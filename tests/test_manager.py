import asyncio

import pytest

from custom_components.todo_overlay.const import EVENT_ITEM_CHANGED
from custom_components.todo_overlay.errors import (
    CycleError,
    InvalidPinTypeError,
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
                "pin_type": None,
                "linked": False,
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
                        "pin_type": None,
                        "linked": False,
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


class _FakeEventHass:
    """Shared minimal FakeHass for the event-firing tests below - see
    test_manager_move_item_fires_a_moved_event's own inline version,
    factored out since several tests below need the identical shape."""

    def __init__(self) -> None:
        self.calls: list[tuple] = []

        outer = self

        class bus:
            @staticmethod
            def async_fire(event, data):
                outer.calls.append((event, data))

        self.bus = bus


@pytest.mark.asyncio
async def test_manager_update_item_fires_updated_event_and_updates_native_fields():
    # Previously the frontend called the native todo.update_item service
    # directly for this, which never fired any event at all -
    # live-diagnosed: title/description/due-date edits never propagated
    # to a linked peer or refreshed other open cards.
    hass = _FakeEventHass()
    adapter = FakeAdapter(items=[TodoItem(id="1", title="Milk", completed=False)])
    manager = TodoManager(adapter=adapter, metadata_store=FakeMetadataStore(), hass=hass)

    await manager.update_item(entity_id="todo.shopping", item_id="1", title="Oat milk")

    todo_list = await manager.get_list("todo.shopping")
    assert todo_list.items[0].title == "Oat milk"

    assert len(hass.calls) == 1
    event, data = hass.calls[0]
    assert event == EVENT_ITEM_CHANGED
    assert data == {
        "entity_id": "todo.shopping", "item_id": "1", "title": "Oat milk", "action": "updated",
    }


@pytest.mark.asyncio
async def test_manager_delete_item_fires_removed_event_and_removes_item():
    # Previously the frontend called the native todo.remove_item service
    # directly for this (both the edit dialog's Delete button and each
    # row's own delete cross) - live-diagnosed: a deletion never
    # propagated to a linked peer, leaving a ghost item there forever.
    hass = _FakeEventHass()
    adapter = FakeAdapter(items=[TodoItem(id="1", title="Milk", completed=False)])
    manager = TodoManager(adapter=adapter, metadata_store=FakeMetadataStore(), hass=hass)

    await manager.delete_item(entity_id="todo.shopping", item_id="1")

    todo_list = await manager.get_list("todo.shopping")
    assert todo_list.items == []

    assert len(hass.calls) == 1
    event, data = hass.calls[0]
    assert event == EVENT_ITEM_CHANGED
    assert data == {
        "entity_id": "todo.shopping", "item_id": "1", "title": "Milk", "action": "removed",
    }


@pytest.mark.asyncio
async def test_manager_set_tags_fires_tags_replaced_event():
    # set_tags is called correctly by the frontend (via
    # todo_overlay/set_tags), but the method itself never fired any
    # event at all - a different flavor of the same underlying gap:
    # editing tags via the dialog never propagated to a linked peer.
    hass = _FakeEventHass()
    adapter = FakeAdapter(items=[TodoItem(id="1", title="Milk", completed=False)])
    manager = TodoManager(adapter=adapter, metadata_store=FakeMetadataStore(), hass=hass)

    await manager.set_tags(entity_id="todo.shopping", item_id="1", tags=["urgent", "dairy"])

    assert len(hass.calls) == 1
    event, data = hass.calls[0]
    assert event == EVENT_ITEM_CHANGED
    assert data == {
        "entity_id": "todo.shopping", "item_id": "1", "title": "Milk",
        "action": "tags_replaced", "tags": ["urgent", "dairy"],
    }


@pytest.mark.asyncio
async def test_manager_restore_completed_fires_events_for_each_restored_item():
    hass = _FakeEventHass()
    adapter = FakeAdapter(items=[
        TodoItem(id="1", title="Milk", completed=True),
        TodoItem(id="2", title="Eggs", completed=False),
    ])
    manager = TodoManager(adapter=adapter, metadata_store=FakeMetadataStore(), hass=hass)

    await manager.restore_completed("todo.shopping", [
        {"id": "1", "completed": False},
        {"id": "2", "completed": True},
    ])

    actions = {(data["item_id"], data["action"]) for _event, data in hass.calls}
    assert actions == {("1", "uncompleted"), ("2", "completed")}


@pytest.mark.asyncio
async def test_manager_load_list_fires_created_event_for_new_items():
    # _create_snapshot_nodes previously never fired any event for newly
    # created items at all - none of a loaded template's items would
    # ever propagate to a linked peer, trigger todo_overlay.created
    # automations, or refresh the open-items sensor for another viewer.
    hass = _FakeEventHass()
    adapter = FakeAdapter(items=[])
    metadata_store = FakeMetadataStore()
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store, hass=hass)

    await metadata_store.save_snapshot("Weekly shop", [
        {
            "title": "Milk", "description": None, "due_date": None, "due_datetime": None,
            "quantity": "2L", "tags": ["dairy"], "trigger_on_due": False, "completed": False,
            "children": [],
        },
    ])

    await manager.load_list(entity_id="todo.shopping", name="Weekly shop", mode="merge")

    created = [data for _event, data in hass.calls if data["action"] == "created"]
    assert len(created) == 1
    assert created[0]["title"] == "Milk"
    assert created[0]["quantity"] == "2L"
    assert created[0]["tags"] == ["dairy"]


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
async def test_manager_clear_all_removes_every_item_regardless_of_completion():

    adapter = FakeAdapter(items=[
        TodoItem(id="1", title="Shopping", completed=True),
        TodoItem(id="2", title="Item", completed=True),
        TodoItem(id="3", title="Milk", completed=False),
        TodoItem(id="4", title="Eggs", completed=False),
    ])

    metadata_store = FakeMetadataStore({
        "1": ItemPosition(parent_id=None, order=0),
        "2": ItemPosition(parent_id="1", order=0),
        "3": ItemPosition(parent_id=None, order=1),
        "4": ItemPosition(parent_id="3", order=0),
    })

    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    removed = await manager.clear_all(entity_id="todo.shopping")

    # Unlike clear_completed, completion status is irrelevant here -
    # "Milk" and its child "Eggs" are still incomplete and are removed
    # right along with the completed "Shopping"/"Item" pair.
    assert set(removed) == {"1", "2", "3", "4"}
    assert adapter._items == []
    assert metadata_store._positions == {}


