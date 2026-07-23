from __future__ import annotations

import logging
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
TRIGGER_ON_DUE_KEY = "_trigger_on_due"
# Which due value a "due" trigger has already fired for, per item - the
# scheduler's own bookkeeping (see due_scheduler.py) so a restart, or any
# reconciliation pass, doesn't re-fire for a due value already handled.
# Keyed separately from TRIGGER_ON_DUE_KEY since toggling the trigger off
# and back on shouldn't itself cause a re-fire if the due value hasn't
# actually changed.
DUE_FIRED_KEY = "_due_fired"


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
        self._cache.get(TRIGGER_ON_DUE_KEY, {}).pop(entity_id, None)
        self._cache.get(DUE_FIRED_KEY, {}).pop(entity_id, None)

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

        for key in (QUANTITIES_KEY, TAGS_KEY, TRIGGER_ON_DUE_KEY, DUE_FIRED_KEY):
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
