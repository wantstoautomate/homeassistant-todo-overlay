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

    def get_relationships(self) -> dict[str, str | None]:
        return {
            "1": None,
            "2": "1",
        }


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