@pytest.mark.asyncio
async def test_manager_clear_all_fires_a_removed_event_per_item():
    hass = _FakeEventHass()
    adapter = FakeAdapter(items=[
        TodoItem(id="1", title="Shopping", completed=False),
        TodoItem(id="2", title="Milk", completed=True),
    ])
    manager = TodoManager(adapter=adapter, metadata_store=FakeMetadataStore(), hass=hass)

    await manager.clear_all(entity_id="todo.shopping")

    assert {(event, data["item_id"], data["action"]) for event, data in hass.calls} == {
        (EVENT_ITEM_CHANGED, "1", "removed"),
        (EVENT_ITEM_CHANGED, "2", "removed"),
    }


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


# --- load_list target_item -------------------------------------------------
# Live use case: "To buy" already exists as a parent (with or without its
# own children yet) and a saved template should load AS ITS CHILDREN,
# not as new top-level siblings.

@pytest.mark.asyncio
async def test_manager_load_list_merge_into_target_item_loads_as_its_children():

    adapter = FakeAdapter(items=[
        TodoItem(id="parent", title="To buy", completed=False),
        TodoItem(id="other", title="Unrelated", completed=False),
    ])
    metadata_store = FakeMetadataStore({
        "parent": ItemPosition(parent_id=None, order=0),
        "other": ItemPosition(parent_id=None, order=1),
    })
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    await metadata_store.save_snapshot("Fruit & veg", [
        {
            "title": "Apples", "description": None, "due_date": None, "due_datetime": None,
            "completed": False, "children": [],
        },
    ])

    await manager.load_list(
        entity_id="todo.shopping", name="Fruit & veg", mode="merge", target_item="To buy",
    )

    todo_list = await manager.get_list("todo.shopping")
    by_title = {item.title: item for item in todo_list.items}

    # "Apples" landed under "To buy", not as a new root sibling -
    # "Unrelated" is untouched.
    assert set(by_title) == {"To buy", "Unrelated"}
    assert [child.title for child in by_title["To buy"].children] == ["Apples"]


