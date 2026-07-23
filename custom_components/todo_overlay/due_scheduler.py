"""Fires the "due" trigger event (see trigger.py) at the exact moment an
opted-in item's due_datetime arrives.

Two mechanisms work together:

- TodoListEntity.async_subscribe_updates() (see homeassistant.components
  .todo) - the same per-entity item-update subscription the native todo
  card itself uses, subscribed to for every known todo.* entity. This
  catches a due-date edit regardless of what made it - our own card,
  the native todo card, a voice assistant, another automation, or even
  this integration's own frontend (which writes due dates straight
  through Home Assistant's todo.update_item service, bypassing
  TodoManager entirely).

  This is NOT the same as listening to state_changed: a todo entity's
  state is just its incomplete-item count, and its attributes never
  include per-item fields, so editing an existing item's due_datetime
  (without changing completion) changes neither and HA's state machine
  legitimately never fires state_changed for it at all - confirmed live
  against a real instance before settling on this mechanism instead.
- homeassistant.helpers.event.async_track_point_in_time - the same
  precise, non-polling scheduling primitive backing HA's own native
  time/calendar triggers - for firing at the exact due moment rather
  than on some polling interval.

Toggling trigger_on_due itself is a metadata-only write that never
touches the native entity at all, so it can't be caught by the
subscription above either - TodoManager calls back into
reconcile_entity() directly for that (see
TodoManager.set_due_schedule_hook()).

Every reconciliation pass recomputes the full "desired" schedule from
scratch and diffs it against what's currently scheduled, the same
reconcile-by-diffing approach already used elsewhere in this
integration (drop-target and orphaned-metadata reconciliation) - rather
than trying to incrementally patch a stateful schedule.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import datetime

from homeassistant.components.todo import DATA_COMPONENT, TodoItem as HaTodoItem
from homeassistant.const import EVENT_HOMEASSISTANT_STARTED
from homeassistant.core import CALLBACK_TYPE, CoreState, HomeAssistant
from homeassistant.helpers.event import async_track_point_in_time
from homeassistant.util import dt as dt_util

from .errors import EntityNotFoundError
from .manager import TodoManager
from .models import TodoItem

_LOGGER = logging.getLogger(__name__)


class DueScheduler:
    """Schedules and fires the "due" trigger event for every todo.*
    entity's opted-in items."""

    def __init__(
        self,
        hass: HomeAssistant,
        manager: TodoManager,
        *,
        track_point_in_time: Callable[..., CALLBACK_TYPE] = async_track_point_in_time,
        utcnow: Callable[[], datetime] = dt_util.utcnow,
    ) -> None:
        self._hass = hass
        self._manager = manager
        self._track_point_in_time = track_point_in_time
        self._utcnow = utcnow
        # (entity_id, item_id) -> (due_value it's scheduled for, cancel callback)
        self._scheduled: dict[tuple[str, str], tuple[str, CALLBACK_TYPE]] = {}
        # entity_id -> unsubscribe callback for that entity's
        # async_subscribe_updates() registration.
        self._item_unsubs: dict[str, CALLBACK_TYPE] = {}

    async def async_start(self) -> None:
        """Seed the schedule from every existing todo.* entity (firing
        anything already overdue as catch-up, e.g. after a restart),
        then subscribe to further per-item changes on each of them.

        Deferred until Home Assistant has finished starting (same
        pattern __init__.py uses for Lovelace resource registration) -
        todo_overlay's own async_setup() can run before other
        integrations have finished adding their todo.* entities, and
        subscribing too early would silently find nothing to attach to.
        """

        self._manager.set_due_schedule_hook(self.reconcile_entity)

        if self._hass.state == CoreState.running:
            await self._async_subscribe_existing()
        else:
            self._hass.bus.async_listen_once(
                EVENT_HOMEASSISTANT_STARTED, self._async_handle_started,
            )

    async def _async_handle_started(self, _event) -> None:
        await self._async_subscribe_existing()

    async def _async_subscribe_existing(self) -> None:
        entity_ids = [state.entity_id for state in self._hass.states.async_all("todo")]

        for entity_id in entity_ids:
            self.subscribe_entity(entity_id)
            await self.reconcile_entity(entity_id)

    def subscribe_entity(self, entity_id: str) -> None:
        """Start watching one todo.* entity for item changes - called for
        every entity known at startup, and by __init__.py when a new
        todo.* entity is added to the entity registry afterwards."""

        if entity_id in self._item_unsubs:
            return

        component = self._hass.data.get(DATA_COMPONENT)
        entity = component.get_entity(entity_id) if component is not None else None

        if entity is None:
            return

        def _on_items_updated(_items: list[HaTodoItem] | None) -> None:
            self._hass.async_create_task(self.reconcile_entity(entity_id))

        self._item_unsubs[entity_id] = entity.async_subscribe_updates(_on_items_updated)

    def async_stop(self) -> None:
        """Cancel every pending schedule and subscription - used on
        integration unload/reload."""

        for unsub in self._item_unsubs.values():
            unsub()

        self._item_unsubs.clear()

        for entity_id, item_id in list(self._scheduled):
            self._cancel(entity_id, item_id)

    def cancel_entity(self, entity_id: str) -> None:
        """Cancel the subscription and every pending schedule for one
        entity - used when a todo.* entity is removed from the entity
        registry."""

        unsub = self._item_unsubs.pop(entity_id, None)

        if unsub is not None:
            unsub()

        for eid, item_id in [key for key in self._scheduled if key[0] == entity_id]:
            self._cancel(eid, item_id)

    async def reconcile_entity(self, entity_id: str) -> None:
        try:
            todo_list = await self._manager.get_list(entity_id)
        except EntityNotFoundError:
            # Entity removed or transiently unavailable - nothing to
            # schedule against; cancel_entity() (see __init__.py) handles
            # the "actually removed" case explicitly.
            return

        desired: dict[str, tuple[str, str]] = {}
        # trigger_on_due can go stale: the toggle is only ever set through
        # our own dialog (which requires a due_datetime to enable it in
        # the first place - see DueTimeRequiredError), but the due date
        # can still be cleared afterwards through a path that bypasses
        # that check entirely (native card, voice assistant, another
        # automation calling todo.update_item directly). Left alone, the
        # flag would sit there forever claiming to be armed while never
        # actually able to fire again - cleaned up here as part of the
        # same reconciliation pass, rather than leaving stale state for
        # someone to eventually notice in the edit dialog.
        stale_trigger_ids: list[str] = []

        def walk(items: list[TodoItem]) -> None:
            for item in items:
                if item.trigger_on_due and not item.due_datetime:
                    stale_trigger_ids.append(item.id)
                elif not item.completed and item.trigger_on_due and item.due_datetime:
                    desired[item.id] = (item.due_datetime, item.title)

                walk(item.children)

        walk(todo_list.items)

        if stale_trigger_ids:
            await self._manager.clear_stale_trigger_on_due(entity_id, stale_trigger_ids)

        due_fired = await self._manager.get_due_fired(entity_id)

        currently_scheduled = {
            item_id: due_value
            for (eid, item_id), (due_value, _unsub) in self._scheduled.items()
            if eid == entity_id
        }

        for item_id in currently_scheduled:
            if item_id not in desired:
                self._cancel(entity_id, item_id)

        now = self._utcnow()

        for item_id, (due_value, title) in desired.items():
            if due_fired.get(item_id) == due_value:
                # Already fired for this exact due value - if it's
                # somehow still scheduled (e.g. due_fired was written by
                # a fire that raced this reconcile), drop it.
                self._cancel(entity_id, item_id)
                continue

            if currently_scheduled.get(item_id) == due_value:
                continue

            self._cancel(entity_id, item_id)

            due_time = dt_util.parse_datetime(due_value)

            if due_time is None:
                _LOGGER.warning(
                    "Skipping unparseable due_datetime %r for item %r on %s",
                    due_value, item_id, entity_id,
                )
                continue

            due_time = dt_util.as_utc(due_time)

            if due_time <= now:
                await self._fire(entity_id, item_id, title, due_value)
            else:
                self._schedule(entity_id, item_id, title, due_value, due_time)

    def _schedule(
        self,
        entity_id: str,
        item_id: str,
        title: str,
        due_value: str,
        due_time: datetime,
    ) -> None:
        async def _on_time(_now: datetime) -> None:
            await self._fire(entity_id, item_id, title, due_value)

        unsub = self._track_point_in_time(self._hass, _on_time, due_time)
        self._scheduled[(entity_id, item_id)] = (due_value, unsub)

    async def _fire(self, entity_id: str, item_id: str, title: str, due_value: str) -> None:
        self._scheduled.pop((entity_id, item_id), None)

        await self._manager.record_due_fired(entity_id, item_id, due_value)
        self._manager.fire_due_event(entity_id, item_id, title, due_value)

    def _cancel(self, entity_id: str, item_id: str) -> None:
        entry = self._scheduled.pop((entity_id, item_id), None)

        if entry is not None:
            entry[1]()
