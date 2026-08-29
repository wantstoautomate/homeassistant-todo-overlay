"""Tests for the service layer: async_register_services() wires each
service to a handler closure that pulls the right fields out of
call.data and passes them to TodoManager.

Since the handlers are local closures (not module-level functions),
async_register_services() is called once against a fake hass.services
that captures each handler by name, and each captured handler is then
invoked directly with a fake ServiceCall - bypassing voluptuous schema
validation (and its defaults), so fake call.data must supply every field
a real validated call would have, defaults included.
"""

import pytest
import voluptuous as vol

from custom_components.todo_overlay.const import DOMAIN
from custom_components.todo_overlay.manager import TodoManager
from custom_components.todo_overlay.models import ItemPosition, TodoItem
from custom_components.todo_overlay.services import (
    JOIN_LINK_SCHEMA,
    QUERY_ITEMS_SCHEMA,
    async_register_services,
)

from fakes import FakeAdapter, FakeConfigEntries, FakeMetadataStore

ENTITY_ID = "todo.shopping"


class FakeServiceCall:

    def __init__(self, data: dict):
        self.data = data


class FakeServices:

    def __init__(self):
        self.handlers: dict[str, callable] = {}

    def async_register(self, domain, service, handler, schema=None, supports_response=None):
        assert domain == DOMAIN
        self.handlers[service] = handler


def make_hass(manager: TodoManager, metadata_store=None, link_sync=None) -> tuple[object, FakeServices]:
    services = FakeServices()
    hass = type("FakeHass", (), {
        "config_entries": FakeConfigEntries(manager, metadata_store, link_sync),
        "services": services,
    })()
    async_register_services(hass)
    return hass, services


def make_manager(items=None, positions=None) -> TodoManager:
    adapter = FakeAdapter(items=items)
    metadata_store = FakeMetadataStore(positions=positions)
    return TodoManager(adapter=adapter, metadata_store=metadata_store)


def test_async_register_services_registers_every_service():
    manager = make_manager()
    _, services = make_hass(manager)

    assert set(services.handlers) == {
        "save_list",
        "load_list",
        "delete_saved_list",
        "add_tag",
        "remove_tag",
        "create_item",
        "set_quantity",
        "set_pin_type",
        "set_trigger_on_due",
        "create_link",
        "join_link",
        "unlink",
        "query_items",
    }


@pytest.mark.asyncio
async def test_service_save_list_and_load_list_round_trip():
    manager = make_manager()
    _, services = make_hass(manager)

    await services.handlers["save_list"](FakeServiceCall({
        "entity_id": ENTITY_ID, "name": "template", "persist_states": False,
    }))

    await services.handlers["load_list"](FakeServiceCall({
        "entity_id": "todo.other", "name": "template", "mode": "full_merge",
    }))

    todo_list = await manager.get_list("todo.other")
    assert any(item.title == "Shopping" for item in todo_list.items)


@pytest.mark.asyncio
async def test_service_load_list_with_target_item_loads_as_its_children():
    manager = make_manager(
        items=[TodoItem(id="parent", title="To buy", completed=False)],
        positions={"parent": ItemPosition(parent_id=None, order=0)},
    )
    _, services = make_hass(manager)

    await manager._metadata_store.save_snapshot("template", [
        {
            "title": "Apples", "description": None, "due_date": None, "due_datetime": None,
            "completed": False, "children": [],
        },
    ])

    await services.handlers["load_list"](FakeServiceCall({
        "entity_id": ENTITY_ID, "name": "template", "mode": "merge", "target_item": "To buy",
    }))

    todo_list = await manager.get_list(ENTITY_ID)
    assert len(todo_list.items) == 1
    assert todo_list.items[0].title == "To buy"
    assert [c.title for c in todo_list.items[0].children] == ["Apples"]


@pytest.mark.asyncio
async def test_service_delete_saved_list():
    manager = make_manager()
    _, services = make_hass(manager)

    await services.handlers["save_list"](FakeServiceCall({
        "entity_id": ENTITY_ID, "name": "template", "persist_states": False,
    }))
    await services.handlers["delete_saved_list"](FakeServiceCall({"name": "template"}))

    assert await manager.list_saved() == []


