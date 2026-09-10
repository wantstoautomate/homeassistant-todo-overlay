"""Tests for runtime_data.py's own lookup helpers - specifically the
defensive path added after a live production outage: a config entry
whose async_setup_entry() never reached entry.runtime_data = ... (see
__init__.py's own comment on the MQTT-connect failure this was
reproduced from) used to make every websocket command and service fail
with a bare, uninformative AttributeError."""

import pytest
from homeassistant.exceptions import HomeAssistantError

from custom_components.todo_overlay.runtime_data import (
    get_item_links,
    get_link_sync,
    get_manager,
    get_metadata_store,
)

from fakes import FakeConfigEntries


class _BareEntry:
    """Stands in for a real ConfigEntry that never had runtime_data
    assigned - same shape a genuine setup failure leaves behind."""


class _BareConfigEntries:
    def __init__(self) -> None:
        self._entries = [_BareEntry()]

    def async_entries(self, domain: str):
        return self._entries


def make_hass(config_entries) -> object:
    return type("FakeHass", (), {"config_entries": config_entries})()


def test_get_manager_raises_a_clear_homeassistant_error_when_runtime_data_is_missing():
    hass = make_hass(_BareConfigEntries())

    with pytest.raises(HomeAssistantError, match="isn't fully set up"):
        get_manager(hass)


def test_get_metadata_store_raises_the_same_clear_error():
    hass = make_hass(_BareConfigEntries())

    with pytest.raises(HomeAssistantError, match="isn't fully set up"):
        get_metadata_store(hass)


def test_get_link_sync_raises_the_same_clear_error():
    hass = make_hass(_BareConfigEntries())

    with pytest.raises(HomeAssistantError, match="isn't fully set up"):
        get_link_sync(hass)


def test_get_item_links_raises_the_same_clear_error():
    hass = make_hass(_BareConfigEntries())

    with pytest.raises(HomeAssistantError, match="isn't fully set up"):
        get_item_links(hass)


def test_get_manager_still_works_normally_once_runtime_data_is_set():
    manager = object()
    hass = make_hass(FakeConfigEntries(manager))

    assert get_manager(hass) is manager


def test_get_link_sync_returns_none_when_no_broker_is_configured():
    hass = make_hass(FakeConfigEntries(manager=object(), link_sync=None))

    assert get_link_sync(hass) is None
