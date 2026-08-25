import asyncio
import json

import pytest

from custom_components.todo_overlay.link_sync import LinkSyncManager
from custom_components.todo_overlay.manager import TodoManager
from custom_components.todo_overlay.models import ItemPosition, TodoItem

from fakes import FakeAdapter, FakeMetadataStore

ENTITY_ID = "todo.shopping"
LINK_ID = "link-abc"


class FakeTransport:
    """In-memory stand-in for LinkTransport - records publishes and lets
    a test simulate an incoming message on any subscribed topic filter,
    with minimal single-level (+) wildcard matching (all this project's
    topic filters use)."""

    def __init__(self) -> None:
        self.published: list[tuple[str, dict]] = []
        self._handlers: dict[str, list] = {}

    async def async_connect(self) -> None:
        pass

    async def async_disconnect(self) -> None:
        pass

    async def async_publish(self, topic, payload, *, retain=False, qos=1) -> None:
        self.published.append((topic, json.loads(payload)))

    def subscribe(self, topic_filter, handler) -> None:
        self._handlers.setdefault(topic_filter, []).append(handler)

    def unsubscribe(self, topic_filter) -> None:
        self._handlers.pop(topic_filter, None)

    def deliver(self, topic: str, payload: dict) -> None:
        encoded = json.dumps(payload).encode()
        for topic_filter, handlers in self._handlers.items():
            if _topic_matches(topic_filter, topic):
                for handler in handlers:
                    handler(topic, encoded)


def _topic_matches(topic_filter: str, topic: str) -> bool:
    filter_parts = topic_filter.split("/")
    topic_parts = topic.split("/")

    if len(filter_parts) != len(topic_parts):
        return False

    return all(f == "+" or f == t for f, t in zip(filter_parts, topic_parts))


class FakeBus:
    """Just enough of hass.bus for LinkSyncManager's own EVENT_ITEM_CHANGED
    subscription (async_setup) - these tests drive async_handle_local_change
    directly rather than through a real fired event, so nothing here needs
    to actually dispatch. async_fire is recorded (not dispatched either)
    so _notify_local_refresh has somewhere to land without crashing."""

    def __init__(self) -> None:
        self.fired: list[tuple] = []

    def async_listen(self, event_type, handler):
        return lambda: None

    def async_fire(self, event_type, data):
        self.fired.append((event_type, data))


class FakeHass:
    """Just enough of hass for async_create_task - tracks scheduled tasks
    so a test can flush them before asserting (mirrors how the real
    transport's sync callback kicks off async work: fire-and-forget from
    hass's perspective, but deterministic once awaited)."""

    def __init__(self) -> None:
        self.tasks: list[asyncio.Task] = []
        self.bus = FakeBus()

    def async_create_task(self, coro):
        task = asyncio.ensure_future(coro)
        self.tasks.append(task)
        return task


async def _flush(hass: FakeHass) -> None:
    if hass.tasks:
        await asyncio.gather(*hass.tasks)
        hass.tasks.clear()


def make_sync_manager(items=None, positions=None):
    hass = FakeHass()
    adapter = FakeAdapter(items=items if items is not None else [])
    metadata_store = FakeMetadataStore(positions=positions)
    manager = TodoManager(adapter, metadata_store)
    transport = FakeTransport()
    sync = LinkSyncManager(hass, manager, metadata_store, adapter, transport)

    return hass, adapter, metadata_store, manager, transport, sync


@pytest.mark.asyncio
async def test_no_publish_when_entity_not_linked():
    hass, adapter, store, manager, transport, sync = make_sync_manager(
        items=[TodoItem(id="1", title="Milk", completed=False)],
    )
    await sync.async_setup()

    await sync.async_handle_local_change(ENTITY_ID, "1", "created")

    assert transport.published == []


@pytest.mark.asyncio
async def test_local_change_publishes_upsert_for_a_linked_entity():
    hass, adapter, store, manager, transport, sync = make_sync_manager(
        items=[TodoItem(id="1", title="Milk", completed=False)],
    )
    await sync.async_setup()
    await store.set_link(ENTITY_ID, LINK_ID)
    await sync.async_start_link(ENTITY_ID)
    transport.published.clear()  # drop the initial (empty) snapshot publish

    await sync.async_handle_local_change(ENTITY_ID, "1", "created")

    assert len(transport.published) == 1
    topic, payload = transport.published[0]
    assert topic == f"todo_overlay/link/{LINK_ID}/item/{payload['sync_id']}"
    assert payload["fields"]["title"] == "Milk"
    assert payload["deleted"] is False


@pytest.mark.asyncio
async def test_identical_local_state_is_not_republished():
    """Covers the echo-suppression design: a local "change" that exactly
    matches what's already recorded (e.g. the echo of our own applied
    remote update) should not be republished."""

    hass, adapter, store, manager, transport, sync = make_sync_manager(
        items=[TodoItem(id="1", title="Milk", completed=False)],
    )
    await sync.async_setup()
    await store.set_link(ENTITY_ID, LINK_ID)
    await sync.async_start_link(ENTITY_ID)

    await sync.async_handle_local_change(ENTITY_ID, "1", "created")
    published_count = len(transport.published)

    # Nothing about item "1" has actually changed - firing the same
    # event again (as an echo would) must not produce a second publish.
    await sync.async_handle_local_change(ENTITY_ID, "1", "created")

    assert len(transport.published) == published_count


