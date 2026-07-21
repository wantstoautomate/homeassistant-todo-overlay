from __future__ import annotations

from homeassistant.helpers.storage import Store

STORAGE_VERSION = 1
STORAGE_KEY = "todo_overlay"


class MetadataStore:
    """Stores Todo Overlay metadata."""

    def __init__(self, hass) -> None:
        self._store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self._cache: dict[str, dict[str, str | None]] | None = None

    async def _load(self) -> None:
        if self._cache is None:
            self._cache = await self._store.async_load() or {}

    async def get_relationships(
        self,
        entity_id: str,
    ) -> dict[str, str | None]:
        await self._load()

        assert self._cache is not None

        return dict(self._cache.get(entity_id, {}))

    async def set_parent(
        self,
        entity_id: str,
        child_id: str,
        parent_id: str | None,
    ) -> None:
        await self._load()

        assert self._cache is not None

        relationships = self._cache.setdefault(entity_id, {})

        if parent_id is None:
            relationships.pop(child_id, None)
        else:
            relationships[child_id] = parent_id

        await self._store.async_save(self._cache)
