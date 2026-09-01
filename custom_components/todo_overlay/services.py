import uuid

import voluptuous as vol

from homeassistant.core import HomeAssistant, ServiceCall, SupportsResponse
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv

from .const import (
    ATTR_COMPLETED,
    ATTR_DELETE_PROTECTED,
    ATTR_DESCRIPTION,
    ATTR_DUE_AFTER,
    ATTR_DUE_BEFORE,
    ATTR_DUE_DATE,
    ATTR_DUE_DATETIME,
    ATTR_ENABLED,
    ATTR_HAS_DUE_DATE,
    ATTR_HAS_QUANTITY,
    ATTR_INCLUDE_ANCESTORS,
    ATTR_INCLUDE_CHILDREN,
    ATTR_ITEM,
    ATTR_ITEMS,
    ATTR_LIMIT,
    ATTR_LINK_ID,
    ATTR_LINKED,
    ATTR_MODE,
    ATTR_NAME,
    ATTR_OVERDUE,
    ATTR_PARENT_ID,
    ATTR_PARENT_TITLE,
    ATTR_PERSIST_STATES,
    ATTR_PIN_TYPE,
    ATTR_QUANTITY,
    ATTR_TAG,
    ATTR_TAGS,
    ATTR_TAGS_MODE,
    ATTR_TARGET_ITEM,
    ATTR_TITLE,
    ATTR_TOP_LEVEL_ONLY,
    ATTR_TRIGGER_ON_DUE,
    ATTR_UNDER_ID,
    ATTR_UNDER_TITLE,
    ATTR_WEEKDAY,
    DOMAIN,
    LINK_ID_PATTERN,
    SERVICE_ADD_TAG,
    SERVICE_CREATE_ITEM,
    SERVICE_CREATE_LINK,
    SERVICE_DELETE_SAVED_LIST,
    SERVICE_JOIN_LINK,
    SERVICE_LOAD_LIST,
    SERVICE_QUERY_ITEMS,
    SERVICE_REMOVE_TAG,
    SERVICE_SAVE_LIST,
    SERVICE_SET_PIN_TYPE,
    SERVICE_SET_QUANTITY,
    SERVICE_SET_TRIGGER_ON_DUE,
    SERVICE_UNLINK,
)
from .manager_types import PIN_TYPES
from .runtime_data import get_link_sync, get_manager, get_metadata_store

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
        vol.Optional(ATTR_TARGET_ITEM): str,
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
        vol.Optional(ATTR_PIN_TYPE): vol.In(sorted(PIN_TYPES)),
        vol.Optional(ATTR_WEEKDAY): vol.All(int, vol.Range(min=0, max=6)),
    }
)

SET_QUANTITY_SCHEMA = vol.Schema(
    {
        vol.Required("entity_id"): cv.entity_id,
        vol.Required(ATTR_ITEM): str,
        vol.Optional(ATTR_QUANTITY): str,
    }
)

SET_PIN_TYPE_SCHEMA = vol.Schema(
    {
        vol.Required("entity_id"): cv.entity_id,
        vol.Required(ATTR_ITEM): str,
        vol.Optional(ATTR_PIN_TYPE): vol.In(sorted(PIN_TYPES)),
        vol.Optional(ATTR_WEEKDAY): vol.All(int, vol.Range(min=0, max=6)),
    }
)

SET_TRIGGER_ON_DUE_SCHEMA = vol.Schema(
    {
        vol.Required("entity_id"): cv.entity_id,
        vol.Required(ATTR_ITEM): str,
        vol.Required(ATTR_ENABLED): bool,
    }
)

CREATE_LINK_SCHEMA = vol.Schema(
    {
        vol.Required("entity_id"): cv.entity_id,
    }
)

JOIN_LINK_SCHEMA = vol.Schema(
    {
        vol.Required("entity_id"): cv.entity_id,
        vol.Required(ATTR_LINK_ID): vol.Match(LINK_ID_PATTERN),
    }
)

UNLINK_SCHEMA = vol.Schema(
    {
        vol.Required("entity_id"): cv.entity_id,
    }
)

# parent_id/parent_title/under_id/under_title are all alternative ways
# to say "id or title of the one item that decides scope" - see
# manager_query.py's own docstring for the actual id-or-title
# resolution and the parent-vs-under distinction. All four share one
# vol.Exclusive group so at most one is ever given: parent_id and
# parent_title are two spellings of the same thing (can't both be
# meaningfully given at once), and mixing a parent_* with an under_*
# would leave it ambiguous which scope actually wins.
_QUERY_SCOPE_GROUP = "query_items_scope"

