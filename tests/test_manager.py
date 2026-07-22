import pytest

from custom_components.todo_overlay.manager import TodoManager
from custom_components.todo_overlay.models import TodoItem


class FakeAdapter:

    async def get_items(
        self,
        entity_id: str,
    ) -> list[TodoItem]:
        return [
            TodoItem(id="1", title="Shopping", completed=False),
            TodoItem(id="2", title="Milk", completed=False),
        ]


class FakeMetadataStore:

    def __init__(self) -> None:
        self.set_parent_calls: list[tuple[str, str, str | None]] = []

    async def get_relationships(self, entity_id: str) -> dict[str, str | None]:
        return {
            "1": None,
            "2": "1",
        }

    async def set_parent(
        self,
        entity_id: str,
        child_id: str,
        parent_id: str | None,
    ) -> None:
        self.set_parent_calls.append((entity_id, child_id, parent_id))


@pytest.mark.asyncio
async def test_manager_get_list():

    manager = TodoManager(
        adapter=FakeAdapter(),
        metadata_store=FakeMetadataStore(),
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
        metadata_store=FakeMetadataStore(),
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
async def test_manager_set_parent_rejects_cycle():

    metadata_store = FakeMetadataStore()

    manager = TodoManager(
        adapter=FakeAdapter(),
        metadata_store=metadata_store,
    )

    # Item "2"'s parent is already "1" (per FakeMetadataStore), so setting
    # "1"'s parent to "2" would close a cycle: 1 -> 2 -> 1.
    with pytest.raises(ValueError):
        await manager.set_parent(
            entity_id="todo.shopping",
            child_id="1",
            parent_id="2",
        )

    assert metadata_store.set_parent_calls == []


@pytest.mark.asyncio
async def test_manager_set_parent_allows_valid_reparent():

    metadata_store = FakeMetadataStore()

    manager = TodoManager(
        adapter=FakeAdapter(),
        metadata_store=metadata_store,
    )

    await manager.set_parent(
        entity_id="todo.shopping",
        child_id="2",
        parent_id=None,
    )

    assert metadata_store.set_parent_calls == [
        ("todo.shopping", "2", None),
    ]
