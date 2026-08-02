import asyncio

import pytest

from custom_components.todo_overlay.const import EVENT_ITEM_CHANGED
from custom_components.todo_overlay.errors import (
    CycleError,
    ItemNotFoundError,
    SnapshotNotFoundError,
)
from custom_components.todo_overlay.manager import TodoManager
from custom_components.todo_overlay.models import ItemPosition, TodoItem

from fakes import (
    FakeAdapter,
    FakeMetadataStore,
    FakeMultiEntityAdapter,
    FakeMultiEntityMetadataStore,
)


@pytest.mark.asyncio
async def test_manager_get_list():

    manager = TodoManager(
        adapter=FakeAdapter(),
        metadata_store=FakeMetadataStore({
            "1": ItemPosition(parent_id=None, order=0),
            "2": ItemPosition(parent_id="1", order=0),
        }),
    )

    todo_list = await manager.get_list("todo.shopping")

    assert todo_list.entity_id == "todo.shopping"
    assert len(todo_list.items) == 1
    assert todo_list.items[0].title == "Shopping"
    assert todo_list.items[0].children[0].title == "Milk"


@pytest.mark.asyncio
async def test_manager_returns_serialisable_list():

    manager = TodoManager(
        adapter=FakeAdapter(),
        metadata_store=FakeMetadataStore({
            "1": ItemPosition(parent_id=None, order=0),
            "2": ItemPosition(parent_id="1", order=0),
        }),
    )

    data = (await manager.get_list("todo.shopping")).to_dict()

    assert data == {
        "entity_id": "todo.shopping",
        "items": [
            {
                "id": "1",
                "title": "Shopping",
                "completed": False,
                "description": None,
                "due_date": None,
                "due_datetime": None,
                "quantity": None,
                "tags": [],
                "trigger_on_due": False,
                "children": [
                    {
                        "id": "2",
                        "title": "Milk",
                        "completed": False,
                        "description": None,
                        "due_date": None,
                        "due_datetime": None,
                        "quantity": None,
                        "tags": [],
                        "trigger_on_due": False,
                        "children": [],
                    }
                ],
            }
        ],
    }


@pytest.mark.asyncio
async def test_manager_move_item_rejects_cycle():

    metadata_store = FakeMetadataStore({
        "1": ItemPosition(parent_id=None, order=0),
        "2": ItemPosition(parent_id="1", order=0),
    })

    manager = TodoManager(
        adapter=FakeAdapter(),
        metadata_store=metadata_store,
    )

    # "2"'s parent is already "1", so nesting "1" inside "2" would close
    # a cycle: 1 -> 2 -> 1.
    with pytest.raises(ValueError):
        await manager.move_item(
            entity_id="todo.shopping",
            child_id="1",
            reference_id="2",
            placement="inside",
        )

    assert metadata_store.set_positions_calls == []


@pytest.mark.asyncio
async def test_manager_move_item_rejects_moving_relative_to_self():

    manager = TodoManager(
        adapter=FakeAdapter(),
        metadata_store=FakeMetadataStore(),
    )

    with pytest.raises(ValueError):
        await manager.move_item(
            entity_id="todo.shopping",
            child_id="1",
            reference_id="1",
            placement="before",
        )


@pytest.mark.asyncio
async def test_manager_move_item_inside_appends_to_new_parent():

    metadata_store = FakeMetadataStore({
        "1": ItemPosition(parent_id=None, order=0),
        "2": ItemPosition(parent_id=None, order=1),
    })

    manager = TodoManager(
        adapter=FakeAdapter(),
        metadata_store=metadata_store,
    )

    await manager.move_item(
        entity_id="todo.shopping",
        child_id="2",
        reference_id="1",
        placement="inside",
    )

    todo_list = await manager.get_list("todo.shopping")

    assert len(todo_list.items) == 1
    assert todo_list.items[0].id == "1"
    assert todo_list.items[0].children[0].id == "2"


@pytest.mark.asyncio
async def test_manager_move_item_fires_a_moved_event():
    # Reordering is purely overlay metadata - it never touches the
    # native entity's items or state, so without this event, no OTHER
    # open card (a different browser/device/tab) has any signal a
    # reorder happened at all - see todo-overlay-list.ts's frontend
    # subscription to this same event.
    calls: list[tuple] = []

    class FakeHass:
        class bus:
            @staticmethod
            def async_fire(event, data):
                calls.append((event, data))

    metadata_store = FakeMetadataStore({
        "1": ItemPosition(parent_id=None, order=0),
        "2": ItemPosition(parent_id=None, order=1),
    })
    adapter = FakeAdapter(items=[
        TodoItem(id="1", title="Milk", completed=False),
        TodoItem(id="2", title="Eggs", completed=False),
    ])
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store, hass=FakeHass())

    await manager.move_item(
        entity_id="todo.shopping",
        child_id="2",
        reference_id="1",
        placement="before",
    )

    assert len(calls) == 1
    event, data = calls[0]
    assert event == EVENT_ITEM_CHANGED
    assert data["entity_id"] == "todo.shopping"
    assert data["item_id"] == "2"
    assert data["title"] == "Eggs"
    assert data["action"] == "moved"


@pytest.mark.asyncio
async def test_manager_move_item_before_reorders_siblings():

    adapter = FakeAdapter(items=[
        TodoItem(id="1", title="Shopping", completed=False),
        TodoItem(id="2", title="Milk", completed=False),
        TodoItem(id="3", title="Bread", completed=False),
    ])

    metadata_store = FakeMetadataStore({
        "1": ItemPosition(parent_id=None, order=0),
        "2": ItemPosition(parent_id=None, order=1),
        "3": ItemPosition(parent_id=None, order=2),
    })

    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    # Move "3" (Bread) to before "2" (Milk): 1, 3, 2
    await manager.move_item(
        entity_id="todo.shopping",
        child_id="3",
        reference_id="2",
        placement="before",
    )

    todo_list = await manager.get_list("todo.shopping")

    assert [item.id for item in todo_list.items] == ["1", "3", "2"]


@pytest.mark.asyncio
async def test_manager_move_item_reparents_root_but_leaves_children_attached():
    """Repositioning a parent (e.g. promoting a nested parent to the root
    level, or reordering it among its own top-level siblings) only ever
    rewrites that one item's own position - never its children's - so the
    whole subtree relocates as a unit, the same outcome a file manager's
    cut/paste gives you for a folder and everything inside it."""

    adapter = FakeAdapter(items=[
        TodoItem(id="1", title="Groceries", completed=False),
        TodoItem(id="2", title="Milk", completed=False),
        TodoItem(id="3", title="Eggs", completed=False),
        TodoItem(id="4", title="Chores", completed=False),
    ])

    metadata_store = FakeMetadataStore({
        "1": ItemPosition(parent_id=None, order=0),
        "2": ItemPosition(parent_id="1", order=0),
        "3": ItemPosition(parent_id="1", order=1),
        "4": ItemPosition(parent_id=None, order=1),
    })

    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    # Move "Groceries" (a parent with two children) to after "Chores".
    await manager.move_item(
        entity_id="todo.shopping",
        child_id="1",
        reference_id="4",
        placement="after",
    )

    todo_list = await manager.get_list("todo.shopping")

    assert [item.id for item in todo_list.items] == ["4", "1"]
    groceries = next(item for item in todo_list.items if item.id == "1")
    assert [child.id for child in groceries.children] == ["2", "3"]


@pytest.mark.asyncio
async def test_manager_set_completed_cascades_to_descendants():

    adapter = FakeAdapter(items=[
        TodoItem(id="1", title="Shopping", completed=False),
        TodoItem(id="2", title="Milk", completed=False),
        TodoItem(id="3", title="Bread", completed=True),
    ])

    metadata_store = FakeMetadataStore({
        "1": ItemPosition(parent_id=None, order=0),
        "2": ItemPosition(parent_id="1", order=0),
        "3": ItemPosition(parent_id="1", order=1),
    })

    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    changed = await manager.set_completed(
        entity_id="todo.shopping",
        item_id="1",
        completed=True,
    )

    # "3" was already completed, so only "1" and "2" actually changed.
    assert {c["id"] for c in changed} == {"1", "2"}
    assert adapter._items[0].completed is True
    assert adapter._items[1].completed is True
    assert adapter._items[2].completed is True


