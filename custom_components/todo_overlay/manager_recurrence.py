"""Recurring items: an item with a repeat set (see manager_items.py's
own set_repeat) doesn't just stay completed once checked off - its due
date advances by the configured interval and it un-completes itself,
so a "change the water filter" or "bins day" task comes back instead
of vanishing once done.

repeat_from picks what the next occurrence counts from:
- "due": a fixed schedule - always counts from the item's own PREVIOUS
  due date, so it never drifts even if completed late (rolls forward
  past today, re-adding the interval repeatedly, if several cycles
  were missed entirely rather than landing back in the past and
  re-triggering an overdue notice immediately). Right for something
  like bins day, which happens on a real calendar schedule regardless
  of when you actually took them out.
- "completion": a floating schedule - counts from whenever the item is
  actually completed instead, so finishing a few days late never
  compresses the next cycle. Right for something like a water filter,
  where what matters is the gap since it was last actually done, not
  a fixed calendar slot.

due_datetime strings throughout this codebase are naive local time (no
UTC offset - see ha_adapter.py's own due_datetime handling and the
frontend's construction of it), so advancing one is just date
arithmetic on the calendar date, keeping the same naive hour:minute -
no timezone/DST conversion is ever needed here.

Deliberately bypasses TodoManager's own public locking methods and
talks to the adapter/metadata_store directly - the same pattern
manager_rollover.py's own module docstring already explains: this runs
from manager_completion.py's own set_completed(), which already holds
this entity's lock (asyncio.Lock isn't reentrant) by the time it gets
here.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

from dateutil.relativedelta import relativedelta
from homeassistant.util import dt as dt_util

from .models import TodoItem


def _advance_date(anchor: date, interval: int, unit: str) -> date:
    """One interval forward from anchor. "months" uses real calendar-
    month arithmetic (via dateutil, already an HA core dependency, not
    a new one this integration adds) so a monthly item due Jan 31 lands
    on Feb 28/29, not on some fixed 30-day approximation."""

    if unit == "days":
        return anchor + timedelta(days=interval)

    if unit == "weeks":
        return anchor + timedelta(weeks=interval)

    return anchor + relativedelta(months=interval)


class RecurrenceMixin:
    """See this module's own docstring for the mechanics - the one
    entry point (_maybe_advance_recurrence) is called from
    manager_completion.py's set_completed(), inside its own lock, once
    per item that just transitioned to completed."""

    async def _maybe_advance_recurrence(
        self,
        entity_id: str,
        item_id: str,
        item_lookup: dict[str, TodoItem],
    ) -> None:
        repeat = (await self._metadata_store.get_repeats(entity_id)).get(item_id)

        if repeat is None:
            return

        item = item_lookup.get(item_id)

        # Already re-checked by the caller before calling this, but
        # trusting that instead of re-deriving it here would couple the
        # two more tightly than the one-line check costs.
        if item is None or not item.completed:
            return

        today = self._today_date_fn()
        due_date, due_datetime = self._compute_next_occurrence(item, repeat, today)

        await self._adapter.update_item(entity_id, item_id, due_date=due_date, due_datetime=due_datetime)
        await self._adapter.set_completed(entity_id, item_id, False)

        item.completed = False
        item.due_date = due_date
        item.due_datetime = due_datetime

        self._fire_event(entity_id, item_id, item.title, "uncompleted")

    @staticmethod
    def _compute_next_occurrence(
        item: TodoItem,
        repeat: dict,
        today: date,
    ) -> tuple[str | None, str | None]:
        """Returns (due_date, due_datetime) for the item's NEXT
        occurrence - exactly one of the pair is set, matching whichever
        of the two the item already had (a date-only item stays
        date-only; a dated-and-timed item keeps the same naive
        hour:minute on its new date)."""

        interval = repeat["interval"]
        unit = repeat["unit"]
        repeat_from = repeat["from"]

        time_of_day = None

        if item.due_datetime:
            anchor_dt = dt_util.parse_datetime(item.due_datetime)
            anchor_date = anchor_dt.date() if anchor_dt is not None else today
            time_of_day = anchor_dt.time() if anchor_dt is not None else None
        elif item.due_date:
            try:
                anchor_date = date.fromisoformat(item.due_date)
            except ValueError:
                anchor_date = today
        else:
            anchor_date = today

        base = today if repeat_from == "completion" else anchor_date
        next_date = _advance_date(base, interval, unit)

        if repeat_from == "due":
            while next_date <= today:
                next_date = _advance_date(next_date, interval, unit)

        if time_of_day is not None:
            return None, datetime.combine(next_date, time_of_day).isoformat()

        return next_date.isoformat(), None
