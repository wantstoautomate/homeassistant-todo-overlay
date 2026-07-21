from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(slots=True)
class TodoItem:
    """The Todo Overlay API model exposed to the frontend."""

    id: str
    title: str
    completed: bool
    children: list["TodoItem"] = field(default_factory=list)
