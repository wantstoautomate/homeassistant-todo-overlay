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

    for item in items:
        position = positions.get(item.id)
        parent_id = position.parent_id if position else None
        parent = item_lookup.get(parent_id) if parent_id else None

        (parent.children if parent is not None else roots).append(item)

    def order_of(item: TodoItem) -> int:
        position = positions.get(item.id)
        return position.order if position else 0

    def sort_key(item: TodoItem) -> tuple[bool, int]:
        return (item.completed if group_completed else False, order_of(item))

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
