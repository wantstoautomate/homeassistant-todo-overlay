import {type TodoItem, isOverdue} from "./models";

export type FilterMode = "all" | "active" | "completed" | "overdue";

function matchesMode(item: TodoItem, mode: FilterMode): boolean {
    switch (mode) {
        case "all":
            return true;
        case "active":
            return !item.completed;
        case "completed":
            return item.completed;
        case "overdue":
            return isOverdue(item);
    }
}

function matchesQuery(item: TodoItem, query: string): boolean {
    return !query || item.title.toLowerCase().includes(query.toLowerCase());
}

// Prunes the tree to items that match both the mode and the search query,
// while keeping any ancestor that has a matching descendant - a match
// nested three levels deep would otherwise be shown with no parent to
// hang off. Filtering is applied uniformly at every level: a matching
// parent doesn't "rescue" its own non-matching children into view, since
// that would make the filter's meaning inconsistent between levels.
export function filterTree(items: TodoItem[], mode: FilterMode, query: string): TodoItem[] {
    const trimmedQuery = query.trim();
    const result: TodoItem[] = [];

    for (const item of items) {
        const filteredChildren = filterTree(item.children, mode, trimmedQuery);
        const selfMatches = matchesMode(item, mode) && matchesQuery(item, trimmedQuery);

        if (selfMatches || filteredChildren.length > 0) {
            result.push({...item, children: filteredChildren});
        }
    }

    return result;
}
