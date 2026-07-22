from types import SimpleNamespace

import pytest

from custom_components.todo_overlay.const import EVENT_ITEM_CHANGED
from custom_components.todo_overlay.trigger import TRIGGER_SCHEMA, async_attach_trigger


class FakeBus:

    def __init__(self) -> None:
        self._listeners: dict[str, list] = {}

    def async_listen(self, event_type, listener):
        self._listeners.setdefault(event_type, []).append(listener)
        return lambda: self._listeners[event_type].remove(listener)

    async def async_fire(self, event_type, data):
        event = SimpleNamespace(data=data, context=None)
        for listener in list(self._listeners.get(event_type, [])):
            await listener(event)


class FakeHass:

    def __init__(self) -> None:
        self.bus = FakeBus()
        self.triggered: list[dict] = []

    def async_run_hass_job(self, job, run_variables, context=None):
        self.triggered.append(run_variables)
        return None


async def _noop_action(run_variables, context=None) -> None:
    pass


@pytest.mark.asyncio
async def test_trigger_fires_for_matching_entity_and_action():
    hass = FakeHass()

    config = TRIGGER_SCHEMA({
        "platform": "todo_overlay",
        "entity_id": "todo.shopping",
        "action": "completed",
    })

    await async_attach_trigger(hass, config, _noop_action, {"trigger_data": {"id": "1"}})

    await hass.bus.async_fire(EVENT_ITEM_CHANGED, {
        "entity_id": "todo.shopping",
        "item_id": "1",
        "title": "Milk",
        "action": "completed",
    })

    assert len(hass.triggered) == 1
    assert hass.triggered[0]["trigger"]["platform"] == "todo_overlay"
    assert hass.triggered[0]["trigger"]["event"].data["title"] == "Milk"


@pytest.mark.asyncio
async def test_trigger_ignores_non_matching_entity():
    hass = FakeHass()

    config = TRIGGER_SCHEMA({
        "platform": "todo_overlay",
        "entity_id": "todo.shopping",
    })

    await async_attach_trigger(hass, config, _noop_action, {"trigger_data": {"id": "1"}})

    await hass.bus.async_fire(EVENT_ITEM_CHANGED, {
        "entity_id": "todo.other",
        "item_id": "1",
        "title": "Milk",
        "action": "completed",
    })

    assert hass.triggered == []


@pytest.mark.asyncio
async def test_trigger_ignores_non_matching_action():
    hass = FakeHass()

    config = TRIGGER_SCHEMA({
        "platform": "todo_overlay",
        "action": "removed",
    })

    await async_attach_trigger(hass, config, _noop_action, {"trigger_data": {"id": "1"}})

    await hass.bus.async_fire(EVENT_ITEM_CHANGED, {
        "entity_id": "todo.shopping",
        "item_id": "1",
        "title": "Milk",
        "action": "created",
    })

    assert hass.triggered == []


@pytest.mark.asyncio
async def test_trigger_filters_by_tag():
    hass = FakeHass()

    config = TRIGGER_SCHEMA({
        "platform": "todo_overlay",
        "action": "tag_added",
        "tag": "urgent",
    })

    await async_attach_trigger(hass, config, _noop_action, {"trigger_data": {"id": "1"}})

    await hass.bus.async_fire(EVENT_ITEM_CHANGED, {
        "entity_id": "todo.shopping",
        "item_id": "1",
        "title": "Milk",
        "action": "tag_added",
        "tag": "not-urgent",
    })
    await hass.bus.async_fire(EVENT_ITEM_CHANGED, {
        "entity_id": "todo.shopping",
        "item_id": "1",
        "title": "Milk",
        "action": "tag_added",
        "tag": "urgent",
    })

    assert len(hass.triggered) == 1
    assert hass.triggered[0]["trigger"]["event"].data["tag"] == "urgent"


@pytest.mark.asyncio
async def test_trigger_with_no_filters_matches_everything():
    hass = FakeHass()

    config = TRIGGER_SCHEMA({"platform": "todo_overlay"})

    await async_attach_trigger(hass, config, _noop_action, {"trigger_data": {"id": "1"}})

    await hass.bus.async_fire(EVENT_ITEM_CHANGED, {
        "entity_id": "todo.anything",
        "item_id": "1",
        "title": "Anything",
        "action": "created",
    })

    assert len(hass.triggered) == 1


@pytest.mark.asyncio
async def test_detach_trigger_stops_listening():
    hass = FakeHass()

    config = TRIGGER_SCHEMA({"platform": "todo_overlay"})

    detach = await async_attach_trigger(hass, config, _noop_action, {"trigger_data": {"id": "1"}})
    detach()

    await hass.bus.async_fire(EVENT_ITEM_CHANGED, {
        "entity_id": "todo.shopping",
        "item_id": "1",
        "title": "Milk",
        "action": "created",
    })

    assert hass.triggered == []
