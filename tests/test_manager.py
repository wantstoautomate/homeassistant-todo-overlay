import pytest

from custom_components.todo_overlay.manager import TodoManager
from custom_components.todo_overlay.models import ItemPosition, TodoItem


class FakeAdapter:

    def __init__(self, items: list[TodoItem] | None = None) -> None:
        self._items = items or [
            TodoItem(id="1", title="Shopping", completed=False),
            TodoItem(id="2", title="Milk", completed=False),
        ]

    async def get_items(
        self,
        entity_id: str,
    ) -> list[TodoItem]:
        return self._items


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
                "children": [
                    {
                        "id": "2",
                        "title": "Milk",
                        "completed": False,
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
