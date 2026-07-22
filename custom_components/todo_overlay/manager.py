from __future__ import annotations

import re
from typing import Literal

from .ha_adapter import HomeAssistantTodoProvider
from .metadata_store import MetadataStore
from .models import ItemPosition, TodoItem, TodoList
from .tree import build_tree

# A leading numeric amount, an optional separating space, then a unit
# (which may itself be empty for a bare count like "3"). Used to combine
# matching quantities on a merge-mode load, e.g. "150g" + "200g" -> "350g".
_QUANTITY_PATTERN = re.compile(r"^\s*(\d+(?:\.\d+)?)(\s*)(.*?)\s*$")

Placement = Literal["before", "after", "inside"]
LoadMode = Literal["replace", "merge", "full_merge"]


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
        """Return a Todo list.

        Before building the tree, items that share a title with a
        sibling are merged together (combining their quantities where
        possible) - see _merge_duplicate_titles(). Running this on
        every read, rather than only when our own UI creates an item,
        is what makes it catch duplicates added through ANY path: a
        voice assistant or automation calling todo.add_item directly
        bypasses this integration entirely, but our card already
        reactively re-reads the list whenever the entity's state
        changes (see the live-sync handling in the frontend), so those
        additions still end up back through here.
        """

        items = await self._adapter.get_items(entity_id)

        positions = await self._metadata_store.get_relationships(
            entity_id,
        )

        quantities = await self._metadata_store.get_quantities(entity_id)

        items, positions, quantities = await self._merge_duplicate_titles(
            entity_id, items, positions, quantities,
        )

        return TodoList(
            entity_id=entity_id,
            items=build_tree(items, positions, quantities),
        )

    async def _merge_duplicate_titles(
        self,
        entity_id: str,
        items: list[TodoItem],
        positions: dict[str, ItemPosition],
        quantities: dict[str, str],
    ) -> tuple[list[TodoItem], dict[str, ItemPosition], dict[str, str]]:
        """Collapse sibling items that share a title into one, combining
        their quantities where possible (see _combine_quantities).

        Only merges a group when at least one member actually carries a
        quantity - two plain same-titled items with no quantity at all
        (e.g. two unrelated "Call mom" reminders) are left alone, since
        there'd be nothing to combine and no quantity-shopping-list
        reason to assume they're the same thing.

        A surviving duplicate keeps whichever item appeared first in
        the adapter's own item list (its native creation order), and
        any children the removed duplicate had are reparented onto it
        rather than being silently orphaned or lost.
        """

        groups: dict[tuple[str | None, str], list[TodoItem]] = {}

        for item in items:
            parent_id = self._parent_id_of(item.id, positions)
            groups.setdefault((parent_id, item.title), []).append(item)

        removed_ids: list[str] = []
        reparented: dict[str, ItemPosition] = {}

        for group in groups.values():
            if len(group) < 2:
                continue

            if not any(quantities.get(item.id) for item in group):
                continue

            survivor, *duplicates = group
            combined_quantity = quantities.get(survivor.id)

            for duplicate in duplicates:
                combined_quantity = (
                    self._combine_quantities(combined_quantity, quantities.get(duplicate.id))
                    or combined_quantity
                )

                child_ids = self._siblings(items, positions, duplicate.id)

                if child_ids:
                    survivor_children = self._siblings(items, positions, survivor.id)
                    next_order = max(
                        (self._order_of(cid, positions) for cid in survivor_children),
                        default=-1,
                    ) + 1

                    for child_id in child_ids:
                        reparented[child_id] = ItemPosition(
                            parent_id=survivor.id, order=next_order,
                        )
                        positions[child_id] = reparented[child_id]
                        next_order += 1

                await self._adapter.remove_item(entity_id, duplicate.id)
                removed_ids.append(duplicate.id)

            if combined_quantity:
                await self._metadata_store.set_quantity(entity_id, survivor.id, combined_quantity)
                quantities[survivor.id] = combined_quantity

        if reparented:
            await self._metadata_store.set_positions(entity_id, reparented)

        if not removed_ids:
            return items, positions, quantities

        await self._metadata_store.remove_positions(entity_id, removed_ids)
        await self._metadata_store.remove_quantities(entity_id, removed_ids)

        removed_id_set = set(removed_ids)
        items = [item for item in items if item.id not in removed_id_set]
        positions = {k: v for k, v in positions.items() if k not in removed_id_set}
        quantities = {k: v for k, v in quantities.items() if k not in removed_id_set}

        return items, positions, quantities

    async def create_item(
        self,
        entity_id: str,
        title: str,
        description: str | None = None,
        due_date: str | None = None,
        due_datetime: str | None = None,
        quantity: str | None = None,
    ) -> str:
        """Create an item, including overlay-only fields (quantity)
        that Home Assistant's native todo.add_item has no concept of.

        Returns the new item's id.
        """

        item_id = await self._adapter.add_item(
            entity_id,
            title,
            description=description,
            due_date=due_date,
            due_datetime=due_datetime,
        )

        if quantity:
            await self._metadata_store.set_quantity(entity_id, item_id, quantity)

        return item_id

    async def set_quantity(
        self,
        entity_id: str,
        item_id: str,
        quantity: str | None,
    ) -> None:
        """Set (or clear) an item's quantity - overlay-only metadata,
        since native Home Assistant todo items have no such field."""

        await self._metadata_store.set_quantity(entity_id, item_id, quantity)

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
            await self._metadata_store.remove_quantities(entity_id, removed_ids)

        return removed_ids

    async def save_list(
        self,
        entity_id: str,
        name: str,
        persist_states: bool = False,
    ) -> None:
        """Save a named snapshot of the list's current items and
        hierarchy, for later reuse via load_list().

        Completion status is only captured when persist_states is set -
        otherwise a snapshot is a reusable template that always starts
        fresh (everything incomplete) when loaded.
        """

        todo_list = await self.get_list(entity_id)

        snapshot = [
            self._snapshot_node(item, persist_states)
            for item in todo_list.items
        ]

        await self._metadata_store.save_snapshot(entity_id, name, snapshot)

    async def load_list(
        self,
        entity_id: str,
        name: str,
        mode: LoadMode = "merge",
    ) -> None:
        """Recreate a named snapshot's items on the list.

        - "replace": every current item is removed first, so the list
          ends up matching the snapshot exactly.
        - "merge": items already on the list are matched against
          snapshot items by title path (own title plus ancestor
          titles) and left untouched rather than duplicated - only
          genuinely new items are created, as children of whichever
          existing item matched their snapshot parent.
        - "full_merge": the whole snapshot is (re)created as new items
          regardless of what's already on the list, duplicates and all.
        """

        snapshot = await self._metadata_store.get_snapshot(entity_id, name)

        if snapshot is None:
            raise ValueError(f"No saved list named {name!r} for {entity_id}")

        if mode == "replace":
            for item in await self._adapter.get_items(entity_id):
                await self._adapter.remove_item(entity_id, item.id)

            await self._metadata_store.clear_positions(entity_id)

        existing_by_path: dict[tuple[str, ...], str] = {}

        if mode == "merge":
            items = await self._adapter.get_items(entity_id)
            positions = await self._metadata_store.get_relationships(entity_id)
            existing_by_path = self._title_path_index(items, positions)

        await self._create_snapshot_nodes(
            entity_id,
            snapshot,
            parent_id=None,
            ancestor_path=(),
            existing_by_path=existing_by_path,
        )

    async def list_saved(
        self,
        entity_id: str,
    ) -> list[str]:
        """Names of every snapshot saved for this entity."""

        return await self._metadata_store.list_snapshots(entity_id)

    async def delete_saved(
        self,
        entity_id: str,
        name: str,
    ) -> None:
        await self._metadata_store.delete_snapshot(entity_id, name)

    @staticmethod
    def _snapshot_node(item: TodoItem, persist_states: bool) -> dict:
        return {
            "title": item.title,
            "description": item.description,
            "due_date": item.due_date,
            "due_datetime": item.due_datetime,
            "quantity": item.quantity,
            "completed": item.completed if persist_states else False,
            "children": [
                TodoManager._snapshot_node(child, persist_states)
                for child in item.children
            ],
        }

    @staticmethod
    def _title_path_index(
        items: list[TodoItem],
        positions: dict[str, ItemPosition],
    ) -> dict[tuple[str, ...], str]:
        """Map each item's (ancestor titles..., own title) path to its
        id, so merge-mode loading can recognise items that already
        exist without relying on ids, which a snapshot never has."""

        item_by_id = {item.id: item for item in items}

        def path_of(item_id: str) -> tuple[str, ...]:
            parent_id = TodoManager._parent_id_of(item_id, positions)
            title = item_by_id[item_id].title

            return (*path_of(parent_id), title) if parent_id is not None else (title,)

        return {path_of(item.id): item.id for item in items}

    async def _create_snapshot_nodes(
        self,
        entity_id: str,
        nodes: list[dict],
        parent_id: str | None,
        ancestor_path: tuple[str, ...],
        existing_by_path: dict[tuple[str, ...], str],
    ) -> None:
        items = await self._adapter.get_items(entity_id)
        positions = await self._metadata_store.get_relationships(entity_id)

        existing_children = self._siblings(items, positions, parent_id)
        next_order = max(
            (self._order_of(child_id, positions) for child_id in existing_children),
            default=-1,
        ) + 1

        for node in nodes:
            path = (*ancestor_path, node["title"])
            matched_id = existing_by_path.get(path)

            if matched_id is not None:
                target_id = matched_id

                # Already exists - rather than leaving it untouched
                # outright, combine quantities when possible (e.g.
                # "150g" + "200g" -> "350g"), so a merge unifies
                # matching items instead of just ignoring the incoming
                # amount.
                existing_quantities = await self._metadata_store.get_quantities(entity_id)
                combined = self._combine_quantities(
                    existing_quantities.get(target_id), node.get("quantity")
                )

                if combined is not None:
                    await self._metadata_store.set_quantity(entity_id, target_id, combined)
            else:
                target_id = await self._adapter.add_item(
                    entity_id,
                    node["title"],
                    description=node.get("description"),
                    due_date=node.get("due_date"),
                    due_datetime=node.get("due_datetime"),
                )

                await self._metadata_store.set_positions(
                    entity_id,
                    {target_id: ItemPosition(parent_id=parent_id, order=next_order)},
                )
                next_order += 1

                if node.get("quantity"):
                    await self._metadata_store.set_quantity(entity_id, target_id, node["quantity"])

                if node.get("completed"):
                    await self._adapter.set_completed(entity_id, target_id, True)

            if node.get("children"):
                await self._create_snapshot_nodes(
                    entity_id,
                    node["children"],
                    parent_id=target_id,
                    ancestor_path=path,
                    existing_by_path=existing_by_path,
                )

    @staticmethod
    def _order_of(
        item_id: str,
        positions: dict[str, ItemPosition],
    ) -> int:
        position = positions.get(item_id)
        return position.order if position else 0

    @staticmethod
    def _combine_quantities(
        existing: str | None,
        incoming: str | None,
    ) -> str | None:
        """Combine two quantity strings for a merged duplicate.

        Adds the numeric amounts when both share a unit (e.g. "150g" +
        "200g" -> "350g"), adopts the incoming value outright when the
        existing item has none, and otherwise leaves the existing value
        alone (returns None, meaning "nothing to write") rather than
        guessing when they can't be confidently reconciled - e.g.
        different or unparseable units.
        """

        if not incoming:
            return None

        if not existing:
            return incoming

        existing_match = _QUANTITY_PATTERN.match(existing)
        incoming_match = _QUANTITY_PATTERN.match(incoming)

        if not existing_match or not incoming_match:
            return None

        existing_amount, separator, unit = existing_match.groups()
        incoming_amount, _, incoming_unit = incoming_match.groups()

        if unit.strip().lower() != incoming_unit.strip().lower():
            return None

        total = float(existing_amount) + float(incoming_amount)
        total_str = str(int(total)) if total.is_integer() else str(total)

        return f"{total_str}{separator}{unit}"

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
