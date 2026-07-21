from .interfaces import MetadataProvider, TodoProvider
from .models import TodoList
from .tree import build_tree


class TodoManager:
    """Main entry point for the Todo Overlay business logic."""

    def __init__(
        self,
        adapter: TodoProvider,
        metadata_store: MetadataProvider,
    ) -> None:
        self._adapter = adapter
        self._metadata_store = metadata_store

    async def get_list(
        self,
        entity_id: str,
    ) -> TodoList:
        """Return a Todo list."""

        items = await self._adapter.get_items(entity_id)

        relationships = await self._metadata_store.get_relationships(
            entity_id,
        )

        return TodoList(
            entity_id=entity_id,
            items=build_tree(items, relationships),
        )

    async def set_parent(
        self,
        entity_id: str,
        child_id: str,
        parent_id: str | None,
    ) -> None:
        """Set the parent of a todo item."""

        await self._metadata_store.set_parent(
            entity_id=entity_id,
            child_id=child_id,
            parent_id=parent_id,
        )
