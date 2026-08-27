from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import Any

from homeassistant.util import dt as dt_util

from .const import EVENT_ITEM_CHANGED
from .ha_adapter import HomeAssistantTodoProvider
from .manager_completion import CompletionMixin
from .manager_due import DueTriggerMixin
from .manager_items import ItemMixin
from .manager_position import PositionMixin
from .manager_snapshots import SnapshotMixin
from .manager_tree import TreeMixin
from .metadata_store import MetadataStore

_LOGGER = logging.getLogger(__name__)


def _current_weekday() -> int:
    """0=Monday..6=Sunday, in HA's own configured time zone - see
    manager_tree.py's own use for why this exists as an injectable
    function rather than a bare dt_util call inline (same "swap in a
    fake clock for tests" reasoning as due_scheduler.py's own utcnow
    parameter)."""

    return dt_util.now().weekday()


class TodoManager(
    TreeMixin,
    ItemMixin,
    DueTriggerMixin,
    PositionMixin,
    CompletionMixin,
    SnapshotMixin,
):
    """Main entry point for the Todo Overlay business logic.

    The actual behaviour is split across one mixin per responsibility
    (manager_tree.py, manager_items.py, manager_due.py,
    manager_position.py, manager_completion.py, manager_snapshots.py) -
    this class just composes them and owns the small pieces of shared
    state (locks, the optional hass event bus, the due-schedule hook)
    every mixin's methods reach for via self.
    """

    def __init__(
        self,
        adapter: HomeAssistantTodoProvider,
        metadata_store: MetadataStore,
        hass: Any | None = None,
        today_weekday_fn: Callable[[], int] = _current_weekday,
    ) -> None:
        self._adapter = adapter
        self._metadata_store = metadata_store
        # Optional: only needed to fire events for the todo_overlay
        # trigger platform. None in tests, where there's nothing
        # listening for them anyway.
        self._hass = hass
        # Injectable purely so tests can pin "today" to a specific
        # weekday deterministically, rather than depending on whatever
        # day it actually is when the suite runs - see tree.py's own
        # build_tree for what this actually drives (the day-of-week
        # pin rotation/labeling).
        self._today_weekday_fn = today_weekday_fn
        # One lock per entity_id, created on first use and never removed -
        # a handful of Lock objects live for the life of the integration,
        # which is negligible even for an install with many todo lists.
        # Every public method that reads-then-writes an entity's items or
        # metadata holds this for its whole body, since HA's websocket API
        # does not serialize command handlers against each other - two
        # rapid calls against the same list (e.g. a fast double
        # drag-and-drop, or a save_list racing a concurrent move_item)
        # would otherwise both read the same stale positions and the
        # second write to land would silently clobber the first.
        self._locks: dict[str, asyncio.Lock] = {}
        # Set by due_scheduler.py after construction. Toggling trigger_on_due
        # is a metadata-only write - it never touches the native entity's
        # own state - so the scheduler's state_changed listener would never
        # notice a toggle happened at all without this explicit nudge.
        self._due_schedule_hook: Callable[[str], Awaitable[None]] | None = None
        # Set by __init__.py to item_links.py's own ItemLinkManager.link_item,
        # after both it and this manager exist - load_list() calls this for
        # any snapshot node captured with linked=True (see
        # manager_snapshots.py), same "an external system needs to react
        # to something happening inside here" shape as the due-schedule
        # hook above. A plain attribute, not a full mixin dependency,
        # since ItemLinkManager is a standalone object (like
        # LinkSyncManager), never part of TodoManager itself.
        self._item_link_hook: Callable[[str, str], Awaitable[str]] | None = None

    def set_due_schedule_hook(self, hook: Callable[[str], Awaitable[None]] | None) -> None:
        """Register the callback due_scheduler.py uses to immediately
        reconcile an entity's due schedule after set_trigger_on_due()
        changes an item's eligibility."""

        self._due_schedule_hook = hook

    async def _notify_due_schedule_changed(self, entity_id: str) -> None:
        if self._due_schedule_hook is not None:
            await self._due_schedule_hook(entity_id)

    def set_item_link_hook(self, hook: Callable[[str, str], Awaitable[str]] | None) -> None:
        """Register item_links.py's own ItemLinkManager.link_item as the
        callback load_list() uses to auto-link a snapshot node captured
        with linked=True (see manager_snapshots.py)."""

        self._item_link_hook = hook

    def _lock_for(self, entity_id: str) -> asyncio.Lock:
        lock = self._locks.get(entity_id)

        if lock is None:
            lock = asyncio.Lock()
            self._locks[entity_id] = lock

        return lock

    def _fire_event(
        self,
        entity_id: str,
        item_id: str,
        title: str,
        action: str,
        **extra: Any,
    ) -> None:
        _LOGGER.debug(
            "_fire_event: entity_id=%s item_id=%s action=%s hass_is_none=%s",
            entity_id, item_id, action, self._hass is None,
        )

        if self._hass is None:
            return

        self._hass.bus.async_fire(
            EVENT_ITEM_CHANGED,
            {
                "entity_id": entity_id,
                "item_id": item_id,
                "title": title,
                "action": action,
                **extra,
            },
        )
