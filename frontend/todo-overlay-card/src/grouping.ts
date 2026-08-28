import type {TodoItem, WeekdayAnchor} from "./models";

// A DisplayItem is either a real TodoItem or the one synthetic "Other"
// node groupSiblingsForDisplay generates - see its own doc comment.
// synthetic is the only thing distinguishing the two; every other field
// on the synthetic node is filled in well enough to satisfy TodoItem's
// own shape (so the EXISTING recursive todo-overlay-tree-item rendering
// can render it with no further special-casing beyond checking this one
// flag) without meaning anything real - it was never sent by the
// backend and never will be.
export interface DisplayItem extends TodoItem {
    synthetic?: boolean;
}

export const OTHER_TITLE = "Other";

// Minimum number of STRUCTURAL siblings (a real parent, or pinned - see
// isStructural) a level needs before its plain siblings get visually
// swept into a trailing "Other" group. Below this, the level is left
// exactly as it always has been: a single incidental category must
// never drag an otherwise-flat list's other items behind a collapsed
// header just because it happened to gain children - see
// groupSiblingsForDisplay's own doc comment for the worked example that
// justifies this specific number (1 doesn't clear it, 2 does).
export const OTHER_BUCKET_THRESHOLD = 2;

// A "structural" item always renders like a parent (section-header
// styling, no checkbox, collapsible) regardless of whether it currently
// has any children - either because it genuinely does, or because it's
// pinned (see models.ts's own PinType) as a stand-in for one that will,
// eventually, without needing to already have something under it to
// look the part.
export function isStructural(item: TodoItem): boolean {
    return item.children.length > 0 || item.pin_type != null;
}

// Stable per-level id for the synthetic "Other" node - stable across
// re-renders (so collapsedIds, keyed by id, keeps working normally for
// it) and unique per nesting level (so a household list's OWN root-
// level Other never collides with, say, Brodie's own Other one level
// down).
export function otherGroupId(parentId: string | undefined): string {
    return `__other__:${parentId ?? "root"}`;
}

// Groups one level's worth of siblings for display: if this level has
// at least OTHER_BUCKET_THRESHOLD structural items among it, every
// PLAIN (non-structural) sibling is pulled out and collected into one
// synthetic, trailing "Other" node instead of staying interspersed in
// its original position - structural items keep their own original
// relative order otherwise untouched. Below the threshold, or if there
// are no plain items to begin with, returns `items` completely
// unchanged (not even a new array) - this is a pure, cheap, render-time
// transformation, never touching real data or hierarchy at all: no
// reparenting, no backend call, nothing persisted anywhere. Dragging an
// item "out of" Other needs no special unbucketing logic anywhere else
// in the app for exactly that reason - its real parent_id was always
// whatever this level's own parent is the whole time; Other was only
// ever a rendering fiction laid over the top of it.
//
// Worked example (see the live design discussion this came out of): a
// flat grocery list where ONE item ("Recipes to try") happens to gain
// two sub-items - one structural sibling doesn't clear the threshold,
// so the other six plain groceries stay exactly where they are, fully
// visible. Only once a SECOND item at that same level also becomes
// structural (e.g. "Snacks") does the level "genuinely become a set of
// categories" and the remaining plain items get swept into Other.
export function groupSiblingsForDisplay(
    items: TodoItem[],
    parentId: string | undefined,
    weekdayAnchor: WeekdayAnchor = "top",
): DisplayItem[] {
    const structuralCount = items.reduce((count, item) => count + (isStructural(item) ? 1 : 0), 0);

    if (structuralCount < OTHER_BUCKET_THRESHOLD) {
        return items;
    }

    const structural: DisplayItem[] = [];
    const plain: TodoItem[] = [];

    for (const item of items) {
        (isStructural(item) ? structural : plain).push(item);
    }

    // Nothing to bucket - every item is already structural, so
    // `structural` is just a freshly-built copy of `items` in the same
    // order. Return the original reference instead: same "nothing
    // changed here" signal the below-threshold early return above
    // already gives.
    if (plain.length === 0) {
        return items;
    }

    const other: DisplayItem = {
        id: otherGroupId(parentId),
        title: OTHER_TITLE,
        completed: plain.every(item => item.completed),
        description: null,
        due_date: null,
        due_datetime: null,
        quantity: null,
        tags: [],
        trigger_on_due: false,
        pin_type: null,
        linked: false,
        delete_protected: false,
        weekday: null,
        day_label: null,
        children: plain,
        synthetic: true,
    };

    // Other otherwise always trails the structural block, regardless of
    // backend order - fine (arguably the whole point) for the ordinary
    // "one incidental category emerged" case this was built for, but it
    // would silently defeat weekday_anchor="bottom" for a day-of-week
    // level: the backend already sorted plain items before the day-pin
    // block in that case (see tree.py's own build_tree), and blindly
    // re-trailing Other here would put them back after it. Only day-pin
    // levels get this override - an ordinary category/person level's
    // Other bucket keeps trailing exactly as it always has.
    const hasDayPins = structural.some(item => item.pin_type === "day");

    return hasDayPins && weekdayAnchor === "bottom" ? [other, ...structural] : [...structural, other];
}
