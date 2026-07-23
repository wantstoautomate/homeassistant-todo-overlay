from pathlib import Path

from homeassistant.components.http import StaticPathConfig
from homeassistant.components.lovelace.const import CONF_RESOURCE_TYPE_WS, LOVELACE_DATA
from homeassistant.config_entries import SOURCE_IMPORT, ConfigEntry
from homeassistant.const import CONF_ID, CONF_URL, EVENT_HOMEASSISTANT_STARTED
from homeassistant.core import CoreState, Event, HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.typing import ConfigType
from homeassistant.loader import async_get_integration

from .const import DATA_MANAGER, DOMAIN
from .due_scheduler import DueScheduler
from .ha_adapter import HomeAssistantTodoProvider
from .manager import TodoManager
from .metadata_store import MetadataStore
from .services import async_register_services
from .websocket import async_register_websocket

FRONTEND_URL_PATH = "/todo_overlay_static"
FRONTEND_DIST = Path(__file__).parent / "frontend_dist"
CARD_FILENAME = "todo-overlay.js"

TODO_ENTITY_PREFIX = "todo."

# Internal hass.data keys alongside DATA_MANAGER - not part of the
# websocket/service surface, just what async_unload_entry() needs back.
_DATA_DUE_SCHEDULER = "due_scheduler"
_DATA_UNSUB_ENTITY_REGISTRY = "unsub_entity_registry"


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Legacy YAML entry point.

    Only used to migrate an existing `todo_overlay:` YAML config into a
    config entry automatically, so nothing breaks for anyone who already
    has it - new installs are added entirely through the UI (see
    config_flow.py), no YAML required.
    """

    if DOMAIN in config:
        hass.async_create_task(
            hass.config_entries.flow.async_init(
                DOMAIN, context={"source": SOURCE_IMPORT},
            )
        )

    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Todo Overlay from a config entry."""

    metadata_store = MetadataStore(hass)

    manager = TodoManager(
        adapter=HomeAssistantTodoProvider(hass),
        metadata_store=metadata_store,
        hass=hass,
    )

    domain_data = hass.data.setdefault(DOMAIN, {})
    domain_data[DATA_MANAGER] = manager

    due_scheduler = DueScheduler(hass, manager)
    await due_scheduler.async_start()
    domain_data[_DATA_DUE_SCHEDULER] = due_scheduler

    async_register_websocket(hass)
    async_register_services(hass)

    await hass.http.async_register_static_paths(
        [StaticPathConfig(FRONTEND_URL_PATH, str(FRONTEND_DIST), cache_headers=True)]
    )

    async def _register_lovelace_resource(_event=None) -> None:
        await _async_register_lovelace_resource(hass)

    if hass.state == CoreState.running:
        await _register_lovelace_resource()
    else:
        hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STARTED, _register_lovelace_resource)

    async def _handle_entity_registry_updated(event: Event) -> None:
        await _async_handle_entity_registry_updated(metadata_store, due_scheduler, event)

    domain_data[_DATA_UNSUB_ENTITY_REGISTRY] = hass.bus.async_listen(
        er.EVENT_ENTITY_REGISTRY_UPDATED, _handle_entity_registry_updated,
    )

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""

    domain_data = hass.data.pop(DOMAIN, {})

    due_scheduler: DueScheduler | None = domain_data.get(_DATA_DUE_SCHEDULER)

    if due_scheduler is not None:
        due_scheduler.async_stop()

    unsub_entity_registry = domain_data.get(_DATA_UNSUB_ENTITY_REGISTRY)

    if unsub_entity_registry is not None:
        unsub_entity_registry()

    return True


async def _async_handle_entity_registry_updated(
    metadata_store: MetadataStore,
    due_scheduler: DueScheduler,
    event: Event,
) -> None:
    """Keep stored metadata and pending due-schedules in sync with the
    entity registry.

    Nothing else in this integration ever notices an entity disappearing
    or being renamed outside of it - get_list() only cleans up metadata
    for individual items it can see are gone, which never runs again for
    an entity that no longer exists at all. Without this, a removed
    todo.* entity's whole positions/quantities/tags block - or, for a
    rename, everything under the old id - would sit in storage forever,
    and any due-schedule still pending under the old id would never fire
    (or, worse, fire against an id that no longer resolves to anything).
    """

    data = event.data
    entity_id = data["entity_id"]

    if not entity_id.startswith(TODO_ENTITY_PREFIX):
        return

    if data["action"] == "remove":
        await metadata_store.clear_entity(entity_id)
        due_scheduler.cancel_entity(entity_id)
    elif data["action"] == "create":
        due_scheduler.subscribe_entity(entity_id)
        await due_scheduler.reconcile_entity(entity_id)
    elif data["action"] == "update":
        old_entity_id = data.get("old_entity_id")

        if old_entity_id and old_entity_id != entity_id:
            await metadata_store.rename_entity(old_entity_id, entity_id)
            due_scheduler.cancel_entity(old_entity_id)
            due_scheduler.subscribe_entity(entity_id)
            await due_scheduler.reconcile_entity(entity_id)


async def _async_register_lovelace_resource(hass: HomeAssistant) -> None:
    """Register the card as a Lovelace resource, so the frontend loads it
    when a dashboard renders rather than racing HA's own boot on every page."""

    if LOVELACE_DATA not in hass.data:
        return

    resources = hass.data[LOVELACE_DATA].resources

    # async_items() doesn't itself guarantee the collection has loaded from
    # storage - without this, an empty read here would look like "no
    # existing resource" and create a duplicate entry on every restart.
    await resources.async_get_info()

    if not hasattr(resources, "async_create_item"):
        # YAML-mode dashboards manage resources themselves; nothing to register.
        return

    integration = await async_get_integration(hass, DOMAIN)
    url = f"{FRONTEND_URL_PATH}/{CARD_FILENAME}?v={integration.version}"

    existing = next(
        (
            item
            for item in resources.async_items()
            if item[CONF_URL].startswith(FRONTEND_URL_PATH)
        ),
        None,
    )

    if existing is None:
        await resources.async_create_item({CONF_RESOURCE_TYPE_WS: "module", CONF_URL: url})
    elif existing[CONF_URL] != url:
        await resources.async_update_item(
            existing[CONF_ID],
            {CONF_RESOURCE_TYPE_WS: "module", CONF_URL: url},
        )
