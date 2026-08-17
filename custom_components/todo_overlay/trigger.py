"""Automation triggers: one distinct trigger per kind of change TodoManager
reports (item created/completed/uncompleted/removed, a tag added/removed,
a quantity changed, a pin type set/cleared, or an opted-in item's due
time arriving) - see
manager.py's _fire_event()/fire_due_event() and const.py's
EVENT_ITEM_CHANGED. Each one uses the standard target selector (the same
entity/device/area picker every other HA trigger uses) for its todo list(s),
matching the pattern HA's own todo integration uses for
todo.item_added/item_completed/item_removed (see
homeassistant.components.todo.trigger) rather than a single trigger with
a generic action-picking field.

This replaces the earlier single bare `todo_overlay` trigger (with a
combined `action:` field and flat entity_id/tag options) entirely, since
splitting it is what was asked for and nothing has shipped to production
yet to stay backward-compatible with.
"""

import abc
from typing import cast

import voluptuous as vol

from homeassistant.const import ATTR_ENTITY_ID, CONF_OPTIONS, CONF_TARGET
from homeassistant.core import CALLBACK_TYPE, Event, HomeAssistant, callback
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.trigger import (
    Trigger,
    TriggerActionRunner,
    TriggerConfig,
    TriggerNotTriggeredReporter,
)
from homeassistant.helpers.typing import ConfigType

from .const import DOMAIN, EVENT_ITEM_CHANGED

CONF_TAG = "tag"

_OPTIONS_SCHEMA = vol.Schema({vol.Optional(CONF_TAG): str})

_TRIGGER_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_TARGET): cv.TARGET_FIELDS,
        vol.Optional(CONF_OPTIONS, default={}): _OPTIONS_SCHEMA,
    }
)


class _TodoOverlayItemTrigger(Trigger, abc.ABC):
    """Base for a single todo_overlay action-specific trigger.

    Only `_item_action` differs between subclasses - it's matched against
    EVENT_ITEM_CHANGED's own "action" field.
    """

    _item_action: str

    @classmethod
    async def async_validate_config(cls, hass: HomeAssistant, config: ConfigType) -> ConfigType:
        """Validate the target (required) and options (optional tag filter)."""
        return cast(ConfigType, _TRIGGER_SCHEMA(config))

    def __init__(self, hass: HomeAssistant, config: TriggerConfig) -> None:
        super().__init__(hass, config)
        target = config.target or {}
        self._entity_ids = target.get(ATTR_ENTITY_ID)
        self._tag = (config.options or {}).get(CONF_TAG)

    async def async_attach_runner(
        self,
        run_action: TriggerActionRunner,
        did_not_trigger: TriggerNotTriggeredReporter | None = None,
    ) -> CALLBACK_TYPE:
        """Attach to EVENT_ITEM_CHANGED, filtering by target entity/tag."""

        @callback
        def handle_event(event: Event) -> None:
            data = event.data

            if data.get("action") != self._item_action:
                return

            if self._entity_ids and data.get("entity_id") not in self._entity_ids:
                return

            if self._tag and data.get("tag") != self._tag:
                return

            run_action({"event": event}, f"{DOMAIN} {self._item_action} event", event.context)

        return self._hass.bus.async_listen(EVENT_ITEM_CHANGED, handle_event)


class TodoOverlayItemCreatedTrigger(_TodoOverlayItemTrigger):
    """Fires when an item is created."""

    _item_action = "created"


class TodoOverlayItemCompletedTrigger(_TodoOverlayItemTrigger):
    """Fires when an item is completed."""

    _item_action = "completed"


class TodoOverlayItemUncompletedTrigger(_TodoOverlayItemTrigger):
    """Fires when an item is un-completed."""

    _item_action = "uncompleted"


class TodoOverlayItemRemovedTrigger(_TodoOverlayItemTrigger):
    """Fires when an item is removed."""

    _item_action = "removed"


class TodoOverlayTagAddedTrigger(_TodoOverlayItemTrigger):
    """Fires when a tag is added to an item."""

    _item_action = "tag_added"


class TodoOverlayTagRemovedTrigger(_TodoOverlayItemTrigger):
    """Fires when a tag is removed from an item."""

    _item_action = "tag_removed"


class TodoOverlayQuantityChangedTrigger(_TodoOverlayItemTrigger):
    """Fires when an item's quantity changes."""

    _item_action = "quantity_changed"


class TodoOverlayPinTypeChangedTrigger(_TodoOverlayItemTrigger):
    """Fires when an item's pin type is set or cleared (see
    manager_items.py's set_pin_type) - e.g. to notify when a person's
    section gains its first item, or to react to a category being
    pinned/unpinned."""

    _item_action = "pin_type_changed"


class TodoOverlayItemDueTrigger(_TodoOverlayItemTrigger):
    """Fires when an opted-in item's due time arrives."""

    _item_action = "due"


TRIGGERS: dict[str, type[Trigger]] = {
    "created": TodoOverlayItemCreatedTrigger,
    "completed": TodoOverlayItemCompletedTrigger,
    "uncompleted": TodoOverlayItemUncompletedTrigger,
    "removed": TodoOverlayItemRemovedTrigger,
    "tag_added": TodoOverlayTagAddedTrigger,
    "tag_removed": TodoOverlayTagRemovedTrigger,
    "quantity_changed": TodoOverlayQuantityChangedTrigger,
    "pin_type_changed": TodoOverlayPinTypeChangedTrigger,
    "due": TodoOverlayItemDueTrigger,
}


async def async_get_triggers(hass: HomeAssistant) -> dict[str, type[Trigger]]:
    """Return the triggers provided by this integration."""
    return TRIGGERS