@pytest.mark.asyncio
async def test_incoming_create_adds_a_local_item():
    hass, adapter, store, manager, transport, sync = make_sync_manager(items=[])
    await sync.async_setup()
    await store.set_link(ENTITY_ID, LINK_ID)
    await sync.async_start_link(ENTITY_ID)

    transport.deliver(f"todo_overlay/link/{LINK_ID}/item/sync-1", {
        "origin": "some-other-instance",
        "sync_id": "sync-1",
        "updated_at": "2026-01-01T00:00:00+00:00",
        "deleted": False,
        "fields": {
            "title": "Bread", "completed": False, "description": None,
            "due_date": None, "due_datetime": None, "quantity": None, "tags": [],
        },
    })
    await _flush(hass)

    items = await adapter.get_items(ENTITY_ID)
    assert any(item.title == "Bread" for item in items)

    link = await store.get_link(ENTITY_ID)
    assert "sync-1" in link["sync_to_native"]


@pytest.mark.asyncio
async def test_incoming_create_does_not_trigger_a_runaway_echo_loop():
    """Live-reproduced bug: applying an incoming create via
    self._manager.create_item() (TodoManager) fired EVENT_ITEM_CHANGED,
    which link_sync's own event listener picked right back up as a
    LOCAL change - a brand new item_id has no sync mapping yet, so it
    couldn't be recognized as the echo it actually was - and
    republished it under a brand new sync_id. Each side then created
    another duplicate item in response to the other's republish,
    forever. Applying an incoming create must go through the adapter
    directly so it can never fire a TodoManager-style event for that
    item - regression-tested here with a real hass.bus.async_fire
    tracker, not the hass=None the other tests in this file use (which
    would silently mask this exact bug, since _fire_event no-ops when
    hass is None).

    _apply_incoming does fire its own "synced" marker event afterwards
    (see _notify_local_refresh) so open cards on this instance reload -
    the assertion below is that this marker is the ONLY thing that
    fires, and that _on_item_changed_event's guard against it stops it
    from ever being treated as a new local change to publish."""

    fired_events: list[tuple] = []

    class EventTrackingBus:
        @staticmethod
        def async_fire(event, data):
            fired_events.append((event, data))

        @staticmethod
        def async_listen(event_type, handler):
            return lambda: None

    class EventTrackingHass:
        def __init__(self) -> None:
            self.tasks: list[asyncio.Task] = []
            self.bus = EventTrackingBus()

        def async_create_task(self, coro):
            task = asyncio.ensure_future(coro)
            self.tasks.append(task)
            return task

    hass = EventTrackingHass()
    adapter = FakeAdapter(items=[])
    metadata_store = FakeMetadataStore()
    manager = TodoManager(adapter, metadata_store, hass=hass)
    transport = FakeTransport()
    sync = LinkSyncManager(hass, manager, metadata_store, adapter, transport)

    await sync.async_setup()
    await metadata_store.set_link(ENTITY_ID, LINK_ID)
    await sync.async_start_link(ENTITY_ID)
    transport.published.clear()  # drop the initial (empty) snapshot publish

    transport.deliver(f"todo_overlay/link/{LINK_ID}/item/sync-1", {
        "origin": "some-other-instance",
        "sync_id": "sync-1",
        "updated_at": "2026-01-01T00:00:00+00:00",
        "deleted": False,
        "fields": {
            "title": "Bread", "completed": False, "description": None,
            "due_date": None, "due_datetime": None, "quantity": None, "tags": [],
        },
    })
    await _flush(hass)

    assert any(item.title == "Bread" for item in await adapter.get_items(ENTITY_ID))
    assert len(fired_events) == 1
    event_type, data = fired_events[0]
    assert event_type == "todo_overlay_item_event"
    assert data["action"] == "synced"
    assert transport.published == []


@pytest.mark.asyncio
async def test_incoming_message_missing_a_title_is_ignored_without_crashing():
    """A link message is arbitrary JSON from the wire with no schema
    guarantee (a hostile/misbehaving peer, or a broker ACL misconfig
    letting unrelated traffic through) - a missing/invalid title must
    not raise out of the fire-and-forget task."""

    hass, adapter, store, manager, transport, sync = make_sync_manager(items=[])
    await sync.async_setup()
    await store.set_link(ENTITY_ID, LINK_ID)
    await sync.async_start_link(ENTITY_ID)

    transport.deliver(f"todo_overlay/link/{LINK_ID}/item/sync-1", {
        "origin": "some-other-instance",
        "sync_id": "sync-1",
        "updated_at": "2026-01-01T00:00:00+00:00",
        "deleted": False,
        "fields": {"completed": False},
    })
    await _flush(hass)

    assert await adapter.get_items(ENTITY_ID) == []


@pytest.mark.asyncio
async def test_incoming_message_with_non_dict_fields_is_ignored_without_crashing():
    hass, adapter, store, manager, transport, sync = make_sync_manager(items=[])
    await sync.async_setup()
    await store.set_link(ENTITY_ID, LINK_ID)
    await sync.async_start_link(ENTITY_ID)

    transport.deliver(f"todo_overlay/link/{LINK_ID}/item/sync-1", {
        "origin": "some-other-instance",
        "sync_id": "sync-1",
        "updated_at": "2026-01-01T00:00:00+00:00",
        "deleted": False,
        "fields": "not-a-dict",
    })
    await _flush(hass)

    assert await adapter.get_items(ENTITY_ID) == []


