"""Tests for the open-items sensor platform (sensor.py).

Covers the actual business logic - open-item filtering/attribute shape
in TodoOverlayOpenItemsSensor._async_refresh(), and add/remove bookkeeping
in OpenItemsSensorRegistry - directly, bypassing real Home Assistant
entity-platform lifecycle (async_added_to_hass, async_write_ha_state,
entity registry wiring). See fakes.py's module docstring for why this
project doesn't use pytest-homeassistant-custom-component: exercising
that lifecycle for real isn't available here, so this deliberately
tests the same logic those lifecycle hooks call into.
"""

import pytest

from custom_components.todo_overlay.const import DOMAIN
from custom_components.todo_overlay.errors import EntityNotFoundError
from custom_components.todo_overlay.manager import TodoManager
from custom_components.todo_overlay.models import ItemPosition, TodoItem
from custom_components.todo_overlay.sensor import (
    OpenItemsSensorRegistry,
    TodoOverlayOpenItemsSensor,
)

from fakes import FakeAdapter, FakeConfigEntries, FakeMetadataStore

ENTITY_ID = "todo.shopping"


class FakeStates:

    def __init__(self, friendly_names: dict[str, str] | None = None) -> None:
        self._friendly_names = friendly_names or {}
        self._all: list[str] = []

    def get(self, entity_id: str):
        if entity_id not in self._friendly_names and entity_id not in self._all:
            return None

        attributes = {}
        if entity_id in self._friendly_names:
            attributes["friendly_name"] = self._friendly_names[entity_id]

        return type("FakeState", (), {"entity_id": entity_id, "attributes": attributes})()

    def async_all(self, domain: str):
        return [type("FakeState", (), {"entity_id": eid})() for eid in self._all]


class FakeHass:

    def __init__(self, manager: TodoManager, todo_entity_ids: list[str] | None = None) -> None:
        self.config_entries = FakeConfigEntries(manager)
        self.states = FakeStates()
        self.states._all = todo_entity_ids or []
        self.data: dict = {}

    def async_create_task(self, coro):
        import asyncio
        return asyncio.ensure_future(coro)


def make_manager(items=None, positions=None) -> TodoManager:
    adapter = FakeAdapter(items=items)
    metadata_store = FakeMetadataStore(positions=positions)
    return TodoManager(adapter=adapter, metadata_store=metadata_store)


@pytest.mark.asyncio
async def test_refresh_reports_only_incomplete_items_with_full_detail():
    adapter = FakeAdapter(items=[
        TodoItem(id="1", title="Milk", completed=False, description="2%", due_date="2026-01-01"),
        TodoItem(id="2", title="Bread", completed=True),
    ])
    metadata_store = FakeMetadataStore()
    metadata_store._quantities["1"] = "2L"
    metadata_store._tags["1"] = ["urgent"]
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)
    hass = FakeHass(manager)
    sensor = TodoOverlayOpenItemsSensor(hass, ENTITY_ID)

    await sensor._async_refresh()

    assert sensor._attr_native_value == 1
    items = sensor._attr_extra_state_attributes["items"]
    assert len(items) == 1
    assert items[0] == {
        "item_id": "1", "title": "Milk", "description": "2%",
        "due_date": "2026-01-01", "due_datetime": None, "quantity": "2L",
        "tags": ["urgent"], "top_level": True,
    }


@pytest.mark.asyncio
async def test_refresh_marks_nested_children_as_not_top_level():
    manager = make_manager(
        items=[
            TodoItem(id="1", title="Parent", completed=False),
            TodoItem(id="2", title="Child", completed=False),
        ],
        positions={
            "1": ItemPosition(parent_id=None, order=0),
            "2": ItemPosition(parent_id="1", order=0),
        },
    )
    hass = FakeHass(manager)
    sensor = TodoOverlayOpenItemsSensor(hass, ENTITY_ID)

    await sensor._async_refresh()

    items = {item["title"]: item for item in sensor._attr_extra_state_attributes["items"]}
    assert items["Parent"]["top_level"] is True
    assert items["Child"]["top_level"] is False