QUERY_ITEMS_SCHEMA = vol.Schema(
    {
        vol.Required("entity_id"): cv.entity_id,
        vol.Optional(ATTR_COMPLETED): bool,
        vol.Optional(ATTR_TAG): str,
        vol.Optional(ATTR_TAGS): [str],
        vol.Optional(ATTR_TAGS_MODE, default="any"): vol.In(["any", "all"]),
        vol.Optional(ATTR_HAS_DUE_DATE): bool,
        vol.Optional(ATTR_OVERDUE): bool,
        # cv.date both validates (a malformed value raises a clean
        # vol.Invalid here rather than crashing deep inside
        # manager_query.py's own date.fromisoformat) and normalizes -
        # vol.Coerce(str) of the date object it returns is that same
        # ISO format, which is the plain string query_items() itself
        # expects. Plain `str` here (rather than vol.Coerce(str)) would
        # NOT do this coercion - voluptuous treats a bare type as an
        # instance check, not a callable to run the value through.
        vol.Optional(ATTR_DUE_BEFORE): vol.All(cv.date, vol.Coerce(str)),
        vol.Optional(ATTR_DUE_AFTER): vol.All(cv.date, vol.Coerce(str)),
        vol.Optional(ATTR_PIN_TYPE): vol.In([*sorted(PIN_TYPES), "none"]),
        vol.Optional(ATTR_WEEKDAY): vol.All(int, vol.Range(min=0, max=6)),
        vol.Optional(ATTR_DELETE_PROTECTED): bool,
        vol.Optional(ATTR_LINKED): bool,
        vol.Optional(ATTR_TRIGGER_ON_DUE): bool,
        vol.Optional(ATTR_HAS_QUANTITY): bool,
        vol.Exclusive(ATTR_PARENT_ID, _QUERY_SCOPE_GROUP): str,
        vol.Exclusive(ATTR_PARENT_TITLE, _QUERY_SCOPE_GROUP): str,
        vol.Exclusive(ATTR_UNDER_ID, _QUERY_SCOPE_GROUP): str,
        vol.Exclusive(ATTR_UNDER_TITLE, _QUERY_SCOPE_GROUP): str,
        vol.Optional(ATTR_TOP_LEVEL_ONLY, default=False): bool,
        vol.Optional(ATTR_INCLUDE_ANCESTORS, default=False): bool,
        vol.Optional(ATTR_INCLUDE_CHILDREN, default=False): bool,
        vol.Optional(ATTR_LIMIT): vol.All(int, vol.Range(min=1)),
    }
)