@pytest.mark.asyncio
async def test_incoming_message_title_is_capped_to_a_sane_length():
    hass, adapter, store, manager, transport, sync = make_sync_manager(items=[])
    await sync.async_setup()
    await store.set_link(ENTITY_ID, LINK_ID)
    await sync.async_start_link(ENTITY_ID)

    huge_title = "x" * 5000

    transport.deliver(f"todo_overlay/link/{LINK_ID}/item/sync-1", {
        "origin": "some-other-instance",
        "sync_id": "sync-1",
        "updated_at": "2026-01-01T00:00:00+00:00",
        "deleted": False,
        "fields": {
            "title": huge_title, "completed": False, "description": None,
            "due_date": None, "due_datetime": None, "quantity": None, "tags": [],
        },
    })
    await _flush(hass)

    items = await adapter.get_items(ENTITY_ID)
    assert len(items) == 1
    assert len(items[0].title) == 1000


@pytest.mark.asyncio
async def test_incoming_message_from_our_own_origin_is_ignored():
    hass, adapter, store, manager, transport, sync = make_sync_manager(items=[])
    await sync.async_setup()
    await store.set_link(ENTITY_ID, LINK_ID)
    await sync.async_start_link(ENTITY_ID)
    our_instance_id = await store.get_instance_id()

    transport.deliver(f"todo_overlay/link/{LINK_ID}/item/sync-1", {
        "origin": our_instance_id,
        "sync_id": "sync-1",
        "updated_at": "2026-01-01T00:00:00+00:00",
        "deleted": False,
        "fields": {"title": "Bread", "completed": False, "description": None,
                    "due_date": None, "due_datetime": None, "quantity": None, "tags": []},
    })
    await _flush(hass)

    assert await adapter.get_items(ENTITY_ID) == []


@pytest.mark.asyncio
async def test_incoming_delete_removes_the_local_item_and_tombstones_it():
    hass, adapter, store, manager, transport, sync = make_sync_manager(
        items=[TodoItem(id="1", title="Milk", completed=False)],
    )
    await sync.async_setup()
    await store.set_link(ENTITY_ID, LINK_ID)
    await store.set_native_sync_mapping(ENTITY_ID, "1", "sync-1")
    await sync.async_start_link(ENTITY_ID)

    transport.deliver(f"todo_overlay/link/{LINK_ID}/item/sync-1", {
        "origin": "some-other-instance",
        "sync_id": "sync-1",
        "updated_at": "2026-01-01T00:00:00+00:00",
        "deleted": True,
        "fields": None,
    })
    await _flush(hass)

    assert await adapter.get_items(ENTITY_ID) == []
    states = await store.get_all_link_item_states(ENTITY_ID)
    assert states["sync-1"]["deleted_at"] is not None


@pytest.mark.asyncio
async def test_incoming_update_notifies_local_refresh_for_open_cards():
    """The 0.16.3 live-sync feature relies on EVENT_ITEM_CHANGED to know
    when an open card should reload. Applying an incoming update never
    goes through TodoManager (see _apply_incoming), so without its own
    explicit _notify_local_refresh() call, a card open on the receiving
    instance would silently never refresh - live-reproduced bug: had to
    manually reload the page to see a remotely-applied change."""

    hass, adapter, store, manager, transport, sync = make_sync_manager(
        items=[TodoItem(id="1", title="Milk", completed=False)],
    )
    await sync.async_setup()
    await store.set_link(ENTITY_ID, LINK_ID)
    await store.set_native_sync_mapping(ENTITY_ID, "1", "sync-1")
    await sync.async_start_link(ENTITY_ID)
    hass.bus.fired.clear()

    transport.deliver(f"todo_overlay/link/{LINK_ID}/item/sync-1", {
        "origin": "some-other-instance",
        "sync_id": "sync-1",
        "updated_at": "2026-01-01T00:00:00+00:00",
        "deleted": False,
        "fields": {"title": "Milk", "completed": True, "description": None,
                    "due_date": None, "due_datetime": None, "quantity": None, "tags": []},
    })
    await _flush(hass)

    assert len(hass.bus.fired) == 1
    event_type, data = hass.bus.fired[0]
    assert event_type == "todo_overlay_item_event"
    assert data == {"entity_id": ENTITY_ID, "item_id": "1", "title": "Milk", "action": "synced"}


@pytest.mark.asyncio
async def test_incoming_delete_notifies_local_refresh_for_open_cards():
    hass, adapter, store, manager, transport, sync = make_sync_manager(
        items=[TodoItem(id="1", title="Milk", completed=False)],
    )
    await sync.async_setup()
    await store.set_link(ENTITY_ID, LINK_ID)
    await store.set_native_sync_mapping(ENTITY_ID, "1", "sync-1")
    await sync.async_start_link(ENTITY_ID)
    hass.bus.fired.clear()

    transport.deliver(f"todo_overlay/link/{LINK_ID}/item/sync-1", {
        "origin": "some-other-instance",
        "sync_id": "sync-1",
        "updated_at": "2026-01-01T00:00:00+00:00",
        "deleted": True,
        "fields": None,
    })
    await _flush(hass)

    assert len(hass.bus.fired) == 1
    event_type, data = hass.bus.fired[0]
    assert event_type == "todo_overlay_item_event"
    assert data == {"entity_id": ENTITY_ID, "item_id": "1", "title": "", "action": "synced"}


