"""Tests for the websocket command layer: schema wiring (each handler
pulls the right fields out of msg and passes them to TodoManager) and the
uniform error-code mapping (_handle_manager_errors).

Handlers are called via their .__wrapped__ attribute rather than directly:
websocket_api.async_response's own wrapper schedules the real handler as a
background task and returns immediately rather than awaiting it, so a
direct call wouldn't be awaitable in a test. @wraps in both async_response
and our own _handle_manager_errors decorator means .__wrapped__ reaches
straight through to the _handle_manager_errors-wrapped coroutine - which
still includes our error-mapping logic, just not HA's task-scheduling
machinery (that's HA's own, not what these tests are for).
"""

import pytest

from custom_components.todo_overlay import websocket
from custom_components.todo_overlay.const import DATA_MANAGER, DOMAIN
from custom_components.todo_overlay.manager import TodoManager
from custom_components.todo_overlay.models import ItemPosition, TodoItem

from fakes import FakeAdapter, FakeMetadataStore

ENTITY_ID = "todo.shopping"


class FakeConnection:

    def __init__(self):
        self.results: list[tuple[int, object]] = []
        self.errors: list[tuple[int, str, str]] = []

    def send_result(self, msg_id, result=None):
        self.results.append((msg_id, result))

    def send_error(self, msg_id, code, message):
        self.errors.append((msg_id, code, message))


def make_hass(manager: TodoManager):
    return type("FakeHass", (), {"data": {DOMAIN: {DATA_MANAGER: manager}}})()


async def call_handler(handler, manager: TodoManager, msg: dict):
    hass = make_hass(manager)
    connection = FakeConnection()
    msg = {"id": 1, **msg}

    await handler.__wrapped__(hass, connection, msg)

    return connection


def make_manager(items=None, positions=None) -> TodoManager:
    adapter = FakeAdapter(items=items)
    metadata_store = FakeMetadataStore(positions=positions)
    return TodoManager(adapter=adapter, metadata_store=metadata_store)


# --- get_list --------------------------------------------------------

@pytest.mark.asyncio
async def test_websocket_get_list_returns_serialised_list():
    manager = make_manager()

    connection = await call_handler(
        websocket.websocket_get_list, manager, {"entity_id": ENTITY_ID, "group_completed": False},
    )

    assert len(connection.results) == 1
    msg_id, result = connection.results[0]
    assert msg_id == 1
    assert result["entity_id"] == ENTITY_ID
    assert {item["title"] for item in result["items"]} == {"Shopping", "Milk"}


# "not_found" for an unknown entity_id is covered by ha_adapter's own
# tests (EntityNotFoundError) - FakeAdapter here doesn't validate
# entity_id at all, so it can't be exercised through this fake without
# extra complexity that wouldn't buy much: add_tag/remove_tag below
# already prove the "not_found" mapping works for the ValueError
# subclass FakeAdapter CAN naturally raise (ItemNotFoundError).


# --- move_item ---------------------------------------------------------

@pytest.mark.asyncio
async def test_websocket_move_item_success():
    manager = make_manager(positions={
        "1": ItemPosition(parent_id=None, order=0),
        "2": ItemPosition(parent_id=None, order=1),
    })

    connection = await call_handler(
        websocket.websocket_move_item, manager,
        {"entity_id": ENTITY_ID, "child_id": "1", "reference_id": "2", "placement": "inside"},
    )

    assert connection.results == [(1, None)]
    assert connection.errors == []


@pytest.mark.asyncio
async def test_websocket_move_item_cycle_sends_cycle_detected_error():
    manager = make_manager()

    connection = await call_handler(
        websocket.websocket_move_item, manager,
        {"entity_id": ENTITY_ID, "child_id": "1", "reference_id": "1", "placement": "before"},
    )

    assert connection.results == []
    msg_id, code, message = connection.errors[0]
    assert code == "cycle_detected"


# --- set_completed / restore_completed / clear_completed -----------------

@pytest.mark.asyncio
async def test_websocket_set_completed_returns_changed_list():
    manager = make_manager()

    connection = await call_handler(
        websocket.websocket_set_completed, manager,
        {"entity_id": ENTITY_ID, "item_id": "1", "completed": True, "reposition": False},
    )

    msg_id, result = connection.results[0]
    assert result["changed"] == [{"id": "1", "completed": False}]


