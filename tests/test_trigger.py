from types import SimpleNamespace

import pytest

from custom_components.todo_overlay.const import EVENT_ITEM_CHANGED
from custom_components.todo_overlay.trigger import TRIGGERS, async_get_triggers
from homeassistant.helpers.trigger import TriggerConfig


class FakeBus:

    def __init__(self) -> None:
        self._listeners: dict[str, list] = {}

    def async_listen(self, event_type, listener):
        self._listeners.setdefault(event_type, []).append(listener)
        return lambda: self._listeners[event_type].remove(listener)

    async def async_fire(self, event_type, data):
        event = SimpleNamespace(data=data, context=None)
        for listener in list(self._listeners.get(event_type, [])):
            listener(event)


class FakeHass:

    def __init__(self) -> None:
        self.bus = FakeBus()


def _make_trigger(cls, hass, entity_id=None, tag=None):
    target = {"entity_id": entity_id} if entity_id else {}
    options = {"tag": tag} if tag else {}
    return cls(hass, TriggerConfig(key="_", target=target, options=options))


async def _attach(trigger, triggered: list[dict]):
    def run_action(extra_trigger_payload, description, context=None):
        triggered.append({**extra_trigger_payload, "description": description})

    return await trigger.async_attach_runner(run_action)


@pytest.mark.asyncio
async def test_async_get_triggers_registers_all_eight_actions():
    triggers = await async_get_triggers(hass=None)

    assert set(triggers.keys()) == {
        "created", "completed", "uncompleted", "removed",
        "tag_added", "tag_removed", "quantity_changed", "due",
    }


@pytest.mark.parametrize("action,cls", list(TRIGGERS.items()))
@pytest.mark.asyncio
async def test_trigger_only_fires_for_its_own_action(action, cls):
    hass = FakeHass()
    triggered: list[dict] = []

    trigger = _make_trigger(cls, hass)
    await _attach(trigger, triggered)

    await hass.bus.async_fire(EVENT_ITEM_CHANGED, {
        "entity_id": "todo.shopping", "item_id": "1", "title": "Milk",
        "action": "some_other_action",
    })
    assert triggered == []

    await hass.bus.async_fire(EVENT_ITEM_CHANGED, {
        "entity_id": "todo.shopping", "item_id": "1", "title": "Milk",
        "action": action,
    })
    assert len(triggered) == 1
    assert triggered[0]["description"] == f"todo_overlay {action} event"
    assert triggered[0]["event"].data["title"] == "Milk"


@pytest.mark.parametrize("action,cls", list(TRIGGERS.items()))
@pytest.mark.asyncio
async def test_trigger_filters_by_target_entity_id(action, cls):
    hass = FakeHass()
    triggered: list[dict] = []

    trigger = _make_trigger(cls, hass, entity_id=["todo.shopping"])
    await _attach(trigger, triggered)

    await hass.bus.async_fire(EVENT_ITEM_CHANGED, {
        "entity_id": "todo.other", "item_id": "1", "title": "Milk", "action": action,
    })
    assert triggered == []

    await hass.bus.async_fire(EVENT_ITEM_CHANGED, {
        "entity_id": "todo.shopping", "item_id": "1", "title": "Milk", "action": action,
    })
    assert len(triggered) == 1


@pytest.mark.asyncio
async def test_trigger_filters_by_tag():
    hass = FakeHass()
    triggered: list[dict] = []

    trigger = _make_trigger(TRIGGERS["tag_added"], hass, tag="urgent")
    await _attach(trigger, triggered)

    await hass.bus.async_fire(EVENT_ITEM_CHANGED, {
        "entity_id": "todo.shopping", "item_id": "1", "title": "Milk",
        "action": "tag_added", "tag": "not-urgent",
    })
    await hass.bus.async_fire(EVENT_ITEM_CHANGED, {
        "entity_id": "todo.shopping", "item_id": "1", "title": "Milk",
        "action": "tag_added", "tag": "urgent",
    })

    assert len(triggered) == 1
    assert triggered[0]["event"].data["tag"] == "urgent"


@pytest.mark.asyncio
async def test_trigger_fires_for_due_action_with_no_filters():
    hass = FakeHass()
    triggered: list[dict] = []

    trigger = _make_trigger(TRIGGERS["due"], hass)
    await _attach(trigger, triggered)

    await hass.bus.async_fire(EVENT_ITEM_CHANGED, {
        "entity_id": "todo.shopping", "item_id": "1", "title": "Renew passport",
        "action": "due", "due_datetime": "2026-01-01T09:00:00+00:00",
    })

    assert len(triggered) == 1
    assert triggered[0]["event"].data["due_datetime"] == "2026-01-01T09:00:00+00:00"


@pytest.mark.asyncio
async def test_detach_trigger_stops_listening():
    hass = FakeHass()
    triggered: list[dict] = []

    trigger = _make_trigger(TRIGGERS["created"], hass)
    detach = await _attach(trigger, triggered)
    detach()

    await hass.bus.async_fire(EVENT_ITEM_CHANGED, {
        "entity_id": "todo.shopping", "item_id": "1", "title": "Milk", "action": "created",
    })

    assert triggered == []


@pytest.mark.asyncio
async def test_validate_config_requires_a_target():
    with pytest.raises(Exception):
        await TRIGGERS["created"].async_validate_config(None, {})


@pytest.mark.asyncio
async def test_validate_config_accepts_target_and_tag_option():
    config = await TRIGGERS["created"].async_validate_config(
        None,
        {"target": {"entity_id": "todo.shopping"}, "options": {"tag": "urgent"}},
    )

    assert config["target"]["entity_id"] == ["todo.shopping"]
    assert config["options"]["tag"] == "urgent"
