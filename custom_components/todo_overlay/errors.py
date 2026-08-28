"""Exception types raised by TodoManager and HomeAssistantTodoProvider.

Kept in their own module, separate from manager.py and ha_adapter.py, so
both can raise/import them without a circular import between the two.
Each subclasses ValueError so existing `except ValueError` handling (in
callers that only care whether something went wrong, not exactly what)
keeps working unchanged - the specific subclasses just let websocket.py
map failures to a meaningful error code instead of a generic one.
"""

from __future__ import annotations


class TodoOverlayError(ValueError):
    """Base for every Todo Overlay business-logic error."""


class EntityNotFoundError(TodoOverlayError):
    """Raised when a todo.* entity id doesn't exist."""


class ItemNotFoundError(TodoOverlayError):
    """Raised when an item id/title can't be resolved on a list."""


class CycleError(TodoOverlayError):
    """Raised when a move would create a cycle in the hierarchy (including
    moving an item relative to itself)."""


class SnapshotNotFoundError(TodoOverlayError):
    """Raised when a saved list name doesn't exist."""


class DueTimeRequiredError(TodoOverlayError):
    """Raised when trigger_on_due is set True for an item with no
    due_datetime - a date-only due_date isn't specific enough to schedule
    an exact-time trigger against, so this is enforced rather than
    silently picking an arbitrary time of day."""


class InvalidPinTypeError(TodoOverlayError):
    """Raised when set_pin_type is given a value other than one of
    PIN_TYPES (see manager_types.py) or None."""


class ItemLinkTargetNotFoundError(TodoOverlayError):
    """Raised by ItemLinkManager.link_item when no target list could be
    resolved at all - no explicit target was given, and there isn't
    exactly one cross-instance linked list configured to fall back on
    (see get_all_linked_entity_ids). A missing/stale configured default
    PARENT item is not this - that degrades to filing at the target
    list's own root instead, logged but not raised."""


class WeekdayRequiredError(TodoOverlayError):
    """Raised when set_pin_type is given pin_type="day" with no weekday
    (or an out-of-range one) - a "day" pin only means something once
    it's tied to a specific weekday, unlike "category"/"person" which
    need nothing further."""


class ItemDeleteProtectedError(TodoOverlayError):
    """Raised by TodoManager.delete_item when the item has its
    delete_protected flag set - deliberately a hard stop (never a
    silent no-op), so a caller (the websocket handler, a service call,
    an automation) gets an explicit, actionable error rather than
    quietly nothing happening. clear_completed/clear_all don't raise
    this - a bulk sweep skips a protected item/subtree instead of
    failing outright (see their own docstrings)."""