@pytest.mark.asyncio
async def test_service_add_tag_and_remove_tag():
    manager = make_manager()
    _, services = make_hass(manager)

    await services.handlers["add_tag"](FakeServiceCall({
        "entity_id": ENTITY_ID, "item": "1", "tag": "urgent",
    }))

    todo_list = await manager.get_list(ENTITY_ID)
    item = next(i for i in todo_list.items if i.id == "1")
    assert item.tags == ["urgent"]

    await services.handlers["remove_tag"](FakeServiceCall({
        "entity_id": ENTITY_ID, "item": "1", "tag": "urgent",
    }))

    todo_list = await manager.get_list(ENTITY_ID)
    item = next(i for i in todo_list.items if i.id == "1")
    assert item.tags == []


@pytest.mark.asyncio
async def test_service_create_item_with_quantity_and_tags():
    manager = make_manager()
    _, services = make_hass(manager)

    await services.handlers["create_item"](FakeServiceCall({
        "entity_id": ENTITY_ID,
        "title": "Bread",
        "description": None,
        "due_date": None,
        "due_datetime": None,
        "quantity": "2",
        "tags": ["bakery"],
        "trigger_on_due": False,
    }))

    todo_list = await manager.get_list(ENTITY_ID)
    bread = next(i for i in todo_list.items if i.title == "Bread")
    assert bread.quantity == "2"
    assert bread.tags == ["bakery"]


@pytest.mark.asyncio
async def test_service_set_quantity_resolves_by_title():
    manager = make_manager()
    _, services = make_hass(manager)

    await services.handlers["set_quantity"](FakeServiceCall({
        "entity_id": ENTITY_ID, "item": "Shopping", "quantity": "5kg",
    }))

    todo_list = await manager.get_list(ENTITY_ID)
    item = next(i for i in todo_list.items if i.id == "1")
    assert item.quantity == "5kg"


@pytest.mark.asyncio
async def test_service_create_item_with_pin_type():
    manager = make_manager()
    _, services = make_hass(manager)

    await services.handlers["create_item"](FakeServiceCall({
        "entity_id": ENTITY_ID,
        "title": "Brodie",
        "description": None,
        "due_date": None,
        "due_datetime": None,
        "quantity": None,
        "tags": None,
        "trigger_on_due": False,
        "pin_type": "person",
    }))

    todo_list = await manager.get_list(ENTITY_ID)
    brodie = next(i for i in todo_list.items if i.title == "Brodie")
    assert brodie.pin_type == "person"


@pytest.mark.asyncio
async def test_service_set_pin_type_resolves_by_title():
    manager = make_manager()
    _, services = make_hass(manager)

    await services.handlers["set_pin_type"](FakeServiceCall({
        "entity_id": ENTITY_ID, "item": "Shopping", "pin_type": "category",
    }))

    todo_list = await manager.get_list(ENTITY_ID)
    item = next(i for i in todo_list.items if i.id == "1")
    assert item.pin_type == "category"


@pytest.mark.asyncio
async def test_service_set_pin_type_can_clear_by_omitting_the_field():
    manager = make_manager()
    _, services = make_hass(manager)

    await services.handlers["set_pin_type"](FakeServiceCall({
        "entity_id": ENTITY_ID, "item": "Shopping", "pin_type": "category",
    }))
    await services.handlers["set_pin_type"](FakeServiceCall({
        "entity_id": ENTITY_ID, "item": "Shopping",
    }))

    todo_list = await manager.get_list(ENTITY_ID)
    item = next(i for i in todo_list.items if i.id == "1")
    assert item.pin_type is None


@pytest.mark.asyncio
async def test_service_set_pin_type_raises_invalid_pin_type_for_a_bad_value():
    """Services don't catch TodoManager's errors themselves (see the
    matching add_tag/ItemNotFoundError test above) - this bypasses the
    vol.In schema layer the same way, exercising the manager-level
    InvalidPinTypeError check directly."""

    from custom_components.todo_overlay.errors import InvalidPinTypeError

    manager = make_manager()
    _, services = make_hass(manager)

    with pytest.raises(InvalidPinTypeError):
        await services.handlers["set_pin_type"](FakeServiceCall({
            "entity_id": ENTITY_ID, "item": "Shopping", "pin_type": "not-a-real-pin-type",
        }))


