import asyncio
import json

import pytest

from custom_components.todo_overlay.link_sync import LinkSyncManager
from custom_components.todo_overlay.manager import TodoManager
from custom_components.todo_overlay.models import TodoItem

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
    to actually dispatch."""

    def async_listen(self, event_type, handler):
        return lambda: None


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


def make_sync_manager(items=None):
    hass = FakeHass()
    adapter = FakeAdapter(items=items if items is not None else [])
    metadata_store = FakeMetadataStore()
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
