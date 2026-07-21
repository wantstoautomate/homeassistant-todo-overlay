from custom_components.todo_overlay.models import TodoItem
from custom_components.todo_overlay.tree import build_tree


def test_build_tree():
    items = [
        TodoItem(id="1", title="Shopping", completed=False),
        TodoItem(id="2", title="Milk", completed=False),
        TodoItem(id="3", title="Bread", completed=True),
    ]

    relationships = {
        "1": None,
        "2": "1",
        "3": "1",
    }

    tree = build_tree(items, relationships)

    assert len(tree) == 1

    root = tree[0]

    assert root.id == "1"
    assert len(root.children) == 2
    assert root.children[0].id == "2"
    assert root.children[1].id == "3"
