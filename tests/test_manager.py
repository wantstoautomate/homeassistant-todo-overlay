import pytest

from custom_components.todo_overlay.manager import TodoManager
from custom_components.todo_overlay.models import ItemPosition, TodoItem


class FakeAdapter:

    def __init__(self, items: list[TodoItem] | None = None) -> None:
        self._items = items or [
            TodoItem(id="1", title="Shopping", completed=False),
            TodoItem(id="2", title="Milk", completed=False),
        ]
        self.set_completed_calls: list[tuple[str, str, bool]] = []
        self.remove_item_calls: list[tuple[str, str]] = []

    async def get_items(
        self,
        entity_id: str,
    ) -> list[TodoItem]:
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


class FakeMetadataStore:

    def __init__(self, positions: dict[str, ItemPosition] | None = None) -> None:
        self._positions = positions or {}
        self.set_positions_calls: list[tuple[str, dict[str, ItemPosition]]] = []

    async def get_relationships(self, entity_id: str) -> dict[str, ItemPosition]:
        return dict(self._positions)

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
                "children": [
                    {
                        "id": "2",
                        "title": "Milk",
                        "completed": False,
                        "description": None,
                        "due_date": None,
                        "due_datetime": None,
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