@pytest.mark.asyncio
async def test_manager_load_list_target_item_resolves_by_title_or_id_the_same_way():

    adapter = FakeAdapter(items=[TodoItem(id="parent", title="To buy", completed=False)])
    metadata_store = FakeMetadataStore({"parent": ItemPosition(parent_id=None, order=0)})
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    await metadata_store.save_snapshot("t", [
        {
            "title": "Apples", "description": None, "due_date": None, "due_datetime": None,
            "completed": False, "children": [],
        },
    ])

    await manager.load_list(entity_id="todo.shopping", name="t", mode="merge", target_item="parent")

    todo_list = await manager.get_list("todo.shopping")
    assert [child.title for child in todo_list.items[0].children] == ["Apples"]


@pytest.mark.asyncio
async def test_manager_load_list_merge_into_target_matches_existing_children_by_path_not_root():

    # "Milk" already exists as a child of "To buy" - merge-mode should
    # recognise it there and only add the genuinely new "Apples", NOT
    # duplicate "Milk" just because it isn't a ROOT-level match.
    adapter = FakeAdapter(items=[
        TodoItem(id="parent", title="To buy", completed=False),
        TodoItem(id="milk", title="Milk", completed=False),
    ])
    metadata_store = FakeMetadataStore({
        "parent": ItemPosition(parent_id=None, order=0),
        "milk": ItemPosition(parent_id="parent", order=0),
    })
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    await metadata_store.save_snapshot("t", [
        {
            "title": "Milk", "description": None, "due_date": None, "due_datetime": None,
            "completed": False, "children": [],
        },
        {
            "title": "Apples", "description": None, "due_date": None, "due_datetime": None,
            "completed": False, "children": [],
        },
    ])

    await manager.load_list(entity_id="todo.shopping", name="t", mode="merge", target_item="To buy")

    todo_list = await manager.get_list("todo.shopping")
    children = todo_list.items[0].children
    assert sorted(c.title for c in children) == ["Apples", "Milk"]
    # "Milk" kept its original id - it was matched, not recreated.
    assert next(c for c in children if c.title == "Milk").id == "milk"


@pytest.mark.asyncio
async def test_manager_load_list_replace_with_target_only_clears_that_targets_subtree():

    adapter = FakeAdapter(items=[
        TodoItem(id="parent", title="To buy", completed=False),
        TodoItem(id="child", title="Old child", completed=False),
        TodoItem(id="grandchild", title="Old grandchild", completed=False),
        TodoItem(id="sibling", title="Untouched sibling", completed=False),
    ])
    metadata_store = FakeMetadataStore({
        "parent": ItemPosition(parent_id=None, order=0),
        "child": ItemPosition(parent_id="parent", order=0),
        "grandchild": ItemPosition(parent_id="child", order=0),
        "sibling": ItemPosition(parent_id=None, order=1),
    })
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    await metadata_store.save_snapshot("t", [
        {
            "title": "New child", "description": None, "due_date": None, "due_datetime": None,
            "completed": False, "children": [],
        },
    ])

    await manager.load_list(entity_id="todo.shopping", name="t", mode="replace", target_item="To buy")

    # Both the old child AND grandchild are gone - a scoped replace has
    # to clear the WHOLE subtree, not just the direct children, or the
    # grandchild would be left behind as an orphan under a deleted parent.
    assert set(adapter.remove_item_calls) == {
        ("todo.shopping", "child"), ("todo.shopping", "grandchild"),
    }

    todo_list = await manager.get_list("todo.shopping")
    by_title = {item.title: item for item in todo_list.items}

    # The rest of the list (the unrelated root sibling) is completely
    # untouched - the whole point of targeting a parent is that nothing
    # else in the list gets cleared.
    assert set(by_title) == {"To buy", "Untouched sibling"}
    assert [child.title for child in by_title["To buy"].children] == ["New child"]


