"""Shared lightweight test doubles for TodoManager's two collaborators.

Deliberately hand-rolled rather than backed by a real Home Assistant
instance - see the backend hardening pass's commit message for why
pytest-homeassistant-custom-component isn't used here (a hard
pytest-asyncio version conflict with this project's pinned dependencies).
These fakes exercise TodoManager's actual business logic in exactly the
same way a real adapter/store would, just without any I/O.
"""

import asyncio

from custom_components.todo_overlay.models import ItemPosition, TodoItem


class FakeConfigEntry:
    """Stands in for a real ConfigEntry - just enough for get_manager()/
    get_metadata_store()/get_link_sync() (see runtime_data.py) to find
    their respective .runtime_data attributes."""

    def __init__(self, manager, metadata_store=None, link_sync=None) -> None:
        self.runtime_data = type("FakeRuntimeData", (), {
            "manager": manager,
            "metadata_store": metadata_store,
            "link_sync": link_sync,
        })()


class FakeConfigEntries:
    """Stands in for hass.config_entries - get_manager() looks up the
    integration's single config entry through here rather than hass.data,
    since websocket/service handlers only ever receive `hass`."""

    def __init__(self, manager, metadata_store=None, link_sync=None) -> None:
        self._entries = [FakeConfigEntry(manager, metadata_store, link_sync)]

    def async_entries(self, domain: str):
        return self._entries


class FakeAdapter:

    def __init__(self, items: list[TodoItem] | None = None) -> None:
        self._items = (
            items
            if items is not None
            else [
                TodoItem(id="1", title="Shopping", completed=False),
                TodoItem(id="2", title="Milk", completed=False),
            ]
        )
        self.set_completed_calls: list[tuple[str, str, bool]] = []
        self.remove_item_calls: list[tuple[str, str]] = []
        self.add_item_calls: list[tuple[str, str]] = []
        self._next_id = 0
        # Only used by concurrency tests: when set, get_items() records a
        # "start"/"end" marker into get_items_call_order and, on the first
        # call, waits on this event before returning - letting a test
        # pause one caller mid-read to see whether a second caller can
        # interleave with it.
        self.get_items_gate: asyncio.Event | None = None
        self.get_items_call_order: list[str] = []

    async def get_items(
        self,
        entity_id: str,
    ) -> list[TodoItem]:
        if self.get_items_gate is not None:
            self.get_items_call_order.append("start")

            if len(self.get_items_call_order) == 1:
                await self.get_items_gate.wait()

            self.get_items_call_order.append("end")

        # A fresh list every call, matching ha_adapter.py's own real
        # get_items() (which builds brand new TodoItem objects from
        # entity.todo_items on every call) - callers are entitled to
        # treat what they got back as an owned working copy they can
        # freely filter/extend (see manager_rollover.py's own
        # _ensure_overdue_parent) without that silently aliasing this
        # fake's own internal state via a later add_item()/remove_item().
        return list(self._items)

    async def set_completed(
        self,
        entity_id: str,
        item_id: str,
        completed: bool,
    ) -> None:
        self.set_completed_calls.append((entity_id, item_id, completed))

        for item in self._items:
            if item.id == item_id:
                item.completed = completed

    async def remove_item(
        self,
        entity_id: str,
        item_id: str,
    ) -> None:
        self.remove_item_calls.append((entity_id, item_id))
        self._items = [item for item in self._items if item.id != item_id]

    async def add_item(
        self,
        entity_id: str,
        title: str,
        description: str | None = None,
        due_date: str | None = None,
        due_datetime: str | None = None,
    ) -> str:
        self._next_id += 1
        new_id = f"new-{self._next_id}"

        self._items.append(TodoItem(
            id=new_id,
            title=title,
            completed=False,
            description=description,
            due_date=due_date,
            due_datetime=due_datetime,
        ))
        self.add_item_calls.append((entity_id, title))

        return new_id

    async def update_item(
        self,
        entity_id: str,
        item_id: str,
        *,
        title: str | None = None,
        description: str | None = None,
        due_date: str | None = None,
        due_datetime: str | None = None,
    ) -> None:
        for item in self._items:
            if item.id == item_id:
                if title is not None:
                    item.title = title
                item.description = description
                item.due_date = due_date
                item.due_datetime = due_datetime


