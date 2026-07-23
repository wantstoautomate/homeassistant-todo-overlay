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