@pytest.mark.asyncio
async def test_refresh_marks_unavailable_when_entity_is_gone():
    class RaisingAdapter(FakeAdapter):
        async def get_items(self, entity_id: str) -> list[TodoItem]:
            raise EntityNotFoundError(f"Unknown todo entity: {entity_id}")

    manager = TodoManager(adapter=RaisingAdapter(), metadata_store=FakeMetadataStore())
    hass = FakeHass(manager)
    sensor = TodoOverlayOpenItemsSensor(hass, ENTITY_ID)

    await sensor._async_refresh()

    assert sensor._attr_available is False


def test_unique_id_name_and_entity_id_are_derived_from_the_todo_entity():
    manager = make_manager()
    hass = FakeHass(manager)
    hass.states._friendly_names = {ENTITY_ID: "Shopping List"}

    sensor = TodoOverlayOpenItemsSensor(hass, ENTITY_ID)

    assert sensor._attr_unique_id == f"{DOMAIN}_{ENTITY_ID}_open_items"
    assert sensor._attr_name == "Shopping List Open Items"
    assert sensor.entity_id == f"sensor.{DOMAIN}_shopping_open_items"


def test_name_falls_back_to_a_title_cased_object_id_without_a_friendly_name():
    manager = make_manager()
    hass = FakeHass(manager)

    sensor = TodoOverlayOpenItemsSensor(hass, ENTITY_ID)

    assert sensor._attr_name == "Shopping Open Items"


class FakeAddEntities:

    def __init__(self) -> None:
        self.added: list = []

    def __call__(self, entities) -> None:
        self.added.extend(entities)


class RemovableSensor:
    """Stands in for TodoOverlayOpenItemsSensor in registry-only tests,
    so async_remove() doesn't need a real Entity/hass wiring."""

    def __init__(self) -> None:
        self.removed = False

    async def async_remove(self, *, force_remove: bool = False) -> None:
        self.removed = True


@pytest.mark.asyncio
async def test_add_entity_is_a_no_op_before_async_bind():
    manager = make_manager()
    hass = FakeHass(manager)
    registry = OpenItemsSensorRegistry(hass)

    registry.add_entity(ENTITY_ID)

    assert registry._entities == {}


@pytest.mark.asyncio
async def test_async_bind_seeds_every_known_todo_entity():
    from homeassistant.core import CoreState

    manager = make_manager()
    hass = FakeHass(manager, todo_entity_ids=[ENTITY_ID, "todo.chores"])
    hass.state = CoreState.running
    registry = OpenItemsSensorRegistry(hass)
    add_entities = FakeAddEntities()

    await registry.async_bind(add_entities)

    assert {sensor._todo_entity_id for sensor in add_entities.added} == {ENTITY_ID, "todo.chores"}


@pytest.mark.asyncio
async def test_add_entity_is_idempotent():
    from homeassistant.core import CoreState

    manager = make_manager()
    hass = FakeHass(manager)
    hass.state = CoreState.running
    registry = OpenItemsSensorRegistry(hass)
    add_entities = FakeAddEntities()
    await registry.async_bind(add_entities)

    registry.add_entity(ENTITY_ID)
    registry.add_entity(ENTITY_ID)

    assert len(add_entities.added) == 1


@pytest.mark.asyncio
async def test_remove_entity_removes_the_sensor_from_hass():
    registry = OpenItemsSensorRegistry(FakeHass(make_manager()))
    sensor = RemovableSensor()
    registry._entities[ENTITY_ID] = sensor

    await registry.remove_entity(ENTITY_ID)

    assert sensor.removed is True
    assert ENTITY_ID not in registry._entities


@pytest.mark.asyncio
async def test_remove_entity_is_a_no_op_for_an_unknown_entity():
    registry = OpenItemsSensorRegistry(FakeHass(make_manager()))

    await registry.remove_entity("todo.unknown")  # must not raise
