"""Config flow for Todo Overlay.

There's nothing to configure - this integration works against whatever
todo.* entities already exist, with no host/token/options of its own -
so the flow is just a single confirmation step (or, for the YAML import
path, no step at all) that creates the one config entry this integration
ever needs. See __init__.py's async_setup() for how an existing
`todo_overlay:` YAML config gets migrated into this automatically.
"""

from __future__ import annotations

import voluptuous as vol

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlowWithReload,
)
from homeassistant.core import callback

from .const import (
    CONF_MQTT_HOST,
    CONF_MQTT_PASSWORD,
    CONF_MQTT_PORT,
    CONF_MQTT_TLS,
    CONF_MQTT_USERNAME,
    DOMAIN,
)


class TodoOverlayConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Todo Overlay."""

    VERSION = 1

    async def async_step_user(self, user_input: dict | None = None) -> ConfigFlowResult:
        """Single confirmation step - no input to collect."""

        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()

        if user_input is not None:
            return self.async_create_entry(title="Todo Overlay", data={})

        return self.async_show_form(step_id="user")

    async def async_step_import(self, import_data: dict | None = None) -> ConfigFlowResult:
        """Triggered by a legacy `todo_overlay:` YAML config - skips the
        confirmation step, since the user already opted in via YAML."""

        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()

        return self.async_create_entry(title="Todo Overlay", data={})

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> TodoOverlayOptionsFlow:
        return TodoOverlayOptionsFlow()


class TodoOverlayOptionsFlow(OptionsFlowWithReload):
    """Configures the (optional, instance-wide) MQTT broker used for
    linked lists - see mqtt_link.py/link_sync.py. Entirely skippable:
    doing nothing here (or hitting "Done") leaves the integration exactly
    as it behaves without this options flow ever having existed.

    Which specific lists are linked, and to whom, is deliberately not
    configured here - that's a per-list, repeatable action better suited
    to a service call (create_link/join_link/unlink) than a one-off
    setup wizard - see services.py.
    """

    async def async_step_init(self, user_input: dict | None = None) -> ConfigFlowResult:
        menu_options = ["configure_broker"]

        if self.config_entry.options.get(CONF_MQTT_HOST):
            menu_options.append("remove_broker")

        return self.async_show_menu(step_id="init", menu_options=menu_options)

    async def async_step_configure_broker(self, user_input: dict | None = None) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(data={**self.config_entry.options, **user_input})

        current = self.config_entry.options

        schema = vol.Schema({
            vol.Required(CONF_MQTT_HOST, default=current.get(CONF_MQTT_HOST, "")): str,
            vol.Required(CONF_MQTT_PORT, default=current.get(CONF_MQTT_PORT, 8883)): int,
            vol.Optional(CONF_MQTT_USERNAME, default=current.get(CONF_MQTT_USERNAME, "")): str,
            vol.Optional(CONF_MQTT_PASSWORD, default=current.get(CONF_MQTT_PASSWORD, "")): str,
            vol.Required(CONF_MQTT_TLS, default=current.get(CONF_MQTT_TLS, True)): bool,
        })

        return self.async_show_form(step_id="configure_broker", data_schema=schema)

    async def async_step_remove_broker(self, user_input: dict | None = None) -> ConfigFlowResult:
        new_options = dict(self.config_entry.options)

        for key in (CONF_MQTT_HOST, CONF_MQTT_PORT, CONF_MQTT_USERNAME, CONF_MQTT_PASSWORD, CONF_MQTT_TLS):
            new_options.pop(key, None)

        return self.async_create_entry(data=new_options)
