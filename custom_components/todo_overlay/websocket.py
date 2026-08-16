from functools import wraps
from typing import Any, Callable, Coroutine

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv

from .const import (
    WS_TYPE_ADD_TAG,
    WS_TYPE_CLEAR_ALL,
    WS_TYPE_CLEAR_COMPLETED,
    WS_TYPE_CREATE_ITEM,
    WS_TYPE_DELETE_ITEM,
    WS_TYPE_DELETE_SAVED_LIST,
    WS_TYPE_GET_LIST,
    WS_TYPE_LIST_SAVED,
    WS_TYPE_LOAD_LIST,
    WS_TYPE_MOVE_ITEM,
    WS_TYPE_REMOVE_TAG,
    WS_TYPE_RESTORE_COMPLETED,
    WS_TYPE_SAVE_LIST,
    WS_TYPE_SET_COMPLETED,
    WS_TYPE_SET_PIN_TYPE,
    WS_TYPE_SET_QUANTITY,
    WS_TYPE_SET_TAGS,
    WS_TYPE_SET_TRIGGER_ON_DUE,
    WS_TYPE_TRANSFER_ITEM,
    WS_TYPE_UPDATE_ITEM,
)
from .errors import (
    CycleError,
    DueTimeRequiredError,
    EntityNotFoundError,
    InvalidPinTypeError,
    ItemNotFoundError,
    SnapshotNotFoundError,
)
from .runtime_data import get_manager, get_metadata_store

# Every TodoManager method that validates its input (a missing item,
# entity, or saved list) raises one of these - all ValueError subclasses,
# so a plain `except ValueError` still works for a caller that only cares
# whether something went wrong. Mapped here to specific websocket error
# codes so the card can tell them apart; anything not listed still gets a
# reasonable code instead of falling through to HA's generic
# "unknown_error", which was the case for every handler except
# move_item/load_list/add_tag/remove_tag before this existed.
_ERROR_CODES: dict[type[Exception], str] = {
    CycleError: "cycle_detected",
    EntityNotFoundError: "not_found",
    ItemNotFoundError: "not_found",
    SnapshotNotFoundError: "not_found",
    DueTimeRequiredError: "due_time_required",
    InvalidPinTypeError: "invalid_pin_type",
}

WebSocketHandler = Callable[
    [HomeAssistant, websocket_api.ActiveConnection, dict], Coroutine[Any, Any, None]
]


def _handle_manager_errors(handler: WebSocketHandler) -> WebSocketHandler:
    """Translate a TodoManager ValueError into a websocket error response
    instead of letting it fall through to HA's generic handling."""

    @wraps(handler)
    async def wrapper(
        hass: HomeAssistant,
        connection: websocket_api.ActiveConnection,
        msg: dict,
    ) -> None:
        try:
            await handler(hass, connection, msg)
        except ValueError as err:
            code = "invalid_request"

            for exc_type, mapped_code in _ERROR_CODES.items():
                if isinstance(err, exc_type):
                    code = mapped_code
                    break

            connection.send_error(msg["id"], code, str(err))

    return wrapper


