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

    async def set_completed(
        self,
        entity_id: str,
        item_id: str,
        completed: bool,
    ) -> list[dict]:
        """Set an item's completion, cascading to all of its descendants.

        Every item whose status actually changes is also repositioned to
        the boundary of its own sibling group: newly-completed items go
        to the top of the completed ones, newly-uncompleted items go to
        the bottom of the incomplete ones. Both are the same insertion
        point (right at the boundary) - which side of it an item reads
        on is just down to its own completed flag - so the move is
        always the shortest possible hop rather than a jump back to
        some stale manually-set position.

        Parents never have their own completed status stored - it's
        derived from their children (see build_tree's finalize step) -
        so a parent's raw stored flag can be stale. Reading whether a
        sibling "counts" as complete for repositioning purposes always
        goes through _derived_completed(), never the raw flag, or a
        parent that's visibly all-complete but whose own flag was never
        independently written would be miscategorised as incomplete.

        A descendant flipping status can flip an ancestor's derived
        value too, so the ancestor chain is walked afterwards, using a
        before/after snapshot of each ancestor's derived status to
        decide whether it changed and should also be repositioned.

        Returns the prior completed state of every item actually changed,
        so a caller can offer to undo the whole cascade.
        """

        items = await self._adapter.get_items(entity_id)
        positions = await self._metadata_store.get_relationships(entity_id)
        item_lookup = {item.id: item for item in items}

        before_derived = self._derived_completed(items, positions)

        target_ids = [item_id, *self._descendants(item_id, positions, items)]

        changed = []
        touched_ids = []

        for target_id in target_ids:
            item = item_lookup.get(target_id)

            if item is None or item.completed == completed:
                continue

            changed.append({"id": target_id, "completed": item.completed})

            await self._adapter.set_completed(entity_id, target_id, completed)
            item.completed = completed
            touched_ids.append(target_id)

        position_updates: dict[str, ItemPosition] = {}

        for target_id in touched_ids:
            derived = self._derived_completed(items, positions)
            reposition = self._reposition_at_boundary(target_id, items, positions, derived)
            position_updates.update(reposition)
            positions.update(reposition)

        ancestor_id = self._parent_id_of(item_id, positions)

        while ancestor_id is not None:
            if ancestor_id not in item_lookup:
                break

            derived = self._derived_completed(items, positions)
            new_status = derived[ancestor_id]

            if new_status == before_derived.get(ancestor_id, False):
                break

            reposition = self._reposition_at_boundary(ancestor_id, items, positions, derived)
            position_updates.update(reposition)
            positions.update(reposition)

            ancestor_id = self._parent_id_of(ancestor_id, positions)

        if position_updates:
            await self._metadata_store.set_positions(entity_id, position_updates)

        return changed

    def _reposition_at_boundary(
        self,
        item_id: str,
        items: list[TodoItem],
        positions: dict[str, ItemPosition],
        derived: dict[str, bool],
    ) -> dict[str, ItemPosition]:
        """Move item_id to sit right at the incomplete/completed boundary
        within its own sibling group, preserving the relative order of
        the siblings on either side of it."""

        parent_id = self._parent_id_of(item_id, positions)

        ordered_siblings = self._siblings(items, positions, parent_id, exclude=item_id)

        incomplete = [sid for sid in ordered_siblings if not derived[sid]]
        already_completed = [sid for sid in ordered_siblings if derived[sid]]

        new_order = incomplete + [item_id] + already_completed

        return {
            sibling_id: ItemPosition(parent_id=parent_id, order=order)
            for order, sibling_id in enumerate(new_order)
        }

    @staticmethod
    def _parent_id_of(
        item_id: str,
        positions: dict[str, ItemPosition],
    ) -> str | None:
        position = positions.get(item_id)
        return position.parent_id if position else None

    @staticmethod
    def _derived_completed(
        items: list[TodoItem],
        positions: dict[str, ItemPosition],
    ) -> dict[str, bool]:
        """Compute each item's effectively-rendered completed status:
        a leaf's own stored flag, or - for a parent - whether all of its
        children are (recursively) derived-complete. Mirrors tree.py's
        finalize() step, but as a lookup manager.py can use to compare
        siblings during repositioning, since the raw adapter flag for a
        parent may never itself have been written."""

        item_by_id = {item.id: item for item in items}

        children_by_parent: dict[str | None, list[str]] = {}

        for item in items:
            parent_id = TodoManager._parent_id_of(item.id, positions)
            children_by_parent.setdefault(parent_id, []).append(item.id)

        result: dict[str, bool] = {}

        def compute(item_id: str) -> bool:
            if item_id in result:
                return result[item_id]

            children = children_by_parent.get(item_id, [])
            value = (
                all(compute(child_id) for child_id in children)
                if children
                else item_by_id[item_id].completed
            )
            result[item_id] = value

            return value

        for item in items:
            compute(item.id)

        return result

    async def restore_completed(
        self,
        entity_id: str,
        changes: list[dict],
    ) -> None:
        """Write back exact prior completion states, e.g. to undo a cascade."""

        for change in changes:
            await self._adapter.set_completed(
                entity_id,
                change["id"],
                change["completed"],
            )

    async def clear_completed(
        self,
        entity_id: str,
    ) -> list[str]:
        """Remove every top-level item that's complete, along with all of
        its descendants (which must themselves all be complete too,
        since that's exactly how a parent's completion is derived).

        Only top-level items are considered for removal - a completed
        subtree nested under an still-incomplete ancestor is left alone,
        matching the native card's "clear completed" behaviour of
        operating on the list as a whole rather than on nested groups.

        Returns the ids of everything removed.
        """

        items = await self._adapter.get_items(entity_id)
        positions = await self._metadata_store.get_relationships(entity_id)

        derived = self._derived_completed(items, positions)

        root_ids = [
            item.id
            for item in items
            if self._parent_id_of(item.id, positions) is None
        ]

        removed_ids: list[str] = []

        for root_id in root_ids:
            if not derived[root_id]:
                continue

            removed_ids.append(root_id)
            removed_ids.extend(self._descendants(root_id, positions, items))

        for removed_id in removed_ids:
            await self._adapter.remove_item(entity_id, removed_id)

        if removed_ids:
            await self._metadata_store.remove_positions(entity_id, removed_ids)

        return removed_ids

    @staticmethod
    def _descendants(
        item_id: str,
        positions: dict[str, ItemPosition],
        items: list[TodoItem],
    ) -> list[str]:
        children_by_parent: dict[str | None, list[str]] = {}

        for item in items:
            position = positions.get(item.id)
            parent_id = position.parent_id if position else None
            children_by_parent.setdefault(parent_id, []).append(item.id)

        def walk(of_id: str) -> list[str]:
            result = []

            for child_id in children_by_parent.get(of_id, []):
                result.append(child_id)
                result.extend(walk(child_id))

            return result

        return walk(item_id)

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
