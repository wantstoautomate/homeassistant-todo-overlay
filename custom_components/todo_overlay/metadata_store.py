from __future__ import annotations

from homeassistant.helpers.storage import Store

from .models import ItemPosition

STORAGE_VERSION = 2
STORAGE_KEY = "todo_overlay"

# Saved snapshots and quantities live under these reserved top-level
# cache keys, separate from the per-entity position maps (which are
# keyed directly by entity_id, e.g. "todo.shopping" - always dotted,
# so this can never collide).
SNAPSHOTS_KEY = "_snapshots"
QUANTITIES_KEY = "_quantities"
TAGS_KEY = "_tags"


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
        name: str,
        snapshot: list[dict],
    ) -> None:
        """Save a named snapshot of a list's items/hierarchy.

        Snapshots are entity-agnostic: a name is a single global slot,
        not scoped to whichever todo entity it was saved from - so it
        can be loaded onto any entity, including a different one than
        it came from.
        """

        await self._load()

        assert self._cache is not None

        self._cache.setdefault(SNAPSHOTS_KEY, {})[name] = snapshot

        await self._store.async_save(self._cache)

    async def get_snapshot(
        self,
        name: str,
    ) -> list[dict] | None:
        await self._load()

        assert self._cache is not None

        return self._cache.get(SNAPSHOTS_KEY, {}).get(name)

    async def list_snapshots(
        self,
    ) -> list[str]:
        await self._load()

        assert self._cache is not None

        return sorted(self._cache.get(SNAPSHOTS_KEY, {}).keys())

    async def delete_snapshot(
        self,
        name: str,
    ) -> None:
        await self._load()

        assert self._cache is not None

        self._cache.get(SNAPSHOTS_KEY, {}).pop(name, None)

        await self._store.async_save(self._cache)

    async def get_quantities(
        self,
        entity_id: str,
    ) -> dict[str, str]:
        await self._load()

        assert self._cache is not None

        return dict(self._cache.get(QUANTITIES_KEY, {}).get(entity_id, {}))

    async def set_quantity(
        self,
        entity_id: str,
        item_id: str,
        quantity: str | None,
    ) -> None:
        """Set (or clear, if quantity is falsy) an item's quantity."""

        await self._load()

        assert self._cache is not None

        entity_quantities = self._cache.setdefault(QUANTITIES_KEY, {}).setdefault(entity_id, {})

        if quantity:
            entity_quantities[item_id] = quantity
        else:
            entity_quantities.pop(item_id, None)

        await self._store.async_save(self._cache)

    async def remove_quantities(
        self,
        entity_id: str,
        item_ids: list[str],
    ) -> None:
        """Drop stored quantities for items that no longer exist, e.g.
        after a clear-completed removal."""

        await self._load()

        assert self._cache is not None

        entity_quantities = self._cache.get(QUANTITIES_KEY, {}).get(entity_id)

        if not entity_quantities:
            return

        for item_id in item_ids:
            entity_quantities.pop(item_id, None)

        await self._store.async_save(self._cache)

    async def get_tags(
        self,
        entity_id: str,
    ) -> dict[str, list[str]]:
        await self._load()

        assert self._cache is not None

        return {
            item_id: list(tags)
            for item_id, tags in self._cache.get(TAGS_KEY, {}).get(entity_id, {}).items()
        }

    async def set_tags(
        self,
        entity_id: str,
        item_id: str,
        tags: list[str],
    ) -> None:
        """Replace an item's full tag list."""

        await self._load()

        assert self._cache is not None

        entity_tags = self._cache.setdefault(TAGS_KEY, {}).setdefault(entity_id, {})

        if tags:
            entity_tags[item_id] = list(tags)
        else:
            entity_tags.pop(item_id, None)

        await self._store.async_save(self._cache)

    async def add_tag(
        self,
        entity_id: str,
        item_id: str,
        tag: str,
    ) -> None:
        await self._load()

        assert self._cache is not None

        entity_tags = self._cache.setdefault(TAGS_KEY, {}).setdefault(entity_id, {})
        tags = entity_tags.setdefault(item_id, [])

        if tag not in tags:
            tags.append(tag)

        await self._store.async_save(self._cache)

    async def remove_tag(
        self,
        entity_id: str,
        item_id: str,
        tag: str,
    ) -> None:
        await self._load()

        assert self._cache is not None

        entity_tags = self._cache.get(TAGS_KEY, {}).get(entity_id, {})
        tags = entity_tags.get(item_id)

        if not tags or tag not in tags:
            return

        tags.remove(tag)

        if not tags:
            entity_tags.pop(item_id, None)

        await self._store.async_save(self._cache)

    async def remove_tags_for_items(
        self,
        entity_id: str,
        item_ids: list[str],
    ) -> None:
        """Drop stored tags for items that no longer exist, e.g. after
        a clear-completed removal."""

        await self._load()

        assert self._cache is not None

        entity_tags = self._cache.get(TAGS_KEY, {}).get(entity_id)

        if not entity_tags:
            return

        for item_id in item_ids:
            entity_tags.pop(item_id, None)

        await self._store.async_save(self._cache)
