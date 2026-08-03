from __future__ import annotations

from .errors import ItemNotFoundError
from .models import TodoItem


class ItemMixin:
    """Creating items and editing the overlay-only metadata fields native
    Home Assistant todo items have no concept of at all: quantity and
    tags. Also the shared "find by uid or title" resolver every
    service-facing (as opposed to frontend-facing, which already has a
    real item_id) method uses."""

    async def create_item(
        self,
        entity_id: str,
        title: str,
        description: str | None = None,
        due_date: str | None = None,
        due_datetime: str | None = None,
        quantity: str | None = None,
        tags: list[str] | None = None,
        trigger_on_due: bool = False,
    ) -> str:
        """Create an item, including overlay-only fields (quantity,
        tags, trigger_on_due) that Home Assistant's native
        todo.add_item has no concept of.

        trigger_on_due=True is silently ignored if the target entity
        doesn't end up with a due_datetime (either none was given, or
        the entity doesn't support the feature and add_item dropped it)
        - same "gracefully degrade" precedent as due_datetime itself.

        Returns the new item's id.
        """

        async with self._lock_for(entity_id):
            item_id = await self._adapter.add_item(
                entity_id,
                title,
                description=description,
                due_date=due_date,
                due_datetime=due_datetime,
            )

            if quantity:
                await self._metadata_store.set_quantity(entity_id, item_id, quantity)

            if tags:
                await self._metadata_store.set_tags(entity_id, item_id, tags)

            if trigger_on_due:
                created = await self._adapter.get_items(entity_id)
                created_item = next((c for c in created if c.id == item_id), None)

                if created_item is not None and created_item.due_datetime:
                    await self._metadata_store.set_trigger_on_due(entity_id, item_id, True)

        self._fire_event(entity_id, item_id, title, "created", quantity=quantity, tags=tags or [])

        return item_id

    async def update_item(
        self,
        entity_id: str,
        item_id: str,
        title: str | None = None,
        description: str | None = None,
        due_date: str | None = None,
        due_datetime: str | None = None,
    ) -> None:
        """Update an item's native fields (title/description/due) -
        fires "updated" so linked lists, the open-items sensor, and any
        other viewer see the change. Previously the frontend called the
        native todo.update_item service directly for this, which never
        fired any event at all - live-diagnosed: title/description/
        due-date edits never propagated to a linked peer or refreshed
        other open cards."""

        async with self._lock_for(entity_id):
            await self._adapter.update_item(
                entity_id, item_id,
                title=title, description=description,
                due_date=due_date, due_datetime=due_datetime,
            )

        items = await self._adapter.get_items(entity_id)
        item = next((candidate for candidate in items if candidate.id == item_id), None)

        if item is not None:
            self._fire_event(entity_id, item_id, item.title, "updated")

    async def delete_item(
        self,
        entity_id: str,
        item_id: str,
    ) -> None:
        """Delete a single item - fires "removed" so linked lists, the
        open-items sensor, and the todo_overlay.removed automation
        trigger all see it. Previously the frontend called the native
        todo.remove_item service directly for this (both the edit
        dialog's Delete button and each row's own delete cross), which
        never fired any event at all - live-diagnosed: a deletion never
        propagated to a linked peer, leaving a ghost item there forever.

        Any now-orphaned metadata for this item (quantity/tags/
        trigger_on_due) is cleaned up reactively by get_list()'s own
        reconciliation pass, same as before this existed."""

        items = await self._adapter.get_items(entity_id)
        item = next((candidate for candidate in items if candidate.id == item_id), None)

        async with self._lock_for(entity_id):
            await self._adapter.remove_item(entity_id, item_id)

        if item is not None:
            self._fire_event(entity_id, item_id, item.title, "removed")

    async def set_quantity(
        self,
        entity_id: str,
        item_id: str,
        quantity: str | None,
    ) -> None:
        """Set (or clear) an item's quantity - overlay-only metadata,
        since native Home Assistant todo items have no such field."""

        async with self._lock_for(entity_id):
            await self._set_quantity_impl(entity_id, item_id, quantity)

    async def _set_quantity_impl(
        self,
        entity_id: str,
        item_id: str,
        quantity: str | None,
    ) -> None:
        """The actual body of set_quantity(), callable by
        set_quantity_by_item() without re-entering self._lock_for() - see
        TreeMixin._get_list_impl()'s docstring for why that split exists."""

        await self._metadata_store.set_quantity(entity_id, item_id, quantity)

        items = await self._adapter.get_items(entity_id)
        item = next((candidate for candidate in items if candidate.id == item_id), None)

        if item is not None:
            self._fire_event(entity_id, item_id, item.title, "quantity_changed", quantity=quantity)

    async def set_quantity_by_item(
        self,
        entity_id: str,
        item: str,
        quantity: str | None,
    ) -> None:
        """Set an item's quantity, identified by uid or title - the
        service-facing counterpart to set_quantity(), which callers
        with a real item_id already in hand (the frontend) use directly."""

        async with self._lock_for(entity_id):
            resolved = await self._resolve_item(entity_id, item)
            await self._set_quantity_impl(entity_id, resolved.id, quantity)

    async def set_tags(
        self,
        entity_id: str,
        item_id: str,
        tags: list[str],
    ) -> None:
        """Replace an item's full tag list - overlay-only metadata."""

        async with self._lock_for(entity_id):
            await self._metadata_store.set_tags(entity_id, item_id, tags)

        items = await self._adapter.get_items(entity_id)
        item = next((candidate for candidate in items if candidate.id == item_id), None)

        if item is not None:
            self._fire_event(entity_id, item_id, item.title, "tags_replaced", tags=tags)

    async def add_tag(
        self,
        entity_id: str,
        item: str,
        tag: str,
    ) -> None:
        """Add a tag to an item, identified by uid or title (matching
        the same uid-or-summary convention Home Assistant's own
        todo.update_item service uses for its "item" field)."""

        async with self._lock_for(entity_id):
            resolved = await self._resolve_item(entity_id, item)
            await self._metadata_store.add_tag(entity_id, resolved.id, tag)

        self._fire_event(entity_id, resolved.id, resolved.title, "tag_added", tag=tag)

    async def remove_tag(
        self,
        entity_id: str,
        item: str,
        tag: str,
    ) -> None:
        async with self._lock_for(entity_id):
            resolved = await self._resolve_item(entity_id, item)
            await self._metadata_store.remove_tag(entity_id, resolved.id, tag)

        self._fire_event(entity_id, resolved.id, resolved.title, "tag_removed", tag=tag)

    async def _resolve_item(
        self,
        entity_id: str,
        item: str,
    ) -> TodoItem:
        items = await self._adapter.get_items(entity_id)

        for candidate in items:
            if item in (candidate.id, candidate.title):
                return candidate

        raise ItemNotFoundError(f"No item {item!r} (by id or title) found on {entity_id}")