@pytest.mark.asyncio
async def test_manager_set_completed_does_not_reposition_by_default():

    adapter = FakeAdapter(items=[
        TodoItem(id="1", title="First", completed=False),
        TodoItem(id="2", title="Second", completed=False),
        TodoItem(id="3", title="Already done", completed=True),
    ])

    metadata_store = FakeMetadataStore({
        "1": ItemPosition(parent_id=None, order=0),
        "2": ItemPosition(parent_id=None, order=1),
        "3": ItemPosition(parent_id=None, order=2),
    })

    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    # No reposition= argument at all - the default should leave stored
    # order untouched, matching a plain checkbox tap's expected behavior.
    await manager.set_completed(entity_id="todo.shopping", item_id="1", completed=True)

    todo_list = await manager.get_list("todo.shopping")

    assert [item.id for item in todo_list.items] == ["1", "2", "3"]
    assert todo_list.items[0].completed is True


@pytest.mark.asyncio
async def test_manager_set_completed_reposition_false_leaves_order_untouched():

    adapter = FakeAdapter(items=[
        TodoItem(id="1", title="Was done", completed=True),
        TodoItem(id="2", title="Still incomplete", completed=False),
        TodoItem(id="3", title="Also done", completed=True),
    ])

    metadata_store = FakeMetadataStore({
        "1": ItemPosition(parent_id=None, order=0),
        "2": ItemPosition(parent_id=None, order=1),
        "3": ItemPosition(parent_id=None, order=2),
    })

    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    await manager.set_completed(entity_id="todo.shopping", item_id="1", completed=False, reposition=False)

    todo_list = await manager.get_list("todo.shopping")

    assert [item.id for item in todo_list.items] == ["1", "2", "3"]
    assert todo_list.items[0].completed is False
    assert metadata_store.set_positions_calls == []


@pytest.mark.asyncio
async def test_manager_set_completed_moves_item_to_top_of_completed_group():

    adapter = FakeAdapter(items=[
        TodoItem(id="1", title="First", completed=False),
        TodoItem(id="2", title="Second", completed=False),
        TodoItem(id="3", title="Already done", completed=True),
    ])

    metadata_store = FakeMetadataStore({
        "1": ItemPosition(parent_id=None, order=0),
        "2": ItemPosition(parent_id=None, order=1),
        "3": ItemPosition(parent_id=None, order=2),
    })

    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    await manager.set_completed(entity_id="todo.shopping", item_id="1", completed=True, reposition=True)

    todo_list = await manager.get_list("todo.shopping")

    # "1" was just completed, so it should sit above "3" (completed
    # earlier) - the top of the completed group - not wherever its old
    # stored order would have placed it.
    assert [item.id for item in todo_list.items] == ["2", "1", "3"]


@pytest.mark.asyncio
async def test_manager_set_completed_moves_item_to_bottom_of_incomplete_group():

    adapter = FakeAdapter(items=[
        TodoItem(id="1", title="Was done", completed=True),
        TodoItem(id="2", title="Still incomplete", completed=False),
        TodoItem(id="3", title="Also done", completed=True),
    ])

    metadata_store = FakeMetadataStore({
        "1": ItemPosition(parent_id=None, order=0),
        "2": ItemPosition(parent_id=None, order=1),
        "3": ItemPosition(parent_id=None, order=2),
    })

    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    await manager.set_completed(entity_id="todo.shopping", item_id="1", completed=False, reposition=True)

    todo_list = await manager.get_list("todo.shopping")

    # "1" was just uncompleted, so it should sit below "2" (still
    # incomplete) - the bottom of the incomplete group - not wherever
    # its old stored order would have placed it.
    assert [item.id for item in todo_list.items] == ["2", "1", "3"]


@pytest.mark.asyncio
async def test_manager_set_completed_repositions_auto_completed_parent_among_siblings():

    adapter = FakeAdapter(items=[
        TodoItem(id="1", title="Parent", completed=False),
        TodoItem(id="2", title="Other completed root", completed=True),
        TodoItem(id="3", title="Other incomplete root", completed=False),
        TodoItem(id="4", title="Only child", completed=False),
    ])

    metadata_store = FakeMetadataStore({
        "1": ItemPosition(parent_id=None, order=0),
        "2": ItemPosition(parent_id=None, order=1),
        "3": ItemPosition(parent_id=None, order=2),
        "4": ItemPosition(parent_id="1", order=0),
    })

    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    # Completing the only child makes "Parent" derive to complete too -
    # it should reposition among its own root-level siblings, landing
    # at the top of the completed ones (right after the incomplete
    # root), even though its own completion was never directly set.
    await manager.set_completed(entity_id="todo.shopping", item_id="4", completed=True, reposition=True)

    todo_list = await manager.get_list("todo.shopping")

    assert [item.id for item in todo_list.items] == ["3", "1", "2"]
    assert todo_list.items[1].completed is True


@pytest.mark.asyncio
async def test_manager_reposition_uses_derived_not_raw_completed_for_siblings():

    # "Shopping" is a parent whose own raw completed flag was never
    # independently written (it stays False at rest - only the tree's
    # bottom-up derivation renders it as complete via its children).
    # When "Egg" completes and flips "Milk" (its parent) to derived-
    # complete too, Milk's reposition among its OWN root siblings must
    # judge "Shopping" by what it actually renders as (complete),
    # not by Shopping's stale raw flag - otherwise Milk gets inserted
    # on the wrong side of an already-complete sibling.
    adapter = FakeAdapter(items=[
        TodoItem(id="milk", title="Milk", completed=False),
        TodoItem(id="shopping", title="Shopping", completed=False),
        TodoItem(id="egg", title="Egg", completed=False),
        TodoItem(id="item", title="Item", completed=True),
        TodoItem(id="asdf", title="asdf", completed=True),
    ])

    metadata_store = FakeMetadataStore({
        "milk": ItemPosition(parent_id=None, order=0),
        "shopping": ItemPosition(parent_id=None, order=1),
        "egg": ItemPosition(parent_id="milk", order=0),
        "item": ItemPosition(parent_id="shopping", order=0),
        "asdf": ItemPosition(parent_id="shopping", order=1),
    })

    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    await manager.set_completed(entity_id="todo.shopping", item_id="egg", completed=True, reposition=True)

    todo_list = await manager.get_list("todo.shopping")

    assert [item.id for item in todo_list.items] == ["milk", "shopping"]
    assert todo_list.items[0].completed is True
    assert todo_list.items[1].completed is True


@pytest.mark.asyncio
async def test_manager_clear_completed_removes_completed_top_level_items_and_children():

    adapter = FakeAdapter(items=[
        TodoItem(id="1", title="Shopping", completed=True),
        TodoItem(id="2", title="Item", completed=True),
        TodoItem(id="3", title="asdf", completed=True),
        TodoItem(id="4", title="Milk", completed=False),
        TodoItem(id="5", title="Eggs", completed=False),
        TodoItem(id="6", title="Bananas", completed=True),
    ])

    metadata_store = FakeMetadataStore({
        "1": ItemPosition(parent_id=None, order=0),
        "2": ItemPosition(parent_id="1", order=0),
        "3": ItemPosition(parent_id="1", order=1),
        "4": ItemPosition(parent_id=None, order=1),
        "5": ItemPosition(parent_id="4", order=0),
        "6": ItemPosition(parent_id=None, order=2),
    })

    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    removed = await manager.clear_completed(entity_id="todo.shopping")

    # "Shopping" (root, derived complete via its children) and its
    # children "Item"/"asdf" are removed together, as is standalone
    # "Bananas" - but "Milk" survives (root, incomplete) along with its
    # child "Eggs" (which must survive too, since it's not top-level and
    # its own ancestor - Milk - isn't complete).
    assert set(removed) == {"1", "2", "3", "6"}

    remaining_ids = {item.id for item in adapter._items}
    assert remaining_ids == {"4", "5"}

    # Stale position entries for removed items are cleaned up too.
    assert metadata_store._positions.keys() == {"4", "5"}