@pytest.mark.asyncio
async def test_manager_load_list_replace_with_target_fires_removed_for_every_cleared_descendant():

    hass = _FakeEventHass()
    adapter = FakeAdapter(items=[
        TodoItem(id="parent", title="To buy", completed=False),
        TodoItem(id="child", title="Old child", completed=False),
    ])
    metadata_store = FakeMetadataStore({
        "parent": ItemPosition(parent_id=None, order=0),
        "child": ItemPosition(parent_id="parent", order=0),
    })
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store, hass=hass)

    await metadata_store.save_snapshot("t", [])

    await manager.load_list(entity_id="todo.shopping", name="t", mode="replace", target_item="To buy")

    removed = [data for _event, data in hass.calls if data["action"] == "removed"]
    assert removed == [
        {"entity_id": "todo.shopping", "item_id": "child", "title": "Old child", "action": "removed"},
    ]


@pytest.mark.asyncio
async def test_manager_load_list_full_merge_into_target_appends_under_it_duplicates_and_all():

    adapter = FakeAdapter(items=[
        TodoItem(id="parent", title="To buy", completed=False),
        TodoItem(id="milk", title="Milk", completed=False),
    ])
    metadata_store = FakeMetadataStore({
        "parent": ItemPosition(parent_id=None, order=0),
        "milk": ItemPosition(parent_id="parent", order=0),
    })
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    await metadata_store.save_snapshot("t", [
        {
            "title": "Milk", "description": None, "due_date": None, "due_datetime": None,
            "completed": False, "children": [],
        },
    ])

    await manager.load_list(
        entity_id="todo.shopping", name="t", mode="full_merge", target_item="To buy",
    )

    todo_list = await manager.get_list("todo.shopping")
    children = todo_list.items[0].children
    assert sorted(c.title for c in children) == ["Milk", "Milk"]


@pytest.mark.asyncio
async def test_manager_load_list_raises_item_not_found_for_an_unresolvable_target():

    adapter = FakeAdapter(items=[TodoItem(id="1", title="Something", completed=False)])
    metadata_store = FakeMetadataStore({"1": ItemPosition(parent_id=None, order=0)})
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    await metadata_store.save_snapshot("t", [])

    with pytest.raises(ItemNotFoundError):
        await manager.load_list(
            entity_id="todo.shopping", name="t", mode="merge", target_item="Does not exist",
        )


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
async def test_manager_set_pin_type_updates_and_clears():

    adapter = FakeAdapter(items=[TodoItem(id="1", title="Brodie", completed=False)])
    metadata_store = FakeMetadataStore({"1": ItemPosition(parent_id=None, order=0)})
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    await manager.set_pin_type("todo.household", "1", "person")
    todo_list = await manager.get_list("todo.household")
    assert todo_list.items[0].pin_type == "person"

    await manager.set_pin_type("todo.household", "1", None)
    todo_list_after = await manager.get_list("todo.household")
    assert todo_list_after.items[0].pin_type is None


@pytest.mark.asyncio
async def test_manager_set_pin_type_accepts_category_too():

    adapter = FakeAdapter(items=[TodoItem(id="1", title="Groceries", completed=False)])
    metadata_store = FakeMetadataStore({"1": ItemPosition(parent_id=None, order=0)})
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    await manager.set_pin_type("todo.household", "1", "category")
    todo_list = await manager.get_list("todo.household")
    assert todo_list.items[0].pin_type == "category"


@pytest.mark.asyncio
async def test_manager_set_pin_type_rejects_an_invalid_value():

    adapter = FakeAdapter(items=[TodoItem(id="1", title="Brodie", completed=False)])
    manager = TodoManager(adapter=adapter, metadata_store=FakeMetadataStore())

    with pytest.raises(InvalidPinTypeError):
        await manager.set_pin_type("todo.household", "1", "not-a-real-type")


