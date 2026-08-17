from __future__ import annotations

import logging
import uuid
from typing import Any

from homeassistant.helpers.storage import Store

from .models import ItemPosition

_LOGGER = logging.getLogger(__name__)

STORAGE_VERSION = 2
STORAGE_KEY = "todo_overlay"

# Batches rapid-fire writes (e.g. a multi-step load_list or duplicate
# merge, which would otherwise write the whole store to disk once per
# field per item) into a single write - the in-memory cache is always
# current regardless of this delay, so nothing that reads through
# MetadataStore within the same runtime ever sees stale data; this only
# affects how quickly a write lands on disk. HA still guarantees a
# final flush on clean shutdown (see Store.async_delay_save).
SAVE_DELAY = 3

# Saved snapshots and quantities live under these reserved top-level
# cache keys, separate from the per-entity position maps (which are
# keyed directly by entity_id, e.g. "todo.shopping" - always dotted,
# so this can never collide).
SNAPSHOTS_KEY = "_snapshots"
QUANTITIES_KEY = "_quantities"
TAGS_KEY = "_tags"
# Marks an item as always rendering/behaving like a parent (bold title,
# no checkbox, collapsible) regardless of whether it currently has any
# children - "category" and "person" are purely presentational
# distinctions on the frontend (a person pin gets an initial avatar), not
# different storage shapes; both are just pin_type values here. See
# manager_items.py's set_pin_type for the full rationale.
PIN_TYPE_KEY = "_pin_type"
TRIGGER_ON_DUE_KEY = "_trigger_on_due"
# Which due value a "due" trigger has already fired for, per item - the
# scheduler's own bookkeeping (see due_scheduler.py) so a restart, or any
# reconciliation pass, doesn't re-fire for a due value already handled.
# Keyed separately from TRIGGER_ON_DUE_KEY since toggling the trigger off
# and back on shouldn't itself cause a re-fire if the due value hasn't
# actually changed.
DUE_FIRED_KEY = "_due_fired"
# Which link (if any) a linked entity belongs to, plus the native-uid <->
# sync-id mapping for that entity - the sync id is our own, generated
# independently of whatever uid the underlying todo platform assigns an
# item, since two separate HA instances' native platforms have no shared
# notion of item identity to begin with (see mqtt_link.py).
LINKS_KEY = "_links"
# Per-(entity, sync_id) conflict-resolution bookkeeping: the last-applied
# update time and field values, or a tombstone (deleted_at set, fields
# None) if the item was removed - kept for a bounded window so a
# reordered/late "create" for an already-deleted item doesn't resurrect
# it (see mqtt_link.py's tombstone pruning).
LINK_ITEM_STATE_KEY = "_link_item_state"
# A random id generated once per HA instance (not per entity) - tags
# every MQTT message this instance publishes so it can recognize and
# discard its own messages echoed back by the broker.
INSTANCE_ID_KEY = "_instance_id"


class _TodoOverlayStore(Store):
    """Store subclass with a defensive migration path.

    The base Store's default _async_migrate_func raises NotImplementedError
    for any version it doesn't recognise, which Store.async_load() then
    re-raises outright - meaning without this override, a version bump
    (STORAGE_VERSION has already moved 1 -> 2 once) would hard-crash
    setup for anyone whose stored data predates it, rather than degrading
    gracefully. There's no real historical data to migrate FROM yet (this
    integration hasn't shipped a release under version 1), so this is
    deliberately a safety net rather than an actual v1 -> v2 transform:
    it logs and passes the old data through as-is instead of raising,
    which is the right call for shape-compatible bumps and at least
    doesn't take the whole integration down for an incompatible one.
    """

    async def _async_migrate_func(
        self,
        old_major_version: int,
        old_minor_version: int,
        old_data: dict[str, Any],
    ) -> dict[str, Any]:
        _LOGGER.warning(
            "Migrating %s storage from version %s.%s to %s.%s with no "
            "dedicated migration - passing stored data through unchanged",
            self.key, old_major_version, old_minor_version,
            self.version, self.minor_version,
        )

        return old_data


