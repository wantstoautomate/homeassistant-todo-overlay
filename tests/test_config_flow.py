"""Tests for TodoOverlayConfigFlow: the user-confirmation step, the
legacy YAML import step, and single_config_entry's abort-on-duplicate
behavior.

Driven directly against the real homeassistant.config_entries.ConfigFlow
base class (imported as a library, same as the rest of this integration)
rather than a full pytest-homeassistant-custom-component harness - see
tests/fakes.py's module docstring for why that harness isn't used here
(a hard pytest-asyncio version conflict with this project's pinned
dependencies). Only the two hass.config_entries entry points the base
class's unique-id machinery actually touches (async_entry_for_domain_
unique_id, flow.async_progress_by_handler) are faked; everything else -
async_set_unique_id, _abort_if_unique_id_configured, async_show_form,
async_create_entry - is the real, already-HA-tested implementation.
"""

import pytest

from homeassistant.config_entries import SOURCE_USER
from homeassistant.data_entry_flow import AbortFlow, FlowResultType

from custom_components.todo_overlay.config_flow import (
    TodoOverlayConfigFlow,
    TodoOverlayOptionsFlow,
)
from custom_components.todo_overlay.const import (
    CONF_MQTT_HOST,
    CONF_MQTT_PORT,
    CONF_MQTT_TLS,
    DOMAIN,
)


class FakeConfigEntry:
    """Just enough of a real ConfigEntry for
    _abort_if_unique_id_configured()'s "already configured" path to read
    without erroring - it only ever checks .source here, since none of
    the update/reload branches apply to a bare abort check."""

    def __init__(self):
        self.source = SOURCE_USER


class FakeFlowProgress:

    def async_progress_by_handler(self, handler, include_uninitialized=False, match_context=None):
        return []


class FakeConfigEntries:

    def __init__(self):
        self.flow = FakeFlowProgress()
        self._entries_by_unique_id: dict[str, object] = {}

    def async_entry_for_domain_unique_id(self, domain: str, unique_id: str):
        return self._entries_by_unique_id.get(unique_id)


class FakeHass:

    def __init__(self):
        self.config_entries = FakeConfigEntries()


def make_flow(hass: FakeHass | None = None) -> TodoOverlayConfigFlow:
    flow = TodoOverlayConfigFlow()
    flow.hass = hass or FakeHass()
    flow.flow_id = "test-flow-id"
    flow.handler = DOMAIN
    flow.context = {}
    return flow


@pytest.mark.asyncio
async def test_async_step_user_shows_confirmation_form_first():
    flow = make_flow()

    result = await flow.async_step_user(None)

    assert result["type"] == FlowResultType.FORM
    assert result["step_id"] == "user"


@pytest.mark.asyncio
async def test_async_step_user_creates_entry_on_confirmation():
    flow = make_flow()

    result = await flow.async_step_user({})

    assert result["type"] == FlowResultType.CREATE_ENTRY
    assert result["title"] == "Todo Overlay"
    assert result["data"] == {}


@pytest.mark.asyncio
async def test_async_step_import_creates_entry_directly_without_confirmation():
    flow = make_flow()

    result = await flow.async_step_import({})

    assert result["type"] == FlowResultType.CREATE_ENTRY
    assert result["title"] == "Todo Overlay"


@pytest.mark.asyncio
async def test_async_step_user_aborts_if_already_configured():
    """single_config_entry semantics: a second attempt to set up this
    integration must abort rather than create a duplicate entry."""

    hass = FakeHass()
    hass.config_entries._entries_by_unique_id[DOMAIN] = FakeConfigEntry()

    flow = make_flow(hass)

    with pytest.raises(AbortFlow) as exc_info:
        await flow.async_step_user({})

    assert exc_info.value.reason == "already_configured"


@pytest.mark.asyncio
async def test_async_step_import_aborts_if_already_configured():
    hass = FakeHass()
    hass.config_entries._entries_by_unique_id[DOMAIN] = FakeConfigEntry()

    flow = make_flow(hass)

    with pytest.raises(AbortFlow) as exc_info:
        await flow.async_step_import({})

    assert exc_info.value.reason == "already_configured"


class FakeOptionsConfigEntry:

    def __init__(self, options: dict | None = None):
        self.options = options or {}


class FakeOptionsConfigEntries:

    def __init__(self, entry: FakeOptionsConfigEntry):
        self._entry = entry

    def async_get_known_entry(self, entry_id):
        return self._entry


class FakeOptionsHass:

    def __init__(self, entry: FakeOptionsConfigEntry):
        self.config_entries = FakeOptionsConfigEntries(entry)


def make_options_flow(options: dict | None = None) -> TodoOverlayOptionsFlow:
    entry = FakeOptionsConfigEntry(options)
    flow = TodoOverlayOptionsFlow()
    flow.hass = FakeOptionsHass(entry)
    flow.handler = "test-entry-id"
    flow.flow_id = "test-flow-id"
    return flow


@pytest.mark.asyncio
async def test_options_init_offers_only_configure_when_no_broker_set():
    flow = make_options_flow()

    result = await flow.async_step_init()

    assert result["type"] == FlowResultType.MENU
    assert result["menu_options"] == ["configure_broker"]


@pytest.mark.asyncio
async def test_options_init_also_offers_remove_when_broker_already_configured():
    flow = make_options_flow({CONF_MQTT_HOST: "broker.local"})

    result = await flow.async_step_init()

    assert result["menu_options"] == ["configure_broker", "remove_broker"]


@pytest.mark.asyncio
async def test_configure_broker_shows_a_form_first():
    flow = make_options_flow()

    result = await flow.async_step_configure_broker()

    assert result["type"] == FlowResultType.FORM
    assert result["step_id"] == "configure_broker"


@pytest.mark.asyncio
async def test_configure_broker_saves_submitted_options():
    flow = make_options_flow()

    result = await flow.async_step_configure_broker({
        CONF_MQTT_HOST: "broker.local",
        CONF_MQTT_PORT: 8883,
        CONF_MQTT_TLS: True,
    })

    assert result["type"] == FlowResultType.CREATE_ENTRY
    assert result["data"][CONF_MQTT_HOST] == "broker.local"
    assert result["data"][CONF_MQTT_PORT] == 8883


@pytest.mark.asyncio
async def test_remove_broker_clears_all_broker_options():
    flow = make_options_flow({
        CONF_MQTT_HOST: "broker.local",
        CONF_MQTT_PORT: 8883,
        CONF_MQTT_TLS: True,
    })

    result = await flow.async_step_remove_broker()

    assert result["type"] == FlowResultType.CREATE_ENTRY
    assert CONF_MQTT_HOST not in result["data"]
    assert CONF_MQTT_PORT not in result["data"]
    assert CONF_MQTT_TLS not in result["data"]
