import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv

from .const import DATA_MANAGER


@websocket_api.websocket_command(
    {
        vol.Required("type"): "todo_overlay/get_list",
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

    manager = hass.data[DATA_MANAGER]

    todo_list = await manager.get_list(
        msg["entity_id"],
    )

    connection.send_result(
        msg["id"],
        todo_list.to_dict(),
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): "todo_overlay/set_parent",
        vol.Required("entity_id"): cv.entity_id,
        vol.Required("child_id"): str,
        vol.Optional("parent_id"): vol.Any(str, None),
    }
)
@websocket_api.async_response
async def websocket_set_parent(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg,
) -> None:
    """Set the parent of a todo item."""

    manager = hass.data[DATA_MANAGER]

    await manager.set_parent(
        entity_id=msg["entity_id"],
        child_id=msg["child_id"],
        parent_id=msg.get("parent_id"),
    )

    connection.send_result(msg["id"])


def async_register_websocket(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(
        hass,
        websocket_get_list,
    )

    websocket_api.async_register_command(
        hass,
        websocket_set_parent,
    )
