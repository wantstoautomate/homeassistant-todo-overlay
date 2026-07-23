"""Config flow for Todo Overlay.

There's nothing to configure - this integration works against whatever
todo.* entities already exist, with no host/token/options of its own -
so the flow is just a single confirmation step (or, for the YAML import
path, no step at all) that creates the one config entry this integration
ever needs. See __init__.py's async_setup() for how an existing
`todo_overlay:` YAML config gets migrated into this automatically.
"""

from __future__ import annotations

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult

from .const import DOMAIN


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
