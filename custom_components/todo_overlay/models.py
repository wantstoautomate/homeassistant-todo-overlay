from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(slots=True)
class ItemPosition:
    """Where a Todo item sits in the overlay hierarchy."""

    parent_id: str | None
    order: int


@dataclass(slots=True)
class TodoItem:
    """A single Todo item exposed by the Todo Overlay API."""

    id: str
    title: str
    completed: bool
    description: str | None = None
    due_date: str | None = None
    due_datetime: str | None = None
    quantity: str | None = None
    tags: list[str] = field(default_factory=list)
    # Opt-in: whether this item should fire the "due" trigger event at its
    # due_datetime. Off by default for every item, including existing ones
    # with due dates already set - having a due date at all never implies
    # wanting to be triggered on it. Only meaningful alongside a real
    # due_datetime (not a date-only due_date) - see DueTimeRequiredError.
    trigger_on_due: bool = False
    # "category" | "person" | None - marks an item as always rendering
    # like a parent (bold title, no checkbox, collapsible) regardless of
    # whether it currently has any children. The two non-None values are
    # a purely presentational distinction for the frontend (a "person"
    # gets an initial avatar); nothing on the backend treats them
    # differently - see manager_items.py's set_pin_type.
    pin_type: str | None = None
    # Whether this item is mirrored to a partner item elsewhere (possibly
    # on a completely different todo.* entity) - see item_links.py. Only
    # a boolean here, not the partner's own details (which entity, which
    # item, its title) - the frontend only needs this to seed the item
    # dialog's own "Link to shared list" checkbox; the actual link record
    # lives in metadata_store, keyed by (entity_id, item_id), and is
    # looked up directly wherever the full detail is actually needed.
    linked: bool = False
    # Off by default for every item - opting an item OUT of normal
    # deletion, everywhere: the desktop delete button, the mobile swipe-
    # to-delete gesture, clear_completed, clear_all, and delete_item
    # itself (including a delete cascading in from a linked item's own
    # partner - see item_links.py). Meant for anchor items a whole
    # structure depends on (e.g. a "person" pin like "Brodie"/"Anna" a
    # shared list's own organization relies on) that would otherwise be
    # one careless swipe or a "clear completed" tap away from being
    # gone. See manager_items.py's set_delete_protected.
    delete_protected: bool = False
    children: list["TodoItem"] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "completed": self.completed,
            "description": self.description,
            "due_date": self.due_date,
            "due_datetime": self.due_datetime,
            "quantity": self.quantity,
            "tags": self.tags,
            "trigger_on_due": self.trigger_on_due,
            "pin_type": self.pin_type,
            "linked": self.linked,
            "delete_protected": self.delete_protected,
            "children": [child.to_dict() for child in self.children],
        }


@dataclass(slots=True)
class TodoList:
    """A Todo list exposed by the Todo Overlay API."""

    entity_id: str
    items: list[TodoItem]

    def to_dict(self) -> dict:
        return {
            "entity_id": self.entity_id,
            "items": [item.to_dict() for item in self.items],
        }
