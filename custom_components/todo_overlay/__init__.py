import logging
from pathlib import Path

from homeassistant.components.http import StaticPathConfig
from homeassistant.components.lovelace.const import CONF_RESOURCE_TYPE_WS, LOVELACE_DATA
from homeassistant.config_entries import SOURCE_IMPORT
from homeassistant.const import CONF_ID, CONF_URL, EVENT_HOMEASSISTANT_STARTED, Platform
from homeassistant.core import CoreState, Event, HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.typing import ConfigType
from homeassistant.loader import async_get_integration

from .const import (
    CONF_ITEM_LINK_DEFAULT_ENABLED,
    CONF_ITEM_LINK_DEFAULT_TARGET_ITEM_ID,
    CONF_MQTT_HOST,
    CONF_MQTT_PASSWORD,
    CONF_MQTT_PORT,
    CONF_MQTT_TLS,
    CONF_MQTT_TRANSPORT,
    CONF_MQTT_USERNAME,
    CONF_MQTT_WS_PATH,
    DOMAIN,
)
from .due_scheduler import DueScheduler
from .ha_adapter import HomeAssistantTodoProvider
from .item_links import ItemLinkManager
from .link_sync import LinkSyncManager
from .manager import TodoManager
from .metadata_store import MetadataStore
from .mqtt_link import PahoMqttTransport
from .runtime_data import TodoOverlayConfigEntry, TodoOverlayData
from .sensor import OpenItemsSensorRegistry
from .services import async_register_services
from .websocket import async_register_websocket

_LOGGER = logging.getLogger(__name__)

FRONTEND_URL_PATH = "/todo_overlay_static"
FRONTEND_DIST = Path(__file__).parent / "frontend_dist"
CARD_FILENAME = "todo-overlay.js"

TODO_ENTITY_PREFIX = "todo."

PLATFORMS = [Platform.SENSOR]

# Allows a bare `todo_overlay:` YAML key (for the one-time migration below)
# but rejects any options under it - not config_entry_only_config_schema,
# since that forbids the key's presence entirely rather than just its
# contents.
CONFIG_SCHEMA = cv.empty_config_schema(DOMAIN)


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


async def async_setup_entry(hass: HomeAssistant, entry: TodoOverlayConfigEntry) -> bool:
    """Set up Todo Overlay from a config entry."""

    metadata_store = MetadataStore(hass)

    manager = TodoManager(
        adapter=HomeAssistantTodoProvider(hass),
        metadata_store=metadata_store,
        hass=hass,
    )

    due_scheduler = DueScheduler(hass, manager)
    await due_scheduler.async_start()

    open_items_registry = OpenItemsSensorRegistry(hass)

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
        await _async_handle_entity_registry_updated(
            metadata_store, due_scheduler, open_items_registry, event,
        )

    unsub_entity_registry = hass.bus.async_listen(
        er.EVENT_ENTITY_REGISTRY_UPDATED, _handle_entity_registry_updated,
    )

    link_sync = await _async_setup_link_sync(hass, entry, manager, metadata_store)

    item_links = ItemLinkManager(
        hass,
        manager,
        metadata_store,
        HomeAssistantTodoProvider(hass),
        default_enabled=entry.options.get(CONF_ITEM_LINK_DEFAULT_ENABLED, False),
        default_target_item_id=entry.options.get(CONF_ITEM_LINK_DEFAULT_TARGET_ITEM_ID),
    )
    item_links.async_setup()
    manager.set_item_link_hook(item_links.link_item)

    entry.runtime_data = TodoOverlayData(
        manager=manager,
        metadata_store=metadata_store,
        due_scheduler=due_scheduler,
        open_items_registry=open_items_registry,
        unsub_entity_registry=unsub_entity_registry,
        item_links=item_links,
        link_sync=link_sync,
    )

    # Must come after entry.runtime_data is set - the sensor platform's
    # own async_setup_entry() reads open_items_registry back off it, and
    # each sensor's first refresh calls get_manager(hass), which also
    # depends on runtime_data already being in place.
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    return True


async def async_unload_entry(hass: HomeAssistant, entry: TodoOverlayConfigEntry) -> bool:
    """Unload a config entry."""

    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)

    # Defensive: async_setup_entry() can still fail before ever reaching
    # entry.runtime_data = ... (a genuinely unexpected error - an MQTT
    # broker connectivity failure specifically can't cause this anymore,
    # see _async_setup_link_sync's own docstring) - HA can call unload
    # as part of retrying that failed setup, and this must not compound
    # the outage with a second AttributeError of its own.
    data = getattr(entry, "runtime_data", None)

    if data is None:
        return unloaded

    data.due_scheduler.async_stop()
    data.unsub_entity_registry()
    data.item_links.async_shutdown()

    if data.link_sync is not None:
        await data.link_sync.async_shutdown()

    return unloaded