def async_register_services(hass: HomeAssistant) -> None:
    """Register save_list/load_list/delete_saved_list as HA services,
    so they can be triggered from automations and scripts."""

    async def handle_save_list(call: ServiceCall) -> None:
        manager = get_manager(hass)

        await manager.save_list(
            entity_id=call.data["entity_id"],
            name=call.data[ATTR_NAME],
            persist_states=call.data[ATTR_PERSIST_STATES],
        )

    async def handle_load_list(call: ServiceCall) -> None:
        manager = get_manager(hass)

        await manager.load_list(
            entity_id=call.data["entity_id"],
            name=call.data[ATTR_NAME],
            mode=call.data[ATTR_MODE],
            target_item=call.data.get(ATTR_TARGET_ITEM),
        )

    async def handle_delete_saved_list(call: ServiceCall) -> None:
        manager = get_manager(hass)

        await manager.delete_saved(
            name=call.data[ATTR_NAME],
        )

    async def handle_add_tag(call: ServiceCall) -> None:
        manager = get_manager(hass)

        await manager.add_tag(
            entity_id=call.data["entity_id"],
            item=call.data[ATTR_ITEM],
            tag=call.data[ATTR_TAG],
        )

    async def handle_remove_tag(call: ServiceCall) -> None:
        manager = get_manager(hass)

        await manager.remove_tag(
            entity_id=call.data["entity_id"],
            item=call.data[ATTR_ITEM],
            tag=call.data[ATTR_TAG],
        )

    async def handle_create_item(call: ServiceCall) -> None:
        manager = get_manager(hass)

        await manager.create_item(
            entity_id=call.data["entity_id"],
            title=call.data[ATTR_TITLE],
            description=call.data.get(ATTR_DESCRIPTION),
            due_date=call.data.get(ATTR_DUE_DATE),
            due_datetime=call.data.get(ATTR_DUE_DATETIME),
            quantity=call.data.get(ATTR_QUANTITY),
            tags=call.data.get(ATTR_TAGS),
            trigger_on_due=call.data[ATTR_TRIGGER_ON_DUE],
            pin_type=call.data.get(ATTR_PIN_TYPE),
            weekday=call.data.get(ATTR_WEEKDAY),
        )

    async def handle_set_quantity(call: ServiceCall) -> None:
        manager = get_manager(hass)

        await manager.set_quantity_by_item(
            entity_id=call.data["entity_id"],
            item=call.data[ATTR_ITEM],
            quantity=call.data.get(ATTR_QUANTITY),
        )

    async def handle_set_pin_type(call: ServiceCall) -> None:
        manager = get_manager(hass)

        await manager.set_pin_type_by_item(
            entity_id=call.data["entity_id"],
            item=call.data[ATTR_ITEM],
            pin_type=call.data.get(ATTR_PIN_TYPE),
            weekday=call.data.get(ATTR_WEEKDAY),
        )

    async def handle_set_trigger_on_due(call: ServiceCall) -> None:
        manager = get_manager(hass)

        await manager.set_trigger_on_due_by_item(
            entity_id=call.data["entity_id"],
            item=call.data[ATTR_ITEM],
            enabled=call.data[ATTR_ENABLED],
        )

    async def handle_query_items(call: ServiceCall) -> dict:
        manager = get_manager(hass)

        items = await manager.query_items(
            entity_id=call.data["entity_id"],
            completed=call.data.get(ATTR_COMPLETED),
            tag=call.data.get(ATTR_TAG),
            tags=call.data.get(ATTR_TAGS),
            tags_mode=call.data[ATTR_TAGS_MODE],
            has_due_date=call.data.get(ATTR_HAS_DUE_DATE),
            overdue=call.data.get(ATTR_OVERDUE),
            due_before=call.data.get(ATTR_DUE_BEFORE),
            due_after=call.data.get(ATTR_DUE_AFTER),
            pin_type=call.data.get(ATTR_PIN_TYPE),
            weekday=call.data.get(ATTR_WEEKDAY),
            delete_protected=call.data.get(ATTR_DELETE_PROTECTED),
            linked=call.data.get(ATTR_LINKED),
            trigger_on_due=call.data.get(ATTR_TRIGGER_ON_DUE),
            has_quantity=call.data.get(ATTR_HAS_QUANTITY),
            parent_id=call.data.get(ATTR_PARENT_ID),
            parent_title=call.data.get(ATTR_PARENT_TITLE),
            under_id=call.data.get(ATTR_UNDER_ID),
            under_title=call.data.get(ATTR_UNDER_TITLE),
            top_level_only=call.data[ATTR_TOP_LEVEL_ONLY],
            include_ancestors=call.data[ATTR_INCLUDE_ANCESTORS],
            include_children=call.data[ATTR_INCLUDE_CHILDREN],
            limit=call.data.get(ATTR_LIMIT),
        )

        return {ATTR_ITEMS: items}

    def _require_link_sync():
        link_sync = get_link_sync(hass)

        if link_sync is None:
            raise HomeAssistantError(
                "No MQTT broker is configured - set one up under this integration's "
                "options (Configure -> Configure MQTT link) before linking a list."
            )

        return link_sync

    async def handle_create_link(call: ServiceCall) -> dict:
        link_sync = _require_link_sync()
        metadata_store = get_metadata_store(hass)
        entity_id = call.data["entity_id"]

        link_id = uuid.uuid4().hex
        await metadata_store.set_link(entity_id, link_id)
        await link_sync.async_start_link(entity_id)

        return {ATTR_LINK_ID: link_id}

    async def handle_join_link(call: ServiceCall) -> None:
        link_sync = _require_link_sync()
        metadata_store = get_metadata_store(hass)
        entity_id = call.data["entity_id"]

        await metadata_store.set_link(entity_id, call.data[ATTR_LINK_ID])
        await link_sync.async_start_link(entity_id)

    async def handle_unlink(call: ServiceCall) -> None:
        metadata_store = get_metadata_store(hass)
        entity_id = call.data["entity_id"]

        link_sync = get_link_sync(hass)
        if link_sync is not None:
            await link_sync.async_stop_link(entity_id)

        await metadata_store.remove_link(entity_id)

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
        DOMAIN, SERVICE_SET_PIN_TYPE, handle_set_pin_type, schema=SET_PIN_TYPE_SCHEMA
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_SET_TRIGGER_ON_DUE,
        handle_set_trigger_on_due,
        schema=SET_TRIGGER_ON_DUE_SCHEMA,
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_CREATE_LINK,
        handle_create_link,
        schema=CREATE_LINK_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
    )
    hass.services.async_register(
        DOMAIN, SERVICE_JOIN_LINK, handle_join_link, schema=JOIN_LINK_SCHEMA,
    )
    hass.services.async_register(
        DOMAIN, SERVICE_UNLINK, handle_unlink, schema=UNLINK_SCHEMA,
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_QUERY_ITEMS,
        handle_query_items,
        schema=QUERY_ITEMS_SCHEMA,
        supports_response=SupportsResponse.ONLY,
    )