@pytest.mark.asyncio
async def test_service_add_tag_raises_item_not_found_for_unknown_item():
    """Services don't catch TodoManager's errors themselves - HA's own
    service-call machinery is what surfaces a raised exception to the
    caller, so this just confirms the handler doesn't silently swallow
    it. See errors.py for the exception hierarchy."""

    from custom_components.todo_overlay.errors import ItemNotFoundError

    manager = make_manager()
    _, services = make_hass(manager)

    with pytest.raises(ItemNotFoundError):
        await services.handlers["add_tag"](FakeServiceCall({
            "entity_id": ENTITY_ID, "item": "nonexistent", "tag": "urgent",
        }))


@pytest.mark.asyncio
async def test_service_set_trigger_on_due_resolves_by_title():
    from custom_components.todo_overlay.models import TodoItem

    manager = make_manager(items=[
        TodoItem(
            id="1", title="Renew passport", completed=False,
            due_datetime="2026-01-01T09:00:00+00:00",
        ),
    ])
    _, services = make_hass(manager)

    await services.handlers["set_trigger_on_due"](FakeServiceCall({
        "entity_id": ENTITY_ID, "item": "Renew passport", "enabled": True,
    }))

    todo_list = await manager.get_list(ENTITY_ID)
    item = next(i for i in todo_list.items if i.id == "1")
    assert item.trigger_on_due is True


@pytest.mark.asyncio
async def test_service_set_trigger_on_due_raises_due_time_required_without_due_datetime():
    from custom_components.todo_overlay.errors import DueTimeRequiredError

    manager = make_manager()  # default items have no due_datetime
    _, services = make_hass(manager)

    with pytest.raises(DueTimeRequiredError):
        await services.handlers["set_trigger_on_due"](FakeServiceCall({
            "entity_id": ENTITY_ID, "item": "Shopping", "enabled": True,
        }))


class FakeLinkSync:

    def __init__(self):
        self.started: list[str] = []
        self.stopped: list[str] = []

    async def async_start_link(self, entity_id: str) -> None:
        self.started.append(entity_id)

    async def async_stop_link(self, entity_id: str) -> None:
        self.stopped.append(entity_id)


@pytest.mark.asyncio
async def test_service_create_link_without_a_configured_broker_raises():
    from homeassistant.exceptions import HomeAssistantError

    manager = make_manager()
    _, services = make_hass(manager, metadata_store=FakeMetadataStore(), link_sync=None)

    with pytest.raises(HomeAssistantError):
        await services.handlers["create_link"](FakeServiceCall({"entity_id": ENTITY_ID}))


@pytest.mark.asyncio
async def test_service_create_link_generates_and_starts_a_link():
    manager = make_manager()
    metadata_store = FakeMetadataStore()
    link_sync = FakeLinkSync()
    _, services = make_hass(manager, metadata_store=metadata_store, link_sync=link_sync)

    result = await services.handlers["create_link"](FakeServiceCall({"entity_id": ENTITY_ID}))

    assert "link_id" in result
    link = await metadata_store.get_link(ENTITY_ID)
    assert link["link_id"] == result["link_id"]
    assert link_sync.started == [ENTITY_ID]


@pytest.mark.asyncio
async def test_service_join_link_uses_the_given_link_id():
    manager = make_manager()
    metadata_store = FakeMetadataStore()
    link_sync = FakeLinkSync()
    _, services = make_hass(manager, metadata_store=metadata_store, link_sync=link_sync)

    await services.handlers["join_link"](FakeServiceCall({
        "entity_id": ENTITY_ID, "link_id": "partners-link-id",
    }))

    link = await metadata_store.get_link(ENTITY_ID)
    assert link["link_id"] == "partners-link-id"
    assert link_sync.started == [ENTITY_ID]


@pytest.mark.asyncio
async def test_service_unlink_stops_and_clears_the_link():
    manager = make_manager()
    metadata_store = FakeMetadataStore()
    link_sync = FakeLinkSync()
    _, services = make_hass(manager, metadata_store=metadata_store, link_sync=link_sync)

    await services.handlers["join_link"](FakeServiceCall({
        "entity_id": ENTITY_ID, "link_id": "some-link-id",
    }))
    await services.handlers["unlink"](FakeServiceCall({"entity_id": ENTITY_ID}))

    assert await metadata_store.get_link(ENTITY_ID) is None
    assert link_sync.stopped == [ENTITY_ID]


