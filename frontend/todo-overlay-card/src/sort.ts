import type {TodoItem} from "./models";

export type SortBy = "manual" | "title" | "due_date";
export type SortOrder = "asc" | "desc";

function dueTimestamp(item: TodoItem): number {
    const raw = item.due_datetime ?? (item.due_date ? `${item.due_date}T00:00:00` : null);

    if (!raw) {
        return Number.POSITIVE_INFINITY;
    }

    const parsed = new Date(raw).getTime();

    return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

function compareItems(a: TodoItem, b: TodoItem, sortBy: SortBy): number {
    if (sortBy === "title") {
        return a.title.localeCompare(b.title);
    }

    if (sortBy === "due_date") {
        return dueTimestamp(a) - dueTimestamp(b);
    }

    return 0;
}

// Produces a shallow-cloned, recursively re-sorted view of the tree for
// display. The real order (drag-and-drop positions, stored per item in
// the backend) is what "manual" reads, untouched by any other sort mode -
// switching back to manual always restores exactly what dragging last
// left it as, since sorting never writes anything back.
export function sortTree(items: TodoItem[], sortBy: SortBy, sortOrder: SortOrder): TodoItem[] {
    if (sortBy === "manual") {
        return items;
    }

    const direction = sortOrder === "desc" ? -1 : 1;
    const sorted = [...items].sort((a, b) => direction * compareItems(a, b, sortBy));

    return sorted.map(item => ({...item, children: sortTree(item.children, sortBy, sortOrder)}));
}