@pytest.mark.asyncio
async def test_manager_set_pin_type_fires_pin_type_changed_event():

    hass = _FakeEventHass()
    adapter = FakeAdapter(items=[TodoItem(id="1", title="Anna", completed=False)])
    manager = TodoManager(adapter=adapter, metadata_store=FakeMetadataStore(), hass=hass)

    await manager.set_pin_type(entity_id="todo.household", item_id="1", pin_type="person")

    assert len(hass.calls) == 1
    event, data = hass.calls[0]
    assert event == EVENT_ITEM_CHANGED
    assert data == {
        "entity_id": "todo.household", "item_id": "1", "title": "Anna",
        "action": "pin_type_changed", "pin_type": "person",
    }


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
async def test_manager_get_list_merge_fires_a_removed_event_for_the_losing_duplicate():
    # Previously silent - on a linked list, this specific combination
    # (two same-titled items where at least one has a quantity) never
    # propagated the removal to the peer at all, since nothing here
    # ever fired an event for it.
    hass = _FakeEventHass()
    adapter = FakeAdapter(items=[
        TodoItem(id="1", title="Salami", completed=False),
        TodoItem(id="2", title="Salami", completed=False),
    ])
    metadata_store = FakeMetadataStore({
        "1": ItemPosition(parent_id=None, order=0),
        "2": ItemPosition(parent_id=None, order=1),
    })
    metadata_store._quantities = {"1": "150g", "2": "200g"}
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store, hass=hass)

    await manager.get_list("todo.shopping")

    assert len(hass.calls) == 1
    event, data = hass.calls[0]
    assert event == EVENT_ITEM_CHANGED
    assert data == {
        "entity_id": "todo.shopping", "item_id": "2", "title": "Salami", "action": "removed",
    }


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
async def test_manager_create_item_with_initial_pin_type():

    adapter = FakeAdapter(items=[])
    metadata_store = FakeMetadataStore()
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    item_id = await manager.create_item(
        entity_id="todo.household", title="Anna", pin_type="person",
    )

    todo_list = await manager.get_list("todo.household")
    assert todo_list.items[0].id == item_id
    assert todo_list.items[0].pin_type == "person"


@pytest.mark.asyncio
async def test_manager_create_item_rejects_an_invalid_pin_type_without_creating_anything():

    adapter = FakeAdapter(items=[])
    manager = TodoManager(adapter=adapter, metadata_store=FakeMetadataStore())

    with pytest.raises(InvalidPinTypeError):
        await manager.create_item(
            entity_id="todo.household", title="Anna", pin_type="not-a-real-type",
        )

    todo_list = await manager.get_list("todo.household")
    assert todo_list.items == []


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
async def test_manager_create_item_positioned_inside_a_parent_with_no_existing_children():
    adapter = FakeAdapter(items=[TodoItem(id="parent", title="Home Assistant", completed=False)])
    metadata_store = FakeMetadataStore()
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    item_id = await manager.create_item(
        entity_id="todo.shopping",
        title="Firewall",
        reference_id="parent",
        placement="inside",
    )

    todo_list = await manager.get_list("todo.shopping")
    parent = next(item for item in todo_list.items if item.id == "parent")
    assert [child.id for child in parent.children] == [item_id]


@pytest.mark.asyncio
async def test_manager_create_item_positioned_before_an_existing_first_child():
    # The frontend's per-parent quick add always wants the new item
    # directly below the parent's own row and above its EXISTING
    # children - "inside" alone would append past them instead (same
    # reason resolvePlacement's own placement logic never offers plain
    # "inside" for a row that already has visible children) - so it
    # targets the current first child with "before" instead.
    adapter = FakeAdapter(items=[
        TodoItem(id="parent", title="Home Assistant", completed=False),
        TodoItem(id="firewall", title="Firewall", completed=False),
    ])
    metadata_store = FakeMetadataStore({
        "parent": ItemPosition(parent_id=None, order=0),
        "firewall": ItemPosition(parent_id="parent", order=0),
    })
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    item_id = await manager.create_item(
        entity_id="todo.shopping",
        title="VPN",
        reference_id="firewall",
        placement="before",
    )

    todo_list = await manager.get_list("todo.shopping")
    parent = next(item for item in todo_list.items if item.id == "parent")
    assert [child.id for child in parent.children] == [item_id, "firewall"]


