"""Day-rollover: once a "day" pin's own weekday stops being "today" (see
manager_types.PIN_TYPES and tree.py's own rotation), its children are
swept - completed ones removed outright, incomplete ones moved onto an
auto-created "Overdue" parent with due_date set to the date that just
passed, so they read as (and sort/highlight like) an ordinary overdue
item from then on.

Runs as part of every get_list() read (see manager_tree.py's own
_get_list_impl), the same "catches up regardless of how long it's been
since the app was last open" reasoning _reconcile_orphaned_metadata
already uses - there's no separate scheduler and no missed-midnight
edge case to handle, since "today" is always freshly computed at read
time (see TodoManager._today_date_fn) and this pass compares it against
a persisted "last checked" date rather than assuming exactly one day
elapsed between reads.

Deliberately bypasses TodoManager's own public create_item/delete_item/
move_item methods and calls self._adapter/self._metadata_store
directly instead, firing events by hand - the same pattern
manager_tree.py's own _merge_duplicate_titles already uses, and for the
same reason: this runs INSIDE _get_list_impl, which already holds this
entity's lock (see TodoManager._lock_for) by the time it gets here, and
those public methods would try to acquire that same (non-reentrant)
lock again.
"""

from __future__ import annotations

from datetime import date, timedelta

from .models import ItemPosition, ListMetadata, TodoItem

OVERDUE_TITLE = "Overdue"


