import datetime

import pytest

from homeassistant.components.todo import DATA_COMPONENT, TodoItemStatus

from custom_components.todo_overlay.errors import EntityNotFoundError
from custom_components.todo_overlay.ha_adapter import HomeAssistantTodoProvider, _due_fields


class FakeNativeItem:
    """Stands in for HA's own TodoItem - only the attributes ha_adapter.py
    actually reads (uid, summary, status, description, due)."""

    def __init__(self, uid, summary, status=TodoItemStatus.NEEDS_ACTION, description=None, due=None):
        self.uid = uid
        self.summary = summary
        self.status = status
        self.description = description
        self.due = due


class FakeEntity:

    def __init__(self, todo_items):
        self.todo_items = todo_items


class FakeComponent:

    def __init__(self, entities: dict[str, FakeEntity]):
        self._entities = entities

    def get_entity(self, entity_id):
        return self._entities.get(entity_id)


class FakeServices:
    """Records every call; on "todo"/"add_item" it applies whatever
    add_item_effect the test configured, mirroring how the real todo.add_item
    service would mutate the entity's todo_items as a side effect."""

    def __init__(self):
        self.calls: list[tuple[str, str, dict]] = []
        self.add_item_effect = None

    async def async_call(self, domain, service, data, blocking=True):
        self.calls.append((domain, service, dict(data)))

        if domain == "todo" and service == "add_item" and self.add_item_effect:
            self.add_item_effect(data)


class FakeState:

    def __init__(self, supported_features=0):
        self.attributes = {"supported_features": supported_features}


class FakeStates:

    def __init__(self, states: dict[str, FakeState]):
        self._states = states

    def get(self, entity_id):
        return self._states.get(entity_id)


class FakeHass:

    def __init__(self, entities, states=None):
        self.data = {DATA_COMPONENT: FakeComponent(entities)}
        self.services = FakeServices()
        self.states = FakeStates(states or {})


# --- _due_fields --------------------------------------------------------

def test_due_fields_with_date_only():
    due_date, due_datetime = _due_fields(datetime.date(2026, 7, 14))

    assert due_date == "2026-07-14"
    assert due_datetime is None


def test_due_fields_with_datetime():
    due_date, due_datetime = _due_fields(
        datetime.datetime(2026, 7, 14, 9, 30, tzinfo=datetime.timezone.utc)
    )

    assert due_date is None
    assert due_datetime == "2026-07-14T09:30:00+00:00"


def test_due_fields_with_none():
    assert _due_fields(None) == (None, None)


# --- get_items / EntityNotFoundError ------------------------------------

@pytest.mark.asyncio
async def test_get_items_raises_entity_not_found_for_unknown_entity():
    hass = FakeHass(entities={})
    provider = HomeAssistantTodoProvider(hass)

    with pytest.raises(EntityNotFoundError):
        await provider.get_items("todo.nonexistent")


@pytest.mark.asyncio
async def test_get_items_maps_native_fields():
    entities = {
        "todo.list": FakeEntity([
            FakeNativeItem("1", "Milk", status=TodoItemStatus.COMPLETED, description="2%"),
        ]),
    }
    hass = FakeHass(entities)
    provider = HomeAssistantTodoProvider(hass)

    items = await provider.get_items("todo.list")

    assert len(items) == 1
    assert items[0].id == "1"
    assert items[0].title == "Milk"
    assert items[0].completed is True
    assert items[0].description == "2%"


# --- add_item ambiguous-id warning ---------------------------------------

@pytest.mark.asyncio
async def test_add_item_warns_when_multiple_new_items_appear(caplog):
    """If more than one new item shows up between the before/after reads
    (e.g. something else added to the same list at the same moment),
    add_item can't tell which is actually ours and picks one arbitrarily -
    this should at least be logged loudly rather than silently guessing."""

    entity = FakeEntity([])
    hass = FakeHass({"todo.list": entity})

    def add_two_items(data):
        entity.todo_items.append(FakeNativeItem("a", data["item"]))
        entity.todo_items.append(FakeNativeItem("b", "Unrelated concurrent item"))

    hass.services.add_item_effect = add_two_items

    provider = HomeAssistantTodoProvider(hass)

    with caplog.at_level("WARNING"):
        new_id = await provider.add_item("todo.list", "Bread")

    assert new_id in ("a", "b")
    assert any("Ambiguous new item" in record.message for record in caplog.records)


@pytest.mark.asyncio
async def test_add_item_no_warning_for_unambiguous_add(caplog):
    entity = FakeEntity([])
    hass = FakeHass({"todo.list": entity})

    def add_one_item(data):
        entity.todo_items.append(FakeNativeItem("a", data["item"]))

    hass.services.add_item_effect = add_one_item

    provider = HomeAssistantTodoProvider(hass)

    with caplog.at_level("WARNING"):
        new_id = await provider.add_item("todo.list", "Bread")

    assert new_id == "a"
    assert not any("Ambiguous new item" in record.message for record in caplog.records)


@pytest.mark.asyncio
async def test_add_item_drops_unsupported_fields():
    """Loading a snapshot with a due date onto an entity that doesn't
    support due dates shouldn't fail the whole call over one field - see
    the entity-agnostic saved-list history for why this matters."""

    entity = FakeEntity([])
    hass = FakeHass(
        {"todo.list": entity},
        states={"todo.list": FakeState(supported_features=0)},
    )

    def add_one_item(data):
        entity.todo_items.append(FakeNativeItem("a", data["item"]))

    hass.services.add_item_effect = add_one_item

    provider = HomeAssistantTodoProvider(hass)

    await provider.add_item("todo.list", "Bread", due_date="2026-07-14")

    _, _, call_data = hass.services.calls[0]
    assert "due_date" not in call_data
