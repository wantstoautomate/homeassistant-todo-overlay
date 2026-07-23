"""Tests for DueScheduler's reconciliation logic: scheduling, restart
catch-up firing, cancellation, the toggle hook, and the per-entity
item-update subscription - using injectable fakes for
async_track_point_in_time and utcnow() so scheduling decisions are
deterministic without any real event-loop waiting (see
due_scheduler.py's constructor).

The subscription mechanism (TodoListEntity.async_subscribe_updates(),
reached via hass.data[DATA_COMPONENT].get_entity(entity_id)) was chosen
over listening to state_changed after confirming live against a real
Home Assistant instance that state_changed simply never fires for a
due_datetime-only edit (a todo entity's state is just its incomplete-item
count, unaffected by such an edit) - see due_scheduler.py's module
docstring. FakeTodoEntity/FakeComponent below stand in for that same API.
"""

import asyncio
import datetime as dt_module

import pytest

from homeassistant.components.todo import DATA_COMPONENT
from homeassistant.const import EVENT_HOMEASSISTANT_STARTED
from homeassistant.core import CoreState

from custom_components.todo_overlay.const import EVENT_ITEM_CHANGED
from custom_components.todo_overlay.due_scheduler import DueScheduler
from custom_components.todo_overlay.manager import TodoManager
from custom_components.todo_overlay.models import ItemPosition, TodoItem

from fakes import FakeAdapter, FakeMetadataStore

ENTITY_ID = "todo.shopping"


class FakeState:

    def __init__(self, entity_id):
        self.entity_id = entity_id


class FakeStates:

    def __init__(self, entity_ids=()):
        self.entity_ids = list(entity_ids)

    def async_all(self, domain):
        return [FakeState(eid) for eid in self.entity_ids]


class FakeBus:

    def __init__(self):
        self.fired: list[tuple[str, dict]] = []
        self._listen_once: dict[str, list] = {}

    def async_fire(self, event_type, data):
        self.fired.append((event_type, data))

    def async_listen_once(self, event_type, handler):
        self._listen_once.setdefault(event_type, []).append(handler)

        def unsub():
            if handler in self._listen_once[event_type]:
                self._listen_once[event_type].remove(handler)

        return unsub

    async def emit(self, event_type, event=None) -> None:
        handlers = list(self._listen_once.get(event_type, []))
        self._listen_once[event_type] = []

        for handler in handlers:
            await handler(event)


class FakeTodoEntity:
    """Stands in for homeassistant.components.todo.TodoListEntity - just
    enough of async_subscribe_updates() to drive DueScheduler."""

    def __init__(self):
        self._listeners: list = []

    def async_subscribe_updates(self, listener):
        self._listeners.append(listener)

        def unsub():
            if listener in self._listeners:
                self._listeners.remove(listener)

        return unsub

    def trigger_update(self):
        for listener in list(self._listeners):
            listener(None)


class FakeComponent:

    def __init__(self, entities: dict[str, FakeTodoEntity]):
        self._entities = entities

    def get_entity(self, entity_id):
        return self._entities.get(entity_id)


class FakeHass:

    def __init__(self, entity_ids=(), state=CoreState.running):
        self.states = FakeStates(entity_ids)
        self.bus = FakeBus()
        self.todo_entities = {eid: FakeTodoEntity() for eid in entity_ids}
        self.data = {DATA_COMPONENT: FakeComponent(self.todo_entities)}
        self.tasks: list = []
        self.state = state

    def async_create_task(self, coro):
        task = asyncio.ensure_future(coro)
        self.tasks.append(task)
        return task

    async def drain(self):
        """Let every task scheduled via async_create_task() finish -
        mirrors how a real event loop would run them, just deterministic."""

        while self.tasks:
            pending = self.tasks
            self.tasks = []
            await asyncio.gather(*pending)


class FakeTrackPointInTime:
    """Records scheduling calls instead of touching the real event loop -
    tests fire a scheduled callback explicitly via fire()."""

    def __init__(self):
        self.scheduled: list[dict] = []

    def __call__(self, hass, action, point_in_time):
        entry = {"action": action, "point_in_time": point_in_time, "cancelled": False}
        self.scheduled.append(entry)

        def unsub():
            entry["cancelled"] = True

        return unsub

    async def fire(self, index: int = 0) -> None:
        entry = self.scheduled[index]
        await entry["action"](entry["point_in_time"])


