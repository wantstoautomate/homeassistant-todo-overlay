from __future__ import annotations

from .errors import DueTimeRequiredError


class DueTriggerMixin:
    """Enabling/disabling the "due" trigger event for an item, and the
    bookkeeping due_scheduler.py needs to fire it exactly once per due
    value and avoid re-firing on restart or reconciliation."""

    async def set_trigger_on_due(
        self,
        entity_id: str,
        item_id: str,
        enabled: bool,
    ) -> None:
        """Enable or disable the "due" trigger event for an item.

        Enabling requires the item to currently have a due_datetime - a
        date-only due_date isn't specific enough to schedule an exact
        moment against (see DueTimeRequiredError)."""

        async with self._lock_for(entity_id):
            if enabled:
                items = await self._adapter.get_items(entity_id)
                item = next((candidate for candidate in items if candidate.id == item_id), None)

                if item is None or not item.due_datetime:
                    raise DueTimeRequiredError(
                        f"Cannot enable trigger-on-due for {item_id!r} on "
                        f"{entity_id}: no due time set"
                    )

            await self._metadata_store.set_trigger_on_due(entity_id, item_id, enabled)

        await self._notify_due_schedule_changed(entity_id)

    async def set_trigger_on_due_by_item(
        self,
        entity_id: str,
        item: str,
        enabled: bool,
    ) -> None:
        """Enable or disable the "due" trigger event, identified by uid
        or title - the service-facing counterpart to
        set_trigger_on_due()."""

        async with self._lock_for(entity_id):
            resolved = await self._resolve_item(entity_id, item)

            if enabled and not resolved.due_datetime:
                raise DueTimeRequiredError(
                    f"Cannot enable trigger-on-due for {resolved.title!r} on "
                    f"{entity_id}: no due time set"
                )

            await self._metadata_store.set_trigger_on_due(entity_id, resolved.id, enabled)

        await self._notify_due_schedule_changed(entity_id)

    def fire_due_event(
        self,
        entity_id: str,
        item_id: str,
        title: str,
        due_datetime: str,
    ) -> None:
        """Fire the "due" trigger event - called by due_scheduler.py at
        the exact moment an opted-in item's due time arrives. Kept here
        rather than the scheduler calling _fire_event() directly so that
        stays private."""

        self._fire_event(entity_id, item_id, title, "due", due_datetime=due_datetime)

    async def clear_stale_trigger_on_due(
        self,
        entity_id: str,
        item_ids: list[str],
    ) -> None:
        """Disable trigger_on_due for items whose due_datetime has since
        been cleared through some other path (native card, voice
        assistant, another automation calling todo.update_item
        directly), without notifying the due-schedule hook.

        Only ever called by DueScheduler.reconcile_entity() itself,
        mid-pass, to clean up exactly this staleness - going through the
        notifying set_trigger_on_due() instead would re-enter
        reconcile_entity() once per stale item, since that hook IS
        reconcile_entity in the first place. The same in-progress pass
        already finishes reconciling the schedule using freshly
        recomputed "desired" state that already excludes these ids, so
        no separate notification is needed.
        """

        async with self._lock_for(entity_id):
            for item_id in item_ids:
                await self._metadata_store.set_trigger_on_due(entity_id, item_id, False)

    async def record_due_fired(
        self,
        entity_id: str,
        item_id: str,
        due_value: str,
    ) -> None:
        """Record that a "due" trigger has already fired for this item's
        current due value, so a restart or later reconciliation pass
        doesn't fire it again for the same value (see due_scheduler.py)."""

        async with self._lock_for(entity_id):
            await self._metadata_store.set_due_fired(entity_id, item_id, due_value)

    async def get_due_fired(
        self,
        entity_id: str,
    ) -> dict[str, str]:
        """Which due value a "due" trigger has already fired for, per
        item - used by due_scheduler.py to avoid re-firing on
        reconciliation or restart for a due value already handled."""

        async with self._lock_for(entity_id):
            return await self._metadata_store.get_due_fired(entity_id)
