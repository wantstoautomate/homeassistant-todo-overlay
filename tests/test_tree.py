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


def test_build_tree_attaches_quantities():
    items = [
        TodoItem(id="1", title="Salami", completed=False),
        TodoItem(id="2", title="Milk", completed=False),
    ]

    positions = {
        "1": ItemPosition(parent_id=None, order=0),
        "2": ItemPosition(parent_id=None, order=1),
    }

    quantities = {"1": "150g"}

    tree = build_tree(items, positions, quantities)

    assert tree[0].quantity == "150g"
    # No stored quantity for "Milk" - stays None rather than stale data
    # left over from a previous build_tree call on the same objects.
    assert tree[1].quantity is None


def test_build_tree_attaches_trigger_on_due():
    items = [
        TodoItem(id="1", title="Renew passport", completed=False),
        TodoItem(id="2", title="Milk", completed=False),
    ]

    positions = {
        "1": ItemPosition(parent_id=None, order=0),
        "2": ItemPosition(parent_id=None, order=1),
    }

    tree = build_tree(items, positions, trigger_on_due={"1"})

    assert tree[0].trigger_on_due is True
    # Not in the set - stays False rather than stale data left over from
    # a previous build_tree call on the same objects.
    assert tree[1].trigger_on_due is False


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


def test_build_tree_parent_completed_is_computed_from_children():
    items = [
        TodoItem(id="1", title="Shopping", completed=False),
        TodoItem(id="2", title="Milk", completed=True),
        TodoItem(id="3", title="Bread", completed=True),
    ]

    positions = {
        "1": ItemPosition(parent_id=None, order=0),
        "2": ItemPosition(parent_id="1", order=0),
        "3": ItemPosition(parent_id="1", order=1),
    }

    tree = build_tree(items, positions)

    # "1"'s own stored status was False, but both its children are
    # complete, so it should be computed as complete.
    assert tree[0].completed is True


def test_build_tree_parent_incomplete_if_any_child_incomplete():
    items = [
        TodoItem(id="1", title="Shopping", completed=True),
        TodoItem(id="2", title="Milk", completed=True),
        TodoItem(id="3", title="Bread", completed=False),
    ]

    positions = {
        "1": ItemPosition(parent_id=None, order=0),
        "2": ItemPosition(parent_id="1", order=0),
        "3": ItemPosition(parent_id="1", order=1),
    }

    tree = build_tree(items, positions)

    # "1"'s own stored status was True, but "3" is incomplete, so it
    # should be computed as incomplete.
    assert tree[0].completed is False


def test_build_tree_grandparent_completion_derives_through_parent():
    items = [
        TodoItem(id="1", title="Grandparent", completed=False),
        TodoItem(id="2", title="Parent", completed=False),
        TodoItem(id="3", title="Child", completed=True),
    ]

    positions = {
        "1": ItemPosition(parent_id=None, order=0),
        "2": ItemPosition(parent_id="1", order=0),
        "3": ItemPosition(parent_id="2", order=0),
    }

    tree = build_tree(items, positions)

    assert tree[0].children[0].completed is True
    assert tree[0].completed is True


def test_build_tree_completed_items_sort_after_incomplete_siblings_when_grouping():
    items = [
        TodoItem(id="1", title="Done", completed=True),
        TodoItem(id="2", title="Not done", completed=False),
    ]

    positions = {
        # "Done" has a LOWER stored order than "Not done", but being
        # complete should still push it to the bottom when group_completed
        # is on.
        "1": ItemPosition(parent_id=None, order=0),
        "2": ItemPosition(parent_id=None, order=1),
    }

    tree = build_tree(items, positions, group_completed=True)

    assert [item.id for item in tree] == ["2", "1"]


def test_build_tree_does_not_group_completed_by_default():
    items = [
        TodoItem(id="1", title="Done", completed=True),
        TodoItem(id="2", title="Not done", completed=False),
    ]

    positions = {
        "1": ItemPosition(parent_id=None, order=0),
        "2": ItemPosition(parent_id=None, order=1),
    }

    # group_completed defaults to False - stored order wins regardless of
    # completion, so ticking an item never visually moves it.
    tree = build_tree(items, positions)

    assert [item.id for item in tree] == ["1", "2"]


def test_build_tree_completed_sort_is_independent_per_level():
    items = [
        TodoItem(id="1", title="Root A", completed=True),
        TodoItem(id="2", title="Root B", completed=False),
        TodoItem(id="3", title="Child of A - done", completed=True),
        TodoItem(id="4", title="Child of A - not done", completed=False),
    ]

    positions = {
        "1": ItemPosition(parent_id=None, order=0),
        "2": ItemPosition(parent_id=None, order=1),
        "3": ItemPosition(parent_id="1", order=0),
        "4": ItemPosition(parent_id="1", order=1),
    }

    tree = build_tree(items, positions, group_completed=True)

    # "Root A" has an incomplete child, so it's computed incomplete and
    # sorts by order like normal at the root level (order 0 before 1) -
    # a child being pushed to the bottom of ITS OWN group must not bubble
    # up and affect its parent's position among its own siblings.
    assert [item.id for item in tree] == ["1", "2"]

    # Within Root A's own children, completion still sorts independently
    # of the root level, despite "done" having the lower stored order.
    assert [child.id for child in tree[0].children] == ["4", "3"]