def make_scheduler(hass, manager, now, track=None):
    track = track if track is not None else FakeTrackPointInTime()
    scheduler = DueScheduler(hass, manager, track_point_in_time=track, utcnow=lambda: now)
    return scheduler, track


def make_manager(hass, items, positions=None):
    adapter = FakeAdapter(items=items)
    metadata_store = FakeMetadataStore(positions or {})
    return TodoManager(adapter=adapter, metadata_store=metadata_store, hass=hass)


NOW = dt_module.datetime(2026, 6, 1, tzinfo=dt_module.timezone.utc)
FUTURE_DUE = "2026-06-01T09:00:00+00:00"
PAST_DUE = "2026-05-01T09:00:00+00:00"


# --- async_start: seeding and catch-up -------------------------------------

@pytest.mark.asyncio
async def test_async_start_schedules_future_due_item():
    hass = FakeHass(entity_ids=[ENTITY_ID])
    manager = make_manager(
        hass,
        items=[TodoItem(id="1", title="Renew passport", completed=False, due_datetime=FUTURE_DUE)],
        positions={"1": ItemPosition(parent_id=None, order=0)},
    )
    manager._metadata_store._trigger_on_due = {"1"}

    scheduler, track = make_scheduler(hass, manager, NOW)
    await scheduler.async_start()

    assert len(track.scheduled) == 1
    assert hass.bus.fired == []
    assert scheduler._scheduled[(ENTITY_ID, "1")][0] == FUTURE_DUE


@pytest.mark.asyncio
async def test_async_start_fires_overdue_item_as_catchup():
    hass = FakeHass(entity_ids=[ENTITY_ID])
    manager = make_manager(
        hass,
        items=[TodoItem(id="1", title="Renew passport", completed=False, due_datetime=PAST_DUE)],
        positions={"1": ItemPosition(parent_id=None, order=0)},
    )
    manager._metadata_store._trigger_on_due = {"1"}

    scheduler, track = make_scheduler(hass, manager, NOW)
    await scheduler.async_start()

    assert track.scheduled == []
    assert len(hass.bus.fired) == 1
    event_type, data = hass.bus.fired[0]
    assert event_type == EVENT_ITEM_CHANGED
    assert data["action"] == "due"
    assert data["due_datetime"] == PAST_DUE

    due_fired = await manager.get_due_fired(ENTITY_ID)
    assert due_fired == {"1": PAST_DUE}


@pytest.mark.asyncio
async def test_async_start_skips_items_not_opted_in():
    hass = FakeHass(entity_ids=[ENTITY_ID])
    manager = make_manager(
        hass,
        items=[TodoItem(id="1", title="Renew passport", completed=False, due_datetime=PAST_DUE)],
        positions={"1": ItemPosition(parent_id=None, order=0)},
    )
    # trigger_on_due deliberately left unset.

    scheduler, track = make_scheduler(hass, manager, NOW)
    await scheduler.async_start()

    assert track.scheduled == []
    assert hass.bus.fired == []


@pytest.mark.asyncio
async def test_async_start_skips_completed_items():
    hass = FakeHass(entity_ids=[ENTITY_ID])
    manager = make_manager(
        hass,
        items=[TodoItem(id="1", title="Renew passport", completed=True, due_datetime=PAST_DUE)],
        positions={"1": ItemPosition(parent_id=None, order=0)},
    )
    manager._metadata_store._trigger_on_due = {"1"}

    scheduler, track = make_scheduler(hass, manager, NOW)
    await scheduler.async_start()

    assert track.scheduled == []
    assert hass.bus.fired == []


@pytest.mark.asyncio
async def test_async_start_defers_subscription_until_home_assistant_started():
    """todo_overlay's own async_setup() can run before other integrations
    have finished adding their todo.* entities - subscribing immediately
    would silently find nothing to attach to (this was a real bug,
    caught by testing against a live instance rather than only this
    fake, which happily let async_start() run at any hass.state)."""

    hass = FakeHass(entity_ids=[ENTITY_ID], state=CoreState.not_running)
    manager = make_manager(
        hass,
        items=[TodoItem(id="1", title="A", completed=False, due_datetime=FUTURE_DUE)],
        positions={"1": ItemPosition(parent_id=None, order=0)},
    )
    manager._metadata_store._trigger_on_due = {"1"}

    scheduler, track = make_scheduler(hass, manager, NOW)
    await scheduler.async_start()

    assert track.scheduled == []
    assert hass.todo_entities[ENTITY_ID]._listeners == []

    await hass.bus.emit(EVENT_HOMEASSISTANT_STARTED)

    assert len(track.scheduled) == 1
    assert len(hass.todo_entities[ENTITY_ID]._listeners) == 1