class FakeMetadataStore:

    def __init__(self, positions: dict[str, ItemPosition] | None = None) -> None:
        self._positions = positions or {}
        self.set_positions_calls: list[tuple[str, dict[str, ItemPosition]]] = []
        self._snapshots: dict[str, dict] = {}
        self._quantities: dict[str, str] = {}
        self._tags: dict[str, list[str]] = {}
        self._pin_types: dict[str, str] = {}
        self._trigger_on_due: set[str] = set()
        self._due_fired: dict[str, str] = {}
        self._instance_id: str | None = None
        self._links: dict[str, dict] = {}
        self._link_item_state: dict[str, dict] = {}
        self._item_links: dict[str, dict] = {}
        self._delete_protected: set[str] = set()
        self._weekdays: dict[str, int] = {}
        self._last_rollover_date: str | None = None

    async def get_last_rollover_date(self, entity_id: str) -> str | None:
        return self._last_rollover_date

    async def set_last_rollover_date(self, entity_id: str, date_str: str) -> None:
        self._last_rollover_date = date_str

    async def get_relationships(self, entity_id: str) -> dict[str, ItemPosition]:
        return dict(self._positions)

    async def get_quantities(self, entity_id: str) -> dict[str, str]:
        return dict(self._quantities)

    async def set_quantity(
        self,
        entity_id: str,
        item_id: str,
        quantity: str | None,
    ) -> None:
        if quantity:
            self._quantities[item_id] = quantity
        else:
            self._quantities.pop(item_id, None)

    async def remove_quantities(
        self,
        entity_id: str,
        item_ids: list[str],
    ) -> None:
        for item_id in item_ids:
            self._quantities.pop(item_id, None)

    async def get_pin_types(self, entity_id: str) -> dict[str, str]:
        return dict(self._pin_types)

    async def set_pin_type(
        self,
        entity_id: str,
        item_id: str,
        pin_type: str | None,
    ) -> None:
        if pin_type:
            self._pin_types[item_id] = pin_type
        else:
            self._pin_types.pop(item_id, None)

    async def remove_pin_types(
        self,
        entity_id: str,
        item_ids: list[str],
    ) -> None:
        for item_id in item_ids:
            self._pin_types.pop(item_id, None)

    async def get_weekdays(self, entity_id: str) -> dict[str, int]:
        return dict(self._weekdays)

    async def set_weekday(
        self,
        entity_id: str,
        item_id: str,
        weekday: int | None,
    ) -> None:
        if weekday is not None:
            self._weekdays[item_id] = weekday
        else:
            self._weekdays.pop(item_id, None)

    async def remove_weekdays(
        self,
        entity_id: str,
        item_ids: list[str],
    ) -> None:
        for item_id in item_ids:
            self._weekdays.pop(item_id, None)

    async def get_item_link(self, entity_id: str, item_id: str) -> dict | None:
        return self._item_links.get(item_id)

    async def get_item_links(self, entity_id: str) -> dict[str, dict]:
        return dict(self._item_links)

    async def set_item_link(
        self,
        entity_id: str,
        item_id: str,
        linked_entity_id: str,
        linked_item_id: str,
    ) -> None:
        self._item_links[item_id] = {"entity_id": linked_entity_id, "item_id": linked_item_id}

    async def remove_item_link(self, entity_id: str, item_id: str) -> None:
        self._item_links.pop(item_id, None)

    async def get_tags(self, entity_id: str) -> dict[str, list[str]]:
        return {k: list(v) for k, v in self._tags.items()}

    async def set_tags(
        self,
        entity_id: str,
        item_id: str,
        tags: list[str],
    ) -> None:
        if tags:
            self._tags[item_id] = list(tags)
        else:
            self._tags.pop(item_id, None)

    async def add_tag(
        self,
        entity_id: str,
        item_id: str,
        tag: str,
    ) -> None:
        tags = self._tags.setdefault(item_id, [])
        if tag not in tags:
            tags.append(tag)

    async def remove_tag(
        self,
        entity_id: str,
        item_id: str,
        tag: str,
    ) -> None:
        tags = self._tags.get(item_id)
        if tags and tag in tags:
            tags.remove(tag)
            if not tags:
                self._tags.pop(item_id, None)

    async def remove_tags_for_items(
        self,
        entity_id: str,
        item_ids: list[str],
    ) -> None:
        for item_id in item_ids:
            self._tags.pop(item_id, None)

    async def get_trigger_on_due(self, entity_id: str) -> set[str]:
        return set(self._trigger_on_due)

    async def set_trigger_on_due(
        self,
        entity_id: str,
        item_id: str,
        enabled: bool,
    ) -> None:
        if enabled:
            self._trigger_on_due.add(item_id)
        else:
            self._trigger_on_due.discard(item_id)

    async def remove_trigger_on_due_for_items(
        self,
        entity_id: str,
        item_ids: list[str],
    ) -> None:
        for item_id in item_ids:
            self._trigger_on_due.discard(item_id)

    async def get_delete_protected(self, entity_id: str) -> set[str]:
        return set(self._delete_protected)

    async def set_delete_protected(
        self,
        entity_id: str,
        item_id: str,
        enabled: bool,
    ) -> None:
        if enabled:
            self._delete_protected.add(item_id)
        else:
            self._delete_protected.discard(item_id)

    async def remove_delete_protected_for_items(
        self,
        entity_id: str,
        item_ids: list[str],
    ) -> None:
        for item_id in item_ids:
            self._delete_protected.discard(item_id)

    async def get_due_fired(self, entity_id: str) -> dict[str, str]:
        return dict(self._due_fired)

    async def set_due_fired(
        self,
        entity_id: str,
        item_id: str,
        due_value: str,
    ) -> None:
        self._due_fired[item_id] = due_value

    async def remove_due_fired_for_items(
        self,
        entity_id: str,
        item_ids: list[str],
    ) -> None:
        for item_id in item_ids:
            self._due_fired.pop(item_id, None)

    async def set_positions(
        self,
        entity_id: str,
        positions: dict[str, ItemPosition],
    ) -> None:
        self.set_positions_calls.append((entity_id, dict(positions)))
        self._positions.update(positions)

    async def remove_positions(
        self,
        entity_id: str,
        item_ids: list[str],
    ) -> None:
        for item_id in item_ids:
            self._positions.pop(item_id, None)

    async def clear_positions(
        self,
        entity_id: str,
    ) -> None:
        self._positions = {}

    async def save_snapshot(
        self,
        name: str,
        snapshot: list[dict],
    ) -> None:
        self._snapshots[name] = snapshot

    async def get_snapshot(
        self,
        name: str,
    ) -> list[dict] | None:
        return self._snapshots.get(name)

    async def list_snapshots(
        self,
    ) -> list[str]:
        return sorted(self._snapshots.keys())

    async def delete_snapshot(
        self,
        name: str,
    ) -> None:
        self._snapshots.pop(name, None)

    async def get_instance_id(self) -> str:
        if self._instance_id is None:
            import uuid
            self._instance_id = uuid.uuid4().hex
        return self._instance_id

    async def get_all_linked_entity_ids(self) -> list[str]:
        return list(self._links)

    async def get_link(self, entity_id: str) -> dict | None:
        return self._links.get(entity_id)

    async def set_link(self, entity_id: str, link_id: str) -> None:
        self._links[entity_id] = {
            "link_id": link_id,
            "native_to_sync": {},
            "sync_to_native": {},
        }
        self._link_item_state[entity_id] = {}

    async def remove_link(self, entity_id: str) -> None:
        self._links.pop(entity_id, None)
        self._link_item_state.pop(entity_id, None)

    async def set_native_sync_mapping(self, entity_id: str, native_uid: str, sync_id: str) -> None:
        link = self._links.get(entity_id)
        if link is None:
            return
        link["native_to_sync"][native_uid] = sync_id
        link["sync_to_native"][sync_id] = native_uid

    async def remove_native_sync_mapping(
        self, entity_id: str, *, native_uid: str | None = None, sync_id: str | None = None,
    ) -> None:
        link = self._links.get(entity_id)
        if link is None:
            return
        if native_uid is not None:
            sync_id = link["native_to_sync"].pop(native_uid, sync_id)
        if sync_id is not None:
            link["sync_to_native"].pop(sync_id, None)
            link["native_to_sync"] = {
                uid: sid for uid, sid in link["native_to_sync"].items() if sid != sync_id
            }

    async def get_all_link_item_states(self, entity_id: str) -> dict[str, dict]:
        return dict(self._link_item_state.get(entity_id, {}))

    async def set_link_item_state(
        self, entity_id: str, sync_id: str, *, updated_at: str, deleted_at: str | None, fields: dict | None,
        position: dict | None = None,
    ) -> None:
        self._link_item_state.setdefault(entity_id, {})[sync_id] = {
            "updated_at": updated_at,
            "deleted_at": deleted_at,
            "fields": fields,
            "position": position,
        }

    async def prune_tombstones(self, entity_id: str, *, older_than: str) -> None:
        entity_state = self._link_item_state.get(entity_id)
        if not entity_state:
            return
        to_drop = [
            sync_id for sync_id, state in entity_state.items()
            if state.get("deleted_at") and state["deleted_at"] < older_than
        ]
        for sync_id in to_drop:
            entity_state.pop(sync_id, None)


