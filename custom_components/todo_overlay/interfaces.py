from __future__ import annotations

from typing import Protocol

from .models import TodoItem


class TodoProvider(Protocol):
    async def get_items(
        self,
        entity_id: str,
    ) -> list[TodoItem]:
        ...


class MetadataProvider(Protocol):
    async def get_relationships(
        self,
        entity_id: str,
    ) -> dict[str, str | None]:
        ...

    async def set_parent(
        self,
        entity_id: str,
        child_id: str,
        parent_id: str | None,
    ) -> None:
        ...
