from .ha_adapter import HomeAssistantTodoProvider
from .metadata_store import MetadataStore
from .models import TodoList
from .tree import build_tree


class TodoManager:
    """Main entry point for the Todo Overlay business logic."""

    def __init__(
        self,
        adapter: HomeAssistantTodoProvider,
        metadata_store: MetadataStore,
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

        if parent_id is not None:
            relationships = await self._metadata_store.get_relationships(
                entity_id,
            )

            ancestor = parent_id

            while ancestor is not None:
                if ancestor == child_id:
                    raise ValueError(
                        f"Cannot set parent of {child_id} to {parent_id}: "
                        f"{parent_id} is already a descendant of {child_id}"
                    )

                ancestor = relationships.get(ancestor)

        await self._metadata_store.set_parent(
            entity_id=entity_id,
            child_id=child_id,
            parent_id=parent_id,
        )
