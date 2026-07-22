from __future__ import annotations

from homeassistant.helpers.storage import Store

from .models import ItemPosition

STORAGE_VERSION = 2
STORAGE_KEY = "todo_overlay"


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