@pytest.mark.asyncio
async def test_manager_clear_completed_leaves_incomplete_nested_completed_subtree_alone():

    # "2" is a fully-complete subtree, but it's nested under an
    # incomplete root ("1") - clear_completed only considers top-level
    # items, so this nested group is left untouched even though it
    # would qualify if it were a root itself.
    adapter = FakeAdapter(items=[
        TodoItem(id="1", title="Root", completed=False),
        TodoItem(id="2", title="Nested done", completed=True),
        TodoItem(id="3", title="Nested pending", completed=False),
    ])

    metadata_store = FakeMetadataStore({
        "1": ItemPosition(parent_id=None, order=0),
        "2": ItemPosition(parent_id="1", order=0),
        "3": ItemPosition(parent_id="1", order=1),
    })

    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    removed = await manager.clear_completed(entity_id="todo.shopping")

    assert removed == []
    assert {item.id for item in adapter._items} == {"1", "2", "3"}


@pytest.mark.asyncio
async def test_manager_restore_completed_writes_back_exact_values():

    adapter = FakeAdapter(items=[
        TodoItem(id="1", title="Shopping", completed=True),
        TodoItem(id="2", title="Milk", completed=True),
        TodoItem(id="3", title="Bread", completed=True),
    ])

    manager = TodoManager(adapter=adapter, metadata_store=FakeMetadataStore())

    # Simulate undoing a cascade where "2" and "3" had different prior states.
    await manager.restore_completed(
        entity_id="todo.shopping",
        changes=[
            {"id": "2", "completed": False},
            {"id": "3", "completed": True},
        ],
    )

    assert adapter._items[1].completed is False
    assert adapter._items[2].completed is True


@pytest.mark.asyncio
async def test_manager_save_list_without_persist_states_omits_completion():

    adapter = FakeAdapter(items=[
        TodoItem(id="1", title="Shopping", completed=True),
        TodoItem(id="2", title="Milk", completed=True),
    ])

    metadata_store = FakeMetadataStore({
        "1": ItemPosition(parent_id=None, order=0),
        "2": ItemPosition(parent_id="1", order=0),
    })

    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    await manager.save_list(entity_id="todo.shopping", name="template")

    snapshot = metadata_store._snapshots["template"]

    assert snapshot[0]["title"] == "Shopping"
    assert snapshot[0]["completed"] is False
    assert snapshot[0]["children"][0]["completed"] is False


@pytest.mark.asyncio
async def test_manager_save_list_with_persist_states_captures_completion():

    adapter = FakeAdapter(items=[
        TodoItem(id="1", title="Shopping", completed=False),
        TodoItem(id="2", title="Milk", completed=True),
        TodoItem(id="3", title="Bread", completed=False),
    ])

    metadata_store = FakeMetadataStore({
        "1": ItemPosition(parent_id=None, order=0),
        "2": ItemPosition(parent_id="1", order=0),
        "3": ItemPosition(parent_id="1", order=1),
    })

    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    await manager.save_list(entity_id="todo.shopping", name="template", persist_states=True)

    snapshot = metadata_store._snapshots["template"]

    children_by_title = {c["title"]: c["completed"] for c in snapshot[0]["children"]}
    assert children_by_title == {"Milk": True, "Bread": False}


@pytest.mark.asyncio
async def test_manager_load_list_full_merge_recreates_snapshot_as_new_items():

    adapter = FakeAdapter(items=[])
    metadata_store = FakeMetadataStore({})
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    await metadata_store.save_snapshot("template", [
        {
            "title": "Shopping",
            "description": None,
            "due_date": None,
            "due_datetime": None,
            "completed": False,
            "children": [
                {
                    "title": "Milk",
                    "description": None,
                    "due_date": None,
                    "due_datetime": None,
                    "completed": False,
                    "children": [],
                },
            ],
        },
    ])

    await manager.load_list(entity_id="todo.shopping", name="template", mode="full_merge")

    todo_list = await manager.get_list("todo.shopping")

    assert len(todo_list.items) == 1
    assert todo_list.items[0].title == "Shopping"
    assert todo_list.items[0].children[0].title == "Milk"

    # Loading it again should create a SECOND "Shopping" - full_merge
    # never checks for duplicates.
    await manager.load_list(entity_id="todo.shopping", name="template", mode="full_merge")

    todo_list_after = await manager.get_list("todo.shopping")
    assert len(todo_list_after.items) == 2


@pytest.mark.asyncio
async def test_manager_load_list_merge_skips_existing_and_adds_missing_children():

    adapter = FakeAdapter(items=[
        TodoItem(id="1", title="Shopping", completed=False),
        TodoItem(id="2", title="Milk", completed=False),
    ])

    metadata_store = FakeMetadataStore({
        "1": ItemPosition(parent_id=None, order=0),
        "2": ItemPosition(parent_id="1", order=0),
    })

    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    await metadata_store.save_snapshot("template", [
        {
            "title": "Shopping",
            "description": None,
            "due_date": None,
            "due_datetime": None,
            "completed": False,
            "children": [
                {
                    "title": "Milk",
                    "description": None,
                    "due_date": None,
                    "due_datetime": None,
                    "completed": False,
                    "children": [],
                },
                {
                    "title": "Eggs",
                    "description": None,
                    "due_date": None,
                    "due_datetime": None,
                    "completed": False,
                    "children": [],
                },
            ],
        },
    ])

    await manager.load_list(entity_id="todo.shopping", name="template", mode="merge")

    todo_list = await manager.get_list("todo.shopping")

    # "Shopping" and "Milk" already existed (matched by title path) and
    # were left alone - only "Eggs" is genuinely new, added as a child
    # of the EXISTING "Shopping" rather than duplicating it.
    assert len(todo_list.items) == 1
    assert todo_list.items[0].id == "1"
    assert {c.title for c in todo_list.items[0].children} == {"Milk", "Eggs"}
    assert len(todo_list.items[0].children) == 2


@pytest.mark.asyncio
async def test_manager_load_list_replace_clears_existing_items_first():

    adapter = FakeAdapter(items=[
        TodoItem(id="1", title="Old item", completed=False),
    ])

    metadata_store = FakeMetadataStore({
        "1": ItemPosition(parent_id=None, order=0),
    })

    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    await metadata_store.save_snapshot("template", [
        {
            "title": "New item",
            "description": None,
            "due_date": None,
            "due_datetime": None,
            "completed": False,
            "children": [],
        },
    ])

    await manager.load_list(entity_id="todo.shopping", name="template", mode="replace")

    assert adapter.remove_item_calls == [("todo.shopping", "1")]

    todo_list = await manager.get_list("todo.shopping")
    assert [item.title for item in todo_list.items] == ["New item"]


@pytest.mark.asyncio
async def test_manager_save_and_load_list_works_across_different_entities():

    # Saved snapshot names are a single global namespace, not scoped to
    # whichever todo entity they were saved from - so a list saved from
    # one entity can be loaded onto a completely different one.
    adapter = FakeAdapter(items=[TodoItem(id="1", title="Bread", completed=False)])
    metadata_store = FakeMetadataStore({"1": ItemPosition(parent_id=None, order=0)})
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    await manager.save_list(entity_id="todo.shopping", name="groceries_template")

    await manager.load_list(
        entity_id="todo.other_list", name="groceries_template", mode="full_merge",
    )

    assert ("todo.other_list", "Bread") in adapter.add_item_calls


@pytest.mark.asyncio
async def test_manager_load_list_raises_for_unknown_snapshot():

    manager = TodoManager(adapter=FakeAdapter(items=[]), metadata_store=FakeMetadataStore())

    with pytest.raises(ValueError):
        await manager.load_list(entity_id="todo.shopping", name="nope", mode="merge")