class FakeMultiEntityAdapter:
    """Like FakeAdapter, but genuinely keyed per entity_id - needed for
    transfer_item() tests, which move items between two different
    entities and need each to have its own independent item list (the
    plain FakeAdapter treats every entity_id as the same single list,
    which every *other* manager method only ever touches one of at a
    time anyway, so it never needed to tell them apart until now)."""

    def __init__(self, items_by_entity: dict[str, list[TodoItem]] | None = None) -> None:
        self._items: dict[str, list[TodoItem]] = items_by_entity or {}
        self._next_id = 0
        self.add_item_calls: list[tuple[str, str]] = []
        self.remove_item_calls: list[tuple[str, str]] = []
        self.set_completed_calls: list[tuple[str, str, bool]] = []

    async def get_items(self, entity_id: str) -> list[TodoItem]:
        # See FakeAdapter's own get_items for why this must be a copy,
        # not the internal list itself.
        return list(self._items.get(entity_id, []))

    async def set_completed(self, entity_id: str, item_id: str, completed: bool) -> None:
        self.set_completed_calls.append((entity_id, item_id, completed))

        for item in self._items.get(entity_id, []):
            if item.id == item_id:
                item.completed = completed

    async def remove_item(self, entity_id: str, item_id: str) -> None:
        self.remove_item_calls.append((entity_id, item_id))
        self._items[entity_id] = [i for i in self._items.get(entity_id, []) if i.id != item_id]

    async def add_item(
        self,
        entity_id: str,
        title: str,
        description: str | None = None,
        due_date: str | None = None,
        due_datetime: str | None = None,
    ) -> str:
        self._next_id += 1
        new_id = f"new-{self._next_id}"

        self._items.setdefault(entity_id, []).append(TodoItem(
            id=new_id,
            title=title,
            completed=False,
            description=description,
            due_date=due_date,
            due_datetime=due_datetime,
        ))
        self.add_item_calls.append((entity_id, title))

        return new_id

    async def update_item(
        self,
        entity_id: str,
        item_id: str,
        *,
        title: str | None = None,
        description: str | None = None,
        due_date: str | None = None,
        due_datetime: str | None = None,
    ) -> None:
        for item in self._items.get(entity_id, []):
            if item.id == item_id:
                if title is not None:
                    item.title = title
                item.description = description
                item.due_date = due_date
                item.due_datetime = due_datetime


