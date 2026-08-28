from __future__ import annotations

from .manager_types import WeekdayAnchor
from .models import ItemPosition, ListMetadata, TodoItem, TodoList
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
        weekday_anchor: WeekdayAnchor = "top",
    ) -> TodoList:
        """Return a Todo list.

        With group_completed=True, completed items are sorted after
        incomplete siblings at every level (see build_tree) - off by
        default, so a plain read reflects stored order regardless of
        completion.

        weekday_anchor picks which end of its siblings a level's "day"
        pins (see manager_types.PIN_TYPES) block together at - a plain
        per-call parameter sourced from the card's own config, exactly
        like group_completed, never stored; irrelevant for a list with
        no "day" pins at all.

        Before building the tree: any "day" pin whose weekday just
        stopped being "today" is rolled over (see manager_rollover.py -
        completed children removed, incomplete ones moved to an
        auto-created "Overdue" parent), then items that share a title
        with a sibling are merged together (combining their quantities
        where possible - see _merge_duplicate_titles()). Both run on
        every read, rather than only when our own UI causes them, so
        they catch changes made through ANY path: a voice assistant or
        automation calling todo.add_item directly bypasses this
        integration entirely, but our card already reactively re-reads
        the list whenever the entity's state changes (see the live-sync
        handling in the frontend), so those additions still end up back
        through here.
        """

        async with self._lock_for(entity_id):
            return await self._get_list_impl(entity_id, group_completed, weekday_anchor)

    async def _get_list_impl(
        self,
        entity_id: str,
        group_completed: bool = False,
        weekday_anchor: WeekdayAnchor = "top",
    ) -> TodoList:
        """The actual body of get_list(), callable by other locked public
        methods (see save_list) without re-entering self._lock_for(),
        since asyncio.Lock isn't reentrant and get_list() already holds
        it for the entity by the time such a caller reaches here."""

        items = await self._adapter.get_items(entity_id)
        positions = await self._metadata_store.get_relationships(entity_id)
        metadata = await self._load_metadata(entity_id)

        items, positions, metadata = await self._process_day_rollovers(entity_id, items, positions, metadata)
        items, positions, metadata = await self._reconcile_orphaned_metadata(entity_id, items, positions, metadata)
        items, positions, metadata = await self._merge_duplicate_titles(entity_id, items, positions, metadata)

        return TodoList(
            entity_id=entity_id,
            items=build_tree(
                items, positions, metadata.quantities, metadata.tags, metadata.trigger_on_due,
                group_completed, metadata.pin_types, set(metadata.item_links), metadata.delete_protected,
                metadata.weekdays, self._today_weekday_fn(), weekday_anchor,
            ),
        )

    async def _load_metadata(self, entity_id: str) -> ListMetadata:
        return ListMetadata(
            quantities=await self._metadata_store.get_quantities(entity_id),
            tags=await self._metadata_store.get_tags(entity_id),
            trigger_on_due=await self._metadata_store.get_trigger_on_due(entity_id),
            pin_types=await self._metadata_store.get_pin_types(entity_id),
            item_links=await self._metadata_store.get_item_links(entity_id),
            delete_protected=await self._metadata_store.get_delete_protected(entity_id),
            weekdays=await self._metadata_store.get_weekdays(entity_id),
        )

    async def _reconcile_orphaned_metadata(
        self,
        entity_id: str,
        items: list[TodoItem],
        positions: dict[str, ItemPosition],
        metadata: ListMetadata,
    ) -> tuple[list[TodoItem], dict[str, ItemPosition], ListMetadata]:
        """Drop stored positions/quantities/tags/trigger_on_due/pin_type/
        item_link/delete_protected/weekday (and the scheduler's
        due_fired bookkeeping) for ids that no longer exist on the
        native list.

        An item can disappear through paths this integration never sees -
        the native todo card, a voice assistant, an automation calling
        todo.remove_item directly - and none of those run our own
        metadata cleanup. Without this, that metadata sits in storage
        forever. Runs on every read since it's cheap (the ids needed are
        already fetched for this call) and catches removals regardless
        of which path did the removing.

        Deliberately passive for item_links specifically, unlike
        item_links.py's own event-driven deletion cascade: an item
        vanishing through a path this integration never saw also means
        ItemLinkManager never saw it either, so its own partner is left
        alone here - just the dangling reference on THIS side is
        dropped, not an active cross-entity delete triggered from a
        routine read-time cleanup pass.
        """

        live_ids = {item.id for item in items}
        orphaned_set: set[str] = set()

        for source in (
            positions, metadata.quantities, metadata.tags, metadata.trigger_on_due, metadata.pin_types,
            metadata.item_links, metadata.delete_protected, metadata.weekdays,
        ):
            orphaned_set.update(item_id for item_id in source if item_id not in live_ids)

        if not orphaned_set:
            return items, positions, metadata

        orphaned = list(orphaned_set)

        await self._metadata_store.remove_positions(entity_id, orphaned)
        await self._metadata_store.remove_quantities(entity_id, orphaned)
        await self._metadata_store.remove_tags_for_items(entity_id, orphaned)
        await self._metadata_store.remove_trigger_on_due_for_items(entity_id, orphaned)
        await self._metadata_store.remove_due_fired_for_items(entity_id, orphaned)
        await self._metadata_store.remove_pin_types(entity_id, orphaned)
        await self._metadata_store.remove_delete_protected_for_items(entity_id, orphaned)
        await self._metadata_store.remove_weekdays(entity_id, orphaned)

        for item_id in orphaned:
            await self._metadata_store.remove_item_link(entity_id, item_id)

        positions = {k: v for k, v in positions.items() if k not in orphaned_set}
        metadata = ListMetadata(
            quantities={k: v for k, v in metadata.quantities.items() if k not in orphaned_set},
            tags={k: v for k, v in metadata.tags.items() if k not in orphaned_set},
            trigger_on_due={i for i in metadata.trigger_on_due if i not in orphaned_set},
            pin_types={k: v for k, v in metadata.pin_types.items() if k not in orphaned_set},
            item_links={k: v for k, v in metadata.item_links.items() if k not in orphaned_set},
            delete_protected={i for i in metadata.delete_protected if i not in orphaned_set},
            weekdays={k: v for k, v in metadata.weekdays.items() if k not in orphaned_set},
        )

        return items, positions, metadata

    async def _merge_duplicate_titles(
        self,
        entity_id: str,
        items: list[TodoItem],
        positions: dict[str, ItemPosition],
        metadata: ListMetadata,
    ) -> tuple[list[TodoItem], dict[str, ItemPosition], ListMetadata]:
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

        quantities = metadata.quantities
        tags = metadata.tags
        trigger_on_due = metadata.trigger_on_due
        pin_types = metadata.pin_types
        item_links = metadata.item_links
        delete_protected = metadata.delete_protected
        weekdays = metadata.weekdays

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
            # Not combinable like quantity/tags - a single value, not a
            # sum or a set. The survivor's own pin_type always wins if it
            # has one; only adopts a duplicate's pin_type when the
            # survivor has none at all, so a merge never silently drops
            # a pin that was only ever set on the duplicate being removed.
            combined_pin_type = pin_types.get(survivor.id)
            # Same "survivor wins, duplicate only fills a gap" rule -
            # only ever meaningful alongside pin_type == "day", and a
            # day pin's title IS its weekday's own name (see
            # set_pin_type), so two same-titled day pins can only ever
            # already agree on this by construction; kept in step with
            # pin_type here purely for consistency, not because a real
            # mismatch is expected.
            combined_weekday = weekdays.get(survivor.id)
            # Same "survivor wins, duplicate only fills a gap" rule as
            # pin_type above - but a link is a TWO-sided relationship
            # (see item_links.py), so adopting the duplicate's own link
            # also means repointing the partner's own record at the
            # survivor, not just writing the survivor's own side.
            combined_item_link = item_links.get(survivor.id)
            # Unlike pin_type/item_link above (survivor wins, a
            # duplicate only fills a genuine gap), this is a plain OR
            # across the whole group - a safety flag should never be
            # silently lost through a merge just because it happened to
            # be set on the duplicate rather than the survivor.
            combined_delete_protected = survivor.id in delete_protected
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

                if combined_pin_type is None:
                    combined_pin_type = pin_types.get(duplicate.id)

                if combined_weekday is None:
                    combined_weekday = weekdays.get(duplicate.id)

                if combined_item_link is None:
                    combined_item_link = item_links.get(duplicate.id)

                if duplicate.id in trigger_on_due:
                    survivor_trigger_on_due = True

                if duplicate.id in delete_protected:
                    combined_delete_protected = True

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

                # Previously silent - on a linked list, this specific
                # combination (two same-titled items where at least one
                # has a quantity) never propagated the removal to the
                # peer at all, since nothing here ever fired an event
                # for it.
                self._fire_event(entity_id, duplicate.id, duplicate.title, "removed")

            if combined_quantity:
                await self._metadata_store.set_quantity(entity_id, survivor.id, combined_quantity)
                quantities[survivor.id] = combined_quantity

            if combined_tags:
                await self._metadata_store.set_tags(entity_id, survivor.id, combined_tags)
                tags[survivor.id] = combined_tags

            if combined_pin_type and pin_types.get(survivor.id) != combined_pin_type:
                await self._metadata_store.set_pin_type(entity_id, survivor.id, combined_pin_type)
                pin_types[survivor.id] = combined_pin_type

            if combined_weekday is not None and weekdays.get(survivor.id) != combined_weekday:
                await self._metadata_store.set_weekday(entity_id, survivor.id, combined_weekday)
                weekdays[survivor.id] = combined_weekday

            if combined_item_link and item_links.get(survivor.id) != combined_item_link:
                await self._metadata_store.set_item_link(
                    entity_id, survivor.id,
                    combined_item_link["entity_id"], combined_item_link["item_id"],
                )
                # The partner's own record still pointed at the
                # duplicate's (about to be removed) id - repoint it at
                # the survivor, or the next change on the partner's side
                # would try to mirror into an item that no longer exists.
                await self._metadata_store.set_item_link(
                    combined_item_link["entity_id"], combined_item_link["item_id"],
                    entity_id, survivor.id,
                )
                item_links[survivor.id] = combined_item_link

            if survivor_trigger_on_due and survivor.due_datetime and survivor.id not in trigger_on_due:
                await self._metadata_store.set_trigger_on_due(entity_id, survivor.id, True)
                trigger_on_due.add(survivor.id)

            if combined_delete_protected and survivor.id not in delete_protected:
                await self._metadata_store.set_delete_protected(entity_id, survivor.id, True)
                delete_protected.add(survivor.id)

        if reparented:
            await self._metadata_store.set_positions(entity_id, reparented)

        if not removed_ids:
            return items, positions, metadata

        await self._metadata_store.remove_positions(entity_id, removed_ids)
        await self._metadata_store.remove_quantities(entity_id, removed_ids)
        await self._metadata_store.remove_tags_for_items(entity_id, removed_ids)
        await self._metadata_store.remove_trigger_on_due_for_items(entity_id, removed_ids)
        await self._metadata_store.remove_due_fired_for_items(entity_id, removed_ids)
        await self._metadata_store.remove_pin_types(entity_id, removed_ids)
        await self._metadata_store.remove_delete_protected_for_items(entity_id, removed_ids)
        await self._metadata_store.remove_weekdays(entity_id, removed_ids)

        for removed_id in removed_ids:
            await self._metadata_store.remove_item_link(entity_id, removed_id)

        removed_id_set = set(removed_ids)
        items = [item for item in items if item.id not in removed_id_set]
        positions = {k: v for k, v in positions.items() if k not in removed_id_set}
        metadata = ListMetadata(
            quantities={k: v for k, v in quantities.items() if k not in removed_id_set},
            tags={k: v for k, v in tags.items() if k not in removed_id_set},
            trigger_on_due={i for i in trigger_on_due if i not in removed_id_set},
            pin_types={k: v for k, v in pin_types.items() if k not in removed_id_set},
            item_links={k: v for k, v in item_links.items() if k not in removed_id_set},
            delete_protected={i for i in delete_protected if i not in removed_id_set},
            weekdays={k: v for k, v in weekdays.items() if k not in removed_id_set},
        )

        return items, positions, metadata
