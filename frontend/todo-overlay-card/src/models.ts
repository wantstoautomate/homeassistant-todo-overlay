export interface TodoItem {
    id: string;
    title: string;
    completed: boolean;
    description: string | null;
    due_date: string | null;
    due_datetime: string | null;
    quantity: string | null;
    tags: string[];
    trigger_on_due: boolean;
    children: TodoItem[];
}

export interface TodoList {
    entity_id: string;
    items: TodoItem[];
}

export type Placement = "before" | "after" | "inside";

export type LoadMode = "replace" | "merge" | "full_merge";

// How long a press must be held before release opens the edit dialog
// instead of toggling completion. Matches Home Assistant's own hold
// threshold (see homeassistant/frontend's action-handler-directive.ts).
export const LONG_PRESS_MS = 500;

// Matches homeassistant.components.todo.TodoListEntityFeature's bit values.
export const TodoListEntityFeature = {
    CREATE_TODO_ITEM: 1,
    DELETE_TODO_ITEM: 2,
    UPDATE_TODO_ITEM: 4,
    MOVE_TODO_ITEM: 8,
    SET_DUE_DATE_ON_ITEM: 16,
    SET_DUE_DATETIME_ON_ITEM: 32,
    SET_DESCRIPTION_ON_ITEM: 64,
} as const;

export function supportsFeature(
    supportedFeatures: unknown,
    feature: number,
): boolean {
    return (
        typeof supportedFeatures === "number" &&
        (supportedFeatures & feature) !== 0
    );
}

// Day-level (not exact-time) overdue check, shared between the row's
// due-chip styling and the filter bar's "Overdue" mode so both agree on
// exactly the same definition - an item due earlier today isn't overdue
// until tomorrow, regardless of what time of day it's now.
export function isOverdue(item: TodoItem): boolean {
    if (item.completed) {
        return false;
    }

    const raw = item.due_datetime ?? (item.due_date ? `${item.due_date}T00:00:00` : null);

    if (!raw) {
        return false;
    }

    const due = new Date(raw);
    const now = new Date();

    const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    return dueDay.getTime() < today.getTime();
}
