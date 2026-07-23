import voluptuous as vol

from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers import config_validation as cv

from .const import (
    ATTR_DESCRIPTION,
    ATTR_DUE_DATE,
    ATTR_DUE_DATETIME,
    ATTR_ENABLED,
    ATTR_ITEM,
    ATTR_MODE,
    ATTR_NAME,
    ATTR_PERSIST_STATES,
    ATTR_QUANTITY,
    ATTR_TAG,
    ATTR_TAGS,
    ATTR_TITLE,
    ATTR_TRIGGER_ON_DUE,
    DATA_MANAGER,
    DOMAIN,
    SERVICE_ADD_TAG,
    SERVICE_CREATE_ITEM,
    SERVICE_DELETE_SAVED_LIST,
    SERVICE_LOAD_LIST,
    SERVICE_REMOVE_TAG,
    SERVICE_SAVE_LIST,
    SERVICE_SET_QUANTITY,
    SERVICE_SET_TRIGGER_ON_DUE,
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
        vol.Required(ATTR_NAME): str,
    }
)

ADD_OR_REMOVE_TAG_SCHEMA = vol.Schema(
    {
        vol.Required("entity_id"): cv.entity_id,
        vol.Required(ATTR_ITEM): str,
        vol.Required(ATTR_TAG): str,
    }
)

CREATE_ITEM_SCHEMA = vol.Schema(
    {
        vol.Required("entity_id"): cv.entity_id,
        vol.Required(ATTR_TITLE): str,
        vol.Optional(ATTR_DESCRIPTION): str,
        vol.Optional(ATTR_DUE_DATE): str,
        vol.Optional(ATTR_DUE_DATETIME): str,
        vol.Optional(ATTR_QUANTITY): str,
        vol.Optional(ATTR_TAGS): [str],
        vol.Optional(ATTR_TRIGGER_ON_DUE, default=False): bool,
    }
)

SET_QUANTITY_SCHEMA = vol.Schema(
    {
        vol.Required("entity_id"): cv.entity_id,
        vol.Required(ATTR_ITEM): str,
        vol.Optional(ATTR_QUANTITY): str,
    }
)

SET_TRIGGER_ON_DUE_SCHEMA = vol.Schema(
    {
        vol.Required("entity_id"): cv.entity_id,
        vol.Required(ATTR_ITEM): str,
        vol.Required(ATTR_ENABLED): bool,
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
            name=call.data[ATTR_NAME],
        )

    async def handle_add_tag(call: ServiceCall) -> None:
        manager = hass.data[DOMAIN][DATA_MANAGER]

        await manager.add_tag(
            entity_id=call.data["entity_id"],
            item=call.data[ATTR_ITEM],
            tag=call.data[ATTR_TAG],
        )

    async def handle_remove_tag(call: ServiceCall) -> None:
        manager = hass.data[DOMAIN][DATA_MANAGER]

        await manager.remove_tag(
            entity_id=call.data["entity_id"],
            item=call.data[ATTR_ITEM],
            tag=call.data[ATTR_TAG],
        )

    async def handle_create_item(call: ServiceCall) -> None:
        manager = hass.data[DOMAIN][DATA_MANAGER]

        await manager.create_item(
            entity_id=call.data["entity_id"],
            title=call.data[ATTR_TITLE],
            description=call.data.get(ATTR_DESCRIPTION),
            due_date=call.data.get(ATTR_DUE_DATE),
            due_datetime=call.data.get(ATTR_DUE_DATETIME),
            quantity=call.data.get(ATTR_QUANTITY),
            tags=call.data.get(ATTR_TAGS),
            trigger_on_due=call.data[ATTR_TRIGGER_ON_DUE],
        )

    async def handle_set_quantity(call: ServiceCall) -> None:
        manager = hass.data[DOMAIN][DATA_MANAGER]

        await manager.set_quantity_by_item(
            entity_id=call.data["entity_id"],
            item=call.data[ATTR_ITEM],
            quantity=call.data.get(ATTR_QUANTITY),
        )

    async def handle_set_trigger_on_due(call: ServiceCall) -> None:
        manager = hass.data[DOMAIN][DATA_MANAGER]

        await manager.set_trigger_on_due_by_item(
            entity_id=call.data["entity_id"],
            item=call.data[ATTR_ITEM],
            enabled=call.data[ATTR_ENABLED],
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
    hass.services.async_register(
        DOMAIN, SERVICE_ADD_TAG, handle_add_tag, schema=ADD_OR_REMOVE_TAG_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, SERVICE_REMOVE_TAG, handle_remove_tag, schema=ADD_OR_REMOVE_TAG_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, SERVICE_CREATE_ITEM, handle_create_item, schema=CREATE_ITEM_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, SERVICE_SET_QUANTITY, handle_set_quantity, schema=SET_QUANTITY_SCHEMA
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_SET_TRIGGER_ON_DUE,
        handle_set_trigger_on_due,
        schema=SET_TRIGGER_ON_DUE_SCHEMA,
    )