# --- reconcile_entity: cancellation and re-firing guards --------------------

@pytest.mark.asyncio
async def test_reconcile_cancels_schedule_when_item_completed():
    hass = FakeHass(entity_ids=[ENTITY_ID])
    manager = make_manager(
        hass,
        items=[TodoItem(id="1", title="Renew passport", completed=False, due_datetime=FUTURE_DUE)],
        positions={"1": ItemPosition(parent_id=None, order=0)},
    )
    manager._metadata_store._trigger_on_due = {"1"}

    scheduler, track = make_scheduler(hass, manager, NOW)
    await scheduler.async_start()
    assert len(track.scheduled) == 1

    await manager.set_completed(ENTITY_ID, "1", True)
    await scheduler.reconcile_entity(ENTITY_ID)

    assert track.scheduled[0]["cancelled"] is True
    assert scheduler._scheduled == {}


@pytest.mark.asyncio
async def test_reconcile_does_not_refire_already_fired_due_value():
    hass = FakeHass(entity_ids=[ENTITY_ID])
    manager = make_manager(
        hass,
        items=[TodoItem(id="1", title="Renew passport", completed=False, due_datetime=PAST_DUE)],
        positions={"1": ItemPosition(parent_id=None, order=0)},
    )
    manager._metadata_store._trigger_on_due = {"1"}
    manager._metadata_store._due_fired = {"1": PAST_DUE}

    scheduler, track = make_scheduler(hass, manager, NOW)
    await scheduler.async_start()

    assert track.scheduled == []
    assert hass.bus.fired == []


@pytest.mark.asyncio
async def test_reconcile_reschedules_when_due_value_changes():
    hass = FakeHass(entity_ids=[ENTITY_ID])
    manager = make_manager(
        hass,
        items=[TodoItem(id="1", title="Renew passport", completed=False, due_datetime=PAST_DUE)],
        positions={"1": ItemPosition(parent_id=None, order=0)},
    )
    manager._metadata_store._trigger_on_due = {"1"}
    # Already fired for a DIFFERENT (older) due value - an edit to a new
    # due_datetime must be treated as fresh, not suppressed.
    manager._metadata_store._due_fired = {"1": "2026-01-01T00:00:00+00:00"}

    scheduler, track = make_scheduler(hass, manager, NOW)
    await scheduler.async_start()

    assert len(hass.bus.fired) == 1
    due_fired = await manager.get_due_fired(ENTITY_ID)
    assert due_fired == {"1": PAST_DUE}


# --- toggle hook -------------------------------------------------------

@pytest.mark.asyncio
async def test_set_trigger_on_due_immediately_schedules_via_hook():
    """Toggling trigger_on_due never touches the native entity at all, so
    the scheduler can only notice via TodoManager's hook - not the
    per-item subscription (see due_scheduler.py's module docstring)."""

    hass = FakeHass(entity_ids=[ENTITY_ID])
    manager = make_manager(
        hass,
        items=[TodoItem(id="1", title="Renew passport", completed=False, due_datetime=FUTURE_DUE)],
        positions={"1": ItemPosition(parent_id=None, order=0)},
    )

    scheduler, track = make_scheduler(hass, manager, NOW)
    await scheduler.async_start()
    assert track.scheduled == []

    await manager.set_trigger_on_due(ENTITY_ID, "1", True)

    assert len(track.scheduled) == 1
    assert scheduler._scheduled[(ENTITY_ID, "1")][0] == FUTURE_DUE


# --- cancel_entity / async_stop -----------------------------------------

@pytest.mark.asyncio
async def test_cancel_entity_cancels_every_schedule_for_that_entity():
    hass = FakeHass(entity_ids=[ENTITY_ID])
    manager = make_manager(
        hass,
        items=[
            TodoItem(id="1", title="A", completed=False, due_datetime=FUTURE_DUE),
            TodoItem(id="2", title="B", completed=False, due_datetime=FUTURE_DUE),
        ],
        positions={
            "1": ItemPosition(parent_id=None, order=0),
            "2": ItemPosition(parent_id=None, order=1),
        },
    )
    manager._metadata_store._trigger_on_due = {"1", "2"}

    scheduler, track = make_scheduler(hass, manager, NOW)
    await scheduler.async_start()
    assert len(track.scheduled) == 2

    scheduler.cancel_entity(ENTITY_ID)

    assert all(entry["cancelled"] for entry in track.scheduled)
    assert scheduler._scheduled == {}
    assert hass.todo_entities[ENTITY_ID]._listeners == []


