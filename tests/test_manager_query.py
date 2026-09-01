"""Tests for manager_query.py's query_items() - server-side filtering
and hierarchy lookups over a list's items, for automations that need
more than "give me the whole list and I'll sort it out in Jinja" (see
its own module docstring for the gap this closes)."""

from datetime import date

import pytest

from custom_components.todo_overlay.errors import ItemNotFoundError
from custom_components.todo_overlay.manager import TodoManager
from custom_components.todo_overlay.models import ItemPosition, TodoItem

from fakes import FakeAdapter, FakeMetadataStore

ENTITY_ID = "todo.household"


async def make_manager(today: date = date(2026, 1, 7)) -> TodoManager:
    """A tree exercising every filter dimension at once:

    - groceries (category)
      - milk (quantity=2L, tags=[urgent])
    - brodie (person)
      - passport (due_date=2026-01-01 - before `today`, so overdue)
      - sub
        - grandchild (tags=[urgent], depth 2 - the multi-level case
          neither get_items nor the open-items sensor can answer)
    - monday (day, weekday=0, delete_protected, linked, trigger_on_due)
      - gym (completed)
    - solo (completed, no children)
    """

    adapter = FakeAdapter(items=[
        TodoItem(id="groceries", title="Groceries", completed=False),
        TodoItem(id="milk", title="Milk", completed=False),
        TodoItem(id="brodie", title="Brodie", completed=False),
        TodoItem(id="passport", title="Passport", completed=False, due_date="2026-01-01"),
        TodoItem(id="sub", title="Sub", completed=False),
        TodoItem(id="grandchild", title="Grandchild", completed=False),
        TodoItem(id="monday", title="Monday", completed=False),
        TodoItem(id="gym", title="Gym", completed=True),
        TodoItem(id="solo", title="Solo", completed=True),
    ])
    metadata_store = FakeMetadataStore({
        "groceries": ItemPosition(parent_id=None, order=0),
        "milk": ItemPosition(parent_id="groceries", order=0),
        "brodie": ItemPosition(parent_id=None, order=1),
        "passport": ItemPosition(parent_id="brodie", order=0),
        "sub": ItemPosition(parent_id="brodie", order=1),
        "grandchild": ItemPosition(parent_id="sub", order=0),
        "monday": ItemPosition(parent_id=None, order=2),
        "gym": ItemPosition(parent_id="monday", order=0),
        "solo": ItemPosition(parent_id=None, order=3),
    })

    await metadata_store.set_pin_type(ENTITY_ID, "groceries", "category")
    await metadata_store.set_pin_type(ENTITY_ID, "brodie", "person")
    await metadata_store.set_pin_type(ENTITY_ID, "monday", "day")
    await metadata_store.set_weekday(ENTITY_ID, "monday", 0)
    await metadata_store.set_delete_protected(ENTITY_ID, "monday", True)
    await metadata_store.set_trigger_on_due(ENTITY_ID, "monday", True)
    await metadata_store.set_item_link(ENTITY_ID, "monday", "todo.shared", "other-id")
    await metadata_store.set_quantity(ENTITY_ID, "milk", "2L")
    await metadata_store.set_tags(ENTITY_ID, "milk", ["urgent"])
    await metadata_store.set_tags(ENTITY_ID, "grandchild", ["urgent"])

    return TodoManager(adapter=adapter, metadata_store=metadata_store, today_date_fn=lambda: today)


@pytest.mark.asyncio
async def test_query_items_with_no_filters_returns_every_item_at_every_depth():
    manager = await make_manager()

    items = await manager.query_items(ENTITY_ID)

    assert {item["id"] for item in items} == {
        "groceries", "milk", "brodie", "passport", "sub", "grandchild", "monday", "gym", "solo",
    }


@pytest.mark.asyncio
async def test_query_items_serializes_every_overlay_field_and_direct_parent():
    manager = await make_manager()

    items = await manager.query_items(ENTITY_ID)
    milk = next(item for item in items if item["id"] == "milk")

    assert milk == {
        "id": "milk", "title": "Milk", "completed": False, "description": None,
        "due_date": None, "due_datetime": None, "quantity": "2L", "tags": ["urgent"],
        "trigger_on_due": False, "pin_type": None, "weekday": None, "day_label": None,
        "linked": False, "delete_protected": False, "depth": 1, "top_level": False,
        "parent_id": "groceries", "parent_title": "Groceries", "child_ids": [],
        "overdue": False, "days_overdue": None,
        "has_open_descendants": False, "has_overdue_descendants": False,
    }