def test_join_link_schema_accepts_a_link_id_shaped_like_create_link_generates():
    result = JOIN_LINK_SCHEMA({"entity_id": ENTITY_ID, "link_id": "a" * 32})

    assert result["link_id"] == "a" * 32


@pytest.mark.parametrize("bad_link_id", [
    "+",  # MQTT single-level wildcard
    "#",  # MQTT multi-level wildcard
    "todo_overlay/link/+/item/+",
    "not-hex-at-all",
    "A" * 32,  # uuid4().hex is always lowercase
    "a" * 31,
])
def test_join_link_schema_rejects_anything_that_could_widen_the_mqtt_subscription(bad_link_id):
    """A join_link link_id is spliced directly into an MQTT topic filter
    (see link_sync.py) - anything other than create_link's own
    32-lowercase-hex-char shape risks turning one link's subscription
    into a broker-wide wildcard, leaking/cross-writing every other
    link's traffic."""

    with pytest.raises(vol.Invalid):
        JOIN_LINK_SCHEMA({"entity_id": ENTITY_ID, "link_id": bad_link_id})


# --- query_items --------------------------------------------------------

def _query_call_data(**overrides) -> dict:
    """Every field the real schema would have filled in, defaults
    included - see this file's own module docstring for why (the
    handler is invoked directly, bypassing QUERY_ITEMS_SCHEMA)."""

    data = {
        "entity_id": ENTITY_ID,
        "tags_mode": "any",
        "top_level_only": False,
        "include_ancestors": False,
        "include_children": False,
    }
    data.update(overrides)

    return data


@pytest.mark.asyncio
async def test_service_query_items_wraps_the_result_under_items():
    manager = make_manager(items=[
        TodoItem(id="1", title="Milk", completed=False),
        TodoItem(id="2", title="Bread", completed=True),
    ])
    _, services = make_hass(manager)

    result = await services.handlers["query_items"](
        FakeServiceCall(_query_call_data(completed=False)),
    )

    assert [item["id"] for item in result["items"]] == ["1"]


@pytest.mark.asyncio
async def test_service_query_items_resolves_parent_title_and_reports_it_back():
    manager = make_manager(
        items=[
            TodoItem(id="brodie", title="Brodie", completed=False),
            TodoItem(id="passport", title="Passport", completed=False),
        ],
        positions={
            "brodie": ItemPosition(parent_id=None, order=0),
            "passport": ItemPosition(parent_id="brodie", order=0),
        },
    )
    _, services = make_hass(manager)

    result = await services.handlers["query_items"](
        FakeServiceCall(_query_call_data(parent_title="Brodie")),
    )

    assert result["items"] == [{
        "id": "passport", "title": "Passport", "completed": False, "description": None,
        "due_date": None, "due_datetime": None, "quantity": None, "tags": [],
        "trigger_on_due": False, "pin_type": None, "weekday": None, "day_label": None,
        "linked": False, "delete_protected": False, "depth": 1,
        "parent_id": "brodie", "parent_title": "Brodie",
    }]


def test_query_items_schema_rejects_combining_parent_and_under_scope():
    """parent_id/parent_title/under_id/under_title all share one
    vol.Exclusive group - see QUERY_ITEMS_SCHEMA's own comment for why
    mixing them is ambiguous rather than just redundant."""

    with pytest.raises(vol.Invalid):
        QUERY_ITEMS_SCHEMA({
            "entity_id": ENTITY_ID, "parent_title": "Brodie", "under_title": "Anna",
        })


def test_query_items_schema_rejects_an_invalid_pin_type():
    with pytest.raises(vol.Invalid):
        QUERY_ITEMS_SCHEMA({"entity_id": ENTITY_ID, "pin_type": "not-a-real-type"})


def test_query_items_schema_accepts_pin_type_none_for_plain_leaf_items():
    result = QUERY_ITEMS_SCHEMA({"entity_id": ENTITY_ID, "pin_type": "none"})

    assert result["pin_type"] == "none"


def test_query_items_schema_fills_in_every_default():
    result = QUERY_ITEMS_SCHEMA({"entity_id": ENTITY_ID})

    assert result["tags_mode"] == "any"
    assert result["top_level_only"] is False
    assert result["include_ancestors"] is False
    assert result["include_children"] is False