@pytest.mark.asyncio
async def test_stale_ignored_incoming_update_does_not_notify_local_refresh():
    hass, adapter, store, manager, transport, sync = make_sync_manager(
        items=[TodoItem(id="1", title="Milk", completed=False)],
    )
    await sync.async_setup()
    await store.set_link(ENTITY_ID, LINK_ID)
    await store.set_native_sync_mapping(ENTITY_ID, "1", "sync-1")
    await store.set_link_item_state(
        ENTITY_ID, "sync-1",
        updated_at="2026-06-01T00:00:00+00:00", deleted_at=None,
        fields={"title": "Milk", "completed": False, "description": None,
                "due_date": None, "due_datetime": None, "quantity": None, "tags": []},
    )
    await sync.async_start_link(ENTITY_ID)
    hass.bus.fired.clear()

    # Timestamped BEFORE what's already recorded - _apply_incoming returns
    # early via last-write-wins, so no refresh notification should fire.
    transport.deliver(f"todo_overlay/link/{LINK_ID}/item/sync-1", {
        "origin": "some-other-instance",
        "sync_id": "sync-1",
        "updated_at": "2026-01-01T00:00:00+00:00",
        "deleted": False,
        "fields": {"title": "Bread", "completed": False, "description": None,
                    "due_date": None, "due_datetime": None, "quantity": None, "tags": []},
    })
    await _flush(hass)

    assert hass.bus.fired == []


@pytest.mark.asyncio
async def test_older_incoming_update_is_ignored_last_write_wins():
    hass, adapter, store, manager, transport, sync = make_sync_manager(
        items=[TodoItem(id="1", title="Milk", completed=False)],
    )
    await sync.async_setup()
    await store.set_link(ENTITY_ID, LINK_ID)
    await store.set_native_sync_mapping(ENTITY_ID, "1", "sync-1")
    await store.set_link_item_state(
        ENTITY_ID, "sync-1",
        updated_at="2026-06-01T00:00:00+00:00", deleted_at=None,
        fields={"title": "Milk", "completed": False, "description": None,
                "due_date": None, "due_datetime": None, "quantity": None, "tags": []},
    )
    await sync.async_start_link(ENTITY_ID)

    # A message timestamped BEFORE what we already recorded must be ignored.
    transport.deliver(f"todo_overlay/link/{LINK_ID}/item/sync-1", {
        "origin": "some-other-instance",
        "sync_id": "sync-1",
        "updated_at": "2026-01-01T00:00:00+00:00",
        "deleted": False,
        "fields": {"title": "STALE TITLE", "completed": False, "description": None,
                    "due_date": None, "due_datetime": None, "quantity": None, "tags": []},
    })
    await _flush(hass)

    items = await adapter.get_items(ENTITY_ID)
    assert items[0].title == "Milk"


@pytest.mark.asyncio
async def test_tombstone_prevents_a_stale_create_from_resurrecting_a_deleted_item():
    hass, adapter, store, manager, transport, sync = make_sync_manager(items=[])
    await sync.async_setup()
    await store.set_link(ENTITY_ID, LINK_ID)
    await store.set_link_item_state(
        ENTITY_ID, "sync-1",
        updated_at="2026-06-01T00:00:00+00:00", deleted_at="2026-06-01T00:00:00+00:00", fields=None,
    )
    await sync.async_start_link(ENTITY_ID)

    # An old, reordered "create" for the already-deleted sync_id arrives late.
    transport.deliver(f"todo_overlay/link/{LINK_ID}/item/sync-1", {
        "origin": "some-other-instance",
        "sync_id": "sync-1",
        "updated_at": "2026-01-01T00:00:00+00:00",
        "deleted": False,
        "fields": {"title": "Zombie item", "completed": False, "description": None,
                    "due_date": None, "due_datetime": None, "quantity": None, "tags": []},
    })
    await _flush(hass)

    assert await adapter.get_items(ENTITY_ID) == []


@pytest.mark.asyncio
async def test_starting_a_link_publishes_a_retained_snapshot():
    hass, adapter, store, manager, transport, sync = make_sync_manager(
        items=[TodoItem(id="1", title="Milk", completed=False)],
    )
    await sync.async_setup()
    await store.set_link(ENTITY_ID, LINK_ID)
    await store.set_native_sync_mapping(ENTITY_ID, "1", "sync-1")
    await store.set_link_item_state(
        ENTITY_ID, "sync-1",
        updated_at="2026-06-01T00:00:00+00:00", deleted_at=None,
        fields={"title": "Milk", "completed": False, "description": None,
                "due_date": None, "due_datetime": None, "quantity": None, "tags": []},
    )

    await sync.async_start_link(ENTITY_ID)

    instance_id = await store.get_instance_id()
    snapshot_topic = f"todo_overlay/link/{LINK_ID}/snapshot/{instance_id}"
    matching = [p for t, p in transport.published if t == snapshot_topic]
    assert len(matching) == 1
    assert matching[0]["items"]["sync-1"]["fields"]["title"] == "Milk"


@pytest.mark.asyncio
async def test_receiving_a_snapshot_reconciles_missed_items():
    hass, adapter, store, manager, transport, sync = make_sync_manager(items=[])
    await sync.async_setup()
    await store.set_link(ENTITY_ID, LINK_ID)
    await sync.async_start_link(ENTITY_ID)

    transport.deliver(f"todo_overlay/link/{LINK_ID}/snapshot/some-other-instance", {
        "origin": "some-other-instance",
        "items": {
            "sync-1": {
                "updated_at": "2026-01-01T00:00:00+00:00",
                "deleted": False,
                "fields": {"title": "Eggs", "completed": False, "description": None,
                            "due_date": None, "due_datetime": None, "quantity": None, "tags": []},
            },
        },
    })
    await _flush(hass)

    items = await adapter.get_items(ENTITY_ID)
    assert any(item.title == "Eggs" for item in items)


