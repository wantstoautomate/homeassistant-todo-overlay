from __future__ import annotations

from typing import Literal

Placement = Literal["before", "after", "inside"]
LoadMode = Literal["replace", "merge", "full_merge"]
# "category" and "person" are a purely presentational distinction on the
# frontend (a person pin gets an initial avatar) - both behave
# identically everywhere on the backend. See manager_items.py's
# set_pin_type. "day" additionally requires a weekday (see
# set_pin_type's own validation) and drives real backend behavior, not
# just presentation - see tree.py's own day-of-week rotation/labeling.
PinType = Literal["category", "person", "day"]
PIN_TYPES: frozenset[str] = frozenset(("category", "person", "day"))
# Monday=0 .. Sunday=6, matching Python's own date.weekday() - the
# convention build_tree's rotation math (and set_pin_type's own
# validation) is built around.
WEEKDAY_NAMES: tuple[str, ...] = (
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
)
# Which side of its siblings the whole day-of-week block anchors to -
# see build_tree's own sort_key. Chosen per get_list call (like
# group_completed), never stored - a card that doesn't use this feature
# never needs to think about it, and one that does can pick per list.
WeekdayAnchor = Literal["top", "bottom"]

# See manager_recurrence.py's own module docstring for what these
# actually drive. "months" uses real calendar-month arithmetic (see
# _advance_date there), not a fixed day count - a monthly item due
# Jan 31 lands on Feb 28/29, not "31 days later".
RepeatUnit = Literal["days", "weeks", "months"]
REPEAT_UNITS: frozenset[str] = frozenset(("days", "weeks", "months"))
# "due": fixed schedule - the next occurrence always counts from the
# PREVIOUS due date, so it never drifts even if completed late (rolls
# forward past today if several cycles were missed entirely - see
# manager_recurrence.py). "completion": floating schedule - counts from
# whenever the item is actually completed instead, so finishing late
# never compresses the next cycle.
RepeatFrom = Literal["due", "completion"]
REPEAT_FROM_VALUES: frozenset[str] = frozenset(("due", "completion"))