@websocket_api.websocket_command(
    {
        vol.Required("type"): WS_TYPE_GET_LIST,
        vol.Required("entity_id"): cv.entity_id,
        vol.Optional("group_completed", default=False): bool,
    }
)
@websocket_api.async_response
@_handle_manager_errors
async def websocket_get_list(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg,
) -> None:
    """Return a Todo list."""

    manager = get_manager(hass)
    metadata_store = get_metadata_store(hass)

    todo_list = await manager.get_list(
        msg["entity_id"],
        group_completed=msg["group_completed"],
    )

    link = await metadata_store.get_link(msg["entity_id"])

    payload = todo_list.to_dict()
    # Status only - which link_id (if any) this list belongs to, for the
    # card's read-only badge. Broker credentials never travel this path;
    # they live only in the options flow, server-side (see
    # config_flow.py).
    payload["link_id"] = link["link_id"] if link else None

    connection.send_result(
        msg["id"],
        payload,
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): WS_TYPE_MOVE_ITEM,
        vol.Required("entity_id"): cv.entity_id,
        vol.Required("child_id"): str,
        vol.Required("reference_id"): str,
        vol.Required("placement"): vol.In(["before", "after", "inside"]),
    }
)
@websocket_api.async_response
@_handle_manager_errors
async def websocket_move_item(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg,
) -> None:
    """Move an item before, after, or inside another item."""

    manager = get_manager(hass)

    await manager.move_item(
        entity_id=msg["entity_id"],
        child_id=msg["child_id"],
        reference_id=msg["reference_id"],
        placement=msg["placement"],
    )

    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {
        vol.Required("type"): WS_TYPE_TRANSFER_ITEM,
        vol.Required("source_entity_id"): cv.entity_id,
        vol.Required("item_id"): str,
        vol.Required("target_entity_id"): cv.entity_id,
        # Omitted (rather than required) when the target entity has no
        # items at all to position relative to - dragging into a wholly
        # empty list. See TodoManager.transfer_item()'s own doc comment.
        vol.Optional("reference_id"): str,
        vol.Required("placement"): vol.In(["before", "after", "inside"]),
    }
)
@websocket_api.async_response
@_handle_manager_errors
async def websocket_transfer_item(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg,
) -> None:
    """Move an item (and its subtree) from one todo.* entity to another."""

    manager = get_manager(hass)

    new_id = await manager.transfer_item(
        source_entity_id=msg["source_entity_id"],
        item_id=msg["item_id"],
        target_entity_id=msg["target_entity_id"],
        reference_id=msg.get("reference_id"),
        placement=msg["placement"],
    )

    connection.send_result(msg["id"], {"id": new_id})


@websocket_api.websocket_command(
    {
        vol.Required("type"): WS_TYPE_SET_COMPLETED,
        vol.Required("entity_id"): cv.entity_id,
        vol.Required("item_id"): str,
        vol.Required("completed"): bool,
        vol.Optional("reposition", default=False): bool,
    }
)
@websocket_api.async_response
@_handle_manager_errors
async def websocket_set_completed(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg,
) -> None:
    """Set an item's completion, cascading to its descendants."""

    manager = get_manager(hass)

    changed = await manager.set_completed(
        entity_id=msg["entity_id"],
        item_id=msg["item_id"],
        completed=msg["completed"],
        reposition=msg["reposition"],
    )

    connection.send_result(msg["id"], {"changed": changed})


@websocket_api.websocket_command(
    {
        vol.Required("type"): WS_TYPE_RESTORE_COMPLETED,
        vol.Required("entity_id"): cv.entity_id,
        vol.Required("changes"): [
            {
                vol.Required("id"): str,
                vol.Required("completed"): bool,
            }
        ],
    }
)
@websocket_api.async_response
@_handle_manager_errors
async def websocket_restore_completed(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg,
) -> None:
    """Undo a completion cascade by writing back exact prior states."""

    manager = get_manager(hass)

    await manager.restore_completed(
        entity_id=msg["entity_id"],
        changes=msg["changes"],
    )

    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {
        vol.Required("type"): WS_TYPE_CLEAR_COMPLETED,
        vol.Required("entity_id"): cv.entity_id,
    }
)
@websocket_api.async_response
@_handle_manager_errors
async def websocket_clear_completed(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg,
) -> None:
    """Remove every completed top-level item (and its descendants)."""

    manager = get_manager(hass)

    removed = await manager.clear_completed(
        entity_id=msg["entity_id"],
    )

    connection.send_result(msg["id"], {"removed": removed})


@websocket_api.websocket_command(
    {
        vol.Required("type"): WS_TYPE_CLEAR_ALL,
        vol.Required("entity_id"): cv.entity_id,
    }
)
@websocket_api.async_response
@_handle_manager_errors
async def websocket_clear_all(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg,
) -> None:
    """Remove every item in the list - active or completed, parents and
    children alike."""

    manager = get_manager(hass)

    removed = await manager.clear_all(
        entity_id=msg["entity_id"],
    )

    connection.send_result(msg["id"], {"removed": removed})


