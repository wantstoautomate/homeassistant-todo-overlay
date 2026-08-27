from .manager_types import WeekdayAnchor
from .models import ItemPosition, TodoItem


def build_tree(
    items: list[TodoItem],
    positions: dict[str, ItemPosition],
    quantities: dict[str, str] | None = None,
    tags: dict[str, list[str]] | None = None,
    trigger_on_due: set[str] | None = None,
    group_completed: bool = False,
    pin_types: dict[str, str] | None = None,
    linked_item_ids: set[str] | None = None,
    delete_protected_ids: set[str] | None = None,
    weekdays: dict[str, int] | None = None,
    today_weekday: int | None = None,
    weekday_anchor: WeekdayAnchor = "top",
) -> list[TodoItem]:
    """Build a hierarchy from a flat list of TodoItems.

    Items with no stored position (never moved) default to being a root,
    keeping their original relative order via Python's stable sort.

    With group_completed=True, completed items sort after incomplete ones
    within their own parent, regardless of their stored order - so
    completing an item moves it to the bottom of its own siblings (and
    only its siblings: this is applied independently at every level), and
    a drag can still reorder within the completed group but can never
    place one ahead of an incomplete sibling, since that comparison is
    decided by completion status first. Off by default: siblings sort
    purely by stored order regardless of completion, so ticking an item
    never visually moves it.

    A "day" pin (see manager_types.PIN_TYPES) with a weekday set is
    NEVER sorted by its own stored order or group_completed - it always
    sorts by how many days away its weekday is from today_weekday
    (wrapping after 6), independently at every level, the same way
    group_completed already does. today_weekday is a plain caller-
    supplied int (0=Monday..6=Sunday), not computed in here, so this
    stays a pure function of its arguments with no clock/timezone
    dependency of its own - see manager_tree.py for where it actually
    comes from. Every "day" pin present at a given level forms ONE
    contiguous block among its siblings; weekday_anchor picks which end
    of the sibling list that block sits at (irrelevant, and ignored, at
    a level with no "day" pins at all).
    """

    item_lookup = {
        item.id: item
        for item in items
    }

    roots: list[TodoItem] = []

    for item in items:
        item.children.clear()
        item.quantity = (quantities or {}).get(item.id)
        item.tags = (tags or {}).get(item.id, [])
        item.trigger_on_due = item.id in (trigger_on_due or set())
        item.pin_type = (pin_types or {}).get(item.id)
        item.linked = item.id in (linked_item_ids or set())
        item.delete_protected = item.id in (delete_protected_ids or set())
        item.weekday = (weekdays or {}).get(item.id)
        item.day_label = _day_label(item, today_weekday)

    for item in items:
        position = positions.get(item.id)
        parent_id = position.parent_id if position else None
        parent = item_lookup.get(parent_id) if parent_id else None

        (parent.children if parent is not None else roots).append(item)

    def order_of(item: TodoItem) -> int:
        position = positions.get(item.id)
        return position.order if position else 0

    def sort_key(item: TodoItem) -> tuple[int, int, bool, int]:
        is_day = item.pin_type == "day" and item.weekday is not None and today_weekday is not None

        if is_day:
            days_until = (item.weekday - today_weekday) % 7
            block = 0 if weekday_anchor == "top" else 1
            return (block, days_until, False, 0)

        block = 1 if weekday_anchor == "top" else 0
        return (block, 0, item.completed if group_completed else False, order_of(item))

    def finalize(item: TodoItem) -> None:
        for child in item.children:
            finalize(child)

        if item.children:
            item.completed = all(child.completed for child in item.children)

        item.children.sort(key=sort_key)

    for root in roots:
        finalize(root)

    roots.sort(key=sort_key)

    return roots


def _day_label(item: TodoItem, today_weekday: int | None) -> str | None:
    if item.pin_type != "day" or item.weekday is None or today_weekday is None:
        return None

    days_until = (item.weekday - today_weekday) % 7

    if days_until == 0:
        return "Today"

    if days_until == 1:
        return "Tomorrow"

    return None
