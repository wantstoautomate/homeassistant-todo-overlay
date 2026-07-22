from pathlib import Path

from homeassistant.components.http import StaticPathConfig
from homeassistant.components.lovelace.const import CONF_RESOURCE_TYPE_WS, LOVELACE_DATA
from homeassistant.const import CONF_ID, CONF_URL, EVENT_HOMEASSISTANT_STARTED
from homeassistant.core import CoreState, HomeAssistant
from homeassistant.loader import async_get_integration

from .const import DATA_MANAGER, DOMAIN
from .ha_adapter import HomeAssistantTodoProvider
from .manager import TodoManager
from .metadata_store import MetadataStore
from .services import async_register_services
from .websocket import async_register_websocket

FRONTEND_URL_PATH = "/todo_overlay_static"
FRONTEND_DIST = Path(__file__).parent / "frontend_dist"
CARD_FILENAME = "todo-overlay.js"


async def async_setup(hass: HomeAssistant, config) -> bool:
    """Set up Todo Overlay."""

    manager = TodoManager(
        adapter=HomeAssistantTodoProvider(hass),
        metadata_store=MetadataStore(hass),
    )

    hass.data.setdefault(DOMAIN, {})[DATA_MANAGER] = manager

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

    return True


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
