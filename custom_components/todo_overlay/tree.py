from .models import TodoItem


def build_tree(
    items: list[TodoItem],
    relationships: dict[str, str | None],
) -> list[TodoItem]:
    """Build a hierarchy from a flat list of TodoItems."""

    item_lookup = {
        item.id: item
        for item in items
    }

    roots: list[TodoItem] = []

    for item in items:
        item.children.clear()

    for item in items:
        parent_id = relationships.get(item.id)

        if parent_id is None:
            roots.append(item)
            continue

        parent = item_lookup.get(parent_id)

        if parent is None:
            roots.append(item)
            continue

        parent.children.append(item)

    return roots
