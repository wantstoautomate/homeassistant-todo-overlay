from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(slots=True)
class TodoItem:
    """A single Todo item exposed by the Todo Overlay API."""

    id: str
    title: str
    completed: bool
    children: list["TodoItem"] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "completed": self.completed,
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
