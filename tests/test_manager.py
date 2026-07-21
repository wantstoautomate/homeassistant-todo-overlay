from custom_components.todo_overlay.manager import TodoManager
from custom_components.todo_overlay.models import TodoItem


class FakeAdapter:

    def get_items(self) -> list[TodoItem]:
        return [
            TodoItem(id="1", title="Shopping", completed=False),
            TodoItem(id="2", title="Milk", completed=False),
        ]


class FakeRepository:

    def get_relationships(self) -> dict[str, str | None]:
        return {
            "1": None,
            "2": "1",
        }


def test_manager_get_tree():

    manager = TodoManager(
        adapter=FakeAdapter(),
        repository=FakeRepository(),
    )

    tree = manager.get_tree()

    assert len(tree) == 1
    assert tree[0].title == "Shopping"
    assert tree[0].children[0].title == "Milk"
