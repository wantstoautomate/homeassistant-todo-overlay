"""Querying a list's items with server-side filtering and hierarchy
awareness - the read-side counterpart to every other mixin here, which
are all about mutating a list. Exists because the two existing ways an
automation can read this integration's own data are both a poor fit for
anything beyond "give me the whole list and I'll sort it out myself":

- The native todo.get_items service returns flat items with none of
  this integration's own overlay fields (quantity, tags, pin_type,
  weekday, delete_protected, linked, trigger_on_due) at all.
- sensor.py's own open-items sensor exposes those fields, but always
  ALL open items, with each one's DIRECT parent only (not the full
  ancestor chain) - "everything under Brodie" is unanswerable there the
  moment Brodie has grandchildren, short of chaining several Jinja
  selectattr passes by hand.

query_items() reuses the exact same tree get_list() already builds
(same rollover/reconciliation passes, same shape the card itself
renders) and applies filtering/scoping to it as a pure, read-only pass
- no new locking, no new business logic, since get_list() already does
its own locking and this never mutates anything.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from homeassistant.util import dt as dt_util

from .errors import ItemNotFoundError
from .models import TodoItem


@dataclass
class _Candidate:
    """One flattened tree node, alongside the two things build_tree's
    own nested shape doesn't give you for free: its full root-to-parent
    ancestor chain, and its depth."""

    item: TodoItem
    ancestors: list[TodoItem]
    depth: int


def _flatten(items: list[TodoItem], ancestors: list[TodoItem], depth: int) -> list[_Candidate]:
    result: list[_Candidate] = []

    for item in items:
        result.append(_Candidate(item, ancestors, depth))
        result.extend(_flatten(item.children, [*ancestors, item], depth + 1))

    return result


def _matches_id_or_title(item: TodoItem, id_or_title: str) -> bool:
    return item.id == id_or_title or item.title == id_or_title


def _pick(id_value: str | None, title_value: str | None) -> str | None:
    return id_value if id_value is not None else title_value


def _due_day(item: TodoItem) -> date | None:
    """The DATE portion of whichever due field an item actually has
    (due_datetime taking precedence, same as everywhere else in this
    codebase that has to pick one) - None if neither is set or set to
    something unparseable."""

    if item.due_datetime:
        parsed = dt_util.parse_datetime(item.due_datetime)
        return parsed.date() if parsed else None

    if item.due_date:
        try:
            return date.fromisoformat(item.due_date)
        except ValueError:
            return None

    return None


def _is_overdue(item: TodoItem, today: date) -> bool:
    """Same day-level definition the card's own models.ts isOverdue()
    uses (kept in step deliberately, not re-derived independently): a
    leaf whose due date/datetime's own DATE portion is strictly before
    today, and isn't already complete - a due time earlier today isn't
    overdue until tomorrow."""

    if item.completed:
        return False

    due_day = _due_day(item)

    return due_day is not None and due_day < today


class QueryMixin:
    """Read-only, filtered, hierarchy-aware access to a list's items -
    see this module's own docstring for why this exists alongside
    get_list() and the open-items sensor rather than folding into
    either."""

    async def query_items(
        self,
        entity_id: str,
        *,
        completed: bool | None = None,
        tag: str | None = None,
        tags: list[str] | None = None,
        tags_mode: str = "any",
        has_due_date: bool | None = None,
        overdue: bool | None = None,
        due_before: str | None = None,
        due_after: str | None = None,
        pin_type: str | None = None,
        weekday: int | None = None,
        delete_protected: bool | None = None,
        linked: bool | None = None,
        trigger_on_due: bool | None = None,
        has_quantity: bool | None = None,
        parent_id: str | None = None,
        parent_title: str | None = None,
        under_id: str | None = None,
        under_title: str | None = None,
        top_level_only: bool = False,
        include_ancestors: bool = False,
        include_children: bool = False,
        limit: int | None = None,
    ) -> list[dict]:
        """Return every item matching all of the given filters (ANDed),
        each as a dict with every overlay field plus parent_id/
        parent_title (see sensor.py's own precedent) - and, opt-in,
        the full ancestor chain and/or nested children.

        Scope (which part of the tree is even considered, before any
        other filter) is exactly one of, in this priority order:
        - parent_id/parent_title: that item's DIRECT children only.
        - under_id/under_title: every DESCENDANT of that item, at any
          depth - the thing neither get_items nor the open-items sensor
          can do at all, since both only ever expose an item's own
          immediate parent.
        - top_level_only=True: root items only.
        - none given: the whole tree, every item at every depth.

        parent_id/parent_title (and under_id/under_title) are looked up
        by id OR title, matching this codebase's existing item/
        target_item resolution convention (see manager_items.py's own
        _resolve_item) - raises ItemNotFoundError if given but nothing
        in the tree matches.

        include_children attaches each MATCHED item's own children
        independently of whether those children separately satisfy the
        scope/filters too - so under_title="Brodie" with
        include_children=True can legitimately show "Grandchild" twice
        (once nested under its own matched parent "Sub", once again as
        its own flat top-level result, since it's also a descendant of
        Brodie) rather than something being wrong. Same reasoning as a
        REST API's own ?expand= param: it enriches each result with
        more of its own context, it doesn't change which results
        matched in the first place.
        """

        todo_list = await self.get_list(entity_id)
        candidates = _flatten(todo_list.items, [], 0)

        scope = self._scope_candidates(
            candidates, entity_id, parent_id, parent_title, under_id, under_title, top_level_only,
        )

        today = self._today_date_fn()
        matched = [
            candidate for candidate in scope
            if self._matches_filters(
                candidate.item, today,
                completed=completed, tag=tag, tags=tags, tags_mode=tags_mode,
                has_due_date=has_due_date, overdue=overdue,
                due_before=due_before, due_after=due_after,
                pin_type=pin_type, weekday=weekday,
                delete_protected=delete_protected, linked=linked,
                trigger_on_due=trigger_on_due, has_quantity=has_quantity,
            )
        ]

        if limit is not None:
            matched = matched[:limit]

        return [
            self._serialize_candidate(candidate, include_ancestors, include_children)
            for candidate in matched
        ]

    @staticmethod
    def _scope_candidates(
        candidates: list[_Candidate],
        entity_id: str,
        parent_id: str | None,
        parent_title: str | None,
        under_id: str | None,
        under_title: str | None,
        top_level_only: bool,
    ) -> list[_Candidate]:
        parent_key = _pick(parent_id, parent_title)
        under_key = _pick(under_id, under_title)

        if parent_key is not None:
            target = next(
                (c.item for c in candidates if _matches_id_or_title(c.item, parent_key)), None,
            )

            if target is None:
                raise ItemNotFoundError(f"No item {parent_key!r} (by id or title) found on {entity_id}")

            return [
                c for c in candidates
                if c.ancestors and c.ancestors[-1].id == target.id
            ]

        if under_key is not None:
            target = next(
                (c.item for c in candidates if _matches_id_or_title(c.item, under_key)), None,
            )

            if target is None:
                raise ItemNotFoundError(f"No item {under_key!r} (by id or title) found on {entity_id}")

            return [
                c for c in candidates
                if any(ancestor.id == target.id for ancestor in c.ancestors)
            ]

        if top_level_only:
            return [c for c in candidates if c.depth == 0]

        return candidates

    @staticmethod
    def _matches_filters(
        item: TodoItem,
        today: date,
        *,
        completed: bool | None,
        tag: str | None,
        tags: list[str] | None,
        tags_mode: str,
        has_due_date: bool | None,
        overdue: bool | None,
        due_before: str | None,
        due_after: str | None,
        pin_type: str | None,
        weekday: int | None,
        delete_protected: bool | None,
        linked: bool | None,
        trigger_on_due: bool | None,
        has_quantity: bool | None,
    ) -> bool:
        if completed is not None and item.completed != completed:
            return False

        if tag is not None and tag not in item.tags:
            return False

        if tags:
            if tags_mode == "all":
                if not all(t in item.tags for t in tags):
                    return False
            elif not any(t in item.tags for t in tags):
                return False

        if has_due_date is not None:
            has_one = bool(item.due_date or item.due_datetime)
            if has_one != has_due_date:
                return False

        if overdue is not None and _is_overdue(item, today) != overdue:
            return False

        due_day = _due_day(item)

        if due_before is not None and (due_day is None or due_day >= date.fromisoformat(due_before)):
            return False

        if due_after is not None and (due_day is None or due_day <= date.fromisoformat(due_after)):
            return False

        if pin_type is not None:
            wanted = None if pin_type == "none" else pin_type
            if item.pin_type != wanted:
                return False

        if weekday is not None and item.weekday != weekday:
            return False

        if delete_protected is not None and item.delete_protected != delete_protected:
            return False

        if linked is not None and item.linked != linked:
            return False

        if trigger_on_due is not None and item.trigger_on_due != trigger_on_due:
            return False

        if has_quantity is not None and bool(item.quantity) != has_quantity:
            return False

        return True

    @staticmethod
    def _serialize_candidate(
        candidate: _Candidate,
        include_ancestors: bool,
        include_children: bool,
    ) -> dict:
        item = candidate.item
        parent = candidate.ancestors[-1] if candidate.ancestors else None

        result = {
            "id": item.id,
            "title": item.title,
            "completed": item.completed,
            "description": item.description,
            "due_date": item.due_date,
            "due_datetime": item.due_datetime,
            "quantity": item.quantity,
            "tags": item.tags,
            "trigger_on_due": item.trigger_on_due,
            "pin_type": item.pin_type,
            "weekday": item.weekday,
            "day_label": item.day_label,
            "linked": item.linked,
            "delete_protected": item.delete_protected,
            "depth": candidate.depth,
            "parent_id": parent.id if parent is not None else None,
            "parent_title": parent.title if parent is not None else None,
        }

        if include_ancestors:
            result["ancestors"] = [
                {"id": ancestor.id, "title": ancestor.title} for ancestor in candidate.ancestors
            ]

        if include_children:
            result["children"] = [child.to_dict() for child in item.children]

        return result
