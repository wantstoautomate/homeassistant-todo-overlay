from custom_components.todo_overlay.models import ItemPosition, TodoItem
from custom_components.todo_overlay.tree import build_tree


def test_build_tree():
    items = [
        TodoItem(id="1", title="Shopping", completed=False),
        TodoItem(id="2", title="Milk", completed=False),
        TodoItem(id="3", title="Bread", completed=True),
    ]

    positions = {
        "1": ItemPosition(parent_id=None, order=0),
        "2": ItemPosition(parent_id="1", order=0),
        "3": ItemPosition(parent_id="1", order=1),
    }

    tree = build_tree(items, positions)

    assert len(tree) == 1

    root = tree[0]

    assert root.id == "1"
    assert len(root.children) == 2
    assert root.children[0].id == "2"
    assert root.children[1].id == "3"


def test_build_tree_sorts_by_order():
    items = [
        TodoItem(id="1", title="First", completed=False),
        TodoItem(id="2", title="Second", completed=False),
        TodoItem(id="3", title="Third", completed=False),
    ]

    # Stored out of order on purpose.
    positions = {
        "1": ItemPosition(parent_id=None, order=2),
        "2": ItemPosition(parent_id=None, order=0),
        "3": ItemPosition(parent_id=None, order=1),
    }

    tree = build_tree(items, positions)

    assert [item.id for item in tree] == ["2", "3", "1"]


def test_build_tree_defaults_unpositioned_items_to_root():
    items = [
        TodoItem(id="1", title="Shopping", completed=False),
        TodoItem(id="2", title="Milk", completed=False),
    ]

    tree = build_tree(items, positions={})

    assert [item.id for item in tree] == ["1", "2"]
