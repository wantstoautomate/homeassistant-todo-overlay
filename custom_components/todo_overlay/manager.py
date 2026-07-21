from .adapter import TodoAdapter
from .repository import RelationshipRepository
from .tree import build_tree
from .models import TodoItem


class TodoManager:
    """Main entry point for the Todo Overlay business logic."""

    def __init__(
        self,
        adapter: TodoAdapter,
        repository: RelationshipRepository,
    ) -> None:
        self._adapter = adapter
        self._repository = repository

    def get_tree(self) -> list[TodoItem]:
        """Return the todo hierarchy."""

        items = self._adapter.get_items()

        relationships = self._repository.get_relationships()

        return build_tree(
            items,
            relationships,
        )
