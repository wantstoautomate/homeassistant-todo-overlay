"""Automation trigger platform: fires whenever TodoManager reports a
meaningful change to a list (item created/completed/uncompleted/removed,
a tag added/removed, or a quantity changed) - see manager.py's
_fire_event() and const.py's EVENT_ITEM_CHANGED. Filterable by entity_id,
action, and/or tag so an automation only reacts to what it cares about.
"""

import voluptuous as vol

from homeassistant.const import CONF_PLATFORM
from homeassistant.core import CALLBACK_TYPE, Event, HassJob, HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.trigger import TriggerActionType, TriggerInfo
from homeassistant.helpers.typing import ConfigType

from .const import DOMAIN, EVENT_ITEM_CHANGED

CONF_ACTION = "action"
CONF_TAG = "tag"

TRIGGER_SCHEMA = cv.TRIGGER_BASE_SCHEMA.extend(
    {
        vol.Required(CONF_PLATFORM): DOMAIN,
        vol.Optional("entity_id"): cv.entity_ids,
        vol.Optional(CONF_ACTION): vol.In(
            [
                "created",
                "completed",
                "uncompleted",
                "removed",
                "tag_added",
                "tag_removed",
                "quantity_changed",
            ]
        ),
        vol.Optional(CONF_TAG): str,
    }
)


async def async_attach_trigger(
    hass: HomeAssistant,
    config: ConfigType,
    action: TriggerActionType,
    trigger_info: TriggerInfo,
) -> CALLBACK_TYPE:
    """Attach a todo_overlay trigger, matching config against fired events."""

    trigger_data = trigger_info["trigger_data"]
    job = HassJob(action)

    wanted_entity_ids = config.get("entity_id")
    wanted_action = config.get(CONF_ACTION)
    wanted_tag = config.get(CONF_TAG)

    async def handle_event(event: Event) -> None:
        data = event.data

        if wanted_entity_ids and data.get("entity_id") not in wanted_entity_ids:
            return

        if wanted_action and data.get("action") != wanted_action:
            return

        if wanted_tag and data.get("tag") != wanted_tag:
            return

        task = hass.async_run_hass_job(
            job,
            {
                "trigger": {
                    **trigger_data,
                    "platform": DOMAIN,
                    "event": event,
                    "description": f"{DOMAIN} event",
                },
            },
            event.context,
        )

        if task:
            await task

    return hass.bus.async_listen(EVENT_ITEM_CHANGED, handle_event)
