from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import DOMAIN
from .due_scheduler import DueScheduler
from .manager import TodoManager


@dataclass
class TodoOverlayData:
    """Everything async_setup_entry() builds that async_unload_entry() and
    the websocket/service handlers need back."""

    manager: TodoManager
    due_scheduler: DueScheduler
    unsub_entity_registry: Callable[[], None]


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