@pytest.mark.asyncio
async def test_async_stop_cancels_everything_and_unsubscribes():
    hass = FakeHass(entity_ids=[ENTITY_ID])
    manager = make_manager(
        hass,
        items=[TodoItem(id="1", title="A", completed=False, due_datetime=FUTURE_DUE)],
        positions={"1": ItemPosition(parent_id=None, order=0)},
    )
    manager._metadata_store._trigger_on_due = {"1"}

    scheduler, track = make_scheduler(hass, manager, NOW)
    await scheduler.async_start()

    scheduler.async_stop()

    assert track.scheduled[0]["cancelled"] is True
    assert scheduler._scheduled == {}
    assert hass.todo_entities[ENTITY_ID]._listeners == []


# --- per-item update subscription ---------------------------------------

@pytest.mark.asyncio
async def test_subscribe_entity_is_a_noop_for_unknown_entity():
    hass = FakeHass(entity_ids=[])
    manager = make_manager(hass, items=[])

    scheduler, track = make_scheduler(hass, manager, NOW)
    await scheduler.async_start()

    scheduler.subscribe_entity("todo.unknown")

    assert scheduler._item_unsubs == {}


@pytest.mark.asyncio
async def test_item_update_reconciles_entity_after_external_edit():
    """Simulates a due-date edit made through a path the scheduler's own
    hook can't see (e.g. the native card calling todo.update_item
    directly, which never fires state_changed for a due-only edit - see
    due_scheduler.py's module docstring) - the per-item subscription is
    what has to catch it."""

    hass = FakeHass(entity_ids=[ENTITY_ID])
    manager = make_manager(
        hass,
        items=[TodoItem(id="1", title="Renew passport", completed=False, due_datetime=None)],
        positions={"1": ItemPosition(parent_id=None, order=0)},
    )
    manager._metadata_store._trigger_on_due = {"1"}

    scheduler, track = make_scheduler(hass, manager, NOW)
    await scheduler.async_start()
    assert track.scheduled == []

    # Something outside TodoManager sets a due_datetime directly on the
    # adapter's own item.
    manager._adapter._items[0].due_datetime = FUTURE_DUE

    hass.todo_entities[ENTITY_ID].trigger_update()
    await hass.drain()

    assert len(track.scheduled) == 1
    assert scheduler._scheduled[(ENTITY_ID, "1")][0] == FUTURE_DUE


@pytest.mark.asyncio
async def test_subscribe_entity_called_twice_does_not_double_subscribe():
    hass = FakeHass(entity_ids=[ENTITY_ID])
    manager = make_manager(hass, items=[])

    scheduler, _track = make_scheduler(hass, manager, NOW)
    await scheduler.async_start()

    scheduler.subscribe_entity(ENTITY_ID)

    assert len(hass.todo_entities[ENTITY_ID]._listeners) == 1


# --- firing a scheduled (future) callback --------------------------------

@pytest.mark.asyncio
async def test_scheduled_callback_fires_and_records():
    hass = FakeHass(entity_ids=[ENTITY_ID])
    manager = make_manager(
        hass,
        items=[TodoItem(id="1", title="Renew passport", completed=False, due_datetime=FUTURE_DUE)],
        positions={"1": ItemPosition(parent_id=None, order=0)},
    )
    manager._metadata_store._trigger_on_due = {"1"}

    scheduler, track = make_scheduler(hass, manager, NOW)
    await scheduler.async_start()
    assert len(track.scheduled) == 1

    await track.fire(0)

    assert len(hass.bus.fired) == 1
    _, data = hass.bus.fired[0]
    assert data["action"] == "due"
    assert scheduler._scheduled == {}

    due_fired = await manager.get_due_fired(ENTITY_ID)
    assert due_fired == {"1": FUTURE_DUE}


@pytest.mark.asyncio
async def test_reconcile_warns_and_skips_unparseable_due_datetime(caplog):
    hass = FakeHass(entity_ids=[ENTITY_ID])
    manager = make_manager(
        hass,
        items=[TodoItem(id="1", title="Bad due", completed=False, due_datetime="not-a-datetime")],
        positions={"1": ItemPosition(parent_id=None, order=0)},
    )
    manager._metadata_store._trigger_on_due = {"1"}

    scheduler, track = make_scheduler(hass, manager, NOW)
    await scheduler.async_start()

    assert track.scheduled == []
    assert hass.bus.fired == []
