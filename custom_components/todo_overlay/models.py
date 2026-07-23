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
