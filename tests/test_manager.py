import asyncio

import pytest

from custom_components.todo_overlay.errors import (
    CycleError,
    ItemNotFoundError,
    SnapshotNotFoundError,
)
from custom_components.todo_overlay.manager import TodoManager
from custom_components.todo_overlay.models import ItemPosition, TodoItem


class FakeAdapter:

    def __init__(self, items: list[TodoItem] | None = None) -> None:
        self._items = (
            items
            if items is not None
            else [
                TodoItem(id="1", title="Shopping", completed=False),
                TodoItem(id="2", title="Milk", completed=False),
            ]
        )
        self.set_completed_calls: list[tuple[str, str, bool]] = []
        self.remove_item_calls: list[tuple[str, str]] = []
        self.add_item_calls: list[tuple[str, str]] = []
        self._next_id = 0
        # Only used by the concurrency test: when set, get_items() records
        # a "start"/"end" marker into get_items_call_order and, on the
        # first call, waits on this event before returning - letting a
        # test pause one caller mid-read to see whether a second caller
        # can interleave with it (see
        # test_manager_concurrent_calls_on_same_entity_are_serialized).
        self.get_items_gate: asyncio.Event | None = None
        self.get_items_call_order: list[str] = []

    async def get_items(
        self,
        entity_id: str,
    ) -> list[TodoItem]:
        if self.get_items_gate is not None:
            self.get_items_call_order.append("start")

            if len(self.get_items_call_order) == 1:
                await self.get_items_gate.wait()

            self.get_items_call_order.append("end")

        return self._items

    async def set_completed(
        self,
        entity_id: str,
        item_id: str,
        completed: bool,
    ) -> None:
        self.set_completed_calls.append((entity_id, item_id, completed))

        for item in self._items:
            if item.id == item_id:
                item.completed = completed

    async def remove_item(
        self,
        entity_id: str,
        item_id: str,
    ) -> None:
        self.remove_item_calls.append((entity_id, item_id))
        self._items = [item for item in self._items if item.id != item_id]

    async def add_item(
        self,
        entity_id: str,
        title: str,
        description: str | None = None,
        due_date: str | None = None,
        due_datetime: str | None = None,
    ) -> str:
        self._next_id += 1
        new_id = f"new-{self._next_id}"

        self._items.append(TodoItem(
            id=new_id,
            title=title,
            completed=False,
            description=description,
            due_date=due_date,
            due_datetime=due_datetime,
        ))
        self.add_item_calls.append((entity_id, title))

        return new_id


class FakeMetadataStore:

    def __init__(self, positions: dict[str, ItemPosition] | None = None) -> None:
        self._positions = positions or {}
        self.set_positions_calls: list[tuple[str, dict[str, ItemPosition]]] = []
        self._snapshots: dict[str, dict] = {}
        self._quantities: dict[str, str] = {}
        self._tags: dict[str, list[str]] = {}

    async def get_relationships(self, entity_id: str) -> dict[str, ItemPosition]:
        return dict(self._positions)

    async def get_quantities(self, entity_id: str) -> dict[str, str]:
        return dict(self._quantities)

    async def set_quantity(
        self,
        entity_id: str,
        item_id: str,
        quantity: str | None,
    ) -> None:
        if quantity:
            self._quantities[item_id] = quantity
        else:
            self._quantities.pop(item_id, None)

    async def remove_quantities(
        self,
        entity_id: str,
        item_ids: list[str],
    ) -> None:
        for item_id in item_ids:
            self._quantities.pop(item_id, None)

    async def get_tags(self, entity_id: str) -> dict[str, list[str]]:
        return {k: list(v) for k, v in self._tags.items()}

    async def set_tags(
        self,
        entity_id: str,
        item_id: str,
        tags: list[str],
    ) -> None:
        if tags:
            self._tags[item_id] = list(tags)
        else:
            self._tags.pop(item_id, None)

    async def add_tag(
        self,
        entity_id: str,
        item_id: str,
        tag: str,
    ) -> None:
        tags = self._tags.setdefault(item_id, [])
        if tag not in tags:
            tags.append(tag)

    async def remove_tag(
        self,
        entity_id: str,
        item_id: str,
        tag: str,
    ) -> None:
        tags = self._tags.get(item_id)
        if tags and tag in tags:
            tags.remove(tag)
            if not tags:
                self._tags.pop(item_id, None)

    async def remove_tags_for_items(
        self,
        entity_id: str,
        item_ids: list[str],
    ) -> None:
        for item_id in item_ids:
            self._tags.pop(item_id, None)

    async def set_positions(
        self,
        entity_id: str,
        positions: dict[str, ItemPosition],
    ) -> None:
        self.set_positions_calls.append((entity_id, dict(positions)))
        self._positions.update(positions)

    async def remove_positions(
        self,
        entity_id: str,
        item_ids: list[str],
    ) -> None:
        for item_id in item_ids:
            self._positions.pop(item_id, None)

    async def clear_positions(
        self,
        entity_id: str,
    ) -> None:
        self._positions = {}

    async def save_snapshot(
        self,
        name: str,
        snapshot: list[dict],
    ) -> None:
        self._snapshots[name] = snapshot

    async def get_snapshot(
        self,
        name: str,
    ) -> list[dict] | None:
        return self._snapshots.get(name)

    async def list_snapshots(
        self,
    ) -> list[str]:
        return sorted(self._snapshots.keys())

    async def delete_snapshot(
        self,
        name: str,
    ) -> None:
        self._snapshots.pop(name, None)


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

    await manager.set_completed(entity_id="todo.shopping", item_id="1", completed=True)

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

    await manager.set_completed(entity_id="todo.shopping", item_id="1", completed=False)

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
    await manager.set_completed(entity_id="todo.shopping", item_id="4", completed=True)

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

    await manager.set_completed(entity_id="todo.shopping", item_id="egg", completed=True)

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
        entity_id="todo.shopping", item_id="leaf-a", completed=True,
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