@pytest.mark.asyncio
async def test_manager_create_item_with_positioning_fires_only_one_created_event():
    # Positioning reuses the same core logic move_item() does (see
    # _reposition in manager_position.py), but must NOT go through
    # move_item() itself - re-acquiring the same (non-reentrant) lock
    # from inside create_item's own would deadlock, and firing move_item's
    # own separate "moved" event on top of "created" would be a second,
    # redundant event for what's really one single action.
    hass = _FakeEventHass()
    adapter = FakeAdapter(items=[TodoItem(id="parent", title="Home Assistant", completed=False)])
    manager = TodoManager(adapter=adapter, metadata_store=FakeMetadataStore(), hass=hass)

    await manager.create_item(
        entity_id="todo.shopping",
        title="Firewall",
        reference_id="parent",
        placement="inside",
    )

    assert len(hass.calls) == 1
    event, data = hass.calls[0]
    assert event == EVENT_ITEM_CHANGED
    assert data["action"] == "created"


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
async def test_manager_get_list_merge_inherits_pin_type_from_a_duplicate():
    # Not combinable like quantity/tags - a single value. The survivor
    # has no pin_type of its own, but the duplicate does, so it should
    # transfer rather than being silently dropped when the duplicate is
    # removed.
    adapter = FakeAdapter(items=[
        TodoItem(id="1", title="Brodie", completed=False),
        TodoItem(id="2", title="Brodie", completed=False),
    ])
    metadata_store = FakeMetadataStore({
        "1": ItemPosition(parent_id=None, order=0),
        "2": ItemPosition(parent_id=None, order=1),
    })
    metadata_store._quantities = {"1": "1", "2": "1"}
    metadata_store._pin_types = {"2": "person"}

    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    todo_list = await manager.get_list("todo.shared")

    assert len(todo_list.items) == 1
    assert todo_list.items[0].id == "1"
    assert todo_list.items[0].pin_type == "person"
    assert metadata_store._pin_types == {"1": "person"}


@pytest.mark.asyncio
async def test_manager_get_list_merge_prefers_survivors_own_pin_type_over_a_duplicates():
    adapter = FakeAdapter(items=[
        TodoItem(id="1", title="Brodie", completed=False),
        TodoItem(id="2", title="Brodie", completed=False),
    ])
    metadata_store = FakeMetadataStore({
        "1": ItemPosition(parent_id=None, order=0),
        "2": ItemPosition(parent_id=None, order=1),
    })
    metadata_store._quantities = {"1": "1", "2": "1"}
    metadata_store._pin_types = {"1": "category", "2": "person"}

    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    todo_list = await manager.get_list("todo.shared")

    assert len(todo_list.items) == 1
    assert todo_list.items[0].pin_type == "category"


@pytest.mark.asyncio
async def test_manager_save_and_load_list_round_trips_pin_type():
    adapter = FakeAdapter(items=[TodoItem(id="1", title="Brodie", completed=False)])
    metadata_store = FakeMetadataStore({"1": ItemPosition(parent_id=None, order=0)})
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    await manager.set_pin_type("todo.shared", "1", "person")
    await manager.save_list(entity_id="todo.shared", name="template")

    await manager.load_list(entity_id="todo.other_list", name="template", mode="full_merge")

    todo_list = await manager.get_list("todo.other_list")
    matching = [item for item in todo_list.items if item.title == "Brodie"]
    assert any(item.pin_type == "person" for item in matching)


@pytest.mark.asyncio
async def test_manager_load_list_merge_only_fills_a_missing_pin_type_on_an_existing_match():
    """Merge mode matches an existing item by title path and leaves it
    largely untouched (see load_list's own docstring) - pin_type follows
    the same "only fills a gap, never overwrites" rule the duplicate-title
    merge in get_list uses, not a blind overwrite."""

    adapter = FakeAdapter(items=[TodoItem(id="1", title="Brodie", completed=False)])
    metadata_store = FakeMetadataStore({"1": ItemPosition(parent_id=None, order=0)})
    metadata_store._pin_types = {"1": "category"}
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)

    await manager.save_list(entity_id="todo.shared", name="template")
    # The saved snapshot node carries no pin_type (item "1" had none at
    # save time in a fresh comparison instance) - simulate loading a
    # snapshot that DOES carry one onto a target that already has its
    # own, different pin_type.
    snapshot = await metadata_store.get_snapshot("template")
    snapshot[0]["pin_type"] = "person"
    await metadata_store.save_snapshot("template", snapshot)

    await manager.load_list(entity_id="todo.shared", name="template", mode="merge")

    todo_list = await manager.get_list("todo.shared")
    assert todo_list.items[0].pin_type == "category"


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
