import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv

from .const import (
    DATA_MANAGER,
    DOMAIN,
    WS_TYPE_CLEAR_COMPLETED,
    WS_TYPE_GET_LIST,
    WS_TYPE_MOVE_ITEM,
    WS_TYPE_RESTORE_COMPLETED,
    WS_TYPE_SET_COMPLETED,
)


@websocket_api.websocket_command(
    {
        vol.Required("type"): WS_TYPE_GET_LIST,
        vol.Required("entity_id"): cv.entity_id,
    }
)
@websocket_api.async_response
async def websocket_get_list(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg,
) -> None:
    """Return a Todo list."""

    manager = hass.data[DOMAIN][DATA_MANAGER]

    todo_list = await manager.get_list(
        msg["entity_id"],
    )

    connection.send_result(
        msg["id"],
        todo_list.to_dict(),
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
async def websocket_move_item(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg,
) -> None:
    """Move an item before, after, or inside another item."""

    manager = hass.data[DOMAIN][DATA_MANAGER]

    try:
        await manager.move_item(
            entity_id=msg["entity_id"],
            child_id=msg["child_id"],
            reference_id=msg["reference_id"],
            placement=msg["placement"],
        )
    except ValueError as err:
        connection.send_error(msg["id"], "cycle_detected", str(err))
        return

    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {
        vol.Required("type"): WS_TYPE_SET_COMPLETED,
        vol.Required("entity_id"): cv.entity_id,
        vol.Required("item_id"): str,
        vol.Required("completed"): bool,
    }
)
@websocket_api.async_response
async def websocket_set_completed(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg,
) -> None:
    """Set an item's completion, cascading to its descendants."""

    manager = hass.data[DOMAIN][DATA_MANAGER]

    changed = await manager.set_completed(
        entity_id=msg["entity_id"],
        item_id=msg["item_id"],
        completed=msg["completed"],
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
async def websocket_restore_completed(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg,
) -> None:
    """Undo a completion cascade by writing back exact prior states."""

    manager = hass.data[DOMAIN][DATA_MANAGER]

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
async def websocket_clear_completed(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg,
) -> None:
    """Remove every completed top-level item (and its descendants)."""

    manager = hass.data[DOMAIN][DATA_MANAGER]

    removed = await manager.clear_completed(
        entity_id=msg["entity_id"],
    )

    connection.send_result(msg["id"], {"removed": removed})


def async_register_websocket(hass: HomeAssistant) -> None:
    for handler in (
        websocket_get_list,
        websocket_move_item,
        websocket_set_completed,
        websocket_restore_completed,
        websocket_clear_completed,
    ):
        websocket_api.async_register_command(hass, handler)