@websocket_api.websocket_command(
    {
        vol.Required("type"): WS_TYPE_SAVE_LIST,
        vol.Required("entity_id"): cv.entity_id,
        vol.Required("name"): str,
        vol.Optional("persist_states", default=False): bool,
    }
)
@websocket_api.async_response
@_handle_manager_errors
async def websocket_save_list(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg,
) -> None:
    """Save a named snapshot of the list."""

    manager = get_manager(hass)

    await manager.save_list(
        entity_id=msg["entity_id"],
        name=msg["name"],
        persist_states=msg["persist_states"],
    )

    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {
        vol.Required("type"): WS_TYPE_LOAD_LIST,
        vol.Required("entity_id"): cv.entity_id,
        vol.Required("name"): str,
        vol.Optional("mode", default="merge"): vol.In(["replace", "merge", "full_merge"]),
    }
)
@websocket_api.async_response
@_handle_manager_errors
async def websocket_load_list(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg,
) -> None:
    """Load a named snapshot back onto the list."""

    manager = get_manager(hass)

    await manager.load_list(
        entity_id=msg["entity_id"],
        name=msg["name"],
        mode=msg["mode"],
    )

    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {
        vol.Required("type"): WS_TYPE_LIST_SAVED,
    }
)
@websocket_api.async_response
@_handle_manager_errors
async def websocket_list_saved(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg,
) -> None:
    """Return the names of every saved snapshot, across all entities."""

    manager = get_manager(hass)

    names = await manager.list_saved()

    connection.send_result(msg["id"], {"names": names})


@websocket_api.websocket_command(
    {
        vol.Required("type"): WS_TYPE_DELETE_SAVED_LIST,
        vol.Required("name"): str,
    }
)
@websocket_api.async_response
@_handle_manager_errors
async def websocket_delete_saved_list(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg,
) -> None:
    """Delete a saved snapshot by name."""

    manager = get_manager(hass)

    await manager.delete_saved(name=msg["name"])

    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {
        vol.Required("type"): WS_TYPE_CREATE_ITEM,
        vol.Required("entity_id"): cv.entity_id,
        vol.Required("title"): str,
        vol.Optional("description"): str,
        vol.Optional("due_date"): str,
        vol.Optional("due_datetime"): str,
        vol.Optional("quantity"): str,
        vol.Optional("tags"): [str],
        vol.Optional("trigger_on_due"): bool,
        vol.Optional("reference_id"): str,
        vol.Optional("placement"): vol.In(["before", "after", "inside"]),
        vol.Optional("pin_type"): vol.In(["category", "person"]),
    }
)
@websocket_api.async_response
@_handle_manager_errors
async def websocket_create_item(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg,
) -> None:
    """Create an item, including overlay-only fields like quantity -
    optionally positioned relative to an existing item (reference_id +
    placement, same semantics as move_item) rather than wherever the
    native adapter's own add_item happens to put it."""

    manager = get_manager(hass)

    item_id = await manager.create_item(
        entity_id=msg["entity_id"],
        title=msg["title"],
        description=msg.get("description"),
        due_date=msg.get("due_date"),
        due_datetime=msg.get("due_datetime"),
        quantity=msg.get("quantity"),
        tags=msg.get("tags"),
        trigger_on_due=msg.get("trigger_on_due", False),
        reference_id=msg.get("reference_id"),
        placement=msg.get("placement"),
        pin_type=msg.get("pin_type"),
    )

    connection.send_result(msg["id"], {"id": item_id})