@pytest.mark.asyncio
async def test_unlinked_entity_ignores_incoming_messages():
    hass, adapter, store, manager, transport, sync = make_sync_manager(items=[])
    await sync.async_setup()
    # Deliberately never linked or started - subscribe() was never called,
    # so there should be no handler registered at all.

    transport.deliver(f"todo_overlay/link/{LINK_ID}/item/sync-1", {
        "origin": "some-other-instance",
        "sync_id": "sync-1",
        "updated_at": "2026-01-01T00:00:00+00:00",
        "deleted": False,
        "fields": {"title": "Should not appear", "completed": False, "description": None,
                    "due_date": None, "due_datetime": None, "quantity": None, "tags": []},
    })
    await _flush(hass)

    assert await adapter.get_items(ENTITY_ID) == []


# --- position/hierarchy sync -------------------------------------------
#
# Live-reported: "reordering does not sync and setting a parent via
# reorder doesn't seem to work at all". Root cause - position/hierarchy
# was deliberately out of scope originally (see the module docstring's
# prior version): a pure "moved" action changes no CONTENT field at
# all, so the old fields-only echo-suppression check saw nothing
# different from what was already on record and silently skipped
# publishing anything. These tests cover the fix - position now rides
# the same upsert message content already used, gated by its own
# comparison against what's already on record (not just fields').


@pytest.mark.asyncio
async def test_moved_action_publishes_position_even_though_content_is_unchanged():
    """The exact bug reported: a pure reorder changes no CONTENT field,
    so the old fields-only "unchanged, skip" check swallowed it whole."""

    hass, adapter, store, manager, transport, sync = make_sync_manager(
        items=[
            TodoItem(id="parent", title="Home", completed=False),
            TodoItem(id="a", title="A", completed=False),
            TodoItem(id="b", title="B", completed=False),
        ],
        positions={
            "a": ItemPosition(parent_id="parent", order=0),
            "b": ItemPosition(parent_id="parent", order=1),
        },
    )
    await sync.async_setup()
    await store.set_link(ENTITY_ID, LINK_ID)
    await sync.async_start_link(ENTITY_ID)

    # Establish "a"'s baseline synced state (content only, no move yet).
    await sync.async_handle_local_change(ENTITY_ID, "a", "created")
    transport.published.clear()

    # Now genuinely reorder "a" relative to "b" - no content field of
    # "a" itself changes at all.
    await store.set_positions(ENTITY_ID, {
        "a": ItemPosition(parent_id="parent", order=1),
        "b": ItemPosition(parent_id="parent", order=0),
    })

    await sync.async_handle_local_change(ENTITY_ID, "a", "moved")

    assert len(transport.published) == 1
    _, payload = transport.published[0]
    assert payload["position"] is not None
    assert payload["position"]["placement"] == "after"


@pytest.mark.asyncio
async def test_local_move_describes_position_as_a_sync_id_reference_to_the_preceding_sibling():
    hass, adapter, store, manager, transport, sync = make_sync_manager(
        items=[
            TodoItem(id="parent", title="Home", completed=False),
            TodoItem(id="a", title="A", completed=False),
            TodoItem(id="b", title="B", completed=False),
        ],
        positions={
            "a": ItemPosition(parent_id="parent", order=0),
            "b": ItemPosition(parent_id="parent", order=1),
        },
    )
    await sync.async_setup()
    await store.set_link(ENTITY_ID, LINK_ID)
    await sync.async_start_link(ENTITY_ID)
    transport.published.clear()

    await sync.async_handle_local_change(ENTITY_ID, "b", "moved")

    assert len(transport.published) == 1
    _, payload = transport.published[0]
    assert payload["position"]["placement"] == "after"

    # "a" (b's preceding sibling) must have been lazily given its own
    # sync_id mapping purely so this reference could exist, even though
    # "a" itself has never had a content change published.
    link = await store.get_link(ENTITY_ID)
    reference_sync_id = payload["position"]["reference_sync_id"]
    assert link["sync_to_native"][reference_sync_id] == "a"


@pytest.mark.asyncio
async def test_local_move_of_an_only_child_describes_position_as_inside_its_parent():
    hass, adapter, store, manager, transport, sync = make_sync_manager(
        items=[
            TodoItem(id="parent", title="Home", completed=False),
            TodoItem(id="only-child", title="A", completed=False),
        ],
        positions={"only-child": ItemPosition(parent_id="parent", order=0)},
    )
    await sync.async_setup()
    await store.set_link(ENTITY_ID, LINK_ID)
    await sync.async_start_link(ENTITY_ID)
    transport.published.clear()

    await sync.async_handle_local_change(ENTITY_ID, "only-child", "moved")

    _, payload = transport.published[0]
    assert payload["position"]["placement"] == "inside"

    link = await store.get_link(ENTITY_ID)
    assert link["sync_to_native"][payload["position"]["reference_sync_id"]] == "parent"


@pytest.mark.asyncio
async def test_local_move_of_a_lone_root_item_has_no_position_to_describe():
    hass, adapter, store, manager, transport, sync = make_sync_manager(
        items=[TodoItem(id="only", title="A", completed=False)],
    )
    await sync.async_setup()
    await store.set_link(ENTITY_ID, LINK_ID)
    await sync.async_start_link(ENTITY_ID)
    transport.published.clear()

    await sync.async_handle_local_change(ENTITY_ID, "only", "moved")

    assert len(transport.published) == 1
    _, payload = transport.published[0]
    assert payload["position"] is None


