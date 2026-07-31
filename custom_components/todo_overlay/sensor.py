"""Sensor platform: one entity per todo.* entity, exposing the count of
incomplete items as state and their full detail (including tags, due
dates, quantity) as the "items" attribute.

Native HA's own todo.* entity state is already this same count (see
homeassistant.components.todo.TodoListEntity.state) - the count here is
intentionally redundant with it. What native HA doesn't expose at all
is per-item detail; getting it otherwise needs a todo.get_items service
call in every automation. This sensor puts that detail directly on a
state attribute instead, so it's referenceable in a template trigger/
condition or a notification message (e.g. tag-filtering via
`items | selectattr('tags', 'contains', 'urgent')`) with no extra
service call.

Reactive, not polled - subscribes to the same async_subscribe_updates()
mechanism due_scheduler.py already uses for the same reason (a todo.*
entity's own state_changed event doesn't fire for most per-item edits -
see due_scheduler.py's own docstring for why).

Entity discovery mirrors due_scheduler.py's pattern: seed from every
todo.* entity once Home Assistant has finished starting (other
integrations may not have added theirs yet during our own setup), then
track further additions/removals/renames via the entity registry -
wired in __init__.py's existing _async_handle_entity_registry_updated,
right alongside the equivalent due_scheduler calls.
"""

from __future__ import annotations

import logging

from homeassistant.components.sensor import SensorEntity, SensorStateClass
from homeassistant.components.todo import DATA_COMPONENT, TodoItem as HaTodoItem
from homeassistant.const import EVENT_HOMEASSISTANT_STARTED
from homeassistant.core import CALLBACK_TYPE, CoreState, HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .errors import EntityNotFoundError
from .models import TodoItem
from .runtime_data import TodoOverlayConfigEntry, get_manager

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: TodoOverlayConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    registry = entry.runtime_data.open_items_registry
    await registry.async_bind(async_add_entities)


class OpenItemsSensorRegistry:
    """Creates and keeps in sync one TodoOverlayOpenItemsSensor per known
    todo.* entity. Constructed in __init__.py (alongside due_scheduler)
    so its add/remove/rename methods are reachable from the shared
    entity-registry handler there - async_bind() supplies the
    async_add_entities callback once this platform's own async_setup_entry
    runs, which is when entities can actually start being added."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass
        self._async_add_entities: AddEntitiesCallback | None = None
        self._entities: dict[str, TodoOverlayOpenItemsSensor] = {}

    async def async_bind(self, async_add_entities: AddEntitiesCallback) -> None:
        self._async_add_entities = async_add_entities

        if self._hass.state == CoreState.running:
            self._add_existing()
        else:
            # Must be a real bound coroutine function, not a lambda - see
            # due_scheduler.py's identical _async_handle_started. Without
            # HA's @callback marker or a coroutine function, async_listen_
            # once dispatches a plain callable via an executor *thread*,
            # and add_entity()'s async_add_entities() call then blows up
            # trying to touch the event loop from off-thread (reproduced
            # live: "RuntimeError: loop ... is not the running loop").
            self._hass.bus.async_listen_once(
                EVENT_HOMEASSISTANT_STARTED, self._async_handle_started,
            )

    async def _async_handle_started(self, _event) -> None:
        self._add_existing()

    def _add_existing(self) -> None:
        for state in self._hass.states.async_all("todo"):
            self.add_entity(state.entity_id)

    def add_entity(self, todo_entity_id: str) -> None:
        if self._async_add_entities is None or todo_entity_id in self._entities:
            return

        sensor = TodoOverlayOpenItemsSensor(self._hass, todo_entity_id)
        self._entities[todo_entity_id] = sensor
        self._async_add_entities([sensor])

    async def remove_entity(self, todo_entity_id: str) -> None:
        sensor = self._entities.pop(todo_entity_id, None)

        if sensor is not None:
            await sensor.async_remove(force_remove=True)


class TodoOverlayOpenItemsSensor(SensorEntity):
    """See sensor.py's module docstring."""

    _attr_should_poll = False
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_icon = "mdi:clipboard-list-outline"
    _attr_native_unit_of_measurement = "items"

    def __init__(self, hass: HomeAssistant, todo_entity_id: str) -> None:
        self._hass = hass
        self._todo_entity_id = todo_entity_id
        self._unsub_updates: CALLBACK_TYPE | None = None

        object_id = todo_entity_id.split(".", 1)[1]
        state = hass.states.get(todo_entity_id)
        friendly_name = state.attributes.get("friendly_name") if state else None

        self._attr_unique_id = f"{DOMAIN}_{todo_entity_id}_open_items"
        self._attr_name = f"{friendly_name or object_id.replace('_', ' ').title()} Open Items"
        self.entity_id = f"sensor.{DOMAIN}_{object_id}_open_items"

        self._attr_native_value: int | None = None
        self._attr_extra_state_attributes: dict = {"items": []}

    async def async_added_to_hass(self) -> None:
        await self._async_refresh()

        component = self._hass.data.get(DATA_COMPONENT)
        entity = component.get_entity(self._todo_entity_id) if component is not None else None

        if entity is not None:
            self._unsub_updates = entity.async_subscribe_updates(self._on_items_updated)
        else:
            _LOGGER.warning(
                "Could not find the native todo entity for %s - open-items "
                "sensor won't reactively update until a restart",
                self._todo_entity_id,
            )

    async def async_will_remove_from_hass(self) -> None:
        if self._unsub_updates is not None:
            self._unsub_updates()
            self._unsub_updates = None

    def _on_items_updated(self, _items: list[HaTodoItem] | None) -> None:
        self._hass.async_create_task(self._async_refresh_and_write())

    async def _async_refresh_and_write(self) -> None:
        await self._async_refresh()
        self.async_write_ha_state()

    async def _async_refresh(self) -> None:
        manager = get_manager(self._hass)

        try:
            todo_list = await manager.get_list(self._todo_entity_id)
        except EntityNotFoundError:
            self._attr_available = False
            return

        self._attr_available = True
        open_items: list[dict] = []

        def walk(items: list[TodoItem], top_level: bool) -> None:
            for item in items:
                if not item.completed:
                    open_items.append({
                        "item_id": item.id,
                        "title": item.title,
                        "description": item.description,
                        "due_date": item.due_date,
                        "due_datetime": item.due_datetime,
                        "quantity": item.quantity,
                        "tags": item.tags,
                        "top_level": top_level,
                    })

                walk(item.children, False)

        walk(todo_list.items, True)

        self._attr_native_value = len(open_items)
        self._attr_extra_state_attributes = {"items": open_items}
