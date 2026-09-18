from __future__ import annotations

from .errors import (
    InvalidPinTypeError,
    InvalidRepeatError,
    ItemDeleteProtectedError,
    ItemNotFoundError,
    RepeatRequiresDueDateError,
    WeekdayRequiredError,
)
from .manager_types import PIN_TYPES, REPEAT_FROM_VALUES, REPEAT_UNITS, WEEKDAY_NAMES, Placement
from .models import TodoItem


def _validate_pin_type(pin_type: str | None, weekday: int | None) -> None:
    if pin_type is not None and pin_type not in PIN_TYPES:
        raise InvalidPinTypeError(
            f"pin_type must be one of {sorted(PIN_TYPES)} or None, got {pin_type!r}"
        )

    if pin_type == "day" and (weekday is None or not 0 <= weekday <= 6):
        raise WeekdayRequiredError(
            f"pin_type='day' requires weekday to be an int 0-6 (Monday-Sunday), got {weekday!r}"
        )


def _validate_repeat(
    interval: int | None,
    unit: str | None,
    repeat_from: str | None,
    has_due_date: bool,
) -> None:
    """interval/unit/repeat_from are all-or-nothing (see TodoItem's own
    fields) - None on all three just means "doesn't repeat", never
    reached as an error case. Anything else validates the full triple."""

    if interval is None and unit is None and repeat_from is None:
        return

    if interval is None or unit is None or repeat_from is None:
        raise InvalidRepeatError(
            "repeat_interval, repeat_unit, and repeat_from must all be given together "
            f"(or all omitted) - got interval={interval!r}, unit={unit!r}, from={repeat_from!r}"
        )

    if not isinstance(interval, int) or isinstance(interval, bool) or interval < 1:
        raise InvalidRepeatError(f"repeat_interval must be a positive int, got {interval!r}")

    if unit not in REPEAT_UNITS:
        raise InvalidRepeatError(f"repeat_unit must be one of {sorted(REPEAT_UNITS)}, got {unit!r}")

    if repeat_from not in REPEAT_FROM_VALUES:
        raise InvalidRepeatError(
            f"repeat_from must be one of {sorted(REPEAT_FROM_VALUES)}, got {repeat_from!r}"
        )

    if not has_due_date:
        raise RepeatRequiresDueDateError(
            "repeat_interval/repeat_unit/repeat_from require the item to already have "
            "a due date or due date+time set"
        )


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
        reference_id: str | None = None,
        placement: Placement | None = None,
        pin_type: str | None = None,
        weekday: int | None = None,
        repeat_interval: int | None = None,
        repeat_unit: str | None = None,
        repeat_from: str | None = None,
    ) -> str:
        """Create an item, including overlay-only fields (quantity,
        tags, trigger_on_due, pin_type) that Home Assistant's native
        todo.add_item has no concept of.

        pin_type="day" requires weekday (0=Monday..6=Sunday) - and the
        given title is IGNORED in that case, replaced with the
        weekday's own plain name (see manager_types.WEEKDAY_NAMES) -
        see set_pin_type's own docstring for why a "day" pin's title is
        never anything else.

        trigger_on_due=True is silently ignored if the target entity
        doesn't end up with a due_datetime (either none was given, or
        the entity doesn't support the feature and add_item dropped it)
        - same "gracefully degrade" precedent as due_datetime itself.

        repeat_interval/repeat_unit/repeat_from (see manager_recurrence.py
        and set_repeat's own docstring) are all-or-nothing, and require
        due_date or due_datetime to also be given here - there's nothing
        to advance from otherwise.

        reference_id/placement optionally position the new item
        relative to an existing one (same before/after/inside semantics
        as move_item) instead of wherever the native adapter's own
        add_item happens to put it - used by the frontend's per-parent
        quick add to insert a new item as a specific parent's first
        child, immediately below the parent's own row rather than at
        the end of the whole list. Repositioning runs via the shared
        _reposition() core (see manager_position.py) INSIDE this
        method's own lock, rather than calling the public move_item()
        - that would try to re-acquire the same (non-reentrant) lock and
        deadlock, and would fire a redundant second "moved" event for
        what the caller sees as one single action.

        Returns the new item's id.
        """

        # Validated up front, before add_item ever runs - failing after
        # the native item already exists would leave an orphan item
        # behind with no pin_type set, a partial failure the caller
        # never asked for.
        _validate_pin_type(pin_type, weekday)
        _validate_repeat(repeat_interval, repeat_unit, repeat_from, has_due_date=bool(due_date or due_datetime))

        if pin_type == "day":
            title = WEEKDAY_NAMES[weekday]

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

            if pin_type is not None:
                await self._metadata_store.set_pin_type(entity_id, item_id, pin_type)

            if pin_type == "day":
                await self._metadata_store.set_weekday(entity_id, item_id, weekday)

            if repeat_interval is not None:
                await self._metadata_store.set_repeat(
                    entity_id, item_id,
                    {"interval": repeat_interval, "unit": repeat_unit, "from": repeat_from},
                )

            if trigger_on_due:
                created = await self._adapter.get_items(entity_id)
                created_item = next((c for c in created if c.id == item_id), None)

                if created_item is not None and created_item.due_datetime:
                    await self._metadata_store.set_trigger_on_due(entity_id, item_id, True)

            if reference_id is not None and placement is not None:
                await self._reposition(entity_id, item_id, reference_id, placement)

        self._fire_event(
            entity_id, item_id, title, "created",
            quantity=quantity, tags=tags or [], pin_type=pin_type,
        )

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

        Raises ItemDeleteProtectedError, without touching the native
        list at all, if the item has its delete_protected flag set -
        this is the single choke point every deletion path goes
        through (the websocket handler, a service call, AND
        item_links.py's own cascade when a linked partner is deleted -
        see its _propagate_delete), so protection holds regardless of
        which of those triggered it. clear_completed/clear_all
        deliberately don't call this - see their own docstrings for why
        a bulk sweep skips a protected item/subtree instead of failing
        outright.

        Any now-orphaned metadata for this item (quantity/tags/
        trigger_on_due) is cleaned up reactively by get_list()'s own
        reconciliation pass, same as before this existed."""

        if item_id in await self._metadata_store.get_delete_protected(entity_id):
            raise ItemDeleteProtectedError(
                f"Cannot delete {item_id!r} on {entity_id}: protected from deletion"
            )

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

    async def set_pin_type(
        self,
        entity_id: str,
        item_id: str,
        pin_type: str | None,
        weekday: int | None = None,
    ) -> None:
        """Set (or clear) an item's pin type - overlay-only metadata that
        marks it as always rendering/behaving like a parent (bold title,
        no checkbox, collapsible) regardless of whether it currently has
        any children. "category" and "person" are purely presentational
        (the frontend uses them to decide between a plain section header
        and one with a person's initial avatar); "day" additionally
        requires weekday (0=Monday..6=Sunday, see manager_types.
        WEEKDAY_NAMES) and drives real backend behavior - see tree.py's
        own build_tree for the day-of-week rotation/labeling this powers.

        Setting pin_type="day" also renames the item to that weekday's
        own plain name (e.g. weekday=2 -> "Wednesday"), overwriting
        whatever title it had - a "day" pin's title is never anything
        else, since build_tree's own "Today"/"Tomorrow" is a display
        overlay computed fresh on every read (see TodoItem.day_label),
        not something stored here; keeping the stored title itself
        stable is what lets a service/automation reference "Wednesday"
        and mean the same real day regardless of when it runs. weekday
        is ignored (and cleared from storage) for any other pin_type."""

        _validate_pin_type(pin_type, weekday)

        async with self._lock_for(entity_id):
            await self._set_pin_type_impl(entity_id, item_id, pin_type, weekday)

    async def _set_pin_type_impl(
        self,
        entity_id: str,
        item_id: str,
        pin_type: str | None,
        weekday: int | None = None,
    ) -> None:
        """The actual body of set_pin_type(), callable by
        set_pin_type_by_item() without re-entering self._lock_for() - see
        TreeMixin._get_list_impl()'s docstring for why that split exists.
        Validation already happened in set_pin_type() before the lock was
        ever taken, so this trusts pin_type/weekday as-is."""

        if pin_type == "day":
            await self._adapter.update_item(entity_id, item_id, title=WEEKDAY_NAMES[weekday])

        await self._metadata_store.set_pin_type(entity_id, item_id, pin_type)
        await self._metadata_store.set_weekday(entity_id, item_id, weekday if pin_type == "day" else None)

        items = await self._adapter.get_items(entity_id)
        item = next((candidate for candidate in items if candidate.id == item_id), None)

        if item is not None:
            self._fire_event(entity_id, item_id, item.title, "pin_type_changed", pin_type=pin_type)

    async def set_pin_type_by_item(
        self,
        entity_id: str,
        item: str,
        pin_type: str | None,
        weekday: int | None = None,
    ) -> None:
        """Set an item's pin type, identified by uid or title - the
        service-facing counterpart to set_pin_type(), which callers with
        a real item_id already in hand (the frontend) use directly."""

        _validate_pin_type(pin_type, weekday)

        async with self._lock_for(entity_id):
            resolved = await self._resolve_item(entity_id, item)
            await self._set_pin_type_impl(entity_id, resolved.id, pin_type, weekday)

    async def set_repeat(
        self,
        entity_id: str,
        item_id: str,
        interval: int | None,
        unit: str | None = None,
        repeat_from: str | None = None,
    ) -> None:
        """Set (or clear, if interval is None) an item's recurrence -
        overlay-only metadata, same shape as pin_type/weekday. interval/
        unit/repeat_from are all-or-nothing (see TodoItem's own
        repeat_interval/repeat_unit/repeat_from) and require the item to
        already have a due_date or due_datetime - manager_recurrence.py
        has nothing to advance from otherwise.

        repeat_from picks what the next occurrence counts from once this
        item is completed: "due" keeps a fixed schedule (always counts
        from the PREVIOUS due date, rolling forward past today if
        several cycles were missed entirely, so it never drifts even if
        completed late); "completion" is a floating schedule (counts
        from whenever it's actually completed instead, so finishing late
        never compresses the next cycle) - see manager_recurrence.py's
        own module docstring for the full mechanics."""

        items = await self._adapter.get_items(entity_id)
        item = next((candidate for candidate in items if candidate.id == item_id), None)
        has_due_date = item is not None and bool(item.due_date or item.due_datetime)

        _validate_repeat(interval, unit, repeat_from, has_due_date)

        async with self._lock_for(entity_id):
            await self._set_repeat_impl(entity_id, item_id, interval, unit, repeat_from)

    async def _set_repeat_impl(
        self,
        entity_id: str,
        item_id: str,
        interval: int | None,
        unit: str | None,
        repeat_from: str | None,
    ) -> None:
        """The actual body of set_repeat(), callable by
        set_repeat_by_item() without re-entering self._lock_for() - see
        TreeMixin._get_list_impl()'s docstring for why that split exists.
        Validation already happened in set_repeat() before the lock was
        ever taken, so this trusts the values as-is."""

        repeat = {"interval": interval, "unit": unit, "from": repeat_from} if interval is not None else None
        await self._metadata_store.set_repeat(entity_id, item_id, repeat)

        items = await self._adapter.get_items(entity_id)
        item = next((candidate for candidate in items if candidate.id == item_id), None)

        if item is not None:
            self._fire_event(
                entity_id, item_id, item.title, "repeat_changed",
                repeat_interval=interval, repeat_unit=unit, repeat_from=repeat_from,
            )

    async def set_repeat_by_item(
        self,
        entity_id: str,
        item: str,
        interval: int | None,
        unit: str | None = None,
        repeat_from: str | None = None,
    ) -> None:
        """Set an item's recurrence, identified by uid or title - the
        service-facing counterpart to set_repeat(), which callers with a
        real item_id already in hand (the frontend) use directly."""

        async with self._lock_for(entity_id):
            resolved = await self._resolve_item(entity_id, item)
            has_due_date = bool(resolved.due_date or resolved.due_datetime)

            _validate_repeat(interval, unit, repeat_from, has_due_date)

            await self._set_repeat_impl(entity_id, resolved.id, interval, unit, repeat_from)

    async def set_delete_protected(
        self,
        entity_id: str,
        item_id: str,
        enabled: bool,
    ) -> None:
        """Set (or clear) an item's delete-protected flag - see
        delete_item's own docstring for exactly what this blocks.
        Overlay-only metadata, same shape as trigger_on_due; no service/
        trigger-event counterpart yet (matches how item_links.py's own
        link_item started - UI-driven first, service parity later if it
        turns out to be needed)."""

        async with self._lock_for(entity_id):
            await self._metadata_store.set_delete_protected(entity_id, item_id, enabled)

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
