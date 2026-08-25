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
    // Marks this item as always rendering like a parent (bold/section-
    // header title, no checkbox, collapsible) regardless of whether it
    // currently has any children - "category" and "person" are purely
    // presentational (a person gets an initial avatar), see
    // todo-tree-item.ts's own isStructural.
    pin_type: PinType | null;
    // Whether this item is mirrored to a partner item elsewhere -
    // possibly on a completely different todo.* entity (see the
    // backend's own item_links.py) - e.g. "Tent" on a purely local
    // "Travel" list, mirrored onto "Brodie" on a cross-instance-linked
    // "Shared" list, so completing one completes the other. Only a
    // boolean here (seeds the item dialog's own "Link to shared list"
    // checkbox) - the partner's own details live entirely server-side.
    linked: boolean;
    // Off by default - opts this item OUT of normal deletion everywhere
    // (desktop delete button, mobile swipe-to-delete, clear completed,
    // clear all - see the backend's own delete_item docstring). Meant
    // for anchor items a whole structure depends on (e.g. a "person"
    // pin a shared list's own organization relies on) that would
    // otherwise be one careless swipe away from being gone.
    delete_protected: boolean;
    children: TodoItem[];
}

export type PinType = "category" | "person";

export interface TodoList {
    entity_id: string;
    items: TodoItem[];
    // Which link this list belongs to, if any - status only (no broker
    // credentials ever travel this path, see websocket.py's
    // websocket_get_list). Linking itself is managed via services
    // (create_link/join_link/unlink), not this card.
    link_id: string | null;
}

export type Placement = "before" | "after" | "inside";

export type LoadMode = "replace" | "merge" | "full_merge";

// Purely cosmetic - how the floating "ghost" that follows the pointer
// during a drag handles the one moment it's a genuine problem: hovering
// a valid reparent ("inside") target, where the ghost sits right at the
// pointer (deliberately - an earlier attempt lifted it clear of the
// pointer entirely and was live-reported as feeling visually
// disconnected from what was actually being dragged) and so can fully
// cover the very row being judged. "label" (the default) puts a small
// pill naming the parent directly under the ghost; "shrink" and
// "translucent" solve the same problem by changing the ghost itself
// instead; "none" leaves the ghost exactly as it's always been, full
// stop. All three non-default options remain available (card editor's
// Advanced section) for anyone who prefers a different one - see
// todo-overlay-list.ts's renderDragGhost for what each actually does.
export type DragGhostStyle = "none" | "label" | "shrink" | "translucent";

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