class DayRolloverMixin:

    async def _process_day_rollovers(
        self,
        entity_id: str,
        items: list[TodoItem],
        positions: dict[str, ItemPosition],
        metadata: ListMetadata,
    ) -> tuple[list[TodoItem], dict[str, ItemPosition], ListMetadata]:
        today = self._today_date_fn()
        last_date_str = await self._metadata_store.get_last_rollover_date(entity_id)

        if last_date_str is None:
            # First time this entity has ever been read since this
            # feature existed - nothing has "become yesterday" from our
            # own point of view yet, so just start tracking from here
            # rather than guessing at history from before we were
            # watching.
            await self._metadata_store.set_last_rollover_date(entity_id, today.isoformat())
            return items, positions, metadata

        last_date = date.fromisoformat(last_date_str)
        days_elapsed = (today - last_date).days

        if days_elapsed <= 0:
            # Same day as last checked (the overwhelmingly common case -
            # this runs on every read), or the clock somehow moved
            # backwards - either way, nothing has rolled over.
            return items, positions, metadata

        # Capped at 7: each weekday only ever needs rolling over once,
        # no matter how many full weeks actually passed since this
        # entity was last read (e.g. a list nobody's opened in a month).
        rolled_over_weekdays = {
            (last_date.weekday() + offset) % 7
            for offset in range(min(days_elapsed, 7))
        }

        day_pin_ids = [
            item.id for item in items
            if metadata.pin_types.get(item.id) == "day" and metadata.weekdays.get(item.id) in rolled_over_weekdays
        ]

        if day_pin_ids:
            overdue_date = (today - timedelta(days=1)).isoformat()

            for day_pin_id in day_pin_ids:
                items, positions, metadata = await self._rollover_day_pin(
                    entity_id, day_pin_id, items, positions, metadata, overdue_date,
                )

        await self._metadata_store.set_last_rollover_date(entity_id, today.isoformat())

        return items, positions, metadata

    async def _rollover_day_pin(
        self,
        entity_id: str,
        day_pin_id: str,
        items: list[TodoItem],
        positions: dict[str, ItemPosition],
        metadata: ListMetadata,
        overdue_date: str,
    ) -> tuple[list[TodoItem], dict[str, ItemPosition], ListMetadata]:
        """Sweep one day pin's own direct children - completed ones are
        removed, incomplete ones move to Overdue with overdue_date
        stamped on as their due_date. The day pin itself is untouched
        (still there, ready for its next real occurrence a week from
        now) - only its children move."""

        child_ids = self._siblings(items, positions, day_pin_id)

        if not child_ids:
            return items, positions, metadata

        item_by_id = {item.id: item for item in items}
        removed_ids: list[str] = []
        overdue_parent_id: str | None = None

        for child_id in child_ids:
            child = item_by_id.get(child_id)

            if child is None:
                continue

            if child.completed:
                if child_id in metadata.delete_protected:
                    # Never auto-removed, even by this - same rule
                    # clear_completed/clear_all already follow (see
                    # their own docstrings). Left under the now-stale
                    # day pin for the user to deal with by hand.
                    continue

                await self._adapter.remove_item(entity_id, child_id)
                removed_ids.append(child_id)
                self._fire_event(entity_id, child_id, child.title, "removed")
                continue

            if overdue_parent_id is None:
                overdue_parent_id, items = await self._ensure_overdue_parent(entity_id, items, positions)

            next_order = max(
                (
                    self._order_of(sibling_id, positions)
                    for sibling_id in self._siblings(items, positions, overdue_parent_id)
                ),
                default=-1,
            ) + 1
            positions[child_id] = ItemPosition(parent_id=overdue_parent_id, order=next_order)
            await self._metadata_store.set_positions(entity_id, {child_id: positions[child_id]})

            await self._adapter.update_item(entity_id, child_id, due_date=overdue_date)
            child.due_date = overdue_date
            self._fire_event(entity_id, child_id, child.title, "updated")

        if removed_ids:
            items, positions, metadata = self._drop_removed(items, positions, metadata, removed_ids)
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

        return items, positions, metadata

    @staticmethod
    def _drop_removed(
        items: list[TodoItem],
        positions: dict[str, ItemPosition],
        metadata: ListMetadata,
        removed_ids: list[str],
    ) -> tuple[list[TodoItem], dict[str, ItemPosition], ListMetadata]:
        removed_id_set = set(removed_ids)

        return (
            [item for item in items if item.id not in removed_id_set],
            {k: v for k, v in positions.items() if k not in removed_id_set},
            ListMetadata(
                quantities={k: v for k, v in metadata.quantities.items() if k not in removed_id_set},
                tags={k: v for k, v in metadata.tags.items() if k not in removed_id_set},
                trigger_on_due={i for i in metadata.trigger_on_due if i not in removed_id_set},
                pin_types={k: v for k, v in metadata.pin_types.items() if k not in removed_id_set},
                item_links={k: v for k, v in metadata.item_links.items() if k not in removed_id_set},
                delete_protected={i for i in metadata.delete_protected if i not in removed_id_set},
                weekdays={k: v for k, v in metadata.weekdays.items() if k not in removed_id_set},
            ),
        )

    async def _ensure_overdue_parent(
        self,
        entity_id: str,
        items: list[TodoItem],
        positions: dict[str, ItemPosition],
    ) -> tuple[str, list[TodoItem]]:
        """Finds the existing root-level "Overdue" category pin, or
        creates one - at most one per entity, reused across every
        rollover from then on. A plain "category" pin, not its own
        PIN_TYPES value: it needs no extra data and no special sort/
        label behavior the way "day" pins do, just the ordinary always-
        a-header rendering "category" already gives for free."""

        existing = next(
            (
                item for item in items
                if item.title == OVERDUE_TITLE and self._parent_id_of(item.id, positions) is None
            ),
            None,
        )

        if existing is not None:
            return existing.id, items

        new_id = await self._adapter.add_item(entity_id, OVERDUE_TITLE)
        await self._metadata_store.set_pin_type(entity_id, new_id, "category")

        root_ids = [item.id for item in items if self._parent_id_of(item.id, positions) is None]
        next_order = max((self._order_of(rid, positions) for rid in root_ids), default=-1) + 1
        positions[new_id] = ItemPosition(parent_id=None, order=next_order)
        await self._metadata_store.set_positions(entity_id, {new_id: positions[new_id]})

        new_item = TodoItem(id=new_id, title=OVERDUE_TITLE, completed=False, pin_type="category")
        items = [*items, new_item]

        self._fire_event(entity_id, new_id, OVERDUE_TITLE, "created", pin_type="category")

        return new_id, items
