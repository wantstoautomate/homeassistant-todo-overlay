from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError

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


def _get_data(hass: HomeAssistant) -> TodoOverlayData:
    """Look up the running integration's own runtime_data.

    Websocket commands and services only ever receive `hass`, never the
    ConfigEntry itself - and since this integration declares
    single_config_entry (see manifest.json), there's always exactly one
    to find once setup has completed.

    A bare `entry.runtime_data` access here would raise an opaque
    AttributeError if setup never reached the point of assigning it -
    live-reproduced: a broker connectivity failure during MQTT link
    setup used to propagate straight out of async_setup_entry() before
    runtime_data was ever set, and every websocket command/service
    (already registered by that point) failed with nothing more
    informative than "Unknown error" in the UI. async_setup_entry()
    itself now catches that specific case, but this stays the one
    place every entry point ultimately funnels through, so any other
    not-yet-imagined setup failure still surfaces a clear, actionable
    message instead of a bare attribute error with no context.
    """

    entry = hass.config_entries.async_entries(DOMAIN)[0]
    data = getattr(entry, "runtime_data", None)

    if data is None:
        raise HomeAssistantError(
            "Todo Overlay isn't fully set up yet - check Settings -> System -> "
            "Logs for why (a network issue reaching a configured MQTT broker is "
            "the most common cause), then reload the integration."
        )

    return data


def get_manager(hass: HomeAssistant) -> TodoManager:
    return _get_data(hass).manager


def get_metadata_store(hass: HomeAssistant) -> MetadataStore:
    return _get_data(hass).metadata_store


def get_link_sync(hass: HomeAssistant) -> LinkSyncManager | None:
    """None unless an MQTT broker is configured - see TodoOverlayData."""

    return _get_data(hass).link_sync


def get_item_links(hass: HomeAssistant) -> ItemLinkManager:
    """Unlike link_sync above, always present - item links (see
    item_links.py) don't need an MQTT broker at all, since they never
    cross an instance boundary."""

    return _get_data(hass).item_links
