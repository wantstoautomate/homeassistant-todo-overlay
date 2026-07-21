from .models import TodoItem


class TodoAdapter:
    """Converts external todo sources into TodoItems."""

    def get_items(self) -> list[TodoItem]:
        """Return a flat list of TodoItems."""

        return [
            TodoItem(
                id="1",
                title="Shopping",
                completed=False,
            ),
            TodoItem(
                id="2",
                title="Milk",
                completed=False,
            ),
            TodoItem(
                id="3",
                title="Bread",
                completed=True,
            ),
        ]
