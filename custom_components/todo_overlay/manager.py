from __future__ import annotations

from typing import Literal

from .ha_adapter import HomeAssistantTodoProvider
from .metadata_store import MetadataStore
from .models import ItemPosition, TodoItem, TodoList
from .tree import build_tree

Placement = Literal["before", "after", "inside"]


class TodoManager:
    """Main entry point for the Todo Overlay business logic."""

    def __init__(
        self,
        adapter: HomeAssistantTodoProvider,
        metadata_store: MetadataStore,
    ) -> None:
        self._adapter = adapter
        self._metadata_store = metadata_store

    async def get_list(
        self,
        entity_id: str,
    ) -> TodoList:
        """Return a Todo list."""

        items = await self._adapter.get_items(entity_id)

        positions = await self._metadata_store.get_relationships(
            entity_id,
        )

        return TodoList(
            entity_id=entity_id,
            items=build_tree(items, positions),
        )

    async def move_item(
        self,
        entity_id: str,
        child_id: str,
        reference_id: str,
        placement: Placement,
    ) -> None:
        """Move an item before, after, or inside another item."""

        if reference_id == child_id:
            raise ValueError(f"Cannot move {child_id} relative to itself")

        items = await self._adapter.get_items(entity_id)
        positions = await self._metadata_store.get_relationships(entity_id)

        reference_position = positions.get(reference_id)
        reference_parent_id = (
            reference_position.parent_id if reference_position else None
        )

        new_parent_id = reference_id if placement == "inside" else reference_parent_id

        self._ensure_no_cycle(child_id, new_parent_id, positions)

        siblings = self._siblings(items, positions, new_parent_id, exclude=child_id)

        if placement == "inside":
            siblings.append(child_id)
        else:
            reference_index = siblings.index(reference_id)
            insert_at = reference_index if placement == "before" else reference_index + 1
            siblings.insert(insert_at, child_id)

        await self._metadata_store.set_positions(
            entity_id,
            {
                item_id: ItemPosition(parent_id=new_parent_id, order=order)
                for order, item_id in enumerate(siblings)
            },
        )

    def _ensure_no_cycle(
        self,
        child_id: str,
        new_parent_id: str | None,
        positions: dict[str, ItemPosition],
    ) -> None:
        ancestor = new_parent_id

        while ancestor is not None:
            if ancestor == child_id:
                raise ValueError(
                    f"Cannot move {child_id} under {new_parent_id}: "
                    f"{new_parent_id} is already a descendant of {child_id}"
                )

            position = positions.get(ancestor)
            ancestor = position.parent_id if position else None

    @staticmethod
    def _siblings(
        items: list[TodoItem],
        positions: dict[str, ItemPosition],
        parent_id: str | None,
        exclude: str,
    ) -> list[str]:
        """Return sibling item ids under parent_id, in their current order."""

        def parent_of(item_id: str) -> str | None:
            position = positions.get(item_id)
            return position.parent_id if position else None

        def order_of(item_id: str) -> int:
            position = positions.get(item_id)
            return position.order if position else 0

        siblings = [
            item.id
            for item in items
            if item.id != exclude and parent_of(item.id) == parent_id
        ]

        siblings.sort(key=order_of)

        return siblings