@pytest.mark.asyncio
async def test_manager_list_saved_and_delete_saved():

    metadata_store = FakeMetadataStore()
    manager = TodoManager(adapter=FakeAdapter(items=[]), metadata_store=metadata_store)

    await manager.save_list(entity_id="todo.shopping", name="a")
    await manager.save_list(entity_id="todo.shopping", name="b")

    assert await manager.list_saved() == ["a", "b"]

    await manager.delete_saved("a")

    assert await manager.list_saved() == ["b"]


@pytest.mark.asyncio
async def test_manager_create_item_sets_quantity():

    adapter = FakeAdapter(items=[])
    metadata_store = FakeMetadataStore()
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    item_id = await manager.create_item(
        entity_id="todo.shopping",
        title="Salami",
        quantity="150g",
    )

    assert adapter.add_item_calls == [("todo.shopping", "Salami")]

    todo_list = await manager.get_list("todo.shopping")
    assert todo_list.items[0].id == item_id
    assert todo_list.items[0].quantity == "150g"


@pytest.mark.asyncio
async def test_manager_set_quantity_updates_and_clears():

    adapter = FakeAdapter(items=[TodoItem(id="1", title="Salami", completed=False)])
    metadata_store = FakeMetadataStore({"1": ItemPosition(parent_id=None, order=0)})
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    await manager.set_quantity("todo.shopping", "1", "150g")
    todo_list = await manager.get_list("todo.shopping")
    assert todo_list.items[0].quantity == "150g"

    await manager.set_quantity("todo.shopping", "1", None)
    todo_list_after = await manager.get_list("todo.shopping")
    assert todo_list_after.items[0].quantity is None


@pytest.mark.asyncio
async def test_manager_save_and_load_list_round_trips_quantity():

    # full_merge itself never dedupes at creation time, but get_list()'s
    # own universal same-title merge (see the tests further down) still
    # catches the result on the very next read, since both copies carry
    # a quantity - so this ends up as ONE "Salami" with combined 300g,
    # not two separate 150g items.
    adapter = FakeAdapter(items=[TodoItem(id="1", title="Salami", completed=False)])
    metadata_store = FakeMetadataStore({"1": ItemPosition(parent_id=None, order=0)})
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    await manager.set_quantity("todo.shopping", "1", "150g")
    await manager.save_list(entity_id="todo.shopping", name="template")

    await manager.load_list(entity_id="todo.shopping", name="template", mode="full_merge")

    todo_list = await manager.get_list("todo.shopping")
    salamis = [item for item in todo_list.items if item.title == "Salami"]
    assert len(salamis) == 1
    assert salamis[0].quantity == "300g"


@pytest.mark.asyncio
async def test_manager_load_list_full_merge_creates_true_duplicates_without_quantity():

    # Without any quantity involved, get_list()'s merge is deliberately
    # a no-op (see test_manager_get_list_leaves_plain_duplicate_titles_alone),
    # so full_merge's "duplicates and all, no dedup" behaviour is still
    # directly observable for plain items.
    adapter = FakeAdapter(items=[TodoItem(id="1", title="Shopping", completed=False)])
    metadata_store = FakeMetadataStore({"1": ItemPosition(parent_id=None, order=0)})
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    await manager.save_list(entity_id="todo.shopping", name="template")
    await manager.load_list(entity_id="todo.shopping", name="template", mode="full_merge")

    todo_list = await manager.get_list("todo.shopping")
    assert len([item for item in todo_list.items if item.title == "Shopping"]) == 2


@pytest.mark.asyncio
async def test_manager_load_list_merge_combines_matching_quantities():

    adapter = FakeAdapter(items=[TodoItem(id="1", title="Salami", completed=False)])
    metadata_store = FakeMetadataStore({"1": ItemPosition(parent_id=None, order=0)})
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    await manager.set_quantity("todo.shopping", "1", "150g")

    await metadata_store.save_snapshot("template", [
        {
            "title": "Salami",
            "description": None,
            "due_date": None,
            "due_datetime": None,
            "quantity": "200g",
            "completed": False,
            "children": [],
        },
    ])

    await manager.load_list(entity_id="todo.shopping", name="template", mode="merge")

    todo_list = await manager.get_list("todo.shopping")

    # Merged into the SAME existing item - no duplicate "Salami" line -
    # with quantities added together since both share a unit.
    assert len(todo_list.items) == 1
    assert todo_list.items[0].quantity == "350g"


@pytest.mark.asyncio
async def test_manager_load_list_merge_leaves_mismatched_units_untouched():

    adapter = FakeAdapter(items=[TodoItem(id="1", title="Salami", completed=False)])
    metadata_store = FakeMetadataStore({"1": ItemPosition(parent_id=None, order=0)})
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    await manager.set_quantity("todo.shopping", "1", "150g")

    await metadata_store.save_snapshot("template", [
        {
            "title": "Salami",
            "description": None,
            "due_date": None,
            "due_datetime": None,
            "quantity": "2 packs",
            "completed": False,
            "children": [],
        },
    ])

    await manager.load_list(entity_id="todo.shopping", name="template", mode="merge")

    todo_list = await manager.get_list("todo.shopping")

    # Units don't match ("g" vs "packs") - can't confidently combine,
    # so the existing quantity is left exactly as it was.
    assert len(todo_list.items) == 1
    assert todo_list.items[0].quantity == "150g"


def test_combine_quantities_adds_matching_units():
    assert TodoManager._combine_quantities("150g", "200g") == "350g"


def test_combine_quantities_adopts_incoming_when_existing_missing():
    assert TodoManager._combine_quantities(None, "200g") == "200g"


def test_combine_quantities_keeps_existing_when_incoming_missing():
    assert TodoManager._combine_quantities("150g", None) is None


def test_combine_quantities_none_for_mismatched_units():
    assert TodoManager._combine_quantities("150g", "2 packs") is None


def test_combine_quantities_bare_counts():
    assert TodoManager._combine_quantities("2", "3") == "5"


@pytest.mark.asyncio
async def test_manager_get_list_merges_duplicate_titles_with_quantities():

    # Simulates the real-world case: quick-add, the dialog, a voice
    # assistant, or an automation each independently create a "Salami"
    # item - regardless of path, get_list() should present them as one.
    adapter = FakeAdapter(items=[
        TodoItem(id="1", title="Salami", completed=False),
        TodoItem(id="2", title="Salami", completed=False),
    ])

    metadata_store = FakeMetadataStore({
        "1": ItemPosition(parent_id=None, order=0),
        "2": ItemPosition(parent_id=None, order=1),
    })
    metadata_store._quantities = {"1": "150g", "2": "200g"}

    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    todo_list = await manager.get_list("todo.shopping")

    assert len(todo_list.items) == 1
    assert todo_list.items[0].id == "1"
    assert todo_list.items[0].quantity == "350g"
    assert adapter.remove_item_calls == [("todo.shopping", "2")]


@pytest.mark.asyncio
async def test_manager_get_list_leaves_plain_duplicate_titles_alone():

    # Neither has a quantity - nothing to combine, and no shopping-list
    # signal that these are "the same thing" rather than two unrelated
    # reminders that happen to share a title - so both survive untouched.
    adapter = FakeAdapter(items=[
        TodoItem(id="1", title="Call mom", completed=False),
        TodoItem(id="2", title="Call mom", completed=False),
    ])

    metadata_store = FakeMetadataStore({
        "1": ItemPosition(parent_id=None, order=0),
        "2": ItemPosition(parent_id=None, order=1),
    })

    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    todo_list = await manager.get_list("todo.shopping")

    assert len(todo_list.items) == 2
    assert adapter.remove_item_calls == []


