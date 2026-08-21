from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import DOMAIN
from .due_scheduler import DueScheduler
from .item_links import ItemLinkManager
from .link_sync import LinkSyncManager
from .manager import TodoManager
from .metadata_store import MetadataStore

if TYPE_CHECKING:
    # sensor.py imports get_manager() from this module - importing
    # OpenItemsSensorRegistry back at runtime would be circular. Safe
    # under TYPE_CHECKING only since `from __future__ import annotations`
    # (above) means this dataclass's field annotation is never evaluated
    # at runtime anyway.
    from .sensor import OpenItemsSensorRegistry


@dataclass
class TodoOverlayData:
    """Everything async_setup_entry() builds that async_unload_entry() and
    the websocket/service handlers need back."""

    manager: TodoManager
    metadata_store: MetadataStore
    due_scheduler: DueScheduler
    open_items_registry: OpenItemsSensorRegistry
    unsub_entity_registry: Callable[[], None]
    item_links: ItemLinkManager
    # None unless an MQTT broker is configured for linked lists (see
    # config_flow.py's options flow) - linking services no-op with a
    # clear error if this is unset rather than failing obscurely.
    # Deliberately last (the only field with a default) - a dataclass
    # can't have a required field after one with a default.
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


def get_item_links(hass: HomeAssistant) -> ItemLinkManager:
    """Unlike link_sync above, always present - item links (see
    item_links.py) don't need an MQTT broker at all, since they never
    cross an instance boundary."""

    entry = hass.config_entries.async_entries(DOMAIN)[0]
    return entry.runtime_data.item_links
