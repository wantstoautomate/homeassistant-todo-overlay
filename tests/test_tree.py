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


# --- "day" pins: rotation + Today/Tomorrow labeling ------------------------
#
# pin_type/weekday, like every other overlay field build_tree attaches,
# come from the pin_types/weekdays dicts passed in - not from whatever
# a TodoItem happened to be constructed with (see the item.pin_type =
# (pin_types or {}).get(item.id) line near the top of build_tree) - so
# every test below sets them up that way, matching test_build_tree_
# attaches_trigger_on_due's own pattern.

def test_build_tree_day_label_today_and_tomorrow():
    # today_weekday=2 is Wednesday - Wednesday itself reads "Today",
    # Thursday (one day out) reads "Tomorrow", everything further out
    # keeps its own plain title (title itself is always the literal
    # weekday name regardless - see set_pin_type's own docstring).
    items = [
        TodoItem(id="wed", title="Wednesday", completed=False),
        TodoItem(id="thu", title="Thursday", completed=False),
        TodoItem(id="fri", title="Friday", completed=False),
    ]
    positions = {
        "wed": ItemPosition(parent_id=None, order=0),
        "thu": ItemPosition(parent_id=None, order=1),
        "fri": ItemPosition(parent_id=None, order=2),
    }
    pin_types = {"wed": "day", "thu": "day", "fri": "day"}
    weekdays = {"wed": 2, "thu": 3, "fri": 4}

    tree = build_tree(items, positions, pin_types=pin_types, weekdays=weekdays, today_weekday=2)

    labels = {item.id: item.day_label for item in tree}
    assert labels == {"wed": "Today", "thu": "Tomorrow", "fri": None}


def test_build_tree_day_label_wraps_around_the_week():
    # today_weekday=6 is Sunday - Monday (weekday=0) is one day away,
    # wrapping past the end of the week, so it still reads "Tomorrow".
    items = [
        TodoItem(id="sun", title="Sunday", completed=False),
        TodoItem(id="mon", title="Monday", completed=False),
    ]
    positions = {
        "sun": ItemPosition(parent_id=None, order=0),
        "mon": ItemPosition(parent_id=None, order=1),
    }
    pin_types = {"sun": "day", "mon": "day"}
    weekdays = {"sun": 6, "mon": 0}

    tree = build_tree(items, positions, pin_types=pin_types, weekdays=weekdays, today_weekday=6)

    labels = {item.id: item.day_label for item in tree}
    assert labels == {"sun": "Today", "mon": "Tomorrow"}


def test_build_tree_no_today_weekday_means_no_day_label_at_all():
    items = [TodoItem(id="wed", title="Wednesday", completed=False)]
    positions = {"wed": ItemPosition(parent_id=None, order=0)}

    tree = build_tree(
        items, positions, pin_types={"wed": "day"}, weekdays={"wed": 2}, today_weekday=None,
    )

    assert tree[0].day_label is None


def test_build_tree_day_pins_sort_by_rotation_not_stored_order():
    # Stored order is reverse-alphabetical/reverse-chronological on
    # purpose - the rotation must override it completely, not just
    # nudge it.
    items = [
        TodoItem(id="fri", title="Friday", completed=False),
        TodoItem(id="thu", title="Thursday", completed=False),
        TodoItem(id="wed", title="Wednesday", completed=False),
    ]
    positions = {
        "fri": ItemPosition(parent_id=None, order=0),
        "thu": ItemPosition(parent_id=None, order=1),
        "wed": ItemPosition(parent_id=None, order=2),
    }
    pin_types = {"fri": "day", "thu": "day", "wed": "day"}
    weekdays = {"fri": 4, "thu": 3, "wed": 2}

    tree = build_tree(items, positions, pin_types=pin_types, weekdays=weekdays, today_weekday=2)

    assert [item.id for item in tree] == ["wed", "thu", "fri"]


def test_build_tree_day_pins_ignore_group_completed_entirely():
    # "Wednesday" (today) is fully complete, "Thursday" is not -
    # group_completed=True would normally push a complete item to the
    # bottom of its siblings, but a "day" pin's rotation must win
    # regardless - the whole point is a stable chronological order.
    items = [
        TodoItem(id="wed", title="Wednesday", completed=True),
        TodoItem(id="thu", title="Thursday", completed=False),
    ]
    positions = {
        "wed": ItemPosition(parent_id=None, order=0),
        "thu": ItemPosition(parent_id=None, order=1),
    }
    pin_types = {"wed": "day", "thu": "day"}
    weekdays = {"wed": 2, "thu": 3}

    tree = build_tree(
        items, positions, pin_types=pin_types, weekdays=weekdays,
        group_completed=True, today_weekday=2,
    )

    assert [item.id for item in tree] == ["wed", "thu"]


