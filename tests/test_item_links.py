"""Tests for item_links.py - mirroring a single item onto another item,
possibly on a completely different todo.* entity (distinct from
link_sync.py's own whole-ENTITY cross-instance MQTT sync).

Following this project's own established convention (see
test_link_sync.py's own comment): async_handle_item_changed() is driven
directly rather than through a simulated real event-bus round trip -
that's exactly the same "business-logic entry point, not HA's dispatch
machinery" split link_sync.py's own async_handle_local_change already
uses, and its test suite already tests it this same way.
"""

import pytest

from custom_components.todo_overlay.errors import ItemLinkTargetNotFoundError, ItemNotFoundError
from custom_components.todo_overlay.item_links import ItemLinkManager
from custom_components.todo_overlay.manager import TodoManager
from custom_components.todo_overlay.models import ItemPosition, TodoItem

from fakes import FakeMultiEntityAdapter, FakeMultiEntityMetadataStore

SOURCE = "todo.travel"
TARGET = "todo.shared"


def make_item_links(
    manager: TodoManager,
    metadata_store,
    adapter,
    default_enabled: bool = False,
    default_target_item_id: str | None = None,
) -> ItemLinkManager:
    return ItemLinkManager(
        hass=None,
        manager=manager,
        metadata_store=metadata_store,
        adapter=adapter,
        default_enabled=default_enabled,
        default_target_item_id=default_target_item_id,
    )


def make_cross_entity(
    source_items: list[TodoItem],
    target_items: list[TodoItem] | None = None,
) -> tuple[TodoManager, ItemLinkManager, FakeMultiEntityAdapter, FakeMultiEntityMetadataStore]:
    adapter = FakeMultiEntityAdapter({SOURCE: source_items, TARGET: target_items or []})
    metadata_store = FakeMultiEntityMetadataStore()
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)
    item_links = make_item_links(manager, metadata_store, adapter)

    return manager, item_links, adapter, metadata_store


# --- link_item ---------------------------------------------------------

@pytest.mark.asyncio
async def test_link_item_creates_a_mirror_and_records_both_sides():
    manager, item_links, adapter, metadata_store = make_cross_entity(
        [TodoItem(id="tent", title="Tent", completed=False, description="4-person")],
    )

    new_id = await item_links.link_item(SOURCE, "tent", target_entity_id=TARGET)

    target_items = await adapter.get_items(TARGET)
    assert len(target_items) == 1
    assert target_items[0].id == new_id
    assert target_items[0].title == "Tent"
    assert target_items[0].description == "4-person"

    source_link = await metadata_store.get_item_link(SOURCE, "tent")
    target_link = await metadata_store.get_item_link(TARGET, new_id)
    assert source_link == {"entity_id": TARGET, "item_id": new_id}
    assert target_link == {"entity_id": SOURCE, "item_id": "tent"}


@pytest.mark.asyncio
async def test_link_item_files_under_an_explicit_target_parent_override():
    manager, item_links, adapter, metadata_store = make_cross_entity(
        [TodoItem(id="tent", title="Tent", completed=False)],
        [TodoItem(id="brodie", title="Brodie", completed=False)],
    )

    new_id = await item_links.link_item(
        SOURCE, "tent", target_entity_id=TARGET, target_parent_id="brodie",
    )

    positions = await metadata_store.get_relationships(TARGET)
    assert positions[new_id].parent_id == "brodie"


@pytest.mark.asyncio
async def test_link_item_copies_quantity_tags_and_completed_at_creation_time():
    manager, item_links, adapter, metadata_store = make_cross_entity(
        [TodoItem(id="tent", title="Tent", completed=True)],
    )
    await metadata_store.set_quantity(SOURCE, "tent", "1")
    await metadata_store.set_tags(SOURCE, "tent", ["camping"])

    new_id = await item_links.link_item(SOURCE, "tent", target_entity_id=TARGET)

    assert (await metadata_store.get_quantities(TARGET)).get(new_id) == "1"
    assert (await metadata_store.get_tags(TARGET)).get(new_id) == ["camping"]

    target_items = await adapter.get_items(TARGET)
    assert target_items[0].completed is True


@pytest.mark.asyncio
async def test_link_item_raises_for_an_unknown_source_item():
    manager, item_links, adapter, metadata_store = make_cross_entity([])

    with pytest.raises(ItemNotFoundError):
        await item_links.link_item(SOURCE, "does-not-exist", target_entity_id=TARGET)


@pytest.mark.asyncio
async def test_link_item_raises_when_no_target_given_and_no_linked_entities_configured():
    manager, item_links, adapter, metadata_store = make_cross_entity(
        [TodoItem(id="tent", title="Tent", completed=False)],
    )

    with pytest.raises(ItemLinkTargetNotFoundError):
        await item_links.link_item(SOURCE, "tent")


@pytest.mark.asyncio
async def test_link_item_raises_when_more_than_one_linked_entity_is_configured():
    manager, item_links, adapter, metadata_store = make_cross_entity(
        [TodoItem(id="tent", title="Tent", completed=False)],
    )
    await metadata_store.set_link(TARGET, "link-1")
    await metadata_store.set_link("todo.other_shared", "link-2")

    with pytest.raises(ItemLinkTargetNotFoundError):
        await item_links.link_item(SOURCE, "tent")


