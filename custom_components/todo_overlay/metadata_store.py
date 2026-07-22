from __future__ import annotations

from homeassistant.helpers.storage import Store

from .models import ItemPosition

STORAGE_VERSION = 2
STORAGE_KEY = "todo_overlay"

# Saved snapshots live under this reserved top-level cache key, separate
# from the per-entity position maps (which are keyed directly by entity_id,
# e.g. "todo.shopping" - always dotted, so this can never collide).
SNAPSHOTS_KEY = "_snapshots"


class MetadataStore:
    """Stores Todo Overlay metadata."""

    def __init__(self, hass) -> None:
        self._store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self._cache: dict[str, dict[str, dict]] | None = None

    async def _load(self) -> None:
        if self._cache is None:
            self._cache = await self._store.async_load() or {}

    async def get_relationships(
        self,
        entity_id: str,
    ) -> dict[str, ItemPosition]:
        await self._load()

        assert self._cache is not None

        return {
            item_id: ItemPosition(parent_id=data["parent"], order=data["order"])
            for item_id, data in self._cache.get(entity_id, {}).items()
        }

    async def set_positions(
        self,
        entity_id: str,
        positions: dict[str, ItemPosition],
    ) -> None:
        """Write positions for one or more items in a single save."""

        await self._load()

        assert self._cache is not None

        entity_positions = self._cache.setdefault(entity_id, {})

        for item_id, position in positions.items():
            entity_positions[item_id] = {
                "parent": position.parent_id,
                "order": position.order,
            }

        await self._store.async_save(self._cache)

    async def remove_positions(
        self,
        entity_id: str,
        item_ids: list[str],
    ) -> None:
        """Drop stored positions for items that no longer exist, e.g.
        after a clear-completed removal."""

        await self._load()

        assert self._cache is not None

        entity_positions = self._cache.get(entity_id)

        if not entity_positions:
            return

        for item_id in item_ids:
            entity_positions.pop(item_id, None)

        await self._store.async_save(self._cache)

    async def clear_positions(
        self,
        entity_id: str,
    ) -> None:
        """Drop every stored position for an entity, e.g. before a
        replace-mode load repopulates the list from scratch."""

        await self._load()

        assert self._cache is not None

        self._cache.pop(entity_id, None)

        await self._store.async_save(self._cache)

    async def save_snapshot(
        self,
        entity_id: str,
        name: str,
        snapshot: list[dict],
    ) -> None:
        """Save a named snapshot of an entity's items/hierarchy."""

        await self._load()

        assert self._cache is not None

        snapshots = self._cache.setdefault(SNAPSHOTS_KEY, {}).setdefault(entity_id, {})
        snapshots[name] = snapshot

        await self._store.async_save(self._cache)

    async def get_snapshot(
        self,
        entity_id: str,
        name: str,
    ) -> list[dict] | None:
        await self._load()

        assert self._cache is not None

        return self._cache.get(SNAPSHOTS_KEY, {}).get(entity_id, {}).get(name)

    async def list_snapshots(
        self,
        entity_id: str,
    ) -> list[str]:
        await self._load()

        assert self._cache is not None

        return sorted(self._cache.get(SNAPSHOTS_KEY, {}).get(entity_id, {}).keys())

    async def delete_snapshot(
        self,
        entity_id: str,
        name: str,
    ) -> None:
        await self._load()

        assert self._cache is not None

        self._cache.get(SNAPSHOTS_KEY, {}).get(entity_id, {}).pop(name, None)

        await self._store.async_save(self._cache)