@pytest.mark.asyncio
async def test_manager_get_list_merge_reparents_duplicate_children():

    adapter = FakeAdapter(items=[
        TodoItem(id="1", title="Groceries", completed=False),
        TodoItem(id="2", title="Groceries", completed=False),
        TodoItem(id="3", title="Salami", completed=False),
    ])

    metadata_store = FakeMetadataStore({
        "1": ItemPosition(parent_id=None, order=0),
        "2": ItemPosition(parent_id=None, order=1),
        "3": ItemPosition(parent_id="2", order=0),
    })
    metadata_store._quantities = {"1": "1 trip", "2": "1 trip"}

    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    todo_list = await manager.get_list("todo.shopping")

    # "2" (the duplicate "Groceries") is removed, and its child "Salami"
    # is reparented onto the surviving "1" rather than being lost.
    assert len(todo_list.items) == 1
    assert todo_list.items[0].id == "1"
    assert [child.id for child in todo_list.items[0].children] == ["3"]


@pytest.mark.asyncio
async def test_manager_add_tag_and_remove_tag_by_id():

    adapter = FakeAdapter(items=[TodoItem(id="1", title="Salami", completed=False)])
    metadata_store = FakeMetadataStore({"1": ItemPosition(parent_id=None, order=0)})
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    await manager.add_tag(entity_id="todo.shopping", item="1", tag="urgent")
    await manager.add_tag(entity_id="todo.shopping", item="1", tag="deli")

    todo_list = await manager.get_list("todo.shopping")
    assert set(todo_list.items[0].tags) == {"urgent", "deli"}

    await manager.remove_tag(entity_id="todo.shopping", item="1", tag="urgent")

    todo_list_after = await manager.get_list("todo.shopping")
    assert todo_list_after.items[0].tags == ["deli"]


@pytest.mark.asyncio
async def test_manager_add_tag_resolves_by_title():

    adapter = FakeAdapter(items=[TodoItem(id="1", title="Salami", completed=False)])
    metadata_store = FakeMetadataStore({"1": ItemPosition(parent_id=None, order=0)})
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    # Automations identify items by title, matching the same
    # uid-or-summary convention todo.update_item already uses.
    await manager.add_tag(entity_id="todo.shopping", item="Salami", tag="urgent")

    todo_list = await manager.get_list("todo.shopping")
    assert todo_list.items[0].tags == ["urgent"]


@pytest.mark.asyncio
async def test_manager_add_tag_raises_for_unknown_item():

    manager = TodoManager(
        adapter=FakeAdapter(items=[]),
        metadata_store=FakeMetadataStore(),
    )

    with pytest.raises(ValueError):
        await manager.add_tag(entity_id="todo.shopping", item="nope", tag="urgent")


@pytest.mark.asyncio
async def test_manager_set_tags_replaces_full_list():

    adapter = FakeAdapter(items=[TodoItem(id="1", title="Salami", completed=False)])
    metadata_store = FakeMetadataStore({"1": ItemPosition(parent_id=None, order=0)})
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    await manager.add_tag(entity_id="todo.shopping", item="1", tag="urgent")
    await manager.set_tags(entity_id="todo.shopping", item_id="1", tags=["deli", "weekend"])

    todo_list = await manager.get_list("todo.shopping")
    assert todo_list.items[0].tags == ["deli", "weekend"]


@pytest.mark.asyncio
async def test_manager_create_item_with_initial_tags():

    adapter = FakeAdapter(items=[])
    metadata_store = FakeMetadataStore()
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    item_id = await manager.create_item(
        entity_id="todo.shopping", title="Salami", tags=["deli", "urgent"],
    )

    todo_list = await manager.get_list("todo.shopping")
    assert todo_list.items[0].id == item_id
    assert todo_list.items[0].tags == ["deli", "urgent"]


@pytest.mark.asyncio
async def test_manager_get_list_merge_unions_tags_of_duplicates():

    adapter = FakeAdapter(items=[
        TodoItem(id="1", title="Salami", completed=False),
        TodoItem(id="2", title="Salami", completed=False),
    ])

    metadata_store = FakeMetadataStore({
        "1": ItemPosition(parent_id=None, order=0),
        "2": ItemPosition(parent_id=None, order=1),
    })
    metadata_store._quantities = {"1": "150g", "2": "200g"}
    metadata_store._tags = {"1": ["deli"], "2": ["urgent", "deli"]}

    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    todo_list = await manager.get_list("todo.shopping")

    assert len(todo_list.items) == 1
    assert set(todo_list.items[0].tags) == {"deli", "urgent"}


@pytest.mark.asyncio
async def test_manager_save_and_load_list_round_trips_tags():

    adapter = FakeAdapter(items=[TodoItem(id="1", title="Salami", completed=False)])
    metadata_store = FakeMetadataStore({"1": ItemPosition(parent_id=None, order=0)})
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    await manager.add_tag(entity_id="todo.shopping", item="1", tag="deli")
    await manager.save_list(entity_id="todo.shopping", name="template")

    await manager.load_list(entity_id="todo.other_list", name="template", mode="full_merge")

    assert ("todo.other_list", "Salami") in adapter.add_item_calls

    todo_list = await manager.get_list("todo.other_list")
    matching = [item for item in todo_list.items if item.title == "Salami"]
    assert any(item.tags == ["deli"] for item in matching)


# --- orphaned metadata reconciliation ------------------------------------

@pytest.mark.asyncio
async def test_manager_get_list_reconciles_orphaned_metadata():
    """An item removed through any path other than this integration (the
    native card, a voice assistant, todo.remove_item directly) leaves its
    position/quantity/tags behind with nothing to clean them up - get_list
    should notice and drop them rather than let them sit in storage
    forever (see manager.py's _reconcile_orphaned_metadata)."""

    adapter = FakeAdapter(items=[TodoItem(id="1", title="Milk", completed=False)])
    metadata_store = FakeMetadataStore({
        "1": ItemPosition(parent_id=None, order=0),
        "ghost": ItemPosition(parent_id=None, order=1),
    })
    metadata_store._quantities = {"1": "2L", "ghost": "1kg"}
    metadata_store._tags = {"1": ["dairy"], "ghost": ["stale"]}

    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    todo_list = await manager.get_list("todo.shopping")

    assert [item.id for item in todo_list.items] == ["1"]
    assert "ghost" not in metadata_store._positions
    assert "ghost" not in metadata_store._quantities
    assert "ghost" not in metadata_store._tags
    # The live item's own metadata must survive the sweep.
    assert metadata_store._positions["1"] == ItemPosition(parent_id=None, order=0)
    assert metadata_store._quantities["1"] == "2L"
    assert metadata_store._tags["1"] == ["dairy"]


@pytest.mark.asyncio
async def test_manager_get_list_reconciliation_is_noop_when_nothing_orphaned():
    adapter = FakeAdapter(items=[TodoItem(id="1", title="Milk", completed=False)])
    metadata_store = FakeMetadataStore({"1": ItemPosition(parent_id=None, order=0)})
    metadata_store._quantities = {"1": "2L"}

    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    await manager.get_list("todo.shopping")

    assert metadata_store._positions == {"1": ItemPosition(parent_id=None, order=0)}
    assert metadata_store._quantities == {"1": "2L"}


# --- trigger_on_due --------------------------------------------------------

@pytest.mark.asyncio
async def test_manager_set_trigger_on_due_requires_due_datetime():
    from custom_components.todo_overlay.errors import DueTimeRequiredError

    adapter = FakeAdapter(items=[TodoItem(id="1", title="Renew passport", completed=False)])
    metadata_store = FakeMetadataStore({"1": ItemPosition(parent_id=None, order=0)})
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    with pytest.raises(DueTimeRequiredError):
        await manager.set_trigger_on_due("todo.shopping", "1", True)

    assert metadata_store._trigger_on_due == set()