@pytest.mark.asyncio
async def test_link_item_auto_resolves_the_single_configured_linked_entity():
    manager, item_links, adapter, metadata_store = make_cross_entity(
        [TodoItem(id="tent", title="Tent", completed=False)],
    )
    await metadata_store.set_link(TARGET, "link-1")

    await item_links.link_item(SOURCE, "tent")

    target_items = await adapter.get_items(TARGET)
    assert len(target_items) == 1
    assert target_items[0].title == "Tent"


@pytest.mark.asyncio
async def test_link_item_files_under_the_configured_default_parent_when_enabled():
    adapter = FakeMultiEntityAdapter({
        SOURCE: [TodoItem(id="tent", title="Tent", completed=False)],
        TARGET: [TodoItem(id="brodie", title="Brodie", completed=False)],
    })
    metadata_store = FakeMultiEntityMetadataStore()
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)
    item_links = make_item_links(
        manager, metadata_store, adapter, default_enabled=True, default_target_item_id="brodie",
    )
    await metadata_store.set_link(TARGET, "link-1")

    new_id = await item_links.link_item(SOURCE, "tent")

    positions = await metadata_store.get_relationships(TARGET)
    assert positions[new_id].parent_id == "brodie"


@pytest.mark.asyncio
async def test_link_item_ignores_the_default_parent_when_the_toggle_is_off():
    adapter = FakeMultiEntityAdapter({
        SOURCE: [TodoItem(id="tent", title="Tent", completed=False)],
        TARGET: [TodoItem(id="brodie", title="Brodie", completed=False)],
    })
    metadata_store = FakeMultiEntityMetadataStore()
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)
    item_links = make_item_links(
        manager, metadata_store, adapter, default_enabled=False, default_target_item_id="brodie",
    )
    await metadata_store.set_link(TARGET, "link-1")

    new_id = await item_links.link_item(SOURCE, "tent")

    positions = await metadata_store.get_relationships(TARGET)
    assert positions.get(new_id, ItemPosition(parent_id=None, order=0)).parent_id is None


@pytest.mark.asyncio
async def test_link_item_falls_back_to_root_and_does_not_raise_when_the_configured_default_is_gone():
    adapter = FakeMultiEntityAdapter({
        SOURCE: [TodoItem(id="tent", title="Tent", completed=False)],
        TARGET: [],
    })
    metadata_store = FakeMultiEntityMetadataStore()
    manager = TodoManager(adapter=adapter, metadata_store=metadata_store)
    item_links = make_item_links(
        manager, metadata_store, adapter, default_enabled=True, default_target_item_id="brodie",
    )
    await metadata_store.set_link(TARGET, "link-1")

    new_id = await item_links.link_item(SOURCE, "tent")

    positions = await metadata_store.get_relationships(TARGET)
    assert positions.get(new_id, ItemPosition(parent_id=None, order=0)).parent_id is None


# --- unlink_item ---------------------------------------------------------

@pytest.mark.asyncio
async def test_unlink_item_severs_the_pairing_without_deleting_either_item():
    manager, item_links, adapter, metadata_store = make_cross_entity(
        [TodoItem(id="tent", title="Tent", completed=False)],
    )
    new_id = await item_links.link_item(SOURCE, "tent", target_entity_id=TARGET)

    await item_links.unlink_item(SOURCE, "tent")

    assert await metadata_store.get_item_link(SOURCE, "tent") is None
    assert await metadata_store.get_item_link(TARGET, new_id) is None
    assert len(await adapter.get_items(SOURCE)) == 1
    assert len(await adapter.get_items(TARGET)) == 1


@pytest.mark.asyncio
async def test_unlink_item_is_a_no_op_for_an_item_that_was_never_linked():
    manager, item_links, adapter, metadata_store = make_cross_entity(
        [TodoItem(id="tent", title="Tent", completed=False)],
    )

    await item_links.unlink_item(SOURCE, "tent")  # should not raise


# --- async_handle_item_changed: content propagation -----------------------

@pytest.mark.asyncio
async def test_propagates_a_title_change_to_the_linked_partner():
    manager, item_links, adapter, metadata_store = make_cross_entity(
        [TodoItem(id="tent", title="Tent", completed=False)],
    )
    await item_links.link_item(SOURCE, "tent", target_entity_id=TARGET)

    await manager.update_item(SOURCE, "tent", title="4-person tent")
    await item_links.async_handle_item_changed(SOURCE, "tent", "updated")

    target_items = await adapter.get_items(TARGET)
    assert target_items[0].title == "4-person tent"