async def _async_setup_link_sync(
    hass: HomeAssistant,
    entry: TodoOverlayConfigEntry,
    manager: TodoManager,
    metadata_store: MetadataStore,
) -> LinkSyncManager | None:
    """Build the LinkSyncManager for a configured MQTT broker - None (no-op)
    unless one has been set up via the options flow (see config_flow.py).

    The actual connect (link_sync.async_setup(), which subscribes and
    immediately starts receiving whatever's already retained/queued on
    the broker) is deferred until Home Assistant has finished starting,
    same reasoning - and same pattern - as due_scheduler.py's own
    deferral: HA doesn't guarantee integration setup order, so a
    retained snapshot message could otherwise get applied before the
    todo integration actually providing this entity has even registered
    its own services yet. Live-reproduced: exactly that race, once,
    right after a restart - "Action todo.update_item not found" - one
    incoming message silently lost (self-healing on the next change
    either side publishes, but not immediate, and previously invisible
    beyond a bare, context-free "Task exception was never retrieved" -
    see _create_tracked_task in link_sync.py for the other half of
    that fix).

    Also where a broker that's unreachable at connect time (a network
    blip, broker restart, DNS hiccup) is caught: live-reproduced
    production outage before this was deferred - PahoMqttTransport.
    async_connect() makes a blocking, synchronous connect() call (see
    mqtt_link.py's own comment), and unguarded, that exception used to
    propagate out of async_setup_entry() BEFORE entry.runtime_data was
    ever assigned - every websocket command/service was already
    registered by that point, so get_manager() had nothing to return
    and EVERYTHING failed with a bare AttributeError, not just linked
    lists. Deferred or not, the same failure mode is possible, so it's
    still caught here - logged, link_sync's own connection left
    unestablished (get_link_sync() still returns it: configured is a
    different question from currently connected), rather than ever
    letting a broker problem cascade into the rest of the integration
    again.
    """

    if not entry.options.get(CONF_MQTT_HOST):
        return None

    instance_id = await metadata_store.get_instance_id()

    transport = PahoMqttTransport(
        hass,
        host=entry.options[CONF_MQTT_HOST],
        port=entry.options.get(CONF_MQTT_PORT, 8883),
        username=entry.options.get(CONF_MQTT_USERNAME) or None,
        password=entry.options.get(CONF_MQTT_PASSWORD) or None,
        use_tls=entry.options.get(CONF_MQTT_TLS, True),
        client_id=f"todo_overlay-{instance_id}",
        transport=entry.options.get(CONF_MQTT_TRANSPORT, "tcp"),
        ws_path=entry.options.get(CONF_MQTT_WS_PATH, "/mqtt"),
    )

    link_sync = LinkSyncManager(
        hass, manager, metadata_store, HomeAssistantTodoProvider(hass), transport,
    )

    async def _connect(_event=None) -> None:
        try:
            await link_sync.async_setup()
        except Exception:  # noqa: BLE001 - intentionally broad, see docstring above
            _LOGGER.exception(
                "Failed to connect to the configured MQTT broker - linked "
                "lists won't sync until this entry is reloaded (Settings -> "
                "Devices & Services -> Todo Overlay -> reload), but every "
                "other feature works normally regardless."
            )

    if hass.state == CoreState.running:
        await _connect()
    else:
        hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STARTED, _connect)

    return link_sync


async def _async_handle_entity_registry_updated(
    metadata_store: MetadataStore,
    due_scheduler: DueScheduler,
    open_items_registry: OpenItemsSensorRegistry,
    event: Event,
) -> None:
    """Keep stored metadata, pending due-schedules, and open-items sensors
    in sync with the entity registry.

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
        await open_items_registry.remove_entity(entity_id)
    elif data["action"] == "create":
        due_scheduler.subscribe_entity(entity_id)
        await due_scheduler.reconcile_entity(entity_id)
        open_items_registry.add_entity(entity_id)
    elif data["action"] == "update":
        old_entity_id = data.get("old_entity_id")

        if old_entity_id and old_entity_id != entity_id:
            await metadata_store.rename_entity(old_entity_id, entity_id)
            due_scheduler.cancel_entity(old_entity_id)
            due_scheduler.subscribe_entity(entity_id)
            await due_scheduler.reconcile_entity(entity_id)
            await open_items_registry.remove_entity(old_entity_id)
            open_items_registry.add_entity(entity_id)


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
