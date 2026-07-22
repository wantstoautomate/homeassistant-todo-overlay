from .models import ItemPosition, TodoItem


def build_tree(
    items: list[TodoItem],
    positions: dict[str, ItemPosition],
) -> list[TodoItem]:
    """Build a hierarchy from a flat list of TodoItems.

    Items with no stored position (never moved) default to being a root,
    keeping their original relative order via Python's stable sort.
    """

    item_lookup = {
        item.id: item
        for item in items
    }

    roots: list[TodoItem] = []

    for item in items:
        item.children.clear()

    for item in items:
        position = positions.get(item.id)
        parent_id = position.parent_id if position else None
        parent = item_lookup.get(parent_id) if parent_id else None

        (parent.children if parent is not None else roots).append(item)

    def order_of(item: TodoItem) -> int:
        position = positions.get(item.id)
        return position.order if position else 0

    roots.sort(key=order_of)

    for item in items:
        item.children.sort(key=order_of)

    for root in roots:
        _compute_completed(root)

    return roots


def _compute_completed(item: TodoItem) -> bool:
    """An item with children is complete iff all of its children are -
    computed bottom-up rather than stored, so it can never drift out of
    sync with the children it's derived from."""

    for child in item.children:
        _compute_completed(child)

    if item.children:
        item.completed = all(child.completed for child in item.children)

    return item.completed
