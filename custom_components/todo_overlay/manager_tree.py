from __future__ import annotations

from .models import ItemPosition, TodoItem, TodoList
from .tree import build_tree


class TreeMixin:
    """Reading a list as a hierarchy - plus the two reconciliation passes
    that keep stored metadata honest against whatever the native adapter
    actually reports, since items can appear/disappear/duplicate through
    paths (a voice assistant, another card, an automation) this
    integration never directly sees."""

    async def get_list(
        self,
        entity_id: str,
        group_completed: bool = False,
    ) -> TodoList:
        """Return a Todo list.

        With group_completed=True, completed items are sorted after
        incomplete siblings at every level (see build_tree) - off by
        default, so a plain read reflects stored order regardless of
        completion.

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

        async with self._lock_for(entity_id):
            return await self._get_list_impl(entity_id, group_completed)

    async def _get_list_impl(self, entity_id: str, group_completed: bool = False) -> TodoList:
        """The actual body of get_list(), callable by other locked public
        methods (see save_list) without re-entering self._lock_for(),
        since asyncio.Lock isn't reentrant and get_list() already holds
        it for the entity by the time such a caller reaches here."""

        items = await self._adapter.get_items(entity_id)

        positions = await self._metadata_store.get_relationships(
            entity_id,
        )

        quantities = await self._metadata_store.get_quantities(entity_id)
        tags = await self._metadata_store.get_tags(entity_id)
        trigger_on_due = await self._metadata_store.get_trigger_on_due(entity_id)

        items, positions, quantities, tags, trigger_on_due = await self._reconcile_orphaned_metadata(
            entity_id, items, positions, quantities, tags, trigger_on_due,
        )

        items, positions, quantities, tags, trigger_on_due = await self._merge_duplicate_titles(
            entity_id, items, positions, quantities, tags, trigger_on_due,
        )

        return TodoList(
            entity_id=entity_id,
            items=build_tree(items, positions, quantities, tags, trigger_on_due, group_completed),
        )

    async def _reconcile_orphaned_metadata(
        self,
        entity_id: str,
        items: list[TodoItem],
        positions: dict[str, ItemPosition],
        quantities: dict[str, str],
        tags: dict[str, list[str]],
        trigger_on_due: set[str],
    ) -> tuple[
        list[TodoItem], dict[str, ItemPosition], dict[str, str], dict[str, list[str]], set[str],
    ]:
        """Drop stored positions/quantities/tags/trigger_on_due (and the
        scheduler's due_fired bookkeeping) for ids that no longer exist on
        the native list.

        An item can disappear through paths this integration never sees -
        the native todo card, a voice assistant, an automation calling
        todo.remove_item directly - and none of those run our own
        metadata cleanup. Without this, that metadata sits in storage
        forever. Runs on every read since it's cheap (the ids needed are
        already fetched for this call) and catches removals regardless
        of which path did the removing.
        """

        live_ids = {item.id for item in items}
        orphaned_set = set()

        for source in (positions, quantities, tags, trigger_on_due):
            orphaned_set.update(item_id for item_id in source if item_id not in live_ids)

        if not orphaned_set:
            return items, positions, quantities, tags, trigger_on_due

        orphaned = list(orphaned_set)

        await self._metadata_store.remove_positions(entity_id, orphaned)
        await self._metadata_store.remove_quantities(entity_id, orphaned)
        await self._metadata_store.remove_tags_for_items(entity_id, orphaned)
        await self._metadata_store.remove_trigger_on_due_for_items(entity_id, orphaned)
        await self._metadata_store.remove_due_fired_for_items(entity_id, orphaned)

        positions = {k: v for k, v in positions.items() if k not in orphaned_set}
        quantities = {k: v for k, v in quantities.items() if k not in orphaned_set}
        tags = {k: v for k, v in tags.items() if k not in orphaned_set}
        trigger_on_due = {item_id for item_id in trigger_on_due if item_id not in orphaned_set}

        return items, positions, quantities, tags, trigger_on_due

    async def _merge_duplicate_titles(
        self,
        entity_id: str,
        items: list[TodoItem],
        positions: dict[str, ItemPosition],
        quantities: dict[str, str],
        tags: dict[str, list[str]],
        trigger_on_due: set[str],
    ) -> tuple[
        list[TodoItem], dict[str, ItemPosition], dict[str, str], dict[str, list[str]], set[str],
    ]:
        """Collapse sibling items that share a title into one, combining
        their quantities where possible (see _combine_quantities) and
        unioning their tags.

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
            combined_tags = list(tags.get(survivor.id, []))
            # A duplicate's own due_datetime never transfers to the
            # survivor (only the survivor's own due_datetime matters), so
            # this only ever turns the flag on, and only when the
            # survivor actually has a due_datetime to trigger against.
            survivor_trigger_on_due = survivor.id in trigger_on_due

            for duplicate in duplicates:
                combined_quantity = (
                    self._combine_quantities(combined_quantity, quantities.get(duplicate.id))
                    or combined_quantity
                )

                for tag in tags.get(duplicate.id, []):
                    if tag not in combined_tags:
                        combined_tags.append(tag)

                if duplicate.id in trigger_on_due:
                    survivor_trigger_on_due = True

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

            if combined_tags:
                await self._metadata_store.set_tags(entity_id, survivor.id, combined_tags)
                tags[survivor.id] = combined_tags

            if survivor_trigger_on_due and survivor.due_datetime and survivor.id not in trigger_on_due:
                await self._metadata_store.set_trigger_on_due(entity_id, survivor.id, True)
                trigger_on_due.add(survivor.id)

        if reparented:
            await self._metadata_store.set_positions(entity_id, reparented)

        if not removed_ids:
            return items, positions, quantities, tags, trigger_on_due

        await self._metadata_store.remove_positions(entity_id, removed_ids)
        await self._metadata_store.remove_quantities(entity_id, removed_ids)
        await self._metadata_store.remove_tags_for_items(entity_id, removed_ids)
        await self._metadata_store.remove_trigger_on_due_for_items(entity_id, removed_ids)
        await self._metadata_store.remove_due_fired_for_items(entity_id, removed_ids)

        removed_id_set = set(removed_ids)
        items = [item for item in items if item.id not in removed_id_set]
        positions = {k: v for k, v in positions.items() if k not in removed_id_set}
        quantities = {k: v for k, v in quantities.items() if k not in removed_id_set}
        tags = {k: v for k, v in tags.items() if k not in removed_id_set}
        trigger_on_due = {item_id for item_id in trigger_on_due if item_id not in removed_id_set}

        return items, positions, quantities, tags, trigger_on_due