@pytest.mark.asyncio
async def test_incoming_position_reorders_the_local_item_relative_to_its_sibling():
    hass, adapter, store, manager, transport, sync = make_sync_manager(
        items=[
            TodoItem(id="a", title="A", completed=False),
            TodoItem(id="b", title="B", completed=False),
        ],
        positions={
            "a": ItemPosition(parent_id=None, order=0),
            "b": ItemPosition(parent_id=None, order=1),
        },
    )
    await sync.async_setup()
    await store.set_link(ENTITY_ID, LINK_ID)
    await sync.async_start_link(ENTITY_ID)
    await store.set_native_sync_mapping(ENTITY_ID, "a", "sync-a")
    await store.set_native_sync_mapping(ENTITY_ID, "b", "sync-b")

    # Tell this side that "b" (native "b") should move to right before
    # "a" (native "a", referenced by its sync id) - the other instance's
    # own way of saying the same "before" move a local drag would.
    transport.deliver(f"todo_overlay/link/{LINK_ID}/item/sync-b", {
        "origin": "some-other-instance",
        "sync_id": "sync-b",
        "updated_at": "2026-01-01T00:00:00+00:00",
        "deleted": False,
        "fields": {"title": "B", "completed": False, "description": None,
                    "due_date": None, "due_datetime": None, "quantity": None, "tags": []},
        "position": {"reference_sync_id": "sync-a", "placement": "before"},
    })
    await _flush(hass)

    relationships = await store.get_relationships(ENTITY_ID)
    assert relationships["b"].order < relationships["a"].order


@pytest.mark.asyncio
async def test_incoming_position_nests_the_local_item_inside_its_new_parent():
    hass, adapter, store, manager, transport, sync = make_sync_manager(
        items=[
            TodoItem(id="parent", title="Home", completed=False),
            TodoItem(id="child", title="Firewall", completed=False),
        ],
    )
    await sync.async_setup()
    await store.set_link(ENTITY_ID, LINK_ID)
    await sync.async_start_link(ENTITY_ID)
    await store.set_native_sync_mapping(ENTITY_ID, "parent", "sync-parent")
    await store.set_native_sync_mapping(ENTITY_ID, "child", "sync-child")

    transport.deliver(f"todo_overlay/link/{LINK_ID}/item/sync-child", {
        "origin": "some-other-instance",
        "sync_id": "sync-child",
        "updated_at": "2026-01-01T00:00:00+00:00",
        "deleted": False,
        "fields": {"title": "Firewall", "completed": False, "description": None,
                    "due_date": None, "due_datetime": None, "quantity": None, "tags": []},
        "position": {"reference_sync_id": "sync-parent", "placement": "inside"},
    })
    await _flush(hass)

    relationships = await store.get_relationships(ENTITY_ID)
    assert relationships["child"].parent_id == "parent"


@pytest.mark.asyncio
async def test_incoming_create_with_position_places_the_new_item_under_the_right_parent():
    """Covers the OTHER half of "setting a parent... doesn't seem to
    work at all" - a brand new item created directly as a child (e.g.
    via per-parent quick-add) must land under the right parent on the
    other side too, not just get appended as a new root item."""

    hass, adapter, store, manager, transport, sync = make_sync_manager(
        items=[TodoItem(id="parent", title="Home", completed=False)],
    )
    await sync.async_setup()
    await store.set_link(ENTITY_ID, LINK_ID)
    await sync.async_start_link(ENTITY_ID)
    await store.set_native_sync_mapping(ENTITY_ID, "parent", "sync-parent")

    transport.deliver(f"todo_overlay/link/{LINK_ID}/item/sync-new", {
        "origin": "some-other-instance",
        "sync_id": "sync-new",
        "updated_at": "2026-01-01T00:00:00+00:00",
        "deleted": False,
        "fields": {"title": "VPN", "completed": False, "description": None,
                    "due_date": None, "due_datetime": None, "quantity": None, "tags": []},
        "position": {"reference_sync_id": "sync-parent", "placement": "inside"},
    })
    await _flush(hass)

    items = await adapter.get_items(ENTITY_ID)
    new_item = next(item for item in items if item.title == "VPN")

    relationships = await store.get_relationships(ENTITY_ID)
    assert relationships[new_item.id].parent_id == "parent"


@pytest.mark.asyncio
async def test_incoming_position_with_an_unresolvable_reference_is_skipped_without_crashing():
    """The referenced item hasn't synced to this side at all yet -
    content must still apply; position is silently left alone rather
    than raising or corrupting anything."""

    hass, adapter, store, manager, transport, sync = make_sync_manager(items=[])
    await sync.async_setup()
    await store.set_link(ENTITY_ID, LINK_ID)
    await sync.async_start_link(ENTITY_ID)

    transport.deliver(f"todo_overlay/link/{LINK_ID}/item/sync-1", {
        "origin": "some-other-instance",
        "sync_id": "sync-1",
        "updated_at": "2026-01-01T00:00:00+00:00",
        "deleted": False,
        "fields": {"title": "Bread", "completed": False, "description": None,
                    "due_date": None, "due_datetime": None, "quantity": None, "tags": []},
        "position": {"reference_sync_id": "sync-never-seen", "placement": "before"},
    })
    await _flush(hass)

    assert any(item.title == "Bread" for item in await adapter.get_items(ENTITY_ID))


