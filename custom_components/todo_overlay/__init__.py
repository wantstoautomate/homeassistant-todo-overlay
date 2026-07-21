from homeassistant.core import HomeAssistant

from .const import DATA_MANAGER
from .ha_adapter import HomeAssistantTodoProvider
from .manager import TodoManager
from .metadata_store import MetadataStore
from .websocket import async_register_websocket


async def async_setup(hass: HomeAssistant, config) -> bool:
    """Set up Todo Overlay."""

    manager = TodoManager(
        adapter=HomeAssistantTodoProvider(hass),
        metadata_store=MetadataStore(hass),
    )

    hass.data[DATA_MANAGER] = manager

    async_register_websocket(hass)

    return True