@pytest.mark.asyncio
async def test_query_items_filters_by_completed():
    manager = await make_manager()

    incomplete = await manager.query_items(ENTITY_ID, completed=False)
    complete = await manager.query_items(ENTITY_ID, completed=True)

    assert "solo" not in {item["id"] for item in incomplete}
    # "monday" itself derives complete too, purely because its one
    # child ("gym") is - see build_tree's own finalize() step.
    assert {item["id"] for item in complete} == {"gym", "monday", "solo"}


@pytest.mark.asyncio
async def test_query_items_filters_by_single_tag():
    manager = await make_manager()

    items = await manager.query_items(ENTITY_ID, tag="urgent")

    assert {item["id"] for item in items} == {"milk", "grandchild"}


@pytest.mark.asyncio
async def test_query_items_tags_mode_any_vs_all():
    manager = await make_manager()
    await manager.set_tags(ENTITY_ID, "milk", ["urgent", "fragile"])

    any_mode = await manager.query_items(ENTITY_ID, tags=["urgent", "fragile"], tags_mode="any")
    all_mode = await manager.query_items(ENTITY_ID, tags=["urgent", "fragile"], tags_mode="all")

    assert {item["id"] for item in any_mode} == {"milk", "grandchild"}
    assert {item["id"] for item in all_mode} == {"milk"}


@pytest.mark.asyncio
async def test_query_items_filters_by_has_due_date():
    manager = await make_manager()

    with_due = await manager.query_items(ENTITY_ID, has_due_date=True)
    without_due = await manager.query_items(ENTITY_ID, has_due_date=False)

    assert {item["id"] for item in with_due} == {"passport"}
    assert "passport" not in {item["id"] for item in without_due}


@pytest.mark.asyncio
async def test_query_items_filters_by_overdue_using_the_injected_clock():
    manager = await make_manager(today=date(2026, 1, 7))

    items = await manager.query_items(ENTITY_ID, overdue=True)

    assert {item["id"] for item in items} == {"passport"}


@pytest.mark.asyncio
async def test_query_items_overdue_is_false_for_a_due_date_that_has_not_arrived_yet():
    # Same due_date (2026-01-01) as the overdue test above, but "today"
    # is now before it - nothing should be overdue.
    manager = await make_manager(today=date(2025, 12, 1))

    items = await manager.query_items(ENTITY_ID, overdue=True)

    assert items == []


@pytest.mark.asyncio
async def test_query_items_filters_by_due_today():
    manager = await make_manager(today=date(2026, 1, 1))

    items = await manager.query_items(ENTITY_ID, due_today=True)

    assert {item["id"] for item in items} == {"passport"}


@pytest.mark.asyncio
async def test_query_items_due_today_does_not_exclude_completed_items():
    # Deliberately different from overdue's own semantics - see
    # query_items' own docstring for why: "due today" is a fact about
    # the due date, not a statement about an outstanding obligation.
    manager = await make_manager(today=date(2026, 1, 1))
    await manager.set_completed(ENTITY_ID, "passport", True)

    items = await manager.query_items(ENTITY_ID, due_today=True)

    assert {item["id"] for item in items} == {"passport"}


@pytest.mark.asyncio
async def test_query_items_days_overdue_field_matches_the_actual_gap():
    manager = await make_manager(today=date(2026, 1, 4))

    items = await manager.query_items(ENTITY_ID)
    passport = next(item for item in items if item["id"] == "passport")

    assert passport["overdue"] is True
    assert passport["days_overdue"] == 3


@pytest.mark.asyncio
async def test_query_items_days_overdue_is_none_when_not_overdue():
    manager = await make_manager()

    items = await manager.query_items(ENTITY_ID)
    solo = next(item for item in items if item["id"] == "solo")

    assert solo["overdue"] is False
    assert solo["days_overdue"] is None


@pytest.mark.asyncio
async def test_query_items_filters_by_due_before_and_due_after():
    manager = await make_manager()

    before = await manager.query_items(ENTITY_ID, due_before="2026-01-02")
    after = await manager.query_items(ENTITY_ID, due_after="2026-01-02")

    assert {item["id"] for item in before} == {"passport"}
    assert after == []


