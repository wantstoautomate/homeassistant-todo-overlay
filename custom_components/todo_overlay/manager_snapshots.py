from __future__ import annotations

import logging
import re

from .errors import ItemLinkTargetNotFoundError, SnapshotNotFoundError
from .manager_types import LoadMode
from .models import ItemPosition, TodoItem

_LOGGER = logging.getLogger(__name__)

# A leading numeric amount, an optional separating space, then a unit
# (which may itself be empty for a bare count like "3"). Used to combine
# matching quantities on a merge-mode load, e.g. "150g" + "200g" -> "350g".
_QUANTITY_PATTERN = re.compile(r"^\s*(\d+(?:\.\d+)?)(\s*)(.*?)\s*$")


class SnapshotMixin:
    """Saving/loading named list templates ("snapshots"), stored
    entity-agnostically so one saved from this entity can be loaded onto
    any todo.* entity later."""

    async def save_list(
        self,
        entity_id: str,
        name: str,
        persist_states: bool = False,
    ) -> None:
        """Save a named snapshot of the list's current items and
        hierarchy, for later reuse via load_list().

        Completion status is only captured when persist_states is set -
        otherwise a snapshot is a reusable template that always starts
        fresh (everything incomplete) when loaded.

        Snapshot names are entity-agnostic (a single global namespace),
        so a list saved from this entity can later be loaded onto any
        todo entity, not just this one.
        """

        async with self._lock_for(entity_id):
            todo_list = await self._get_list_impl(entity_id)

        snapshot = [
            self._snapshot_node(item, persist_states)
            for item in todo_list.items
        ]

        await self._metadata_store.save_snapshot(name, snapshot)

    async def load_list(
        self,
        entity_id: str,
        name: str,
        mode: LoadMode = "merge",
        target_item: str | None = None,
    ) -> None:
        """Recreate a named snapshot's items on the list.

        - "replace": every current item is removed first (or, with
          target_item set - see below - just that item's own existing
          children), so the affected part of the list ends up matching
          the snapshot exactly.
        - "merge": items already on the list are matched against
          snapshot items by title path (own title plus ancestor
          titles) and left untouched rather than duplicated - only
          genuinely new items are created, as children of whichever
          existing item matched their snapshot parent.
        - "full_merge": the whole snapshot is (re)created as new items
          regardless of what's already on the list, duplicates and all.

        target_item, when given (identified by uid or title, same
        uid-or-title convention as every other "item" field - see
        _resolve_item), loads the snapshot as children of that existing
        item instead of at the list's root - e.g. loading a saved
        "Fruit & veg" template into an existing "To buy" parent rather
        than appending it as new top-level siblings. Raises
        ItemNotFoundError if it doesn't resolve to a real item.
        """

        snapshot = await self._metadata_store.get_snapshot(name)

        if snapshot is None:
            raise SnapshotNotFoundError(f"No saved list named {name!r}")

        async with self._lock_for(entity_id):
            target_id: str | None = None
            ancestor_path: tuple[str, ...] = ()

            if target_item is not None:
                resolved_target = await self._resolve_item(entity_id, target_item)
                target_id = resolved_target.id

                items = await self._adapter.get_items(entity_id)
                positions = await self._metadata_store.get_relationships(entity_id)
                item_by_id = {item.id: item for item in items}
                ancestor_path = self._path_of(target_id, item_by_id, positions)

            if mode == "replace":
                if target_id is None:
                    for item in await self._adapter.get_items(entity_id):
                        await self._adapter.remove_item(entity_id, item.id)

                    await self._metadata_store.clear_positions(entity_id)
                else:
                    # Scoped to the target's own subtree, not the whole
                    # list - the whole point of loading INTO a parent is
                    # that everything else in the list is left alone.
                    # The full subtree (every depth, not just direct
                    # children - see _descendant_ids' own comment) is
                    # cleared so nothing gets left behind as an orphaned
                    # grandchild before the snapshot loads back in fresh.
                    items = await self._adapter.get_items(entity_id)
                    positions = await self._metadata_store.get_relationships(entity_id)
                    item_by_id = {item.id: item for item in items}

                    for descendant_id in self._descendant_ids(items, positions, target_id):
                        await self._adapter.remove_item(entity_id, descendant_id)
                        descendant = item_by_id.get(descendant_id)

                        # Previously-silent-elsewhere gap this project has
                        # already hit twice (duplicate-title merges,
                        # quick-add creates) - a removal that never fires
                        # this never propagates to a linked peer, the
                        # open-items sensor, or the todo_overlay.removed
                        # automation trigger.
                        if descendant is not None:
                            self._fire_event(entity_id, descendant_id, descendant.title, "removed")

            existing_by_path: dict[tuple[str, ...], str] = {}

            if mode == "merge":
                items = await self._adapter.get_items(entity_id)
                positions = await self._metadata_store.get_relationships(entity_id)
                existing_by_path = self._title_path_index(items, positions)

            await self._create_snapshot_nodes(
                entity_id,
                snapshot,
                parent_id=target_id,
                ancestor_path=ancestor_path,
                existing_by_path=existing_by_path,
            )

    async def list_saved(self) -> list[str]:
        """Names of every saved snapshot, across all entities."""

        return await self._metadata_store.list_snapshots()

    async def delete_saved(
        self,
        name: str,
    ) -> None:
        await self._metadata_store.delete_snapshot(name)

    @staticmethod
    def _snapshot_node(item: TodoItem, persist_states: bool) -> dict:
        return {
            "title": item.title,
            "description": item.description,
            "due_date": item.due_date,
            "due_datetime": item.due_datetime,
            "quantity": item.quantity,
            "tags": item.tags,
            "trigger_on_due": item.trigger_on_due,
            "pin_type": item.pin_type,
            "linked": item.linked,
            "completed": item.completed if persist_states else False,
            "children": [
                SnapshotMixin._snapshot_node(child, persist_states)
                for child in item.children
            ],
        }

    @staticmethod
    def _path_of(
        item_id: str,
        item_by_id: dict[str, TodoItem],
        positions: dict[str, ItemPosition],
    ) -> tuple[str, ...]:
        """An item's own (ancestor titles..., own title) path - factored
        out of _title_path_index so load_list's own target_item can get
        just the one path it needs without building the whole-list
        index only to throw the rest away."""

        position = positions.get(item_id)
        parent_id = position.parent_id if position else None
        title = item_by_id[item_id].title

        if parent_id is None:
            return (title,)

        return (*SnapshotMixin._path_of(parent_id, item_by_id, positions), title)

    @staticmethod
    def _title_path_index(
        items: list[TodoItem],
        positions: dict[str, ItemPosition],
    ) -> dict[tuple[str, ...], str]:
        """Map each item's (ancestor titles..., own title) path to its
        id, so merge-mode loading can recognise items that already
        exist without relying on ids, which a snapshot never has."""

        item_by_id = {item.id: item for item in items}

        return {
            SnapshotMixin._path_of(item.id, item_by_id, positions): item.id
            for item in items
        }

    async def _create_snapshot_nodes(
        self,
        entity_id: str,
        nodes: list[dict],
        parent_id: str | None,
        ancestor_path: tuple[str, ...],
        existing_by_path: dict[tuple[str, ...], str],
    ) -> None:
        items = await self._adapter.get_items(entity_id)
        positions = await self._metadata_store.get_relationships(entity_id)
        item_by_id = {item.id: item for item in items}

        existing_children = self._siblings(items, positions, parent_id)
        next_order = max(
            (self._order_of(child_id, positions) for child_id in existing_children),
            default=-1,
        ) + 1

        for node in nodes:
            path = (*ancestor_path, node["title"])
            matched_id = existing_by_path.get(path)

            if matched_id is not None:
                target_id = matched_id

                # Already exists - rather than leaving it untouched
                # outright, combine quantities when possible (e.g.
                # "150g" + "200g" -> "350g") and union tags, so a merge
                # unifies matching items instead of just ignoring the
                # incoming data.
                existing_quantities = await self._metadata_store.get_quantities(entity_id)
                combined = self._combine_quantities(
                    existing_quantities.get(target_id), node.get("quantity")
                )

                if combined is not None:
                    await self._metadata_store.set_quantity(entity_id, target_id, combined)

                incoming_tags = node.get("tags") or []

                if incoming_tags:
                    existing_tags = await self._metadata_store.get_tags(entity_id)
                    merged_tags = list(existing_tags.get(target_id, []))

                    for tag in incoming_tags:
                        if tag not in merged_tags:
                            merged_tags.append(tag)

                    await self._metadata_store.set_tags(entity_id, target_id, merged_tags)

                if node.get("trigger_on_due"):
                    existing_item = item_by_id.get(target_id)

                    if existing_item is not None and existing_item.due_datetime:
                        await self._metadata_store.set_trigger_on_due(entity_id, target_id, True)

                # Not combinable like quantity/tags - a single value.
                # Only adopts the incoming pin_type when the existing
                # (matched) item has none at all, same "existing wins,
                # incoming only fills a gap" rule the duplicate-title
                # merge in manager_tree.py uses.
                incoming_pin_type = node.get("pin_type")

                if incoming_pin_type:
                    existing_pin_types = await self._metadata_store.get_pin_types(entity_id)

                    if not existing_pin_types.get(target_id):
                        await self._metadata_store.set_pin_type(entity_id, target_id, incoming_pin_type)
            else:
                target_id = await self._adapter.add_item(
                    entity_id,
                    node["title"],
                    description=node.get("description"),
                    due_date=node.get("due_date"),
                    due_datetime=node.get("due_datetime"),
                )

                await self._metadata_store.set_positions(
                    entity_id,
                    {target_id: ItemPosition(parent_id=parent_id, order=next_order)},
                )
                next_order += 1

                if node.get("quantity"):
                    await self._metadata_store.set_quantity(entity_id, target_id, node["quantity"])

                if node.get("tags"):
                    await self._metadata_store.set_tags(entity_id, target_id, node["tags"])

                if node.get("pin_type"):
                    await self._metadata_store.set_pin_type(entity_id, target_id, node["pin_type"])

                if node.get("completed"):
                    await self._adapter.set_completed(entity_id, target_id, True)

                if node.get("trigger_on_due"):
                    # Re-check due_datetime actually landed - the target
                    # entity might not support it at all, in which case
                    # add_item() above already silently dropped it (same
                    # "gracefully degrade" precedent as other unsupported
                    # cross-entity snapshot fields).
                    created_items = await self._adapter.get_items(entity_id)
                    created_item = next(
                        (c for c in created_items if c.id == target_id), None,
                    )

                    if created_item is not None and created_item.due_datetime:
                        await self._metadata_store.set_trigger_on_due(entity_id, target_id, True)

                # Previously never fired at all for a loaded list - live-
                # diagnosed alongside the same gap in create_item's own
                # frontend call site: without this, none of a loaded
                # template's new items would ever propagate to a linked
                # peer, trigger todo_overlay.created automations, or
                # refresh the open-items sensor for another viewer.
                self._fire_event(
                    entity_id, target_id, node["title"], "created",
                    quantity=node.get("quantity"), tags=node.get("tags") or [],
                    pin_type=node.get("pin_type"),
                )

            await self._maybe_auto_link(entity_id, target_id, node)

            if node.get("children"):
                await self._create_snapshot_nodes(
                    entity_id,
                    node["children"],
                    parent_id=target_id,
                    ancestor_path=path,
                    existing_by_path=existing_by_path,
                )

    async def _maybe_auto_link(self, entity_id: str, item_id: str, node: dict) -> None:
        """Re-create an item link a snapshot node was captured with (see
        _snapshot_node's own "linked" field) - a no-op unless the node
        actually asked for it, the target is genuinely unlinked already
        (a merge-matched existing item may already have its own real
        link, in which case this must NOT try to link it a second time),
        and item_links.py's own hook is even wired up (manager.py's
        __init__.py wiring - absent in tests that construct a bare
        TodoManager with no ItemLinkManager at all).

        Uses the exact same auto-resolution item_links.py's own
        link_item() always uses (exactly one cross-instance linked list
        configured -> use it; anything else -> raise) - deliberately NOT
        a hard failure here, unlike the item dialog's own explicit
        "link this" checkbox: a stale "was linked when saved" marker on
        one item is never worth aborting the rest of a load over, so
        this only ever logs and moves on.
        """

        if not node.get("linked") or self._item_link_hook is None:
            return

        if await self._metadata_store.get_item_link(entity_id, item_id) is not None:
            return

        try:
            await self._item_link_hook(entity_id, item_id)
        except ItemLinkTargetNotFoundError:
            _LOGGER.error(
                "Snapshot item %r (%s/%s) was linked when saved, but no default "
                "item-link target could be auto-resolved right now - loaded as a "
                "plain, unlinked item instead",
                node["title"], entity_id, item_id,
            )

    @staticmethod
    def _combine_quantities(
        existing: str | None,
        incoming: str | None,
    ) -> str | None:
        """Combine two quantity strings for a merged duplicate.

        Adds the numeric amounts when both share a unit (e.g. "150g" +
        "200g" -> "350g"), adopts the incoming value outright when the
        existing item has none, and otherwise leaves the existing value
        alone (returns None, meaning "nothing to write") rather than
        guessing when they can't be confidently reconciled - e.g.
        different or unparseable units.
        """

        if not incoming:
            return None

        if not existing:
            return incoming

        existing_match = _QUANTITY_PATTERN.match(existing)
        incoming_match = _QUANTITY_PATTERN.match(incoming)

        if not existing_match or not incoming_match:
            return None

        existing_amount, separator, unit = existing_match.groups()
        incoming_amount, _, incoming_unit = incoming_match.groups()

        if unit.strip().lower() != incoming_unit.strip().lower():
            return None

        total = float(existing_amount) + float(incoming_amount)
        total_str = str(int(total)) if total.is_integer() else str(total)

        return f"{total_str}{separator}{unit}"