@pytest.mark.asyncio
async def test_manager_set_trigger_on_due_enables_and_disables():
    adapter = FakeAdapter(items=[
        TodoItem(
            id="1", title="Renew passport", completed=False,
            due_datetime="2026-01-01T09:00:00+00:00",
        ),
    ])
    metadata_store = FakeMetadataStore({"1": ItemPosition(parent_id=None, order=0)})
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    await manager.set_trigger_on_due("todo.shopping", "1", True)
    todo_list = await manager.get_list("todo.shopping")
    assert todo_list.items[0].trigger_on_due is True

    await manager.set_trigger_on_due("todo.shopping", "1", False)
    todo_list_after = await manager.get_list("todo.shopping")
    assert todo_list_after.items[0].trigger_on_due is False


@pytest.mark.asyncio
async def test_manager_set_trigger_on_due_by_item_resolves_by_title():
    adapter = FakeAdapter(items=[
        TodoItem(
            id="1", title="Renew passport", completed=False,
            due_datetime="2026-01-01T09:00:00+00:00",
        ),
    ])
    metadata_store = FakeMetadataStore({"1": ItemPosition(parent_id=None, order=0)})
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    await manager.set_trigger_on_due_by_item("todo.shopping", "Renew passport", True)

    todo_list = await manager.get_list("todo.shopping")
    assert todo_list.items[0].trigger_on_due is True


@pytest.mark.asyncio
async def test_manager_create_item_with_trigger_on_due():
    adapter = FakeAdapter(items=[])
    metadata_store = FakeMetadataStore()
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    item_id = await manager.create_item(
        entity_id="todo.shopping",
        title="Renew passport",
        due_datetime="2026-01-01T09:00:00+00:00",
        trigger_on_due=True,
    )

    todo_list = await manager.get_list("todo.shopping")
    assert todo_list.items[0].id == item_id
    assert todo_list.items[0].trigger_on_due is True


@pytest.mark.asyncio
async def test_manager_create_item_with_trigger_on_due_but_no_due_datetime_is_silently_ignored():
    """trigger_on_due=True with no due_datetime given never raises at
    creation time - it's just silently not applied, matching the same
    "gracefully degrade" precedent as an unsupported field being
    dropped, rather than every create_item caller needing to guard
    against DueTimeRequiredError."""

    adapter = FakeAdapter(items=[])
    metadata_store = FakeMetadataStore()
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    item_id = await manager.create_item(
        entity_id="todo.shopping",
        title="Renew passport",
        trigger_on_due=True,
    )

    todo_list = await manager.get_list("todo.shopping")
    assert todo_list.items[0].id == item_id
    assert todo_list.items[0].trigger_on_due is False


@pytest.mark.asyncio
async def test_manager_due_schedule_hook_called_after_toggle():
    adapter = FakeAdapter(items=[
        TodoItem(
            id="1", title="Renew passport", completed=False,
            due_datetime="2026-01-01T09:00:00+00:00",
        ),
    ])
    metadata_store = FakeMetadataStore({"1": ItemPosition(parent_id=None, order=0)})
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    notified: list[str] = []

    async def hook(entity_id: str) -> None:
        notified.append(entity_id)

    manager.set_due_schedule_hook(hook)

    await manager.set_trigger_on_due("todo.shopping", "1", True)

    assert notified == ["todo.shopping"]


@pytest.mark.asyncio
async def test_manager_fire_due_event_and_record_and_get_due_fired():
    calls: list[tuple] = []

    class FakeHass:
        class bus:
            @staticmethod
            def async_fire(event, data):
                calls.append((event, data))

    adapter = FakeAdapter(items=[])
    metadata_store = FakeMetadataStore()
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store, hass=FakeHass())

    manager.fire_due_event("todo.shopping", "1", "Renew passport", "2026-01-01T09:00:00+00:00")

    assert len(calls) == 1
    _, data = calls[0]
    assert data["action"] == "due"
    assert data["due_datetime"] == "2026-01-01T09:00:00+00:00"

    await manager.record_due_fired("todo.shopping", "1", "2026-01-01T09:00:00+00:00")

    due_fired = await manager.get_due_fired("todo.shopping")
    assert due_fired == {"1": "2026-01-01T09:00:00+00:00"}


@pytest.mark.asyncio
async def test_manager_get_list_merge_ors_trigger_on_due_of_duplicates():
    # Merging is only triggered by a shared quantity (see
    # _merge_duplicate_titles) - the survivor has no trigger_on_due of
    # its own, but the duplicate does, and the survivor has a
    # due_datetime to trigger against, so the flag should transfer.
    adapter = FakeAdapter(items=[
        TodoItem(
            id="1", title="Renew passport", completed=False,
            due_datetime="2026-01-01T09:00:00+00:00",
        ),
        TodoItem(
            id="2", title="Renew passport", completed=False,
            due_datetime="2026-02-01T09:00:00+00:00",
        ),
    ])
    metadata_store = FakeMetadataStore({
        "1": ItemPosition(parent_id=None, order=0),
        "2": ItemPosition(parent_id=None, order=1),
    })
    metadata_store._quantities = {"1": "1", "2": "1"}
    metadata_store._trigger_on_due = {"2"}

    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    todo_list = await manager.get_list("todo.shopping")

    assert len(todo_list.items) == 1
    assert todo_list.items[0].id == "1"
    assert todo_list.items[0].trigger_on_due is True


@pytest.mark.asyncio
async def test_manager_save_and_load_list_round_trips_trigger_on_due():
    adapter = FakeAdapter(items=[
        TodoItem(
            id="1", title="Renew passport", completed=False,
            due_datetime="2026-01-01T09:00:00+00:00",
        ),
    ])
    metadata_store = FakeMetadataStore({"1": ItemPosition(parent_id=None, order=0)})
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    await manager.set_trigger_on_due("todo.shopping", "1", True)
    await manager.save_list(entity_id="todo.shopping", name="template")

    await manager.load_list(entity_id="todo.other_list", name="template", mode="full_merge")

    todo_list = await manager.get_list("todo.other_list")
    assert todo_list.items[0].trigger_on_due is True


@pytest.mark.asyncio
async def test_manager_load_list_trigger_on_due_dropped_when_target_lacks_due_datetime():
    """A saved snapshot is entity-agnostic - if trigger_on_due=True
    somehow ends up in a snapshot node without a due_datetime (or the
    target entity doesn't support due_datetime at all, so add_item()
    silently drops it), loading it must not enable an ineligible
    trigger rather than raising mid-load."""

    adapter = FakeAdapter(items=[])
    metadata_store = FakeMetadataStore()
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    await metadata_store.save_snapshot("template", [
        {
            "title": "Renew passport",
            "due_date": None,
            "due_datetime": None,
            "trigger_on_due": True,
            "completed": False,
            "children": [],
        },
    ])

    await manager.load_list(entity_id="todo.shopping", name="template", mode="full_merge")

    todo_list = await manager.get_list("todo.shopping")
    assert todo_list.items[0].trigger_on_due is False


@pytest.mark.asyncio
async def test_manager_get_list_reconciles_orphaned_trigger_on_due_and_due_fired():
    adapter = FakeAdapter(items=[TodoItem(id="1", title="Milk", completed=False)])
    metadata_store = FakeMetadataStore({
        "1": ItemPosition(parent_id=None, order=0),
        "ghost": ItemPosition(parent_id=None, order=1),
    })
    metadata_store._trigger_on_due = {"1", "ghost"}
    metadata_store._due_fired = {"1": "2026-01-01T00:00:00+00:00", "ghost": "2025-01-01T00:00:00+00:00"}

    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    await manager.get_list("todo.shopping")

    assert metadata_store._trigger_on_due == {"1"}
    assert metadata_store._due_fired == {"1": "2026-01-01T00:00:00+00:00"}


# --- typed exceptions -----------------------------------------------------

@pytest.mark.asyncio
async def test_manager_move_item_cycle_raises_cycle_error():
    metadata_store = FakeMetadataStore({
        "1": ItemPosition(parent_id=None, order=0),
        "2": ItemPosition(parent_id="1", order=0),
    })
    manager = TodoManager(adapter=FakeAdapter(), metadata_store=metadata_store)

    with pytest.raises(CycleError):
        await manager.move_item(
            entity_id="todo.shopping", child_id="1", reference_id="2", placement="inside",
        )