@pytest.mark.asyncio
async def test_query_items_filters_by_pin_type():
    manager = await make_manager()

    persons = await manager.query_items(ENTITY_ID, pin_type="person")

    assert {item["id"] for item in persons} == {"brodie"}


@pytest.mark.asyncio
async def test_query_items_pin_type_none_means_plain_leaf_items():
    manager = await make_manager()

    items = await manager.query_items(ENTITY_ID, pin_type="none")

    assert {item["id"] for item in items} == {"milk", "passport", "sub", "grandchild", "gym", "solo"}


@pytest.mark.asyncio
async def test_query_items_filters_by_weekday():
    manager = await make_manager()

    items = await manager.query_items(ENTITY_ID, weekday=0)

    assert {item["id"] for item in items} == {"monday"}


@pytest.mark.asyncio
async def test_query_items_filters_by_delete_protected_linked_and_trigger_on_due():
    manager = await make_manager()

    assert {item["id"] for item in await manager.query_items(ENTITY_ID, delete_protected=True)} == {"monday"}
    assert {item["id"] for item in await manager.query_items(ENTITY_ID, linked=True)} == {"monday"}
    assert {item["id"] for item in await manager.query_items(ENTITY_ID, trigger_on_due=True)} == {"monday"}


@pytest.mark.asyncio
async def test_query_items_filters_by_has_quantity():
    manager = await make_manager()

    items = await manager.query_items(ENTITY_ID, has_quantity=True)

    assert {item["id"] for item in items} == {"milk"}


@pytest.mark.asyncio
async def test_query_items_combines_filters_with_and():
    manager = await make_manager()

    items = await manager.query_items(ENTITY_ID, completed=False, tag="urgent")

    assert {item["id"] for item in items} == {"milk", "grandchild"}


# --- hierarchy scope --------------------------------------------------

@pytest.mark.asyncio
async def test_query_items_parent_id_returns_direct_children_only():
    manager = await make_manager()

    items = await manager.query_items(ENTITY_ID, parent_id="brodie")

    assert {item["id"] for item in items} == {"passport", "sub"}


@pytest.mark.asyncio
async def test_query_items_parent_title_resolves_the_same_as_parent_id():
    manager = await make_manager()

    items = await manager.query_items(ENTITY_ID, parent_title="Brodie")

    assert {item["id"] for item in items} == {"passport", "sub"}


@pytest.mark.asyncio
async def test_query_items_under_title_returns_every_descendant_at_any_depth():
    # The actual gap this whole feature exists to close: "grandchild"
    # is two levels under "brodie" - parent_id/parent_title (and the
    # open-items sensor's own single-level parent_title) can't reach
    # it at all, only under_id/under_title can.
    manager = await make_manager()

    items = await manager.query_items(ENTITY_ID, under_title="Brodie")

    assert {item["id"] for item in items} == {"passport", "sub", "grandchild"}


@pytest.mark.asyncio
async def test_query_items_top_level_only():
    manager = await make_manager()

    items = await manager.query_items(ENTITY_ID, top_level_only=True)

    assert {item["id"] for item in items} == {"groceries", "brodie", "monday", "solo"}


@pytest.mark.asyncio
async def test_query_items_parent_id_raises_item_not_found_for_an_unknown_target():
    manager = await make_manager()

    with pytest.raises(ItemNotFoundError):
        await manager.query_items(ENTITY_ID, parent_id="does-not-exist")


@pytest.mark.asyncio
async def test_query_items_under_title_raises_item_not_found_for_an_unknown_target():
    manager = await make_manager()

    with pytest.raises(ItemNotFoundError):
        await manager.query_items(ENTITY_ID, under_title="Nobody")


# --- output shape -------------------------------------------------------

@pytest.mark.asyncio
async def test_query_items_include_ancestors_gives_the_full_root_to_parent_chain():
    manager = await make_manager()

    items = await manager.query_items(ENTITY_ID, under_title="Brodie", include_ancestors=True)
    grandchild = next(item for item in items if item["id"] == "grandchild")

    assert grandchild["ancestors"] == [
        {"id": "brodie", "title": "Brodie"},
        {"id": "sub", "title": "Sub"},
    ]


@pytest.mark.asyncio
async def test_query_items_without_include_ancestors_omits_the_key_entirely():
    manager = await make_manager()

    items = await manager.query_items(ENTITY_ID, parent_id="brodie")

    assert "ancestors" not in items[0]


