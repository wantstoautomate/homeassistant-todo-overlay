import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv

from .const import DATA_MANAGER, DOMAIN, WS_TYPE_GET_LIST, WS_TYPE_MOVE_ITEM


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


def async_register_websocket(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(
        hass,
        websocket_get_list,
    )

    websocket_api.async_register_command(
        hass,
        websocket_move_item,
    )