@websocket_api.websocket_command(
    {
        vol.Required("type"): WS_TYPE_UPDATE_ITEM,
        vol.Required("entity_id"): cv.entity_id,
        vol.Required("item_id"): str,
        vol.Optional("title"): str,
        vol.Optional("description"): str,
        vol.Optional("due_date"): str,
        vol.Optional("due_datetime"): str,
    }
)
@websocket_api.async_response
@_handle_manager_errors
async def websocket_update_item(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg,
) -> None:
    """Update an item's native fields (title/description/due)."""

    manager = get_manager(hass)

    await manager.update_item(
        entity_id=msg["entity_id"],
        item_id=msg["item_id"],
        title=msg.get("title"),
        description=msg.get("description"),
        due_date=msg.get("due_date"),
        due_datetime=msg.get("due_datetime"),
    )

    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {
        vol.Required("type"): WS_TYPE_DELETE_ITEM,
        vol.Required("entity_id"): cv.entity_id,
        vol.Required("item_id"): str,
    }
)
@websocket_api.async_response
@_handle_manager_errors
async def websocket_delete_item(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg,
) -> None:
    """Delete a single item."""

    manager = get_manager(hass)

    await manager.delete_item(
        entity_id=msg["entity_id"],
        item_id=msg["item_id"],
    )

    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {
        vol.Required("type"): WS_TYPE_SET_QUANTITY,
        vol.Required("entity_id"): cv.entity_id,
        vol.Required("item_id"): str,
        vol.Optional("quantity"): str,
    }
)
@websocket_api.async_response
@_handle_manager_errors
async def websocket_set_quantity(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg,
) -> None:
    """Set (or clear) an item's quantity."""

    manager = get_manager(hass)

    await manager.set_quantity(
        entity_id=msg["entity_id"],
        item_id=msg["item_id"],
        quantity=msg.get("quantity"),
    )

    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {
        vol.Required("type"): WS_TYPE_SET_PIN_TYPE,
        vol.Required("entity_id"): cv.entity_id,
        vol.Required("item_id"): str,
        vol.Optional("pin_type"): vol.In(["category", "person"]),
    }
)
@websocket_api.async_response
@_handle_manager_errors
async def websocket_set_pin_type(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg,
) -> None:
    """Set (or clear) an item's pin type."""

    manager = get_manager(hass)

    await manager.set_pin_type(
        entity_id=msg["entity_id"],
        item_id=msg["item_id"],
        pin_type=msg.get("pin_type"),
    )

    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {
        vol.Required("type"): WS_TYPE_SET_TAGS,
        vol.Required("entity_id"): cv.entity_id,
        vol.Required("item_id"): str,
        vol.Required("tags"): [str],
    }
)
@websocket_api.async_response
@_handle_manager_errors
async def websocket_set_tags(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg,
) -> None:
    """Replace an item's full tag list."""

    manager = get_manager(hass)

    await manager.set_tags(
        entity_id=msg["entity_id"],
        item_id=msg["item_id"],
        tags=msg["tags"],
    )

    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {
        vol.Required("type"): WS_TYPE_ADD_TAG,
        vol.Required("entity_id"): cv.entity_id,
        vol.Required("item"): str,
        vol.Required("tag"): str,
    }
)
@websocket_api.async_response
@_handle_manager_errors
async def websocket_add_tag(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg,
) -> None:
    """Add a tag to an item, identified by uid or title."""

    manager = get_manager(hass)

    await manager.add_tag(
        entity_id=msg["entity_id"],
        item=msg["item"],
        tag=msg["tag"],
    )

    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {
        vol.Required("type"): WS_TYPE_REMOVE_TAG,
        vol.Required("entity_id"): cv.entity_id,
        vol.Required("item"): str,
        vol.Required("tag"): str,
    }
)
@websocket_api.async_response
@_handle_manager_errors
async def websocket_remove_tag(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg,
) -> None:
    """Remove a tag from an item, identified by uid or title."""

    manager = get_manager(hass)

    await manager.remove_tag(
        entity_id=msg["entity_id"],
        item=msg["item"],
        tag=msg["tag"],
    )

    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {
        vol.Required("type"): WS_TYPE_SET_TRIGGER_ON_DUE,
        vol.Required("entity_id"): cv.entity_id,
        vol.Required("item_id"): str,
        vol.Required("enabled"): bool,
    }
)
@websocket_api.async_response
@_handle_manager_errors
async def websocket_set_trigger_on_due(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg,
) -> None:
    """Enable or disable the "due" trigger event for an item."""

    manager = get_manager(hass)

    await manager.set_trigger_on_due(
        entity_id=msg["entity_id"],
        item_id=msg["item_id"],
        enabled=msg["enabled"],
    )

    connection.send_result(msg["id"])


def async_register_websocket(hass: HomeAssistant) -> None:
    for handler in (
        websocket_get_list,
        websocket_move_item,
        websocket_transfer_item,
        websocket_set_completed,
        websocket_restore_completed,
        websocket_clear_completed,
        websocket_clear_all,
        websocket_save_list,
        websocket_load_list,
        websocket_list_saved,
        websocket_delete_saved_list,
        websocket_create_item,
        websocket_update_item,
        websocket_delete_item,
        websocket_set_quantity,
        websocket_set_pin_type,
        websocket_set_tags,
        websocket_add_tag,
        websocket_remove_tag,
        websocket_set_trigger_on_due,
    ):
        websocket_api.async_register_command(hass, handler)