class FakeMultiEntityMetadataStore:
    """Like FakeMetadataStore, but genuinely keyed per entity_id - the
    metadata-store counterpart to FakeMultiEntityAdapter, for the same
    reason. Snapshot methods are omitted: transfer_item() never touches
    them."""

    def __init__(self, positions_by_entity: dict[str, dict[str, ItemPosition]] | None = None) -> None:
        self._positions: dict[str, dict[str, ItemPosition]] = positions_by_entity or {}
        self._quantities: dict[str, dict[str, str]] = {}
        self._tags: dict[str, dict[str, list[str]]] = {}
        self._pin_types: dict[str, dict[str, str]] = {}
        self._trigger_on_due: dict[str, set[str]] = {}
        self._due_fired: dict[str, dict[str, str]] = {}
        self._item_links: dict[str, dict[str, dict]] = {}
        self._links: dict[str, dict] = {}
        self._delete_protected: dict[str, set[str]] = {}
        self._weekdays: dict[str, dict[str, int]] = {}
        self._last_rollover_date: dict[str, str] = {}
        self.set_positions_calls: list[tuple[str, dict[str, ItemPosition]]] = []

    async def get_last_rollover_date(self, entity_id: str) -> str | None:
        return self._last_rollover_date.get(entity_id)

    async def set_last_rollover_date(self, entity_id: str, date_str: str) -> None:
        self._last_rollover_date[entity_id] = date_str

    async def get_relationships(self, entity_id: str) -> dict[str, ItemPosition]:
        return dict(self._positions.get(entity_id, {}))

    async def get_quantities(self, entity_id: str) -> dict[str, str]:
        return dict(self._quantities.get(entity_id, {}))

    async def set_quantity(self, entity_id: str, item_id: str, quantity: str | None) -> None:
        bucket = self._quantities.setdefault(entity_id, {})

        if quantity:
            bucket[item_id] = quantity
        else:
            bucket.pop(item_id, None)

    async def remove_quantities(self, entity_id: str, item_ids: list[str]) -> None:
        bucket = self._quantities.get(entity_id, {})

        for item_id in item_ids:
            bucket.pop(item_id, None)

    async def get_pin_types(self, entity_id: str) -> dict[str, str]:
        return dict(self._pin_types.get(entity_id, {}))

    async def set_pin_type(self, entity_id: str, item_id: str, pin_type: str | None) -> None:
        bucket = self._pin_types.setdefault(entity_id, {})

        if pin_type:
            bucket[item_id] = pin_type
        else:
            bucket.pop(item_id, None)

    async def remove_pin_types(self, entity_id: str, item_ids: list[str]) -> None:
        bucket = self._pin_types.get(entity_id, {})

        for item_id in item_ids:
            bucket.pop(item_id, None)

    async def get_weekdays(self, entity_id: str) -> dict[str, int]:
        return dict(self._weekdays.get(entity_id, {}))

    async def set_weekday(self, entity_id: str, item_id: str, weekday: int | None) -> None:
        bucket = self._weekdays.setdefault(entity_id, {})

        if weekday is not None:
            bucket[item_id] = weekday
        else:
            bucket.pop(item_id, None)

    async def remove_weekdays(self, entity_id: str, item_ids: list[str]) -> None:
        bucket = self._weekdays.get(entity_id, {})

        for item_id in item_ids:
            bucket.pop(item_id, None)

    async def get_item_link(self, entity_id: str, item_id: str) -> dict | None:
        return self._item_links.get(entity_id, {}).get(item_id)

    async def get_item_links(self, entity_id: str) -> dict[str, dict]:
        return dict(self._item_links.get(entity_id, {}))

    async def set_item_link(
        self,
        entity_id: str,
        item_id: str,
        linked_entity_id: str,
        linked_item_id: str,
    ) -> None:
        self._item_links.setdefault(entity_id, {})[item_id] = {
            "entity_id": linked_entity_id, "item_id": linked_item_id,
        }

    async def remove_item_link(self, entity_id: str, item_id: str) -> None:
        self._item_links.get(entity_id, {}).pop(item_id, None)

    async def get_all_linked_entity_ids(self) -> list[str]:
        return list(self._links)

    async def set_link(self, entity_id: str, link_id: str) -> None:
        self._links[entity_id] = {"link_id": link_id, "native_to_sync": {}, "sync_to_native": {}}

    async def get_tags(self, entity_id: str) -> dict[str, list[str]]:
        return {k: list(v) for k, v in self._tags.get(entity_id, {}).items()}

    async def set_tags(self, entity_id: str, item_id: str, tags: list[str]) -> None:
        bucket = self._tags.setdefault(entity_id, {})

        if tags:
            bucket[item_id] = list(tags)
        else:
            bucket.pop(item_id, None)

    async def remove_tags_for_items(self, entity_id: str, item_ids: list[str]) -> None:
        bucket = self._tags.get(entity_id, {})

        for item_id in item_ids:
            bucket.pop(item_id, None)

    async def get_trigger_on_due(self, entity_id: str) -> set[str]:
        return set(self._trigger_on_due.get(entity_id, set()))

    async def set_trigger_on_due(self, entity_id: str, item_id: str, enabled: bool) -> None:
        bucket = self._trigger_on_due.setdefault(entity_id, set())

        if enabled:
            bucket.add(item_id)
        else:
            bucket.discard(item_id)

    async def remove_trigger_on_due_for_items(self, entity_id: str, item_ids: list[str]) -> None:
        bucket = self._trigger_on_due.get(entity_id, set())

        for item_id in item_ids:
            bucket.discard(item_id)

    async def get_delete_protected(self, entity_id: str) -> set[str]:
        return set(self._delete_protected.get(entity_id, set()))

    async def set_delete_protected(self, entity_id: str, item_id: str, enabled: bool) -> None:
        bucket = self._delete_protected.setdefault(entity_id, set())

        if enabled:
            bucket.add(item_id)
        else:
            bucket.discard(item_id)

    async def remove_delete_protected_for_items(self, entity_id: str, item_ids: list[str]) -> None:
        bucket = self._delete_protected.get(entity_id, set())

        for item_id in item_ids:
            bucket.discard(item_id)

    async def get_due_fired(self, entity_id: str) -> dict[str, str]:
        return dict(self._due_fired.get(entity_id, {}))

    async def set_due_fired(self, entity_id: str, item_id: str, due_value: str) -> None:
        self._due_fired.setdefault(entity_id, {})[item_id] = due_value

    async def remove_due_fired_for_items(self, entity_id: str, item_ids: list[str]) -> None:
        bucket = self._due_fired.get(entity_id, {})

        for item_id in item_ids:
            bucket.pop(item_id, None)

    async def set_positions(self, entity_id: str, positions: dict[str, ItemPosition]) -> None:
        self.set_positions_calls.append((entity_id, dict(positions)))
        self._positions.setdefault(entity_id, {}).update(positions)

    async def remove_positions(self, entity_id: str, item_ids: list[str]) -> None:
        bucket = self._positions.get(entity_id, {})

        for item_id in item_ids:
            bucket.pop(item_id, None)

    async def clear_positions(self, entity_id: str) -> None:
        self._positions[entity_id] = {}
