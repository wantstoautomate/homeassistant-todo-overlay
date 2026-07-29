from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import DOMAIN
from .due_scheduler import DueScheduler
from .link_sync import LinkSyncManager
from .manager import TodoManager
from .metadata_store import MetadataStore


@dataclass
class TodoOverlayData:
    """Everything async_setup_entry() builds that async_unload_entry() and
    the websocket/service handlers need back."""

    manager: TodoManager
    metadata_store: MetadataStore
    due_scheduler: DueScheduler
    unsub_entity_registry: Callable[[], None]
    # None unless an MQTT broker is configured for linked lists (see
    # config_flow.py's options flow) - linking services no-op with a
    # clear error if this is unset rather than failing obscurely.
    link_sync: LinkSyncManager | None = None


TodoOverlayConfigEntry = ConfigEntry[TodoOverlayData]


def get_manager(hass: HomeAssistant) -> TodoManager:
    """Look up the running integration's TodoManager.

    Websocket commands and services only ever receive `hass`, never the
    ConfigEntry itself - and since this integration declares
    single_config_entry (see manifest.json), there's always exactly one
    to find once setup has completed.
    """

    entry = hass.config_entries.async_entries(DOMAIN)[0]
    return entry.runtime_data.manager


def get_metadata_store(hass: HomeAssistant) -> MetadataStore:
    entry = hass.config_entries.async_entries(DOMAIN)[0]
    return entry.runtime_data.metadata_store


def get_link_sync(hass: HomeAssistant) -> LinkSyncManager | None:
    """None unless an MQTT broker is configured - see TodoOverlayData."""

    entry = hass.config_entries.async_entries(DOMAIN)[0]
    return entry.runtime_data.link_sync