@pytest.mark.asyncio
async def test_propagates_completed_in_both_directions():
    manager, item_links, adapter, metadata_store = make_cross_entity(
        [TodoItem(id="tent", title="Tent", completed=False)],
    )
    new_id = await item_links.link_item(SOURCE, "tent", target_entity_id=TARGET)

    await manager.set_completed(SOURCE, "tent", True)
    await item_links.async_handle_item_changed(SOURCE, "tent", "completed")

    target_items = await adapter.get_items(TARGET)
    assert target_items[0].completed is True

    # And back the other way.
    await manager.set_completed(TARGET, new_id, False)
    await item_links.async_handle_item_changed(TARGET, new_id, "uncompleted")

    source_items = await adapter.get_items(SOURCE)
    assert source_items[0].completed is False


@pytest.mark.asyncio
async def test_propagates_quantity_and_tags():
    manager, item_links, adapter, metadata_store = make_cross_entity(
        [TodoItem(id="tent", title="Tent", completed=False)],
    )
    new_id = await item_links.link_item(SOURCE, "tent", target_entity_id=TARGET)

    await manager.set_quantity(SOURCE, "tent", "2")
    await manager.set_tags(SOURCE, "tent", ["camping", "urgent"])
    await item_links.async_handle_item_changed(SOURCE, "tent", "tags_replaced")

    assert (await metadata_store.get_quantities(TARGET)).get(new_id) == "2"
    assert sorted((await metadata_store.get_tags(TARGET)).get(new_id, [])) == ["camping", "urgent"]


@pytest.mark.asyncio
async def test_does_nothing_for_an_item_that_is_not_linked_at_all():
    manager, item_links, adapter, metadata_store = make_cross_entity(
        [TodoItem(id="tent", title="Tent", completed=False)],
    )

    # No exception, no side effect - just a plain unlinked item.
    await item_links.async_handle_item_changed(SOURCE, "tent", "updated")

    assert len(await adapter.get_items(TARGET)) == 0


@pytest.mark.asyncio
async def test_idempotent_reapplying_an_already_matching_change_writes_nothing_further():
    """The mechanism that makes this self-terminating without a separate
    reentrancy flag - see _propagate_content's own comment. Once both
    sides already agree, handling the change again must be a genuine
    no-op (no further manager calls), not just "doesn't crash" - this
    is what actually stops A -> B -> A -> B... from looping forever in
    the real event-driven path."""

    manager, item_links, adapter, metadata_store = make_cross_entity(
        [TodoItem(id="tent", title="Tent", completed=True)],
    )
    new_id = await item_links.link_item(SOURCE, "tent", target_entity_id=TARGET)

    # Both sides already match (link_item copies completed at creation) -
    # handling the target's own "completed" event must not touch the
    # source, or set_completed_calls would grow.
    calls_before = list(adapter.set_completed_calls)

    await item_links.async_handle_item_changed(TARGET, new_id, "completed")

    assert adapter.set_completed_calls == calls_before


# --- async_handle_item_changed: delete cascade -----------------------------

@pytest.mark.asyncio
async def test_deleting_the_source_deletes_the_linked_target_too():
    manager, item_links, adapter, metadata_store = make_cross_entity(
        [TodoItem(id="tent", title="Tent", completed=False)],
    )
    new_id = await item_links.link_item(SOURCE, "tent", target_entity_id=TARGET)

    await manager.delete_item(SOURCE, "tent")
    await item_links.async_handle_item_changed(SOURCE, "tent", "removed")

    assert all(item.id != new_id for item in await adapter.get_items(TARGET))
    assert await metadata_store.get_item_link(SOURCE, "tent") is None
    assert await metadata_store.get_item_link(TARGET, new_id) is None


@pytest.mark.asyncio
async def test_delete_cascade_does_not_error_if_the_partner_is_somehow_already_gone():
    manager, item_links, adapter, metadata_store = make_cross_entity(
        [TodoItem(id="tent", title="Tent", completed=False)],
    )
    new_id = await item_links.link_item(SOURCE, "tent", target_entity_id=TARGET)

    # The partner vanished through some other path first (e.g. deleted
    # directly on the native card) - the pairing must still get cleaned
    # up without raising.
    await adapter.remove_item(TARGET, new_id)

    await item_links.async_handle_item_changed(SOURCE, "tent", "removed")

    assert await metadata_store.get_item_link(SOURCE, "tent") is None


@pytest.mark.asyncio
async def test_delete_cascade_leaves_a_delete_protected_partner_alive_and_still_linked():
    # If the pairing were dropped unconditionally up front (the old
    # order), a protected partner would survive as a silently orphaned
    # item - alive, but with no link left to signal it was ever
    # mirrored to anything. Both sides of the pairing must survive
    # together here, not just the target item itself.
    manager, item_links, adapter, metadata_store = make_cross_entity(
        [TodoItem(id="tent", title="Tent", completed=False)],
    )
    new_id = await item_links.link_item(SOURCE, "tent", target_entity_id=TARGET)
    await metadata_store.set_delete_protected(TARGET, new_id, True)

    await manager.delete_item(SOURCE, "tent")
    await item_links.async_handle_item_changed(SOURCE, "tent", "removed")

    assert any(item.id == new_id for item in await adapter.get_items(TARGET))
    assert await metadata_store.get_item_link(TARGET, new_id) == {"entity_id": SOURCE, "item_id": "tent"}
