from __future__ import annotations

from .errors import CycleError, ItemNotFoundError
from .manager_types import Placement
from .models import ItemPosition, TodoItem


class PositionMixin:
    """Repositioning items within an entity, and physically transferring
    them (and their subtree) across two different entities - plus the
    shared tree-structure helpers (siblings, descendants, cycle checks)
    every other mixin also relies on to walk parent/child relationships."""

    async def move_item(
        self,
        entity_id: str,
        child_id: str,
        reference_id: str,
        placement: Placement,
    ) -> None:
        """Move an item before, after, or inside another item."""

        async with self._lock_for(entity_id):
            await self._reposition(entity_id, child_id, reference_id, placement)

        # Purely overlay metadata - never touches the native entity's
        # items or state at all, so without this, no OTHER card instance
        # (a different browser/device/tab) has any way to know a reorder
        # happened at all (see todo-overlay-list.ts's own comment on its
        # hass-state-based refresh trigger, which only reacts to a native
        # todo.* entity actually changing).
        items = await self._adapter.get_items(entity_id)
        moved_item = next((item for item in items if item.id == child_id), None)

        if moved_item is not None:
            self._fire_event(entity_id, child_id, moved_item.title, "moved")

    async def _reposition(
        self,
        entity_id: str,
        child_id: str,
        reference_id: str,
        placement: Placement,
    ) -> None:
        """Core before/after/inside repositioning - no locking, no event
        firing. Callers own both themselves: move_item() locks and fires
        its own "moved" event; create_item()'s own optional positioning
        (see manager_items.py) needs this to run inside its OWN
        already-held lock instead, firing only a single "created" event
        for the whole create-and-place operation.
        """

        if reference_id == child_id:
            raise CycleError(f"Cannot move {child_id} relative to itself")

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

    async def transfer_item(
        self,
        source_entity_id: str,
        item_id: str,
        target_entity_id: str,
        reference_id: str | None,
        placement: Placement,
    ) -> str:
        """Move an item (and its whole subtree) from one todo.* entity to
        another - used when a drag-and-drop drop target belongs to a
        different entity than the one being dragged from.

        Unlike move_item(), which only ever repositions metadata within
        a single entity (every item there already exists on the same
        native list), this is a physical move across two independent
        native lists: the whole subtree is recreated as new items on the
        target entity first, then removed from the source - never the
        other way around, so a failure partway through can't delete an
        item from the source without a working replacement on the
        target.

        reference_id may be None when the target entity has no items at
        all to position relative to (dragging into a wholly empty list) -
        the transferred subtree's root then simply becomes the target's
        first root-level item, regardless of `placement`.

        Returns the transferred root item's new id on the target entity.
        """

        if source_entity_id == target_entity_id:
            if reference_id is None:
                # Can't actually happen from the frontend - the dragged
                # item already lives in this entity, so it can't be
                # empty - but a public method shouldn't silently misbehave
                # if called this way regardless.
                raise ItemNotFoundError(
                    f"reference_id is required for a same-entity move on {source_entity_id}"
                )

            await self.move_item(source_entity_id, item_id, reference_id, placement)
            return item_id

        # Two different entities need to be locked for the duration of
        # the whole operation - locking in a fixed (sorted) order avoids
        # deadlocking against a concurrent transfer running in the
        # opposite direction between the same two entities.
        first_entity_id, second_entity_id = sorted([source_entity_id, target_entity_id])

        async with self._lock_for(first_entity_id):
            async with self._lock_for(second_entity_id):
                return await self._transfer_item_impl(
                    source_entity_id, item_id, target_entity_id, reference_id, placement,
                )

    async def _transfer_item_impl(
        self,
        source_entity_id: str,
        item_id: str,
        target_entity_id: str,
        reference_id: str | None,
        placement: Placement,
    ) -> str:
        source_items = await self._adapter.get_items(source_entity_id)
        source_positions = await self._metadata_store.get_relationships(source_entity_id)
        item_lookup = {item.id: item for item in source_items}

        if item_id not in item_lookup:
            raise ItemNotFoundError(f"No item {item_id!r} found on {source_entity_id}")

        # _descendants() walks top-down (pre-order), so every id's own
        # parent already appears earlier in this list - recreate() below
        # relies on that to always find a mapped new parent id already
        # in id_map by the time it needs one.
        subtree_ids = [item_id, *self._descendants(item_id, source_positions, source_items)]

        quantities = await self._metadata_store.get_quantities(source_entity_id)
        tags = await self._metadata_store.get_tags(source_entity_id)
        trigger_on_due = await self._metadata_store.get_trigger_on_due(source_entity_id)

        def source_parent_id(source_id: str) -> str | None:
            position = source_positions.get(source_id)
            return position.parent_id if position else None

        # Recreate every item in the subtree on the target entity before
        # touching the source at all.
        id_map: dict[str, str] = {}

        for source_id in subtree_ids:
            source_item = item_lookup[source_id]

            new_id = await self._adapter.add_item(
                target_entity_id,
                source_item.title,
                description=source_item.description,
                due_date=source_item.due_date,
                due_datetime=source_item.due_datetime,
            )
            id_map[source_id] = new_id

            if source_item.completed:
                await self._adapter.set_completed(target_entity_id, new_id, True)

            quantity = quantities.get(source_id)

            if quantity:
                await self._metadata_store.set_quantity(target_entity_id, new_id, quantity)

            item_tags = tags.get(source_id)

            if item_tags:
                await self._metadata_store.set_tags(target_entity_id, new_id, item_tags)

            if source_id in trigger_on_due:
                # Re-check due_datetime actually landed - the target
                # entity might not support it at all, in which case
                # add_item() above already silently dropped it (same
                # "gracefully degrade" precedent as cross-entity snapshot
                # loading).
                created_items = await self._adapter.get_items(target_entity_id)
                created_item = next((c for c in created_items if c.id == new_id), None)

                if created_item is not None and created_item.due_datetime:
                    await self._metadata_store.set_trigger_on_due(target_entity_id, new_id, True)

        # Re-establish parent/child relationships and sibling order
        # among the transferred items themselves.
        subtree_position_updates: dict[str, ItemPosition] = {}

        for source_id in subtree_ids:
            parent_source_id = source_parent_id(source_id)

            if parent_source_id is None or parent_source_id not in id_map:
                continue

            siblings_within_subtree = [
                id_map[sid] for sid in subtree_ids if source_parent_id(sid) == parent_source_id
            ]
            subtree_position_updates[id_map[source_id]] = ItemPosition(
                parent_id=id_map[parent_source_id],
                order=siblings_within_subtree.index(id_map[source_id]),
            )

        if subtree_position_updates:
            await self._metadata_store.set_positions(target_entity_id, subtree_position_updates)

        # Place the transferred root among the target's own siblings at
        # the requested reference point - the same insertion logic
        # move_item() uses for an in-entity move.
        new_root_id = id_map[item_id]

        target_items = await self._adapter.get_items(target_entity_id)
        target_positions = await self._metadata_store.get_relationships(target_entity_id)

        if reference_id is None:
            # Nothing to position relative to (the target had no items at
            # all) - the transferred root just becomes a new root-level
            # item, last among whatever else is already at that level
            # (normally nothing, since this is the empty-target case).
            new_parent_id = None
        else:
            reference_position = target_positions.get(reference_id)
            reference_parent_id = reference_position.parent_id if reference_position else None
            new_parent_id = reference_id if placement == "inside" else reference_parent_id

        siblings = self._siblings(target_items, target_positions, new_parent_id, exclude=new_root_id)

        if reference_id is None or placement == "inside":
            siblings.append(new_root_id)
        else:
            reference_index = siblings.index(reference_id)
            insert_at = reference_index if placement == "before" else reference_index + 1
            siblings.insert(insert_at, new_root_id)

        await self._metadata_store.set_positions(
            target_entity_id,
            {
                sibling_id: ItemPosition(parent_id=new_parent_id, order=order)
                for order, sibling_id in enumerate(siblings)
            },
        )

        # Everything is safely recreated on the target - now remove the
        # originals from the source.
        for source_id in subtree_ids:
            await self._adapter.remove_item(source_entity_id, source_id)

        await self._metadata_store.remove_positions(source_entity_id, subtree_ids)
        await self._metadata_store.remove_quantities(source_entity_id, subtree_ids)
        await self._metadata_store.remove_tags_for_items(source_entity_id, subtree_ids)
        await self._metadata_store.remove_trigger_on_due_for_items(source_entity_id, subtree_ids)
        await self._metadata_store.remove_due_fired_for_items(source_entity_id, subtree_ids)

        root_title = item_lookup[item_id].title
        self._fire_event(source_entity_id, item_id, root_title, "removed")
        self._fire_event(target_entity_id, new_root_id, root_title, "created")

        return new_root_id

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
                raise CycleError(
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
        exclude: str | None = None,
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

    @staticmethod
    def _order_of(
        item_id: str,
        positions: dict[str, ItemPosition],
    ) -> int:
        position = positions.get(item_id)
        return position.order if position else 0

    @staticmethod
    def _descendant_ids(
        items: list[TodoItem],
        positions: dict[str, ItemPosition],
        parent_id: str,
    ) -> list[str]:
        """Every descendant of parent_id, at ANY depth - not just its
        direct children (see _siblings, which this calls one level at a
        time). Order is unspecified (a plain iterative walk, parents
        collected before their own children); callers that need a
        particular order should sort the result themselves. Used by
        load_list's own scoped "replace" (see manager_snapshots.py) to
        clear an existing subtree entirely before loading a snapshot
        back in under it, rather than leaving orphaned grandchildren
        behind if only the direct children were removed."""

        result: list[str] = []
        frontier = [parent_id]

        while frontier:
            children = PositionMixin._siblings(items, positions, frontier.pop())
            result.extend(children)
            frontier.extend(children)

        return result

    @staticmethod
    def _parent_id_of(
        item_id: str,
        positions: dict[str, ItemPosition],
    ) -> str | None:
        position = positions.get(item_id)
        return position.parent_id if position else None