@pytest.mark.asyncio
async def test_websocket_restore_completed_writes_back_states():
    manager = make_manager()
    adapter: FakeAdapter = manager._adapter

    connection = await call_handler(
        websocket.websocket_restore_completed, manager,
        {"entity_id": ENTITY_ID, "changes": [{"id": "1", "completed": True}]},
    )

    assert connection.results == [(1, None)]
    assert adapter.set_completed_calls == [(ENTITY_ID, "1", True)]


@pytest.mark.asyncio
async def test_websocket_clear_completed_returns_removed_ids():
    manager = make_manager(items=[
        TodoItem(id="1", title="Shopping", completed=True),
        TodoItem(id="2", title="Milk", completed=False),
    ])

    connection = await call_handler(
        websocket.websocket_clear_completed, manager, {"entity_id": ENTITY_ID},
    )

    msg_id, result = connection.results[0]
    assert result["removed"] == ["1"]


# --- save_list / load_list / list_saved / delete_saved_list --------------

@pytest.mark.asyncio
async def test_websocket_save_and_load_list_round_trip():
    manager = make_manager()

    save_connection = await call_handler(
        websocket.websocket_save_list, manager,
        {"entity_id": ENTITY_ID, "name": "template", "persist_states": False},
    )
    assert save_connection.results == [(1, None)]

    load_connection = await call_handler(
        websocket.websocket_load_list, manager,
        {"entity_id": "todo.other", "name": "template", "mode": "full_merge"},
    )
    assert load_connection.results == [(1, None)]

    list_connection = await call_handler(
        websocket.websocket_list_saved, manager, {},
    )
    msg_id, result = list_connection.results[0]
    assert result["names"] == ["template"]

    delete_connection = await call_handler(
        websocket.websocket_delete_saved_list, manager, {"name": "template"},
    )
    assert delete_connection.results == [(1, None)]

    list_after_delete = await call_handler(
        websocket.websocket_list_saved, manager, {},
    )
    assert list_after_delete.results[0][1]["names"] == []


@pytest.mark.asyncio
async def test_websocket_load_list_unknown_snapshot_sends_not_found_error():
    manager = make_manager()

    connection = await call_handler(
        websocket.websocket_load_list, manager,
        {"entity_id": ENTITY_ID, "name": "nonexistent", "mode": "merge"},
    )

    assert connection.results == []
    msg_id, code, message = connection.errors[0]
    assert code == "not_found"


# --- create_item / set_quantity / set_tags --------------------------------

@pytest.mark.asyncio
async def test_websocket_create_item_returns_new_id():
    manager = make_manager()

    connection = await call_handler(
        websocket.websocket_create_item, manager,
        {"entity_id": ENTITY_ID, "title": "Bread", "quantity": "2", "tags": ["bakery"]},
    )

    msg_id, result = connection.results[0]
    assert "id" in result

    list_connection = await call_handler(
        websocket.websocket_get_list, manager, {"entity_id": ENTITY_ID, "group_completed": False},
    )
    items = list_connection.results[0][1]["items"]
    bread = next(item for item in items if item["title"] == "Bread")
    assert bread["quantity"] == "2"
    assert bread["tags"] == ["bakery"]


@pytest.mark.asyncio
async def test_websocket_set_quantity_success():
    manager = make_manager()

    connection = await call_handler(
        websocket.websocket_set_quantity, manager,
        {"entity_id": ENTITY_ID, "item_id": "1", "quantity": "3kg"},
    )

    assert connection.results == [(1, None)]

    metadata_store: FakeMetadataStore = manager._metadata_store
    assert metadata_store._quantities["1"] == "3kg"


@pytest.mark.asyncio
async def test_websocket_set_tags_replaces_full_list():
    manager = make_manager()

    connection = await call_handler(
        websocket.websocket_set_tags, manager,
        {"entity_id": ENTITY_ID, "item_id": "1", "tags": ["urgent", "deli"]},
    )

    assert connection.results == [(1, None)]

    metadata_store: FakeMetadataStore = manager._metadata_store
    assert metadata_store._tags["1"] == ["urgent", "deli"]


