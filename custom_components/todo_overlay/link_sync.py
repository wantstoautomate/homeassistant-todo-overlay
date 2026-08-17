"""Sync logic for linked lists - the conflict-resolution and message
application logic, kept separate from mqtt_link.py's transport plumbing
so it can be unit tested against a fake LinkTransport with no real
broker involved.

Scope, deliberately (see the architecture discussion this was designed
against):
- Item CONTENT syncs (title, completed, description, due_date/
  due_datetime, quantity, tags) AND position/hierarchy (parent +
  before/after/inside a sibling - see _compute_position_message/
  _apply_incoming_position) - both ride the same last-write-wins-by-
  timestamp message a content change already used alone. Position is
  necessarily best-effort, not strongly consistent: two sides
  reordering the SAME neighborhood at the same moment can still end up
  disagreeing about the exact final order (there's no distributed
  ordered-list algorithm here, just "the newest move wins for the item
  that moved") - acceptable for the stated scope below, not for a
  general distributed database.
- Strictly two-party, one link per list.
- Conflict resolution is last-write-wins by wall-clock UTC timestamp per
  item - relies on both instances' clocks being reasonably accurate
  (NTP, as virtually all modern systems are), not a logical clock. Fine
  for a two-person household list, not a general distributed database.
- Deletions are tombstoned (state kept with deleted_at set, not purged)
  for a bounded window so a late/reordered "create" for an
  already-deleted item can't resurrect it - see
  metadata_store.prune_tombstones.
- Each item has its own "sync id", generated independently of the
  underlying todo platform's own native item uid, since two separate HA
  instances' native platforms share no notion of item identity at all.

Echo suppression deliberately does NOT use an in-flight "currently
applying" flag: HA's event bus schedules listeners as tasks rather than
calling them inline (see EventBus.async_fire), so a transient flag could
be cleared before the echoed EVENT_ITEM_CHANGED is even processed.
Instead, a local change is only published if it actually differs from
the last-synced state already on record for that item - naturally
idempotent regardless of event-loop timing, since applying a remote
change writes that same state before the native call that triggers the
echo even happens.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from .const import EVENT_ITEM_CHANGED
from .errors import CycleError, ItemNotFoundError
from .ha_adapter import HomeAssistantTodoProvider
from .manager import TodoManager
from .manager_types import PIN_TYPES, Placement
from .metadata_store import MetadataStore
from .mqtt_link import TOPIC_PREFIX, LinkTransport

_LOGGER = logging.getLogger(__name__)

_SYNCED_FIELDS = (
    "title", "completed", "description", "due_date", "due_datetime", "quantity", "tags", "pin_type",
)

# Fired directly on this instance's own event bus after successfully
# applying an incoming remote change - bypassing TodoManager entirely,
# unlike every other _fire_event call site in this codebase, and for
# the same reason _apply_incoming itself never calls TodoManager (see
# its own comment): open cards on THIS instance still need to know to
# reload (see todo-overlay-list.ts's own subscription to
# EVENT_ITEM_CHANGED - live-reproduced bug: without this, applying an
# incoming quantity/tag/title change updated the backend correctly but
# never refreshed an already-open card on the receiving side at all,
# a direct side effect of fixing the echo loop). _on_item_changed_event
# explicitly ignores this action so it's never mistaken for a new
# local change to publish right back out.
_SYNC_APPLIED_ACTION = "synced"

# Caps on incoming remote fields before they're ever applied to a real
# todo.* entity - a link message is otherwise arbitrary JSON from the
# wire with no schema guarantee (a hostile or misbehaving peer, or a
# broker ACL misconfiguration letting unrelated traffic through).
_MAX_TEXT_LENGTH = 1000
_MAX_TAGS = 50


def _sanitize_incoming_fields(fields: dict[str, Any] | None) -> dict[str, Any] | None:
    """Validate and normalize a remote peer's item fields. Returns None
    if fields isn't a dict or is missing a usable title, so the caller
    can skip applying it rather than crash on a malformed payload."""

    if not isinstance(fields, dict):
        return None

    title = fields.get("title")

    if not isinstance(title, str) or not title.strip():
        return None

    def _text(value: Any, max_length: int = _MAX_TEXT_LENGTH) -> str | None:
        return value[:max_length] if isinstance(value, str) else None

    tags = fields.get("tags")
    tags = [tag[:_MAX_TEXT_LENGTH] for tag in tags if isinstance(tag, str)][:_MAX_TAGS] if isinstance(tags, list) else []

    pin_type = fields.get("pin_type")
    pin_type = pin_type if pin_type in PIN_TYPES else None

    return {
        "title": title[:_MAX_TEXT_LENGTH],
        "completed": bool(fields.get("completed")),
        "description": _text(fields.get("description")),
        "due_date": _text(fields.get("due_date"), 32),
        "due_datetime": _text(fields.get("due_datetime"), 64),
        "quantity": _text(fields.get("quantity"), 64),
        "tags": tags,
        "pin_type": pin_type,
    }


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _item_topic(link_id: str, sync_id: str) -> str:
    return f"{TOPIC_PREFIX}/{link_id}/item/{sync_id}"


def _item_topic_filter(link_id: str) -> str:
    return f"{TOPIC_PREFIX}/{link_id}/item/+"


def _snapshot_topic(link_id: str, instance_id: str) -> str:
    return f"{TOPIC_PREFIX}/{link_id}/snapshot/{instance_id}"


def _snapshot_topic_filter(link_id: str) -> str:
    return f"{TOPIC_PREFIX}/{link_id}/snapshot/+"


class LinkSyncManager:
    """Owns every active link's MQTT subscriptions and translates between
    TodoManager's item events and the wire protocol above."""

    def __init__(
        self,
        hass: Any,
        manager: TodoManager,
        metadata_store: MetadataStore,
        adapter: HomeAssistantTodoProvider,
        transport: LinkTransport,
    ) -> None:
        self._hass = hass
        self._manager = manager
        self._metadata_store = metadata_store
        self._adapter = adapter
        self._transport = transport
        self._active_entities: set[str] = set()
        self._instance_id: str | None = None
        self._unsub_item_changed: Any = None

    async def async_setup(self) -> None:
        self._instance_id = await self._metadata_store.get_instance_id()
        await self._transport.async_connect()

        self._unsub_item_changed = self._hass.bus.async_listen(
            EVENT_ITEM_CHANGED, self._on_item_changed_event,
        )

        for entity_id in await self._metadata_store.get_all_linked_entity_ids():
            await self.async_start_link(entity_id)

    async def async_shutdown(self) -> None:
        if self._unsub_item_changed is not None:
            self._unsub_item_changed()

        await self._transport.async_disconnect()

    async def _on_item_changed_event(self, event: Any) -> None:
        data = event.data
        _LOGGER.debug("_on_item_changed_event received: %s", data)

        if data.get("action") == _SYNC_APPLIED_ACTION:
            # Our own _notify_local_refresh() echoing back through this
            # same listener - not a new local change to publish.
            return

        await self.async_handle_local_change(data["entity_id"], data["item_id"], data["action"])

    def _notify_local_refresh(self, entity_id: str, item_id: str, title: str) -> None:
        """Tell any open card on THIS instance to reload after applying an
        incoming remote change - fired directly on the event bus, never
        through TodoManager (see _apply_incoming and the module docstring
        for why)."""

        self._hass.bus.async_fire(
            EVENT_ITEM_CHANGED,
            {
                "entity_id": entity_id,
                "item_id": item_id,
                "title": title,
                "action": _SYNC_APPLIED_ACTION,
            },
        )

    async def async_start_link(self, entity_id: str) -> None:
        """Begin syncing entity_id under its stored link_id - subscribes
        to the link's topics and publishes a full current snapshot so
        the other side reconciles immediately, even if it's been offline
        since the last incremental change."""

        link = await self._metadata_store.get_link(entity_id)

        if link is None:
            return

        link_id = link["link_id"]

        def _on_item(topic: str, payload: bytes, entity_id: str = entity_id) -> None:
            self._hass.async_create_task(self._on_item_message(entity_id, payload))

        def _on_snapshot(topic: str, payload: bytes, entity_id: str = entity_id) -> None:
            self._hass.async_create_task(self._on_snapshot_message(entity_id, payload))

        self._transport.subscribe(_item_topic_filter(link_id), _on_item)
        self._transport.subscribe(_snapshot_topic_filter(link_id), _on_snapshot)
        self._active_entities.add(entity_id)

        await self._publish_snapshot(entity_id, link_id)

    async def async_stop_link(self, entity_id: str) -> None:
        link = await self._metadata_store.get_link(entity_id)

        self._active_entities.discard(entity_id)

        if link is None:
            return

        link_id = link["link_id"]
        self._transport.unsubscribe(_item_topic_filter(link_id))
        self._transport.unsubscribe(_snapshot_topic_filter(link_id))

    async def async_handle_local_change(
        self,
        entity_id: str,
        item_id: str,
        action: str,
    ) -> None:
        """Call from the EVENT_ITEM_CHANGED hook. No-ops for anything not
        actively linked, and for a change that turns out to be identical
        to what's already on record (an echo of our own applied remote
        change, or a genuine local no-op)."""

        _LOGGER.debug(
            "async_handle_local_change: entity_id=%s item_id=%s action=%s active_entities=%s",
            entity_id, item_id, action, self._active_entities,
        )

        if entity_id not in self._active_entities:
            _LOGGER.debug("async_handle_local_change: %s is not an active link - ignoring", entity_id)
            return

        link = await self._metadata_store.get_link(entity_id)

        if link is None:
            _LOGGER.debug("async_handle_local_change: no stored link for %s - ignoring", entity_id)
            return

        sync_id = link["native_to_sync"].get(item_id)

        if sync_id is None:
            sync_id = uuid.uuid4().hex
            await self._metadata_store.set_native_sync_mapping(entity_id, item_id, sync_id)

        states = await self._metadata_store.get_all_link_item_states(entity_id)
        current_state = states.get(sync_id)

        if action == "removed":
            if current_state is not None and current_state.get("deleted_at"):
                return

            await self._publish_delete(entity_id, link["link_id"], sync_id)
            return

        items = await self._adapter.get_items(entity_id)
        item = next((candidate for candidate in items if candidate.id == item_id), None)

        if item is None:
            _LOGGER.debug(
                "async_handle_local_change: item_id=%s not found among %d items on %s - ignoring",
                item_id, len(items), entity_id,
            )
            return

        quantities = await self._metadata_store.get_quantities(entity_id)
        tags = await self._metadata_store.get_tags(entity_id)
        pin_types = await self._metadata_store.get_pin_types(entity_id)

        fields = {
            "title": item.title,
            "completed": item.completed,
            "description": item.description,
            "due_date": item.due_date,
            "due_datetime": item.due_datetime,
            "quantity": quantities.get(item_id),
            "tags": tags.get(item_id, []),
            "pin_type": pin_types.get(item_id),
        }

        # Wherever the item currently sits, described as sync-id
        # references the other side can translate back to its own
        # native ids (see its own doc comment) - computed for every
        # action, not just "moved": a "created" item positioned via
        # per-parent quick-add needs the SAME info to land in the right
        # spot on the other side too, not just get appended.
        position = await self._compute_position_message(entity_id, link, item_id)

        if (
            current_state is not None
            and current_state.get("deleted_at") is None
            and current_state.get("fields") == fields
            and current_state.get("position") == position
        ):
            _LOGGER.debug(
                "async_handle_local_change: fields+position unchanged from last-synced state for sync_id=%s - ignoring",
                sync_id,
            )
            return

        _LOGGER.debug(
            "async_handle_local_change: publishing upsert for sync_id=%s fields=%s position=%s",
            sync_id, fields, position,
        )
        await self._publish_upsert(entity_id, link["link_id"], sync_id, fields, position)

    async def _ensure_sync_id(self, entity_id: str, link: dict[str, Any], native_id: str) -> str:
        """Look up native_id's sync id under this link, generating and
        persisting a new one if it doesn't have one yet - the same lazy
        mapping async_handle_local_change already uses for an item's own
        sync_id, reused here so a position message can reference a
        PARENT or SIBLING that's never itself had a content change since
        the link started. set_native_sync_mapping mutates `link` (the
        very dict get_link() returned) in place, so no separate
        re-assignment is needed here - same pattern the item's own
        sync_id lookup above already relies on."""

        sync_id = link["native_to_sync"].get(native_id)

        if sync_id is None:
            sync_id = uuid.uuid4().hex
            await self._metadata_store.set_native_sync_mapping(entity_id, native_id, sync_id)

        return sync_id

    async def _compute_position_message(
        self,
        entity_id: str,
        link: dict[str, Any],
        item_id: str,
    ) -> dict[str, Any] | None:
        """Describe item_id's CURRENT position as a sync-id reference
        the other side can translate back to its own native ids -
        mirrors move_item()'s own before/after/inside model exactly
        (see _apply_incoming_position, which feeds this straight into
        TodoManager._reposition unchanged), just resolved from wherever
        the item happens to sit right now instead of from a user's drag
        gesture. Returns None when there's nothing meaningful to say: a
        root-level item with no parent and no siblings to reference at
        all - it'll land correctly on its own regardless (a brand new
        item naturally becomes a new root item; an existing one simply
        keeps whatever position it already has there)."""

        positions = await self._metadata_store.get_relationships(entity_id)
        items = await self._adapter.get_items(entity_id)

        item_position = positions.get(item_id)
        parent_id = item_position.parent_id if item_position else None

        siblings = self._manager._siblings(items, positions, parent_id)  # noqa: SLF001
        idx = siblings.index(item_id) if item_id in siblings else -1

        placement: Placement
        reference_native_id: str

        if idx > 0:
            reference_native_id = siblings[idx - 1]
            placement = "after"
        elif idx == 0 and len(siblings) > 1:
            reference_native_id = siblings[idx + 1]
            placement = "before"
        elif parent_id is not None:
            # Only child - nothing among siblings to reference, but
            # still has a parent to nest under. "inside" a parent is
            # already expressed via reference_id=parent (see
            # move_item's own API), so this needs no separate
            # parent_sync_id field at all.
            reference_native_id = parent_id
            placement = "inside"
        else:
            return None

        reference_sync_id = await self._ensure_sync_id(entity_id, link, reference_native_id)

        return {"reference_sync_id": reference_sync_id, "placement": placement}

    async def _publish_upsert(
        self,
        entity_id: str,
        link_id: str,
        sync_id: str,
        fields: dict[str, Any],
        position: dict[str, Any] | None,
    ) -> None:
        updated_at = _now_iso()

        await self._metadata_store.set_link_item_state(
            entity_id, sync_id, updated_at=updated_at, deleted_at=None, fields=fields, position=position,
        )

        payload = json.dumps({
            "origin": self._instance_id,
            "sync_id": sync_id,
            "updated_at": updated_at,
            "deleted": False,
            "fields": fields,
            "position": position,
        }).encode()

        await self._transport.async_publish(_item_topic(link_id, sync_id), payload, retain=False, qos=1)

    async def _publish_delete(
        self,
        entity_id: str,
        link_id: str,
        sync_id: str,
    ) -> None:
        updated_at = _now_iso()

        await self._metadata_store.set_link_item_state(
            entity_id, sync_id, updated_at=updated_at, deleted_at=updated_at, fields=None,
        )

        payload = json.dumps({
            "origin": self._instance_id,
            "sync_id": sync_id,
            "updated_at": updated_at,
            "deleted": True,
            "fields": None,
        }).encode()

        await self._transport.async_publish(_item_topic(link_id, sync_id), payload, retain=False, qos=1)

    async def _publish_snapshot(self, entity_id: str, link_id: str) -> None:
        states = await self._metadata_store.get_all_link_item_states(entity_id)

        payload = json.dumps({
            "origin": self._instance_id,
            "items": {
                sync_id: {
                    "updated_at": state["updated_at"],
                    "deleted": state["deleted_at"] is not None,
                    "fields": state["fields"],
                    "position": state.get("position"),
                }
                for sync_id, state in states.items()
            },
        }).encode()

        await self._transport.async_publish(
            _snapshot_topic(link_id, self._instance_id), payload, retain=True, qos=1,
        )

    async def _on_item_message(self, entity_id: str, payload: bytes) -> None:
        data = _parse_payload(payload)

        if data is None:
            return

        if data.get("origin") == self._instance_id:
            return

        sync_id = data.get("sync_id")

        if not sync_id:
            return

        deleted = bool(data.get("deleted"))
        position = data.get("position")

        native_uid = await self._apply_incoming_content(
            entity_id, sync_id,
            updated_at=data.get("updated_at", ""),
            deleted=deleted,
            fields=data.get("fields"),
            position=position,
        )

        # A single live message - no ordering concern the way a
        # snapshot's own unordered dict has (see _on_snapshot_message),
        # so content and position apply back-to-back in one pass.
        if native_uid is not None and not deleted and position is not None:
            await self._apply_incoming_position(entity_id, native_uid, position)

    async def _on_snapshot_message(self, entity_id: str, payload: bytes) -> None:
        data = _parse_payload(payload)

        if data is None:
            return

        if data.get("origin") == self._instance_id:
            return

        items = data.get("items", {})

        # Two passes, deliberately: content first for EVERY item (so
        # every sync_id this snapshot mentions gets its own native_uid
        # mapping established), THEN position for every item that
        # applied cleanly. A snapshot's own dict has no guaranteed
        # parent-before-child order, so a child's position message can
        # easily reference a parent that only gets its own native_uid a
        # few iterations later in the same loop - doing position in a
        # dedicated second pass means that's never a problem, regardless
        # of which order the snapshot happened to iterate in.
        resolved: dict[str, str] = {}

        for sync_id, item_state in items.items():
            deleted = bool(item_state.get("deleted"))
            native_uid = await self._apply_incoming_content(
                entity_id, sync_id,
                updated_at=item_state.get("updated_at", ""),
                deleted=deleted,
                fields=item_state.get("fields"),
                position=item_state.get("position"),
            )

            if native_uid is not None and not deleted:
                resolved[sync_id] = native_uid

        for sync_id, native_uid in resolved.items():
            position = items[sync_id].get("position")

            if position is not None:
                await self._apply_incoming_position(entity_id, native_uid, position)

    async def _apply_incoming_content(
        self,
        entity_id: str,
        sync_id: str,
        *,
        updated_at: str,
        deleted: bool,
        fields: dict[str, Any] | None,
        position: dict[str, Any] | None,
    ) -> str | None:
        """Applies (or tombstones) an incoming item's CONTENT only -
        position is deliberately a separate step (see
        _apply_incoming_position), called by the caller only once this
        returns a resolved native_uid. Records `position` in link-item
        state regardless of whether it goes on to be actually applied,
        so a still-unresolvable reference (see _apply_incoming_position)
        doesn't cause this same message to look "changed" and get
        needlessly republished later (see async_handle_local_change's
        own fields+position comparison).

        Returns the item's native id once successfully created/updated,
        or None if this message was skipped entirely (stale per last-
        write-wins, malformed, or a delete)."""

        states = await self._metadata_store.get_all_link_item_states(entity_id)
        current_state = states.get(sync_id)

        if current_state is not None and current_state["updated_at"] >= updated_at:
            return None  # we've already applied something at least this new - last-write-wins keeps it

        link = await self._metadata_store.get_link(entity_id)

        if link is None:
            return None

        native_uid = link["sync_to_native"].get(sync_id)

        if deleted:
            if native_uid is not None:
                await self._adapter.remove_item(entity_id, native_uid)
                await self._metadata_store.remove_native_sync_mapping(entity_id, sync_id=sync_id)
                self._notify_local_refresh(entity_id, native_uid, "")

            await self._metadata_store.set_link_item_state(
                entity_id, sync_id, updated_at=updated_at, deleted_at=updated_at, fields=None,
            )
            return None

        if fields is None:
            return None

        fields = _sanitize_incoming_fields(fields)

        if fields is None:
            _LOGGER.warning("Ignoring link message with invalid/missing item fields for %s", entity_id)
            return None

        if native_uid is None:
            # Deliberately self._adapter.add_item(), not
            # self._manager.create_item() - live-reproduced runaway echo
            # loop: create_item() fires EVENT_ITEM_CHANGED("created"),
            # which link_sync's own _on_item_changed_event listener picks
            # right back up as a LOCAL change (a brand new item_id has no
            # sync mapping yet, so it can't be recognized as the echo it
            # actually is) and republishes it under a new sync_id - each
            # side then creates another duplicate item in response to
            # the other's republish, forever. The adapter-only call below
            # mirrors what the update branch already does for the exact
            # same reason (self._adapter.update_item(), never
            # self._manager.update_item()) - and equally, position is
            # applied via metadata_store.set_positions/TodoManager
            # _reposition directly (see _apply_incoming_position), never
            # TodoManager.move_item(), for the exact same echo reason.
            native_uid = await self._adapter.add_item(
                entity_id,
                fields["title"],
                description=fields.get("description"),
                due_date=fields.get("due_date"),
                due_datetime=fields.get("due_datetime"),
            )

            quantity = fields.get("quantity")
            if quantity:
                await self._metadata_store.set_quantity(entity_id, native_uid, quantity)

            tags = fields.get("tags")
            if tags:
                await self._metadata_store.set_tags(entity_id, native_uid, tags)

            pin_type = fields.get("pin_type")
            if pin_type:
                await self._metadata_store.set_pin_type(entity_id, native_uid, pin_type)

            if fields.get("completed"):
                await self._adapter.set_completed(entity_id, native_uid, True)

            await self._metadata_store.set_native_sync_mapping(entity_id, native_uid, sync_id)
        else:
            await self._adapter.update_item(
                entity_id, native_uid,
                title=fields.get("title"),
                description=fields.get("description"),
                due_date=fields.get("due_date"),
                due_datetime=fields.get("due_datetime"),
            )
            await self._adapter.set_completed(entity_id, native_uid, bool(fields.get("completed")))
            await self._metadata_store.set_quantity(entity_id, native_uid, fields.get("quantity"))
            await self._metadata_store.set_tags(entity_id, native_uid, fields.get("tags") or [])
            await self._metadata_store.set_pin_type(entity_id, native_uid, fields.get("pin_type"))

        await self._metadata_store.set_link_item_state(
            entity_id, sync_id, updated_at=updated_at, deleted_at=None, fields=fields, position=position,
        )
        self._notify_local_refresh(entity_id, native_uid, fields.get("title", ""))

        return native_uid

    async def _apply_incoming_position(
        self,
        entity_id: str,
        native_uid: str,
        position: dict[str, Any],
    ) -> None:
        """Translates an incoming position's reference_sync_id back to
        THIS side's own native id and applies it via TodoManager's own
        lock-free _reposition core (never move_item() - see
        _apply_incoming_content's own comment on why: no event fires,
        so applying an incoming position can never itself be mistaken
        for a new local change to publish back out). Silently does
        nothing if the reference isn't resolvable locally yet (the
        referenced item hasn't synced here at all) - the position was
        already recorded regardless (see _apply_incoming_content), so a
        later change to either item naturally retries it, and a fresh
        snapshot's own two-pass ordering (see _on_snapshot_message)
        resolves the common case - a whole tree arriving at once -
        without ever hitting this at all."""

        link = await self._metadata_store.get_link(entity_id)

        if link is None:
            return

        reference_sync_id = position.get("reference_sync_id")
        placement = position.get("placement")

        if not reference_sync_id or placement not in ("before", "after", "inside"):
            return

        reference_native_id = link["sync_to_native"].get(reference_sync_id)

        if reference_native_id is None or reference_native_id == native_uid:
            return

        try:
            async with self._manager._lock_for(entity_id):  # noqa: SLF001
                await self._manager._reposition(  # noqa: SLF001
                    entity_id, native_uid, reference_native_id, placement,
                )
        except (CycleError, ItemNotFoundError) as err:
            # A benign race, not a bug to crash over - e.g. the
            # reference item was deleted/moved again locally between
            # this message being queued and applied.
            _LOGGER.debug(
                "_apply_incoming_position: could not reposition %s relative to %s (%s) on %s: %s",
                native_uid, reference_native_id, placement, entity_id, err,
            )
            return

        self._notify_local_refresh(entity_id, native_uid, "")


def _parse_payload(payload: bytes) -> dict[str, Any] | None:
    try:
        return json.loads(payload)
    except (ValueError, UnicodeDecodeError):
        _LOGGER.warning("Ignoring malformed link message payload")
        return None
