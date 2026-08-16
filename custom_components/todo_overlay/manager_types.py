from __future__ import annotations

from typing import Literal

Placement = Literal["before", "after", "inside"]
LoadMode = Literal["replace", "merge", "full_merge"]
# "category" and "person" are a purely presentational distinction on the
# frontend (a person pin gets an initial avatar) - both behave
# identically everywhere on the backend. See manager_items.py's
# set_pin_type.
PinType = Literal["category", "person"]
PIN_TYPES: frozenset[str] = frozenset(("category", "person"))