# --- set_trigger_on_due ----------------------------------------------------

@pytest.mark.asyncio
async def test_websocket_set_trigger_on_due_success():
    manager = make_manager(items=[
        TodoItem(
            id="1", title="Renew passport", completed=False,
            due_datetime="2026-01-01T09:00:00+00:00",
        ),
    ])

    connection = await call_handler(
        websocket.websocket_set_trigger_on_due, manager,
        {"entity_id": ENTITY_ID, "item_id": "1", "enabled": True},
    )

    assert connection.results == [(1, None)]

    metadata_store: FakeMetadataStore = manager._metadata_store
    assert metadata_store._trigger_on_due == {"1"}


@pytest.mark.asyncio
async def test_websocket_set_trigger_on_due_without_due_time_sends_due_time_required_error():
    manager = make_manager()  # default items have no due_datetime

    connection = await call_handler(
        websocket.websocket_set_trigger_on_due, manager,
        {"entity_id": ENTITY_ID, "item_id": "1", "enabled": True},
    )

    assert connection.results == []
    assert len(connection.errors) == 1
    _, code, _ = connection.errors[0]
    assert code == "due_time_required"


# --- add_tag / remove_tag -------------------------------------------------

@pytest.mark.asyncio
async def test_websocket_add_tag_success():
    manager = make_manager()

    connection = await call_handler(
        websocket.websocket_add_tag, manager,
        {"entity_id": ENTITY_ID, "item": "1", "tag": "urgent"},
    )

    assert connection.results == [(1, None)]
    metadata_store: FakeMetadataStore = manager._metadata_store
    assert metadata_store._tags["1"] == ["urgent"]


@pytest.mark.asyncio
async def test_websocket_add_tag_unknown_item_sends_not_found_error():
    manager = make_manager()

    connection = await call_handler(
        websocket.websocket_add_tag, manager,
        {"entity_id": ENTITY_ID, "item": "nonexistent", "tag": "urgent"},
    )

    assert connection.results == []
    msg_id, code, message = connection.errors[0]
    assert code == "not_found"


@pytest.mark.asyncio
async def test_websocket_remove_tag_success():
    manager = make_manager()
    metadata_store: FakeMetadataStore = manager._metadata_store
    metadata_store._tags["1"] = ["urgent"]

    connection = await call_handler(
        websocket.websocket_remove_tag, manager,
        {"entity_id": ENTITY_ID, "item": "1", "tag": "urgent"},
    )

    assert connection.results == [(1, None)]
    assert "1" not in metadata_store._tags


@pytest.mark.asyncio
async def test_websocket_remove_tag_unknown_item_sends_not_found_error():
    manager = make_manager()

    connection = await call_handler(
        websocket.websocket_remove_tag, manager,
        {"entity_id": ENTITY_ID, "item": "nonexistent", "tag": "urgent"},
    )

    assert connection.results == []
    msg_id, code, message = connection.errors[0]
    assert code == "not_found"


# --- registration -----------------------------------------------------

def test_async_register_websocket_registers_every_handler():
    """Every handler this module defines should actually be wired up -
    a handler that exists but is never registered would be silently
    unreachable from the real frontend."""

    registered_commands = []

    def fake_register(hass, handler):
        registered_commands.append(handler._ws_command)

    import unittest.mock

    with unittest.mock.patch.object(
        websocket.websocket_api, "async_register_command", fake_register,
    ):
        websocket.async_register_websocket(hass=None)

    expected = {
        "todo_overlay/get_list",
        "todo_overlay/move_item",
        "todo_overlay/set_completed",
        "todo_overlay/restore_completed",
        "todo_overlay/clear_completed",
        "todo_overlay/save_list",
        "todo_overlay/load_list",
        "todo_overlay/list_saved",
        "todo_overlay/delete_saved_list",
        "todo_overlay/create_item",
        "todo_overlay/set_quantity",
        "todo_overlay/set_tags",
        "todo_overlay/add_tag",
        "todo_overlay/remove_tag",
        "todo_overlay/set_trigger_on_due",
    }
    assert set(registered_commands) == expected