@pytest.mark.asyncio
async def test_query_items_child_ids_lists_direct_children_by_id():
    manager = await make_manager()

    items = await manager.query_items(ENTITY_ID, parent_id="brodie")
    sub = next(item for item in items if item["id"] == "sub")

    assert sub["child_ids"] == ["grandchild"]


@pytest.mark.asyncio
async def test_query_items_child_ids_is_always_present_even_with_no_children():
    manager = await make_manager()

    items = await manager.query_items(ENTITY_ID, parent_id="brodie")
    passport = next(item for item in items if item["id"] == "passport")

    assert passport["child_ids"] == []


@pytest.mark.asyncio
async def test_query_items_child_ids_can_reference_an_id_outside_the_result_set():
    """Same already-accepted situation parent_id can be in too (see
    manager_query.py's own docstring): top_level_only excludes "gym"
    (depth 1) from the result set entirely, but "monday" (its parent,
    a root item) still lists it in child_ids - a child_id not present
    as its own key in the result just means that child didn't
    separately satisfy the filters/scope, here the scope itself."""

    manager = await make_manager()

    items = await manager.query_items(ENTITY_ID, top_level_only=True)
    monday = next(item for item in items if item["id"] == "monday")

    assert monday["child_ids"] == ["gym"]
    assert "gym" not in {item["id"] for item in items}


@pytest.mark.asyncio
async def test_query_items_top_level_field_matches_depth_zero():
    manager = await make_manager()

    items = await manager.query_items(ENTITY_ID)

    assert {item["id"] for item in items if item["top_level"]} == {
        "groceries", "brodie", "monday", "solo",
    }


@pytest.mark.asyncio
async def test_query_items_overdue_field_is_always_present_not_just_a_filter():
    manager = await make_manager()

    items = await manager.query_items(ENTITY_ID)

    assert next(item for item in items if item["id"] == "passport")["overdue"] is True
    assert next(item for item in items if item["id"] == "solo")["overdue"] is False


@pytest.mark.asyncio
async def test_query_items_has_open_descendants_is_true_at_any_depth_not_just_direct_children():
    # "brodie" has no INCOMPLETE direct child of its own that's a leaf -
    # its incomplete descendant ("grandchild") is two levels down, under
    # "sub" - has_open_descendants must still see it.
    manager = await make_manager()

    items = await manager.query_items(ENTITY_ID)

    brodie = next(item for item in items if item["id"] == "brodie")
    sub = next(item for item in items if item["id"] == "sub")
    solo = next(item for item in items if item["id"] == "solo")

    assert brodie["has_open_descendants"] is True
    assert sub["has_open_descendants"] is True
    # A leaf with no children at all never has open descendants,
    # regardless of its own completed status.
    assert solo["has_open_descendants"] is False


@pytest.mark.asyncio
async def test_query_items_has_overdue_descendants_is_true_at_any_depth():
    # "passport" (overdue) sits directly under "brodie", but is itself
    # a leaf with no descendants of its own.
    manager = await make_manager()

    items = await manager.query_items(ENTITY_ID)

    brodie = next(item for item in items if item["id"] == "brodie")
    passport = next(item for item in items if item["id"] == "passport")
    sub = next(item for item in items if item["id"] == "sub")

    assert brodie["has_overdue_descendants"] is True
    assert passport["has_overdue_descendants"] is False
    assert sub["has_overdue_descendants"] is False


@pytest.mark.asyncio
async def test_query_items_has_overdue_descendants_reaches_below_a_non_overdue_intermediate_parent():
    # Overdue-ness doesn't derive/bubble up through completed the way
    # has_open_descendants does - this pins down that the dedicated
    # whole-tree pass actually walks every level rather than stopping
    # at the first intermediate parent.
    manager = await make_manager()
    await manager.move_item(ENTITY_ID, "passport", reference_id="sub", placement="inside")

    items = await manager.query_items(ENTITY_ID)
    sub = next(item for item in items if item["id"] == "sub")

    assert sub["has_overdue_descendants"] is True


@pytest.mark.asyncio
async def test_query_items_limit_caps_the_result_count():
    manager = await make_manager()

    items = await manager.query_items(ENTITY_ID, top_level_only=True, limit=2)

    assert len(items) == 2
