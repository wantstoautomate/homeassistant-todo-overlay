from .models import ItemPosition, TodoItem


def build_tree(
    items: list[TodoItem],
    positions: dict[str, ItemPosition],
) -> list[TodoItem]:
    """Build a hierarchy from a flat list of TodoItems.

    Items with no stored position (never moved) default to being a root,
    keeping their original relative order via Python's stable sort.

    Completed items sort after incomplete ones within their own parent,
    regardless of their stored order - so completing an item moves it to
    the bottom of its own siblings (and only its siblings: this is applied
    independently at every level), and a drag can still reorder within
    the completed group but can never place one ahead of an incomplete
    sibling, since that comparison is decided by completion status first.
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

    def sort_key(item: TodoItem) -> tuple[bool, int]:
        return (item.completed, order_of(item))

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
