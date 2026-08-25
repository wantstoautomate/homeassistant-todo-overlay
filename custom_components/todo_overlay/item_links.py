"""Item links: mirroring a single item onto another item, possibly on a
completely different todo.* entity - distinct from the cross-instance
"linked lists" feature (link_sync.py/mqtt_link.py), which syncs a whole
ENTITY over MQTT between two separate HA instances.

Live use case: a household runs a cross-instance-linked "Shared" list
(pinned "Brodie"/"Anna" sections) alongside separate, purely local lists
like "Travel". An item added to Travel ("Tent") can be linked into
Shared too, so completing/deleting/editing either one keeps the other in
sync - Anna sees "Tent" marked off in Shared the moment Brodie packs it,
without either of them having to maintain two lists by hand.

Scope, deliberately:
- Same-instance only. If the target list also happens to be
  cross-instance-linked (as in the use case above), that hop is NOT this
  module's concern at all - EVENT_ITEM_CHANGED is fired via the normal
  manager methods either way, and link_sync.py's own existing listener
  picks it up and forwards it exactly as it would for any other local
  edit. Anna completing it from HER side arrives back here via
  link_sync's own "synced" action (see _on_item_changed's own comment) -
  this module doesn't need to know Anna's instance exists at all.
- Content + completion mirror bidirectionally (title, description, due
  date/time, quantity, tags, completed - the same field set
  link_sync.py's own _SYNCED_FIELDS already uses, reused rather than
  re-invented). Position/hierarchy never mirrors - the two lists' own
  structures are independent on purpose. pin_type never mirrors either -
  it's presentational and list-specific, not part of an item's own
  "content".
- Deleting either side deletes both (see _on_item_changed's own
  "removed" handling) - unlinking (the item dialog's own checkbox, off)
  only severs the pairing, leaving both items as independent, unlinked
  survivors.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from .const import EVENT_ITEM_CHANGED
from .errors import ItemDeleteProtectedError, ItemLinkTargetNotFoundError, ItemNotFoundError
from .ha_adapter import HomeAssistantTodoProvider
from .metadata_store import MetadataStore

if TYPE_CHECKING:
    from .manager import TodoManager
    from .models import TodoItem

_LOGGER = logging.getLogger(__name__)


class ItemLinkManager:
    """Owns the EVENT_ITEM_CHANGED subscription that keeps every linked
    item pair in sync, plus the create/remove entry points the websocket
    layer calls into."""

    def __init__(
        self,
        hass: Any,
        manager: "TodoManager",
        metadata_store: MetadataStore,
        adapter: HomeAssistantTodoProvider,
        default_enabled: bool,
        default_target_item_id: str | None,
    ) -> None:
        self._hass = hass
        self._manager = manager
        self._metadata_store = metadata_store
        self._adapter = adapter
        self._default_enabled = default_enabled
        self._default_target_item_id = default_target_item_id
        self._unsub: Any = None

    def async_setup(self) -> None:
        self._unsub = self._hass.bus.async_listen(EVENT_ITEM_CHANGED, self._on_item_changed_event)

    def async_shutdown(self) -> None:
        if self._unsub is not None:
            self._unsub()
            self._unsub = None

    async def link_item(
        self,
        entity_id: str,
        item_id: str,
        target_entity_id: str | None = None,
        target_parent_id: str | None = None,
    ) -> str:
        """Create a mirror of (entity_id, item_id) and record the
        bidirectional pairing. Returns the new mirror item's id.

        target_entity_id/target_parent_id, when given, override the
        configured default entirely (see the item dialog's own "change
        destination" control) - target_entity_id alone, with no parent,
        files the mirror at that entity's own root.

        With neither given, the target entity is resolved the same way
        both here and for a snapshot's own "linked: true" marker on
        load (see manager_snapshots.py): exactly one cross-instance
        linked entity currently configured -> use it; anything else
        (zero, or more than one) -> raise rather than guess. The default
        PARENT item is a softer failure - a configured-but-since-deleted
        default just logs and falls back to the target's own root,
        rather than blocking the link entirely over a stale setting.
        """

        source_items = await self._adapter.get_items(entity_id)
        source_item = next((candidate for candidate in source_items if candidate.id == item_id), None)

        if source_item is None:
            raise ItemNotFoundError(f"No item {item_id!r} on {entity_id}")

        resolved_entity_id = target_entity_id
        resolved_parent_id = target_parent_id

        if resolved_entity_id is None:
            resolved_entity_id = await self._resolve_default_entity()

            if resolved_parent_id is None:
                resolved_parent_id = await self._resolve_default_parent(resolved_entity_id)

        new_item_id = await self._manager.create_item(
            entity_id=resolved_entity_id,
            title=source_item.title,
            description=source_item.description,
            due_date=source_item.due_date,
            due_datetime=source_item.due_datetime,
            reference_id=resolved_parent_id,
            placement="inside" if resolved_parent_id else None,
        )

        await self._metadata_store.set_item_link(entity_id, item_id, resolved_entity_id, new_item_id)
        await self._metadata_store.set_item_link(resolved_entity_id, new_item_id, entity_id, item_id)

        quantities = await self._metadata_store.get_quantities(entity_id)
        tags = await self._metadata_store.get_tags(entity_id)

        if quantities.get(item_id):
            await self._manager.set_quantity(resolved_entity_id, new_item_id, quantities[item_id])

        if tags.get(item_id):
            await self._manager.set_tags(resolved_entity_id, new_item_id, tags[item_id])

        if source_item.completed:
            await self._manager.set_completed(resolved_entity_id, new_item_id, True)

        return new_item_id

    async def unlink_item(self, entity_id: str, item_id: str) -> None:
        """Sever the pairing - both items survive, independently, as
        plain unlinked items. Deleting an item that happens to be linked
        is a completely different action (see _on_item_changed's own
        "removed" handling), which deletes both sides instead."""

        link = await self._metadata_store.get_item_link(entity_id, item_id)

        if link is None:
            return

        await self._metadata_store.remove_item_link(entity_id, item_id)
        await self._metadata_store.remove_item_link(link["entity_id"], link["item_id"])

    async def _resolve_default_entity(self) -> str:
        linked_entities = await self._metadata_store.get_all_linked_entity_ids()

        if len(linked_entities) != 1:
            raise ItemLinkTargetNotFoundError(
                f"Cannot auto-resolve a default item-link target - {len(linked_entities)} "
                "cross-instance linked lists currently configured (need exactly 1)"
            )

        return linked_entities[0]

    async def _resolve_default_parent(self, resolved_entity_id: str) -> str | None:
        if not self._default_enabled or not self._default_target_item_id:
            return None

        target_items = await self._adapter.get_items(resolved_entity_id)

        if any(candidate.id == self._default_target_item_id for candidate in target_items):
            return self._default_target_item_id

        _LOGGER.error(
            "Configured default item-link target %r no longer exists on %s - "
            "filing at the list's own root instead",
            self._default_target_item_id, resolved_entity_id,
        )

        return None

    async def _on_item_changed_event(self, event: Any) -> None:
        """The raw EVENT_ITEM_CHANGED listener - just unpacks the event
        and hands off to async_handle_item_changed(), the actual public
        entry point (see its own docstring for why the split exists)."""

        data = event.data
        entity_id = data.get("entity_id")
        item_id = data.get("item_id")
        action = data.get("action")

        if not entity_id or not item_id:
            return

        await self.async_handle_item_changed(entity_id, item_id, action)

    async def async_handle_item_changed(self, entity_id: str, item_id: str, action: str) -> None:
        """The actual body of the EVENT_ITEM_CHANGED reaction - a public
        method, callable directly (bypassing a real event-bus round
        trip entirely) since that's how this project's own tests
        already exercise link_sync.py's own equivalent listener
        (async_handle_local_change) - driving the business-logic entry
        point directly rather than simulating HA's event-dispatch
        machinery in a fake."""

        link = await self._metadata_store.get_item_link(entity_id, item_id)

        if link is None:
            return

        target_entity_id = link["entity_id"]
        target_item_id = link["item_id"]

        if action == "removed":
            await self._propagate_delete(entity_id, item_id, target_entity_id, target_item_id)
            return

        await self._propagate_content(entity_id, item_id, target_entity_id, target_item_id)

    async def _propagate_delete(
        self,
        entity_id: str,
        item_id: str,
        target_entity_id: str,
        target_item_id: str,
    ) -> None:
        """Delete the linked partner, then drop the pairing - in that
        order specifically. The pairing must not survive an ordinary
        delete (whether it succeeds, or the target's already gone) -
        but if the target is delete_protected (see TodoManager.
        delete_item), it's still there and the pairing is still
        accurate, so THAT case bails out before ever touching either
        side's link record, leaving them linked. The alternative -
        dropping the pairing unconditionally up front, before knowing
        whether the delete will actually happen - would leave a
        protected item as a silently orphaned survivor: alive, but
        no longer mirrored to anything, with no link left to even
        signal that."""

        target_items = await self._adapter.get_items(target_entity_id)

        if any(candidate.id == target_item_id for candidate in target_items):
            try:
                await self._manager.delete_item(target_entity_id, target_item_id)
            except ItemDeleteProtectedError:
                _LOGGER.warning(
                    "Not deleting linked partner %s (%s) - it's protected from "
                    "deletion. %s (%s) was still deleted; this pair is now out of "
                    "sync until the partner is unlinked or its protection is cleared.",
                    target_item_id, target_entity_id, item_id, entity_id,
                )
                return

        await self._metadata_store.remove_item_link(entity_id, item_id)
        await self._metadata_store.remove_item_link(target_entity_id, target_item_id)

    async def _propagate_content(
        self,
        entity_id: str,
        item_id: str,
        target_entity_id: str,
        target_item_id: str,
    ) -> None:
        """The idempotency check that makes this self-terminating: every
        field is compared before writing, and a field already matching
        is never re-applied. A->B applies whatever differs (itself
        firing new events); B's own resulting event(s) come back through
        here, compare B against A again, find nothing left to apply, and
        stop - one hop, no separate reentrancy flag needed. The exact
        same principle link_sync.py's own async_handle_local_change
        already uses (skip if current_state.fields == fields), just at
        item granularity instead of whole-list."""

        source_item = await self._get_item(entity_id, item_id)
        target_item = await self._get_item(target_entity_id, target_item_id)

        if source_item is None or target_item is None:
            return

        source_quantities = await self._metadata_store.get_quantities(entity_id)
        target_quantities = await self._metadata_store.get_quantities(target_entity_id)
        source_tags = await self._metadata_store.get_tags(entity_id)
        target_tags = await self._metadata_store.get_tags(target_entity_id)

        source_quantity = source_quantities.get(item_id)
        source_tag_list = source_tags.get(item_id, [])

        content_changed = (
            source_item.title != target_item.title
            or source_item.description != target_item.description
            or source_item.due_date != target_item.due_date
            or source_item.due_datetime != target_item.due_datetime
        )

        if content_changed:
            await self._manager.update_item(
                entity_id=target_entity_id,
                item_id=target_item_id,
                title=source_item.title,
                description=source_item.description,
                due_date=source_item.due_date,
                due_datetime=source_item.due_datetime,
            )

        if source_quantity != target_quantities.get(target_item_id):
            await self._manager.set_quantity(target_entity_id, target_item_id, source_quantity)

        if sorted(source_tag_list) != sorted(target_tags.get(target_item_id, [])):
            await self._manager.set_tags(target_entity_id, target_item_id, source_tag_list)

        if source_item.completed != target_item.completed:
            await self._manager.set_completed(target_entity_id, target_item_id, source_item.completed)

    async def _get_item(self, entity_id: str, item_id: str) -> "TodoItem | None":
        items = await self._adapter.get_items(entity_id)

        return next((candidate for candidate in items if candidate.id == item_id), None)
