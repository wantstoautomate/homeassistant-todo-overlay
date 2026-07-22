import voluptuous as vol

from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers import config_validation as cv

from .const import (
    ATTR_MODE,
    ATTR_NAME,
    ATTR_PERSIST_STATES,
    DATA_MANAGER,
    DOMAIN,
    SERVICE_DELETE_SAVED_LIST,
    SERVICE_LOAD_LIST,
    SERVICE_SAVE_LIST,
)

SAVE_LIST_SCHEMA = vol.Schema(
    {
        vol.Required("entity_id"): cv.entity_id,
        vol.Required(ATTR_NAME): str,
        vol.Optional(ATTR_PERSIST_STATES, default=False): bool,
    }
)

LOAD_LIST_SCHEMA = vol.Schema(
    {
        vol.Required("entity_id"): cv.entity_id,
        vol.Required(ATTR_NAME): str,
        vol.Optional(ATTR_MODE, default="merge"): vol.In(
            ["replace", "merge", "full_merge"]
        ),
    }
)

DELETE_SAVED_LIST_SCHEMA = vol.Schema(
    {
        vol.Required("entity_id"): cv.entity_id,
        vol.Required(ATTR_NAME): str,
    }
)


def async_register_services(hass: HomeAssistant) -> None:
    """Register save_list/load_list/delete_saved_list as HA services,
    so they can be triggered from automations and scripts."""

    async def handle_save_list(call: ServiceCall) -> None:
        manager = hass.data[DOMAIN][DATA_MANAGER]

        await manager.save_list(
            entity_id=call.data["entity_id"],
            name=call.data[ATTR_NAME],
            persist_states=call.data[ATTR_PERSIST_STATES],
        )

    async def handle_load_list(call: ServiceCall) -> None:
        manager = hass.data[DOMAIN][DATA_MANAGER]

        await manager.load_list(
            entity_id=call.data["entity_id"],
            name=call.data[ATTR_NAME],
            mode=call.data[ATTR_MODE],
        )

    async def handle_delete_saved_list(call: ServiceCall) -> None:
        manager = hass.data[DOMAIN][DATA_MANAGER]

        await manager.delete_saved(
            entity_id=call.data["entity_id"],
            name=call.data[ATTR_NAME],
        )

    hass.services.async_register(
        DOMAIN, SERVICE_SAVE_LIST, handle_save_list, schema=SAVE_LIST_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, SERVICE_LOAD_LIST, handle_load_list, schema=LOAD_LIST_SCHEMA
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_DELETE_SAVED_LIST,
        handle_delete_saved_list,
        schema=DELETE_SAVED_LIST_SCHEMA,
    )