@pytest.mark.asyncio
async def test_snapshot_resolves_a_child_that_references_a_parent_appearing_later_in_the_same_snapshot():
    """A snapshot's own dict has no guaranteed parent-before-child
    order - the two-pass apply (content for everything, then position
    for everything) must resolve this regardless of which order it
    happened to iterate in."""

    hass, adapter, store, manager, transport, sync = make_sync_manager(items=[])
    await sync.async_setup()
    await store.set_link(ENTITY_ID, LINK_ID)
    await sync.async_start_link(ENTITY_ID)

    transport.deliver(f"todo_overlay/link/{LINK_ID}/snapshot/some-other-instance", {
        "origin": "some-other-instance",
        "items": {
            # Child listed FIRST, referencing a parent whose own entry
            # (and therefore native_uid mapping) doesn't exist yet.
            "sync-child": {
                "updated_at": "2026-01-01T00:00:00+00:00",
                "deleted": False,
                "fields": {"title": "Firewall", "completed": False, "description": None,
                            "due_date": None, "due_datetime": None, "quantity": None, "tags": []},
                "position": {"reference_sync_id": "sync-parent", "placement": "inside"},
            },
            "sync-parent": {
                "updated_at": "2026-01-01T00:00:00+00:00",
                "deleted": False,
                "fields": {"title": "Home", "completed": False, "description": None,
                            "due_date": None, "due_datetime": None, "quantity": None, "tags": []},
                "position": None,
            },
        },
    })
    await _flush(hass)

    items = await adapter.get_items(ENTITY_ID)
    child = next(item for item in items if item.title == "Firewall")
    parent = next(item for item in items if item.title == "Home")

    relationships = await store.get_relationships(ENTITY_ID)
    assert relationships[child.id].parent_id == parent.id


@pytest.mark.asyncio
async def test_incoming_position_does_not_trigger_a_runaway_echo_loop():
    """Same class of bug as the create echo-loop test above, for
    position specifically: applying an incoming move via
    TodoManager.move_item() would fire EVENT_ITEM_CHANGED("moved"),
    which link_sync's own listener would pick up as a new LOCAL change
    and republish - forever. Position is applied via the manager's
    lock-free _reposition core directly (never move_item()), which
    fires no event at all, so only the "synced" refresh marker(s)
    should ever appear here."""

    class EventTrackingBus:
        def __init__(self) -> None:
            self.fired: list[tuple] = []

        def async_fire(self, event, data):
            self.fired.append((event, data))

        def async_listen(self, event_type, handler):
            return lambda: None

    class EventTrackingHass:
        def __init__(self) -> None:
            self.tasks: list[asyncio.Task] = []
            self.bus = EventTrackingBus()

        def async_create_task(self, coro):
            task = asyncio.ensure_future(coro)
            self.tasks.append(task)
            return task

    hass = EventTrackingHass()
    adapter = FakeAdapter(items=[
        TodoItem(id="a", title="A", completed=False),
        TodoItem(id="b", title="B", completed=False),
    ])
    metadata_store = FakeMetadataStore(positions={
        "a": ItemPosition(parent_id=None, order=0),
        "b": ItemPosition(parent_id=None, order=1),
    })
    manager = TodoManager(adapter, metadata_store, hass=hass)
    transport = FakeTransport()
    sync = LinkSyncManager(hass, manager, metadata_store, adapter, transport)

    await sync.async_setup()
    await metadata_store.set_link(ENTITY_ID, LINK_ID)
    await sync.async_start_link(ENTITY_ID)
    await metadata_store.set_native_sync_mapping(ENTITY_ID, "a", "sync-a")
    await metadata_store.set_native_sync_mapping(ENTITY_ID, "b", "sync-b")
    transport.published.clear()

    transport.deliver(f"todo_overlay/link/{LINK_ID}/item/sync-b", {
        "origin": "some-other-instance",
        "sync_id": "sync-b",
        "updated_at": "2026-01-01T00:00:00+00:00",
        "deleted": False,
        "fields": {"title": "B", "completed": False, "description": None,
                    "due_date": None, "due_datetime": None, "quantity": None, "tags": []},
        "position": {"reference_sync_id": "sync-a", "placement": "before"},
    })
    await _flush(hass)

    assert transport.published == []
    assert all(data["action"] == "synced" for _event_type, data in hass.bus.fired)


# --- pin_type sync -------------------------------------------------------


@pytest.mark.asyncio
async def test_local_pin_type_change_publishes_it_even_though_other_content_is_unchanged():
    """Mirrors the "moved" fix: pinning/unpinning an item changes no
    other content field, so it needs the same fields+position
    comparison (not fields alone) to avoid being silently swallowed as
    "unchanged"."""

    hass, adapter, store, manager, transport, sync = make_sync_manager(
        items=[TodoItem(id="1", title="Anna", completed=False)],
    )
    await sync.async_setup()
    await store.set_link(ENTITY_ID, LINK_ID)
    await sync.async_start_link(ENTITY_ID)

    await sync.async_handle_local_change(ENTITY_ID, "1", "created")
    transport.published.clear()

    await store.set_pin_type(ENTITY_ID, "1", "person")
    await sync.async_handle_local_change(ENTITY_ID, "1", "pin_type_changed")

    assert len(transport.published) == 1
    _, payload = transport.published[0]
    assert payload["fields"]["pin_type"] == "person"


