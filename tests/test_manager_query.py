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
        "linked": False, "delete_protected": False, "depth": 1,
        "parent_id": "groceries", "parent_title": "Groceries",
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
async def test_query_items_include_children_attaches_nested_unfiltered_children():
    manager = await make_manager()

    items = await manager.query_items(ENTITY_ID, parent_id="brodie", include_children=True)
    sub = next(item for item in items if item["id"] == "sub")

    assert [child["id"] for child in sub["children"]] == ["grandchild"]


@pytest.mark.asyncio
async def test_query_items_include_children_can_show_a_matched_descendant_twice():
    """Documents a deliberate, non-obvious interaction rather than
    guarding against it: under_title scope + include_children=True
    enriches each MATCHED result with its own children independently -
    it doesn't change which results matched. "grandchild" is itself a
    descendant of "brodie" (so it's its own top-level result here too)
    AND "sub"'s own child (so it shows up nested there as well)."""

    manager = await make_manager()

    items = await manager.query_items(ENTITY_ID, under_title="Brodie", include_children=True)

    sub = next(item for item in items if item["id"] == "sub")
    assert [child["id"] for child in sub["children"]] == ["grandchild"]
    assert "grandchild" in {item["id"] for item in items}


@pytest.mark.asyncio
async def test_query_items_limit_caps_the_result_count():
    manager = await make_manager()

    items = await manager.query_items(ENTITY_ID, top_level_only=True, limit=2)

    assert len(items) == 2