def test_build_tree_weekday_anchor_top_groups_days_before_other_items():
    items = [
        TodoItem(id="other", title="Buy milk", completed=False),
        TodoItem(id="thu", title="Thursday", completed=False),
        TodoItem(id="wed", title="Wednesday", completed=False),
    ]
    positions = {
        "other": ItemPosition(parent_id=None, order=0),
        "thu": ItemPosition(parent_id=None, order=1),
        "wed": ItemPosition(parent_id=None, order=2),
    }
    pin_types = {"thu": "day", "wed": "day"}
    weekdays = {"thu": 3, "wed": 2}

    tree = build_tree(
        items, positions, pin_types=pin_types, weekdays=weekdays,
        today_weekday=2, weekday_anchor="top",
    )

    assert [item.id for item in tree] == ["wed", "thu", "other"]


def test_build_tree_weekday_anchor_bottom_groups_days_after_other_items():
    items = [
        TodoItem(id="thu", title="Thursday", completed=False),
        TodoItem(id="wed", title="Wednesday", completed=False),
        TodoItem(id="other", title="Buy milk", completed=False),
    ]
    positions = {
        "thu": ItemPosition(parent_id=None, order=0),
        "wed": ItemPosition(parent_id=None, order=1),
        "other": ItemPosition(parent_id=None, order=2),
    }
    pin_types = {"thu": "day", "wed": "day"}
    weekdays = {"thu": 3, "wed": 2}

    tree = build_tree(
        items, positions, pin_types=pin_types, weekdays=weekdays,
        today_weekday=2, weekday_anchor="bottom",
    )

    assert [item.id for item in tree] == ["other", "wed", "thu"]


def test_build_tree_weekday_anchor_is_independent_at_every_level():
    # Root level: a day block (anchored top) plus a plain "other" root.
    # Under "other", a SEPARATE day block of its own - proves this isn't
    # a whole-list special mode, just ordinary per-level grouping,
    # exactly like group_completed's own "applied independently at
    # every level" behavior.
    items = [
        TodoItem(id="other-root", title="Personal", completed=False),
        TodoItem(id="root-wed", title="Wednesday", completed=False),
        TodoItem(id="nested-thu", title="Thursday", completed=False),
        TodoItem(id="nested-other", title="Call mom", completed=False),
    ]
    positions = {
        "other-root": ItemPosition(parent_id=None, order=0),
        "root-wed": ItemPosition(parent_id=None, order=1),
        "nested-other": ItemPosition(parent_id="other-root", order=0),
        "nested-thu": ItemPosition(parent_id="other-root", order=1),
    }
    pin_types = {"root-wed": "day", "nested-thu": "day"}
    weekdays = {"root-wed": 2, "nested-thu": 3}

    tree = build_tree(
        items, positions, pin_types=pin_types, weekdays=weekdays,
        today_weekday=2, weekday_anchor="top",
    )

    assert [item.id for item in tree] == ["root-wed", "other-root"]
    personal = next(item for item in tree if item.id == "other-root")
    assert [child.id for child in personal.children] == ["nested-thu", "nested-other"]


def test_build_tree_only_day_pin_type_participates_in_rotation():
    # A plain (non-"day") item that happens to have a weekday value set
    # (shouldn't normally happen given set_pin_type's own validation,
    # but build_tree itself is a pure function with no such guarantee)
    # is NOT treated as a day pin - pin_type == "day" is what actually
    # gates this, not the mere presence of a weekday value.
    items = [
        TodoItem(id="thu", title="Thursday", completed=False),
        TodoItem(id="stray", title="Not a real day pin", completed=False),
    ]
    positions = {
        "thu": ItemPosition(parent_id=None, order=0),
        "stray": ItemPosition(parent_id=None, order=1),
    }
    pin_types = {"thu": "day", "stray": "category"}
    weekdays = {"thu": 3, "stray": 0}

    tree = build_tree(
        items, positions, pin_types=pin_types, weekdays=weekdays,
        today_weekday=2, weekday_anchor="top",
    )

    assert tree[1].id == "stray"
    assert tree[1].day_label is None