class MetadataStore:
    """Stores Todo Overlay metadata."""

    def __init__(self, hass) -> None:
        self._store = _TodoOverlayStore(hass, STORAGE_VERSION, STORAGE_KEY)
        self._cache: dict[str, dict[str, dict]] | None = None

    async def _load(self) -> None:
        if self._cache is None:
            self._cache = await self._store.async_load() or {}

    def _save(self) -> None:
        assert self._cache is not None

        self._store.async_delay_save(lambda: self._cache, SAVE_DELAY)

    async def get_relationships(
        self,
        entity_id: str,
    ) -> dict[str, ItemPosition]:
        await self._load()

        assert self._cache is not None

        return {
            item_id: ItemPosition(parent_id=data["parent"], order=data["order"])
            for item_id, data in self._cache.get(entity_id, {}).items()
        }

    async def set_positions(
        self,
        entity_id: str,
        positions: dict[str, ItemPosition],
    ) -> None:
        """Write positions for one or more items in a single save."""

        await self._load()

        assert self._cache is not None

        entity_positions = self._cache.setdefault(entity_id, {})

        for item_id, position in positions.items():
            entity_positions[item_id] = {
                "parent": position.parent_id,
                "order": position.order,
            }

        self._save()

    async def remove_positions(
        self,
        entity_id: str,
        item_ids: list[str],
    ) -> None:
        """Drop stored positions for items that no longer exist, e.g.
        after a clear-completed removal."""

        await self._load()

        assert self._cache is not None

        entity_positions = self._cache.get(entity_id)

        if not entity_positions:
            return

        for item_id in item_ids:
            entity_positions.pop(item_id, None)

        self._save()

    async def clear_positions(
        self,
        entity_id: str,
    ) -> None:
        """Drop every stored position for an entity, e.g. before a
        replace-mode load repopulates the list from scratch."""

        await self._load()

        assert self._cache is not None

        self._cache.pop(entity_id, None)

        self._save()

    async def clear_entity(
        self,
        entity_id: str,
    ) -> None:
        """Drop every stored position, quantity, and tag for an entity.

        Unlike clear_positions() (used before a replace-mode load
        repopulates a still-live list), this is for when the entity
        itself stops existing - e.g. removed from the entity registry -
        so nothing will ever again call get_list() for it to trigger the
        normal per-item orphan cleanup (see TodoManager's reconciliation
        sweep). Without this, that entity's whole metadata block would
        sit in storage forever.
        """

        await self._load()

        assert self._cache is not None

        self._cache.pop(entity_id, None)
        self._cache.get(QUANTITIES_KEY, {}).pop(entity_id, None)
        self._cache.get(TAGS_KEY, {}).pop(entity_id, None)
        self._cache.get(PIN_TYPE_KEY, {}).pop(entity_id, None)
        self._cache.get(TRIGGER_ON_DUE_KEY, {}).pop(entity_id, None)
        self._cache.get(DUE_FIRED_KEY, {}).pop(entity_id, None)
        self._cache.get(LINKS_KEY, {}).pop(entity_id, None)
        self._cache.get(LINK_ITEM_STATE_KEY, {}).pop(entity_id, None)

        self._save()

    async def rename_entity(
        self,
        old_entity_id: str,
        new_entity_id: str,
    ) -> None:
        """Move stored positions/quantities/tags from one entity_id key
        to another, e.g. when a todo.* entity is renamed in the entity
        registry - without this, a rename would silently orphan
        everything under the old id (same underlying problem as
        clear_entity(), just a move instead of a drop)."""

        await self._load()

        assert self._cache is not None

        if old_entity_id in self._cache:
            self._cache[new_entity_id] = self._cache.pop(old_entity_id)

        for key in (
            QUANTITIES_KEY, TAGS_KEY, PIN_TYPE_KEY, TRIGGER_ON_DUE_KEY, DUE_FIRED_KEY,
            LINKS_KEY, LINK_ITEM_STATE_KEY,
        ):
            bucket = self._cache.get(key, {})

            if old_entity_id in bucket:
                bucket[new_entity_id] = bucket.pop(old_entity_id)

        self._save()

    async def save_snapshot(
        self,
        name: str,
        snapshot: list[dict],
    ) -> None:
        """Save a named snapshot of a list's items/hierarchy.

        Snapshots are entity-agnostic: a name is a single global slot,
        not scoped to whichever todo entity it was saved from - so it
        can be loaded onto any entity, including a different one than
        it came from.
        """

        await self._load()

        assert self._cache is not None

        self._cache.setdefault(SNAPSHOTS_KEY, {})[name] = snapshot

        self._save()

    async def get_snapshot(
        self,
        name: str,
    ) -> list[dict] | None:
        await self._load()

        assert self._cache is not None

        return self._cache.get(SNAPSHOTS_KEY, {}).get(name)

    async def list_snapshots(
        self,
    ) -> list[str]:
        await self._load()

        assert self._cache is not None

        return sorted(self._cache.get(SNAPSHOTS_KEY, {}).keys())

    async def delete_snapshot(
        self,
        name: str,
    ) -> None:
        await self._load()

        assert self._cache is not None

        self._cache.get(SNAPSHOTS_KEY, {}).pop(name, None)

        self._save()

    async def get_quantities(
        self,
        entity_id: str,
    ) -> dict[str, str]:
        await self._load()

        assert self._cache is not None

        return dict(self._cache.get(QUANTITIES_KEY, {}).get(entity_id, {}))

    async def set_quantity(
        self,
        entity_id: str,
        item_id: str,
        quantity: str | None,
    ) -> None:
        """Set (or clear, if quantity is falsy) an item's quantity."""

        await self._load()

        assert self._cache is not None

        entity_quantities = self._cache.setdefault(QUANTITIES_KEY, {}).setdefault(entity_id, {})

        if quantity:
            entity_quantities[item_id] = quantity
        else:
            entity_quantities.pop(item_id, None)

        self._save()

    async def get_pin_types(
        self,
        entity_id: str,
    ) -> dict[str, str]:
        await self._load()

        assert self._cache is not None

        return dict(self._cache.get(PIN_TYPE_KEY, {}).get(entity_id, {}))

    async def set_pin_type(
        self,
        entity_id: str,
        item_id: str,
        pin_type: str | None,
    ) -> None:
        """Set (or clear, if pin_type is None) an item's pin type."""

        await self._load()

        assert self._cache is not None

        entity_pin_types = self._cache.setdefault(PIN_TYPE_KEY, {}).setdefault(entity_id, {})

        if pin_type:
            entity_pin_types[item_id] = pin_type
        else:
            entity_pin_types.pop(item_id, None)

        self._save()

    async def remove_pin_types(
        self,
        entity_id: str,
        item_ids: list[str],
    ) -> None:
        """Drop stored pin types for items that no longer exist, e.g.
        after a clear-completed removal."""

        await self._load()

        assert self._cache is not None

        entity_pin_types = self._cache.get(PIN_TYPE_KEY, {}).get(entity_id)

        if not entity_pin_types:
            return

        for item_id in item_ids:
            entity_pin_types.pop(item_id, None)

        self._save()

    async def remove_quantities(
        self,
        entity_id: str,
        item_ids: list[str],
    ) -> None:
        """Drop stored quantities for items that no longer exist, e.g.
        after a clear-completed removal."""

        await self._load()

        assert self._cache is not None

        entity_quantities = self._cache.get(QUANTITIES_KEY, {}).get(entity_id)

        if not entity_quantities:
            return

        for item_id in item_ids:
            entity_quantities.pop(item_id, None)

        self._save()

    async def get_tags(
        self,
        entity_id: str,
    ) -> dict[str, list[str]]:
        await self._load()

        assert self._cache is not None

        return {
            item_id: list(tags)
            for item_id, tags in self._cache.get(TAGS_KEY, {}).get(entity_id, {}).items()
        }

    async def set_tags(
        self,
        entity_id: str,
        item_id: str,
        tags: list[str],
    ) -> None:
        """Replace an item's full tag list."""

        await self._load()

        assert self._cache is not None

        entity_tags = self._cache.setdefault(TAGS_KEY, {}).setdefault(entity_id, {})

        if tags:
            entity_tags[item_id] = list(tags)
        else:
            entity_tags.pop(item_id, None)

        self._save()

    async def add_tag(
        self,
        entity_id: str,
        item_id: str,
        tag: str,
    ) -> None:
        await self._load()

        assert self._cache is not None

        entity_tags = self._cache.setdefault(TAGS_KEY, {}).setdefault(entity_id, {})
        tags = entity_tags.setdefault(item_id, [])

        if tag not in tags:
            tags.append(tag)

        self._save()

    async def remove_tag(
        self,
        entity_id: str,
        item_id: str,
        tag: str,
    ) -> None:
        await self._load()

        assert self._cache is not None

        entity_tags = self._cache.get(TAGS_KEY, {}).get(entity_id, {})
        tags = entity_tags.get(item_id)

        if not tags or tag not in tags:
            return

        tags.remove(tag)

        if not tags:
            entity_tags.pop(item_id, None)

        self._save()

    async def remove_tags_for_items(
        self,
        entity_id: str,
        item_ids: list[str],
    ) -> None:
        """Drop stored tags for items that no longer exist, e.g. after
        a clear-completed removal."""

        await self._load()

        assert self._cache is not None

        entity_tags = self._cache.get(TAGS_KEY, {}).get(entity_id)

        if not entity_tags:
            return

        for item_id in item_ids:
            entity_tags.pop(item_id, None)

        self._save()

    async def get_trigger_on_due(
        self,
        entity_id: str,
    ) -> set[str]:
        """Ids of items with the "trigger on due" toggle enabled - stored
        as a set (only True entries ever get written) rather than a
        dict-of-booleans, since a disabled item just isn't in it."""

        await self._load()

        assert self._cache is not None

        return set(self._cache.get(TRIGGER_ON_DUE_KEY, {}).get(entity_id, {}))

    async def set_trigger_on_due(
        self,
        entity_id: str,
        item_id: str,
        enabled: bool,
    ) -> None:
        await self._load()

        assert self._cache is not None

        entity_flags = self._cache.setdefault(TRIGGER_ON_DUE_KEY, {}).setdefault(entity_id, {})

        if enabled:
            entity_flags[item_id] = True
        else:
            entity_flags.pop(item_id, None)

        self._save()

    async def remove_trigger_on_due_for_items(
        self,
        entity_id: str,
        item_ids: list[str],
    ) -> None:
        """Drop the "trigger on due" flag for items that no longer exist,
        e.g. after a clear-completed removal."""

        await self._load()

        assert self._cache is not None

        entity_flags = self._cache.get(TRIGGER_ON_DUE_KEY, {}).get(entity_id)

        if not entity_flags:
            return

        for item_id in item_ids:
            entity_flags.pop(item_id, None)

        self._save()

    async def get_due_fired(
        self,
        entity_id: str,
    ) -> dict[str, str]:
        """Map of item_id -> the due_datetime value a "due" trigger has
        already fired for - see due_scheduler.py for how this prevents a
        restart, or any reconciliation pass, from re-firing."""

        await self._load()

        assert self._cache is not None

        return dict(self._cache.get(DUE_FIRED_KEY, {}).get(entity_id, {}))

    async def set_due_fired(
        self,
        entity_id: str,
        item_id: str,
        due_value: str,
    ) -> None:
        await self._load()

        assert self._cache is not None

        entity_fired = self._cache.setdefault(DUE_FIRED_KEY, {}).setdefault(entity_id, {})
        entity_fired[item_id] = due_value

        self._save()

    async def remove_due_fired_for_items(
        self,
        entity_id: str,
        item_ids: list[str],
    ) -> None:
        """Drop fired-tracking for items that no longer exist, e.g. after
        a clear-completed removal."""

        await self._load()

        assert self._cache is not None

        entity_fired = self._cache.get(DUE_FIRED_KEY, {}).get(entity_id)

        if not entity_fired:
            return

        for item_id in item_ids:
            entity_fired.pop(item_id, None)

        self._save()

    async def get_instance_id(self) -> str:
        """A random id generated once and persisted for this HA instance's
        lifetime - see INSTANCE_ID_KEY."""

        await self._load()

        assert self._cache is not None

        instance_id = self._cache.get(INSTANCE_ID_KEY)

        if not instance_id:
            instance_id = uuid.uuid4().hex
            self._cache[INSTANCE_ID_KEY] = instance_id
            self._save()

        return instance_id

    async def get_all_linked_entity_ids(self) -> list[str]:
        """Every entity_id with a stored link - used at startup to resume
        syncing whatever was already linked before a restart."""

        await self._load()

        assert self._cache is not None

        return list(self._cache.get(LINKS_KEY, {}))

    async def get_link(
        self,
        entity_id: str,
    ) -> dict[str, Any] | None:
        """The link this entity belongs to, or None if unlinked.

        Shape: {"link_id": str, "native_to_sync": {uid: sync_id},
        "sync_to_native": {sync_id: uid}}.
        """

        await self._load()

        assert self._cache is not None

        return self._cache.get(LINKS_KEY, {}).get(entity_id)

    async def set_link(
        self,
        entity_id: str,
        link_id: str,
    ) -> None:
        """Link this entity to link_id, replacing any existing link on it
        (including its id<->id mappings and item state - a re-link starts
        fresh rather than mixing bookkeeping from a previous partner)."""

        await self._load()

        assert self._cache is not None

        self._cache.setdefault(LINKS_KEY, {})[entity_id] = {
            "link_id": link_id,
            "native_to_sync": {},
            "sync_to_native": {},
        }
        self._cache.setdefault(LINK_ITEM_STATE_KEY, {})[entity_id] = {}

        self._save()

    async def remove_link(
        self,
        entity_id: str,
    ) -> None:
        """Unlink this entity - clears its link, id mappings, and item
        state entirely. Local items themselves are untouched."""

        await self._load()

        assert self._cache is not None

        self._cache.get(LINKS_KEY, {}).pop(entity_id, None)
        self._cache.get(LINK_ITEM_STATE_KEY, {}).pop(entity_id, None)

        self._save()

    async def set_native_sync_mapping(
        self,
        entity_id: str,
        native_uid: str,
        sync_id: str,
    ) -> None:
        link = self._cache.get(LINKS_KEY, {}).get(entity_id) if self._cache else None

        if link is None:
            return

        link["native_to_sync"][native_uid] = sync_id
        link["sync_to_native"][sync_id] = native_uid

        self._save()

    async def remove_native_sync_mapping(
        self,
        entity_id: str,
        *,
        native_uid: str | None = None,
        sync_id: str | None = None,
    ) -> None:
        """Remove a mapping by either of its two keys."""

        link = self._cache.get(LINKS_KEY, {}).get(entity_id) if self._cache else None

        if link is None:
            return

        if native_uid is not None:
            sync_id = link["native_to_sync"].pop(native_uid, sync_id)
        if sync_id is not None:
            link["sync_to_native"].pop(sync_id, None)
            link["native_to_sync"] = {
                uid: sid for uid, sid in link["native_to_sync"].items() if sid != sync_id
            }

        self._save()

    async def get_all_link_item_states(
        self,
        entity_id: str,
    ) -> dict[str, dict[str, Any]]:
        """All known (sync_id -> {"updated_at", "deleted_at", "fields",
        "position"}) conflict-resolution state for this entity's link,
        including tombstones for deleted items."""

        await self._load()

        assert self._cache is not None

        return dict(self._cache.get(LINK_ITEM_STATE_KEY, {}).get(entity_id, {}))

    async def set_link_item_state(
        self,
        entity_id: str,
        sync_id: str,
        *,
        updated_at: str,
        deleted_at: str | None,
        fields: dict[str, Any] | None,
        position: dict[str, Any] | None = None,
    ) -> None:
        await self._load()

        assert self._cache is not None

        entity_state = self._cache.setdefault(LINK_ITEM_STATE_KEY, {}).setdefault(entity_id, {})
        entity_state[sync_id] = {
            "updated_at": updated_at,
            "deleted_at": deleted_at,
            "fields": fields,
            "position": position,
        }

        self._save()

    async def prune_tombstones(
        self,
        entity_id: str,
        *,
        older_than: str,
    ) -> None:
        """Drop tombstones (deleted_at set) older than the given ISO8601
        UTC cutoff - keeps LINK_ITEM_STATE_KEY from growing forever while
        still giving a reasonable window for a late/reordered message
        about an already-deleted item to be correctly ignored rather than
        resurrecting it."""

        await self._load()

        assert self._cache is not None

        entity_state = self._cache.get(LINK_ITEM_STATE_KEY, {}).get(entity_id)

        if not entity_state:
            return

        to_drop = [
            sync_id for sync_id, state in entity_state.items()
            if state.get("deleted_at") and state["deleted_at"] < older_than
        ]

        for sync_id in to_drop:
            entity_state.pop(sync_id, None)

        if to_drop:
            self._save()