@pytest.mark.asyncio
async def test_incoming_pin_type_is_applied_locally():
    hass, adapter, store, manager, transport, sync = make_sync_manager(items=[])
    await sync.async_setup()
    await store.set_link(ENTITY_ID, LINK_ID)
    await sync.async_start_link(ENTITY_ID)

    transport.deliver(f"todo_overlay/link/{LINK_ID}/item/sync-1", {
        "origin": "some-other-instance",
        "sync_id": "sync-1",
        "updated_at": "2026-01-01T00:00:00+00:00",
        "deleted": False,
        "fields": {"title": "Brodie", "completed": False, "description": None,
                    "due_date": None, "due_datetime": None, "quantity": None, "tags": [],
                    "pin_type": "person"},
    })
    await _flush(hass)

    items = await adapter.get_items(ENTITY_ID)
    new_item = next(item for item in items if item.title == "Brodie")

    pin_types = await store.get_pin_types(ENTITY_ID)
    assert pin_types[new_item.id] == "person"


@pytest.mark.asyncio
async def test_incoming_message_with_an_invalid_pin_type_falls_back_to_none_without_crashing():
    """Same "arbitrary JSON from the wire" defensiveness as every other
    incoming field - an invalid pin_type must not be applied verbatim,
    and must not crash the fire-and-forget task."""

    hass, adapter, store, manager, transport, sync = make_sync_manager(items=[])
    await sync.async_setup()
    await store.set_link(ENTITY_ID, LINK_ID)
    await sync.async_start_link(ENTITY_ID)

    transport.deliver(f"todo_overlay/link/{LINK_ID}/item/sync-1", {
        "origin": "some-other-instance",
        "sync_id": "sync-1",
        "updated_at": "2026-01-01T00:00:00+00:00",
        "deleted": False,
        "fields": {"title": "Bread", "completed": False, "description": None,
                    "due_date": None, "due_datetime": None, "quantity": None, "tags": [],
                    "pin_type": "not-a-real-type"},
    })
    await _flush(hass)

    items = await adapter.get_items(ENTITY_ID)
    new_item = next(item for item in items if item.title == "Bread")

    pin_types = await store.get_pin_types(ENTITY_ID)
    assert pin_types.get(new_item.id) is None


# --- delete_protected sync -------------------------------------------------
#
# Synced (unlike trigger_on_due, deliberately NOT in _SYNCED_FIELDS -
# see its own comment there) because "don't delete this item" is a
# property of the item itself, not of one particular HA instance's own
# config - a "person" pin like "Brodie"/"Anna" only stays meaningfully
# protected if BOTH sides of a shared list agree on it. Otherwise the
# whole point (avoid inadvertently deleting one side's own person pin)
# would be trivially bypassed by deleting it from the OTHER instance.


@pytest.mark.asyncio
async def test_local_delete_protected_change_publishes_it_even_though_other_content_is_unchanged():
    hass, adapter, store, manager, transport, sync = make_sync_manager(
        items=[TodoItem(id="1", title="Anna", completed=False)],
    )
    await sync.async_setup()
    await store.set_link(ENTITY_ID, LINK_ID)
    await sync.async_start_link(ENTITY_ID)

    await sync.async_handle_local_change(ENTITY_ID, "1", "created")
    transport.published.clear()

    await store.set_delete_protected(ENTITY_ID, "1", True)
    await sync.async_handle_local_change(ENTITY_ID, "1", "updated")

    assert len(transport.published) == 1
    _, payload = transport.published[0]
    assert payload["fields"]["delete_protected"] is True


@pytest.mark.asyncio
async def test_incoming_delete_protected_is_applied_locally_on_create():
    hass, adapter, store, manager, transport, sync = make_sync_manager(items=[])
    await sync.async_setup()
    await store.set_link(ENTITY_ID, LINK_ID)
    await sync.async_start_link(ENTITY_ID)

    transport.deliver(f"todo_overlay/link/{LINK_ID}/item/sync-1", {
        "origin": "some-other-instance",
        "sync_id": "sync-1",
        "updated_at": "2026-01-01T00:00:00+00:00",
        "deleted": False,
        "fields": {"title": "Brodie", "completed": False, "description": None,
                    "due_date": None, "due_datetime": None, "quantity": None, "tags": [],
                    "pin_type": "person", "delete_protected": True},
    })
    await _flush(hass)

    items = await adapter.get_items(ENTITY_ID)
    new_item = next(item for item in items if item.title == "Brodie")

    delete_protected = await store.get_delete_protected(ENTITY_ID)
    assert new_item.id in delete_protected


@pytest.mark.asyncio
async def test_incoming_delete_protected_is_applied_locally_on_update():
    hass, adapter, store, manager, transport, sync = make_sync_manager(
        items=[TodoItem(id="1", title="Brodie", completed=False)],
    )
    await sync.async_setup()
    await store.set_link(ENTITY_ID, LINK_ID)
    await sync.async_start_link(ENTITY_ID)
    await store.set_native_sync_mapping(ENTITY_ID, "1", "sync-1")

    transport.deliver(f"todo_overlay/link/{LINK_ID}/item/sync-1", {
        "origin": "some-other-instance",
        "sync_id": "sync-1",
        "updated_at": "2026-01-01T00:00:00+00:00",
        "deleted": False,
        "fields": {"title": "Brodie", "completed": False, "description": None,
                    "due_date": None, "due_datetime": None, "quantity": None, "tags": [],
                    "pin_type": None, "delete_protected": True},
    })
    await _flush(hass)

    delete_protected = await store.get_delete_protected(ENTITY_ID)
    assert "1" in delete_protected