@pytest.mark.asyncio
async def test_manager_move_item_self_reference_raises_cycle_error():
    manager = TodoManager(adapter=FakeAdapter(), metadata_store=FakeMetadataStore())

    with pytest.raises(CycleError):
        await manager.move_item(
            entity_id="todo.shopping", child_id="1", reference_id="1", placement="before",
        )


@pytest.mark.asyncio
async def test_manager_resolve_item_raises_item_not_found_error():
    manager = TodoManager(adapter=FakeAdapter(), metadata_store=FakeMetadataStore())

    with pytest.raises(ItemNotFoundError):
        await manager.add_tag(entity_id="todo.shopping", item="nonexistent", tag="x")


@pytest.mark.asyncio
async def test_manager_load_list_unknown_snapshot_raises_snapshot_not_found_error():
    manager = TodoManager(adapter=FakeAdapter(), metadata_store=FakeMetadataStore())

    with pytest.raises(SnapshotNotFoundError):
        await manager.load_list(entity_id="todo.shopping", name="nonexistent")


# --- per-entity concurrency -------------------------------------------

@pytest.mark.asyncio
async def test_manager_concurrent_calls_on_same_entity_are_serialized():
    """HA's websocket API doesn't serialize command handlers against each
    other, so two calls against the same entity can genuinely interleave
    at any await point. TodoManager's per-entity lock (see manager.py's
    _lock_for) should stop a second caller's read-modify-write window
    from ever overlapping the first's - proven directly here by
    controlling exactly when the first call's read is allowed to
    complete, rather than inferring it from final state."""

    adapter = FakeAdapter(items=[
        TodoItem(id="1", title="A", completed=False),
        TodoItem(id="2", title="B", completed=False),
    ])
    metadata_store = FakeMetadataStore()
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    gate = asyncio.Event()
    adapter.get_items_gate = gate

    task1 = asyncio.create_task(
        manager.set_completed(entity_id="todo.shopping", item_id="1", completed=True)
    )
    await asyncio.sleep(0)
    # task1 is now blocked inside its own get_items(), holding the lock.
    assert adapter.get_items_call_order == ["start"]

    task2 = asyncio.create_task(
        manager.set_completed(entity_id="todo.shopping", item_id="2", completed=True)
    )
    await asyncio.sleep(0)
    # If task2 could interleave, it would have appended its own "start"
    # here already. With the lock, it's blocked waiting to acquire it,
    # not blocked inside get_items - so the order is unchanged.
    assert adapter.get_items_call_order == ["start"]

    gate.set()

    await asyncio.wait_for(task1, timeout=2)
    await asyncio.wait_for(task2, timeout=2)

    assert adapter.get_items_call_order == ["start", "end", "start", "end"]


@pytest.mark.asyncio
async def test_manager_set_quantity_by_item_does_not_deadlock():
    """set_quantity_by_item() calls into the same quantity-setting logic
    as set_quantity() - both lock the same entity, so this only passes if
    the internal call goes through the unlocked _set_quantity_impl()
    rather than re-entering _lock_for() (asyncio.Lock isn't reentrant)."""

    manager = TodoManager(adapter=FakeAdapter(), metadata_store=FakeMetadataStore())

    await asyncio.wait_for(
        manager.set_quantity_by_item(entity_id="todo.shopping", item="1", quantity="2L"),
        timeout=2,
    )


@pytest.mark.asyncio
async def test_manager_save_list_does_not_deadlock():
    """save_list() reads the list via _get_list_impl() directly rather
    than calling the locked get_list(), for the same reentrancy reason."""

    adapter = FakeAdapter(items=[TodoItem(id="1", title="Salami", completed=False)])
    manager = TodoManager(adapter=adapter, metadata_store=FakeMetadataStore())

    await asyncio.wait_for(
        manager.save_list(entity_id="todo.shopping", name="template"),
        timeout=2,
    )


# --- set_completed cascade optimization (deep nesting) --------------------

@pytest.mark.asyncio
async def test_manager_set_completed_deep_cascade_repositions_every_level():
    """Regression test for the _derived_completed() reuse optimization in
    set_completed(): it's computed once (after all completion flags are
    settled) and reused for every boundary reposition, rather than
    recomputed from scratch per touched item and per ancestor level - this
    is only safe because derived status doesn't depend on order, which a
    multi-level cascade like this one would expose if that were wrong."""

    adapter = FakeAdapter(items=[
        TodoItem(id="root", title="Root", completed=False),
        TodoItem(id="mid", title="Mid", completed=False),
        TodoItem(id="leaf-a", title="Leaf A", completed=False),
        TodoItem(id="leaf-b", title="Leaf B", completed=True),
        TodoItem(id="root-sibling", title="Root Sibling", completed=False),
    ])
    metadata_store = FakeMetadataStore({
        "mid": ItemPosition(parent_id="root", order=0),
        "leaf-a": ItemPosition(parent_id="mid", order=0),
        "leaf-b": ItemPosition(parent_id="mid", order=1),
        "root-sibling": ItemPosition(parent_id=None, order=1),
    })
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    # "mid" is not yet derived-complete (leaf-a is still incomplete), so
    # completing leaf-a should cascade all the way up: mid becomes
    # derived-complete (both its children now complete), and root
    # becomes derived-complete too (its only child, mid, now is).
    changed = await manager.set_completed(
        entity_id="todo.shopping", item_id="leaf-a", completed=True, reposition=True,
    )

    assert {c["id"] for c in changed} == {"leaf-a"}

    todo_list = await manager.get_list("todo.shopping")
    root = next(item for item in todo_list.items if item.id == "root")
    assert root.completed is True

    mid = next(item for item in root.children if item.id == "mid")
    assert mid.completed is True
    assert {child.id for child in mid.children} == {"leaf-a", "leaf-b"}

    # root-sibling was never touched and should keep its own status/position.
    root_sibling = next(item for item in todo_list.items if item.id == "root-sibling")
    assert root_sibling.completed is False


# --- transfer_item (cross-entity drag-and-drop) ----------------------------

@pytest.mark.asyncio
async def test_manager_transfer_item_same_entity_delegates_to_move_item():

    adapter = FakeMultiEntityAdapter({
        "todo.shopping": [
            TodoItem(id="1", title="Shopping", completed=False),
            TodoItem(id="2", title="Milk", completed=False),
        ],
    })
    metadata_store = FakeMultiEntityMetadataStore({
        "todo.shopping": {
            "1": ItemPosition(parent_id=None, order=0),
            "2": ItemPosition(parent_id=None, order=1),
        },
    })
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    new_id = await manager.transfer_item(
        source_entity_id="todo.shopping",
        item_id="2",
        target_entity_id="todo.shopping",
        reference_id="1",
        placement="inside",
    )

    assert new_id == "2"
    # No item was recreated/removed - move_item() only rewrites positions.
    assert adapter.add_item_calls == []
    assert adapter.remove_item_calls == []

    todo_list = await manager.get_list("todo.shopping")
    assert todo_list.items[0].children[0].id == "2"


@pytest.mark.asyncio
async def test_manager_transfer_item_moves_leaf_to_target_entity():

    adapter = FakeMultiEntityAdapter({
        "todo.shopping": [TodoItem(id="1", title="Milk", completed=False)],
        "todo.chores": [TodoItem(id="a", title="Laundry", completed=False)],
    })
    metadata_store = FakeMultiEntityMetadataStore({
        "todo.shopping": {"1": ItemPosition(parent_id=None, order=0)},
        "todo.chores": {"a": ItemPosition(parent_id=None, order=0)},
    })
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    new_id = await manager.transfer_item(
        source_entity_id="todo.shopping",
        item_id="1",
        target_entity_id="todo.chores",
        reference_id="a",
        placement="after",
    )

    # Removed from the source entirely.
    source_list = await manager.get_list("todo.shopping")
    assert source_list.items == []

    # Recreated on the target, after "a".
    target_list = await manager.get_list("todo.chores")
    assert [item.id for item in target_list.items] == ["a", new_id]
    assert target_list.items[1].title == "Milk"


