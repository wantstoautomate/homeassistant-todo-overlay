"""Sync logic for linked lists - the conflict-resolution and message
application logic, kept separate from mqtt_link.py's transport plumbing
so it can be unit tested against a fake LinkTransport with no real
broker involved.

Scope, deliberately (see the architecture discussion this was designed
against):
- Only item CONTENT syncs (title, completed, description, due_date/
  due_datetime, quantity, tags) - not position/hierarchy. Each side
  keeps its own local arrangement of linked items.
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
from .ha_adapter import HomeAssistantTodoProvider
from .manager import TodoManager
from .metadata_store import MetadataStore
from .mqtt_link import TOPIC_PREFIX, LinkTransport

_LOGGER = logging.getLogger(__name__)

_SYNCED_FIELDS = ("title", "completed", "description", "due_date", "due_datetime", "quantity", "tags")

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

    return {
        "title": title[:_MAX_TEXT_LENGTH],
        "completed": bool(fields.get("completed")),
        "description": _text(fields.get("description")),
        "due_date": _text(fields.get("due_date"), 32),
        "due_datetime": _text(fields.get("due_datetime"), 64),
        "quantity": _text(fields.get("quantity"), 64),
        "tags": tags,
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
        await self.async_handle_local_change(data["entity_id"], data["item_id"], data["action"])

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

        fields = {
            "title": item.title,
            "completed": item.completed,
            "description": item.description,
            "due_date": item.due_date,
            "due_datetime": item.due_datetime,
            "quantity": quantities.get(item_id),
            "tags": tags.get(item_id, []),
        }

        if (
            current_state is not None
            and current_state.get("deleted_at") is None
            and current_state.get("fields") == fields
        ):
            _LOGGER.debug(
                "async_handle_local_change: fields unchanged from last-synced state for sync_id=%s - ignoring",
                sync_id,
            )
            return

        _LOGGER.debug(
            "async_handle_local_change: publishing upsert for sync_id=%s fields=%s", sync_id, fields,
        )
        await self._publish_upsert(entity_id, link["link_id"], sync_id, fields)

    async def _publish_upsert(
        self,
        entity_id: str,
        link_id: str,
        sync_id: str,
        fields: dict[str, Any],
    ) -> None:
        updated_at = _now_iso()

        await self._metadata_store.set_link_item_state(
            entity_id, sync_id, updated_at=updated_at, deleted_at=None, fields=fields,
        )

        payload = json.dumps({
            "origin": self._instance_id,
            "sync_id": sync_id,
            "updated_at": updated_at,
            "deleted": False,
            "fields": fields,
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

        await self._apply_incoming(
            entity_id, sync_id,
            updated_at=data.get("updated_at", ""),
            deleted=bool(data.get("deleted")),
            fields=data.get("fields"),
        )

    async def _on_snapshot_message(self, entity_id: str, payload: bytes) -> None:
        data = _parse_payload(payload)

        if data is None:
            return

        if data.get("origin") == self._instance_id:
            return

        for sync_id, item_state in data.get("items", {}).items():
            await self._apply_incoming(
                entity_id, sync_id,
                updated_at=item_state.get("updated_at", ""),
                deleted=bool(item_state.get("deleted")),
                fields=item_state.get("fields"),
            )

    async def _apply_incoming(
        self,
        entity_id: str,
        sync_id: str,
        *,
        updated_at: str,
        deleted: bool,
        fields: dict[str, Any] | None,
    ) -> None:
        states = await self._metadata_store.get_all_link_item_states(entity_id)
        current_state = states.get(sync_id)

        if current_state is not None and current_state["updated_at"] >= updated_at:
            return  # we've already applied something at least this new - last-write-wins keeps it

        link = await self._metadata_store.get_link(entity_id)

        if link is None:
            return

        native_uid = link["sync_to_native"].get(sync_id)

        if deleted:
            if native_uid is not None:
                await self._adapter.remove_item(entity_id, native_uid)
                await self._metadata_store.remove_native_sync_mapping(entity_id, sync_id=sync_id)

            await self._metadata_store.set_link_item_state(
                entity_id, sync_id, updated_at=updated_at, deleted_at=updated_at, fields=None,
            )
            return

        if fields is None:
            return

        fields = _sanitize_incoming_fields(fields)

        if fields is None:
            _LOGGER.warning("Ignoring link message with invalid/missing item fields for %s", entity_id)
            return

        if native_uid is None:
            native_uid = await self._manager.create_item(
                entity_id,
                fields["title"],
                description=fields.get("description"),
                due_date=fields.get("due_date"),
                due_datetime=fields.get("due_datetime"),
                quantity=fields.get("quantity"),
                tags=fields.get("tags"),
            )
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

        await self._metadata_store.set_link_item_state(
            entity_id, sync_id, updated_at=updated_at, deleted_at=None, fields=fields,
        )


def _parse_payload(payload: bytes) -> dict[str, Any] | None:
    try:
        return json.loads(payload)
    except (ValueError, UnicodeDecodeError):
        _LOGGER.warning("Ignoring malformed link message payload")
        return None
