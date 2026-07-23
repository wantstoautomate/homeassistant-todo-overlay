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

        return self._items

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


class FakeMetadataStore:

    def __init__(self, positions: dict[str, ItemPosition] | None = None) -> None:
        self._positions = positions or {}
        self.set_positions_calls: list[tuple[str, dict[str, ItemPosition]]] = []
        self._snapshots: dict[str, dict] = {}
        self._quantities: dict[str, str] = {}
        self._tags: dict[str, list[str]] = {}

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