@pytest.mark.asyncio
async def test_manager_transfer_item_preserves_subtree_hierarchy():

    adapter = FakeMultiEntityAdapter({
        "todo.shopping": [
            TodoItem(id="parent", title="Groceries", completed=False),
            TodoItem(id="child", title="Milk", completed=True),
        ],
        "todo.chores": [TodoItem(id="anchor", title="Laundry", completed=False)],
    })
    metadata_store = FakeMultiEntityMetadataStore({
        "todo.shopping": {
            "parent": ItemPosition(parent_id=None, order=0),
            "child": ItemPosition(parent_id="parent", order=0),
        },
        "todo.chores": {"anchor": ItemPosition(parent_id=None, order=0)},
    })
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    new_root_id = await manager.transfer_item(
        source_entity_id="todo.shopping",
        item_id="parent",
        target_entity_id="todo.chores",
        reference_id="anchor",
        placement="after",
    )

    target_list = await manager.get_list("todo.chores")
    assert [item.id for item in target_list.items] == ["anchor", new_root_id]
    root = target_list.items[1]
    assert root.title == "Groceries"
    assert len(root.children) == 1
    assert root.children[0].title == "Milk"
    assert root.children[0].completed is True

    source_list = await manager.get_list("todo.shopping")
    assert source_list.items == []


@pytest.mark.asyncio
async def test_manager_transfer_item_preserves_quantity_and_tags():

    adapter = FakeMultiEntityAdapter({
        "todo.shopping": [TodoItem(id="1", title="Milk", completed=False)],
        "todo.chores": [TodoItem(id="anchor", title="Laundry", completed=False)],
    })
    metadata_store = FakeMultiEntityMetadataStore({
        "todo.shopping": {"1": ItemPosition(parent_id=None, order=0)},
        "todo.chores": {"anchor": ItemPosition(parent_id=None, order=0)},
    })
    await metadata_store.set_quantity("todo.shopping", "1", "2L")
    await metadata_store.set_tags("todo.shopping", "1", ["dairy", "urgent"])

    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    new_id = await manager.transfer_item(
        source_entity_id="todo.shopping",
        item_id="1",
        target_entity_id="todo.chores",
        reference_id="anchor",
        placement="after",
    )

    quantities = await metadata_store.get_quantities("todo.chores")
    tags = await metadata_store.get_tags("todo.chores")
    assert quantities[new_id] == "2L"
    assert set(tags[new_id]) == {"dairy", "urgent"}

    # Source metadata for the transferred item is gone.
    assert await metadata_store.get_quantities("todo.shopping") == {}
    assert await metadata_store.get_tags("todo.shopping") == {}


@pytest.mark.asyncio
async def test_manager_transfer_item_carries_trigger_on_due_when_target_keeps_due_datetime():

    adapter = FakeMultiEntityAdapter({
        "todo.shopping": [
            TodoItem(
                id="1",
                title="Pay rent",
                completed=False,
                due_datetime="2026-08-01T09:00:00+00:00",
            ),
        ],
        "todo.chores": [TodoItem(id="anchor", title="Laundry", completed=False)],
    })
    metadata_store = FakeMultiEntityMetadataStore({
        "todo.shopping": {"1": ItemPosition(parent_id=None, order=0)},
        "todo.chores": {"anchor": ItemPosition(parent_id=None, order=0)},
    })
    await metadata_store.set_trigger_on_due("todo.shopping", "1", True)

    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    new_id = await manager.transfer_item(
        source_entity_id="todo.shopping",
        item_id="1",
        target_entity_id="todo.chores",
        reference_id="anchor",
        placement="after",
    )

    assert await metadata_store.get_trigger_on_due("todo.chores") == {new_id}
    assert await metadata_store.get_trigger_on_due("todo.shopping") == set()


@pytest.mark.asyncio
async def test_manager_transfer_item_raises_for_unknown_item():

    adapter = FakeMultiEntityAdapter({
        "todo.shopping": [TodoItem(id="1", title="Milk", completed=False)],
        "todo.chores": [],
    })
    metadata_store = FakeMultiEntityMetadataStore({
        "todo.shopping": {"1": ItemPosition(parent_id=None, order=0)},
        "todo.chores": {},
    })
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    with pytest.raises(ItemNotFoundError):
        await manager.transfer_item(
            source_entity_id="todo.shopping",
            item_id="does-not-exist",
            target_entity_id="todo.chores",
            reference_id="",
            placement="inside",
        )

    # Nothing should have been created on the target or removed from the
    # source - the failure happens before any mutation begins.
    assert adapter.add_item_calls == []
    assert adapter.remove_item_calls == []


@pytest.mark.asyncio
async def test_manager_transfer_item_places_root_before_reference_sibling():

    adapter = FakeMultiEntityAdapter({
        "todo.shopping": [TodoItem(id="1", title="Milk", completed=False)],
        "todo.chores": [
            TodoItem(id="a", title="Laundry", completed=False),
            TodoItem(id="b", title="Dishes", completed=False),
        ],
    })
    metadata_store = FakeMultiEntityMetadataStore({
        "todo.shopping": {"1": ItemPosition(parent_id=None, order=0)},
        "todo.chores": {
            "a": ItemPosition(parent_id=None, order=0),
            "b": ItemPosition(parent_id=None, order=1),
        },
    })
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    new_id = await manager.transfer_item(
        source_entity_id="todo.shopping",
        item_id="1",
        target_entity_id="todo.chores",
        reference_id="b",
        placement="before",
    )

    target_list = await manager.get_list("todo.chores")
    assert [item.id for item in target_list.items] == ["a", new_id, "b"]


@pytest.mark.asyncio
async def test_manager_transfer_item_into_a_wholly_empty_target_entity():
    """Live-reported bug: dragging an item into a completely empty list
    (e.g. a fresh Shopping List with nothing on it yet) silently didn't
    work. There's no existing item on an empty target to position
    relative to, so reference_id is None in that case - the transferred
    subtree just becomes the target's first root-level item."""

    adapter = FakeMultiEntityAdapter({
        "todo.shopping": [
            TodoItem(id="parent", title="Groceries", completed=False),
            TodoItem(id="child", title="Milk", completed=False),
        ],
        "todo.chores": [],
    })
    metadata_store = FakeMultiEntityMetadataStore({
        "todo.shopping": {
            "parent": ItemPosition(parent_id=None, order=0),
            "child": ItemPosition(parent_id="parent", order=0),
        },
        "todo.chores": {},
    })
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    new_root_id = await manager.transfer_item(
        source_entity_id="todo.shopping",
        item_id="parent",
        target_entity_id="todo.chores",
        reference_id=None,
        placement="inside",
    )

    target_list = await manager.get_list("todo.chores")
    assert [item.id for item in target_list.items] == [new_root_id]
    assert target_list.items[0].title == "Groceries"
    assert len(target_list.items[0].children) == 1
    assert target_list.items[0].children[0].title == "Milk"

    source_list = await manager.get_list("todo.shopping")
    assert source_list.items == []


@pytest.mark.asyncio
async def test_manager_transfer_item_same_entity_with_no_reference_id_raises():
    """reference_id is only ever None for a genuine cross-entity transfer
    into an empty target - can't happen from the real frontend for a
    same-entity move (the dragged item already lives there, so that
    entity can't be empty), but this documents/enforces the invariant
    rather than letting it silently misbehave if ever called this way."""

    adapter = FakeAdapter(items=[TodoItem(id="1", title="Milk", completed=False)])
    metadata_store = FakeMetadataStore({"1": ItemPosition(parent_id=None, order=0)})
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    with pytest.raises(ItemNotFoundError):
        await manager.transfer_item(
            source_entity_id="todo.shopping",
            item_id="1",
            target_entity_id="todo.shopping",
            reference_id=None,
            placement="inside",
        )
