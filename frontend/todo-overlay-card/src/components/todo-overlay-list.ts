import {LitElement, html, css} from "lit";
import {customElement, property, state} from "lit/decorators.js";
import {classMap} from "lit/directives/class-map.js";
import {styleMap} from "lit/directives/style-map.js";

import {
    type CompletionChange,
    clearAll,
    clearCompleted,
    createItem,
    deleteItem,
    deleteSavedList,
    getList,
    linkItem,
    listSaved,
    loadList,
    moveItem,
    restoreCompleted,
    saveList,
    setCompleted,
    setPinType,
    setQuantity,
    setTags,
    setTriggerOnDue,
    transferItem,
    unlinkItem,
    updateItem,
} from "../api";
import {loadCollapsedIds, saveCollapsedIds} from "../collapse-storage";
import type {FilterMode} from "../filter";
import {filterTree} from "../filter";
import type {HassLike} from "../hass";
import {
    type DragGhostStyle,
    LONG_PRESS_MS,
    type Placement,
    type TodoItem,
    type TodoList,
    TodoListEntityFeature,
    supportsFeature,
} from "../models";
import type {SortBy, SortOrder} from "../sort";
import {sortTree} from "../sort";
import type {TodoItemDialogFieldSupport, TodoItemFormValue} from "./todo-item-dialog";
import {EMPTY_FORM_VALUE} from "./todo-item-dialog";
import type {SaveLoadFormValue} from "./todo-save-load-dialog";
import {EMPTY_SAVE_LOAD_VALUE} from "./todo-save-load-dialog";
import {BEFORE_AFTER_ZONE, DROP_GAP_PX} from "./todo-tree-item";

import "./todo-tree";
import "./todo-item-dialog";
import "./todo-save-load-dialog";
import "./todo-confirm-dialog";

// Hand-rolled inline SVGs, matching the same pattern already used for
// the row-level clock/chevron icons (todo-tree-item.ts) - avoids any
// dependency on HA's mdi icon-font resolver being loaded, rather than
// using <ha-icon icon="mdi:...">.
const PLUS_ICON = html`
    <svg viewBox="0 0 24 24"><path d="M19 13H13V19H11V13H5V11H11V5H13V11H19V13Z"></path></svg>
`;

const LINK_ICON = html`
    <svg viewBox="0 0 24 24">
        <path d="M3.9,12C3.9,10.29 5.29,8.9 7,8.9H11V7H7A5,5 0 0,0 2,12A5,5 0 0,0 7,17H11V15.1H7C5.29,15.1 3.9,13.71 3.9,12M8,13H16V11H8V13M17,7H13V8.9H17C18.71,8.9 20.1,10.29 20.1,12C20.1,13.71 18.71,15.1 17,15.1H13V17H17A5,5 0 0,0 22,12A5,5 0 0,0 17,7Z"></path>
    </svg>
`;

const FILTER_ICON = html`
    <svg viewBox="0 0 24 24">
        <path d="M14,12V19.88C14.04,20.18 13.94,20.5 13.71,20.71C13.32,21.1 12.69,21.1 12.3,20.71L10.29,18.7C10.06,18.47 9.96,18.16 10,17.87V12H9.97L4.21,4.62C3.87,4.19 3.95,3.56 4.38,3.22C4.57,3.08 4.78,3 5,3V3H19V3C19.22,3 19.43,3.08 19.62,3.22C20.05,3.56 20.13,4.19 19.79,4.62L14.03,12H14Z"></path>
    </svg>
`;

const SAVE_ICON = html`
    <svg viewBox="0 0 24 24">
        <path d="M17,3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V7L17,3M19,19H5V5H16.17L19,7.83V19M12,12A3,3 0 0,0 9,15A3,3 0 0,0 12,18A3,3 0 0,0 15,15A3,3 0 0,0 12,12M6,6H15V10H6V6Z"></path>
    </svg>
`;

const LOAD_ICON = html`
    <svg viewBox="0 0 24 24">
        <path d="M20,18H4V8H20M20,6H12L10,4H4C2.89,4 2,4.89 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V8C22,6.89 21.1,6 20,6Z"></path>
    </svg>
`;

const CLEAR_COMPLETED_ICON = html`
    <svg viewBox="0 0 24 24">
        <path d="M9,3V4H4V6H5V19A2,2 0 0,0 7,21H17A2,2 0 0,0 19,19V6H20V4H15V3H9M7,6H17V19H7V6M9,8V17H11V8H9M13,8V17H15V8H13Z"></path>
    </svg>
`;

const CLOSE_ICON = html`
    <svg viewBox="0 0 24 24">
        <path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"></path>
    </svg>
`;

const REORDER_TOGGLE_ICON = html`
    <svg viewBox="0 0 24 24">
        <path d="M9,3L5,6.99H8V14H10V6.99H13M16,17.01V10H14V17.01H11L15,21L19,17.01H16Z"></path>
    </svg>
`;

// Must match const.py's EVENT_ITEM_CHANGED exactly - there's no shared
// source of truth between the Python backend and this TS frontend to
// enforce that automatically.
const ITEM_CHANGED_EVENT = "todo_overlay_item_event";

// Hit-testing (onGlobalPointerMove) is suppressed until the pointer has
// moved at least this far from where the drag actually started - live-
// reported bug: the dragged row disappears (.lifted) and every row below
// it slides up to close the gap the instant a drag engages, so the very
// first hit-test right after engaging - still at essentially the pickup
// point, before any real movement - lands on whichever row just slid
// into the dragged item's old on-screen slot, highlighting it as the
// drop target despite nothing having actually been dragged there yet.
// Mice have this exact same race technically, but it's barely noticed in
// practice (a mouse drag usually has real travel before anyone's looking
// closely at the highlight); a handle-initiated touch drag engages
// almost instantly with near-zero travel, and a finger physically
// covers the very row whose highlight just silently jumped, so it reads
// as an obvious, disorienting glitch rather than a mouse drag's more
// forgiving one.
const HOVER_DEAD_ZONE_PX = 12;

// Gap between the ghost's own box and the "label" drag-ghost style's
// floating pill (see renderDragGhost/DragGhostStyle) - anchored
// directly beneath the ghost itself (same left edge, plus the ghost's
// own height) rather than near the raw pointer, so it reads as clearly
// attached to the thing being dragged instead of an independent
// floating element with no obvious connection to it (see the label's
// own CSS arrow, which points straight up at the ghost above it).
const DRAG_GHOST_LABEL_GAP_PX = 8;

// Only used when dragGhostSize is unset (rare - see onDragStart) as a
// stand-in for "the ghost's own height", to place the label directly
// under it anyway rather than not rendering at all.
const DRAG_GHOST_FALLBACK_HEIGHT_PX = 40;

// How narrow the "shrink" drag-ghost style's ghost collapses to while
// hovering a valid reparent target (see renderDragGhost) - small enough
// that the target row is visible around it, without changing the
// ghost's own top-left anchor (still the pointer minus the original
// grab offset, exactly like the ghost's normal, non-shrunk width).
const DRAG_GHOST_SHRINK_WIDTH_PX = 44;

// Caps how far horizontally a TOUCH drag's ghost can sit from the
// pointer (see onDragStart's own comment) - mouse is unaffected, and
// keeps its exact grabbed-point offset.
const TOUCH_DRAG_MAX_GRAB_OFFSET_X_PX = 32;

// Backstop for both the ghost and the "label" style's pill (see
// renderDragGhost/clampToViewport) - keeps either from rendering
// partly or fully off-screen, regardless of how it was positioned.
const GHOST_VIEWPORT_MARGIN_PX = 8;

// Rough stand-in for the "label" style's own rendered height, used
// only to keep it from clipping the bottom edge of the viewport (see
// clampToViewport) - its exact height depends on the parent's title
// length wrapping, which isn't known until after render.
const DRAG_GHOST_LABEL_FALLBACK_HEIGHT_PX = 36;

// Only used when dragGhostSize is unset (rare - see onDragStart), same
// role as DRAG_GHOST_FALLBACK_HEIGHT_PX but for width.
const DRAG_GHOST_FALLBACK_WIDTH_PX = 200;

interface TreeItemElement extends Element {
    item?: TodoItem;
}

interface TodoListElement extends Element {
    entity?: string;
}

// id is undefined for exactly one case: the placeholder todo-tree.ts
// renders in place of an empty item list (see its own "empty-drop-zone"
// element) - there's no existing item there to position relative to, so
// dropping onto it can only ever mean "become this entity's first root
// item" (see findDropTarget/onGlobalPointerUp's own handling of this).
//
// depth exists purely to indent the drop-shadow-box preview to match
// how deep the target actually sits (see todo-tree-item.ts's
// hoverDepth) - 0 for a root item, and for the empty-list placeholder,
// which has no ancestry to speak of.
type RowSnapshot = {
    id: string | undefined;
    entityId: string;
    children: TodoItem[];
    rect: DOMRect;
    depth: number;
};

// Recursively collects every rendered row across all nested shadow roots,
// across every todo-overlay-list on the page (not just this one) - a drop
// target can belong to a different entity than the one being dragged from,
// whether that's a sibling section on the same multi-entity card or an
// entirely separate card on the same dashboard, so hit-testing has to see
// all of them to find it. Each row's entityId is tracked by remembering
// the nearest enclosing todo-overlay-list's own .entity as the walk
// descends into its shadow root - todo-overlay-tree/-tree-item carry no
// entity information of their own.
//
// Reaching even the FIRST todo-overlay-tree-item at all means crossing
// several ancestor shadow roots (ha-card, todo-overlay-list,
// todo-overlay-tree) that don't themselves match the selector - so this has
// to walk every element's shadow root, not just the ones that happen to
// match.
function collectAllRows(
    root: ParentNode,
    currentEntity?: string,
    currentDepth = 0,
): RowSnapshot[] {
    const rows: RowSnapshot[] = [];

    for (const el of Array.from(root.querySelectorAll("*"))) {
        const itemEl = el as TreeItemElement;
        const isTreeItem = el.localName === "todo-overlay-tree-item" && Boolean(itemEl.item);

        if (isTreeItem && currentEntity) {
            const rowEl = itemEl.shadowRoot?.querySelector(".row");

            // The synthetic "Other" row (see grouping.ts) never becomes a
            // drop target itself - it's a rendering fiction with no real
            // item_id behind it, so there's nothing a drag could actually
            // reparent onto. Its real children are collected completely
            // normally regardless: the recursive descent into its own
            // shadow root below doesn't gate on this at all, so skipping
            // the push here only removes Other's OWN row from `rows`,
            // never anything nested under it.
            if (rowEl && !rowEl.hasAttribute("data-synthetic")) {
                // Deliberately NOT itemEl.item.children unconditionally -
                // that's the raw DATA, populated regardless of whether
                // this item is currently collapsed. A collapsed parent's
                // <ul> of child rows is removed from the DOM entirely
                // (see todo-tree-item.ts's own render()), so resolvePlacement
                // treating it as "has children" would silently retarget
                // hovering the parent's own body to "before its first
                // child" - a row that doesn't exist anywhere in the DOM
                // right now, so isDropTarget can never match it and no
                // highlight ever appears, yet the drop still went ahead
                // and the item became a child of that collapsed parent.
                // Live-reported: "the box won't necessarily show but the
                // item is created as a child anyway." Falling back to []
                // here routes a collapsed parent's body through the exact
                // same childless-row logic as a genuine leaf - a real,
                // visible "become a child" zone on the parent's own row,
                // never a phantom target on an invisible descendant.
                const hasVisibleChildren = itemEl.shadowRoot?.querySelector("ul") != null;

                rows.push({
                    id: itemEl.item!.id,
                    entityId: currentEntity,
                    children: hasVisibleChildren ? itemEl.item!.children : [],
                    rect: rowEl.getBoundingClientRect(),
                    depth: currentDepth,
                });
            }
        }

        if (el.localName === "todo-overlay-tree" && currentEntity) {
            const emptyZone = el.shadowRoot?.querySelector("[data-empty-drop-zone]");

            if (emptyZone) {
                rows.push({
                    id: undefined,
                    entityId: currentEntity,
                    children: [],
                    rect: emptyZone.getBoundingClientRect(),
                    depth: 0,
                });
            }
        }

        if (el.shadowRoot) {
            const isList = el.localName === "todo-overlay-list";
            const nextEntity = isList ? (el as TodoListElement).entity : currentEntity;
            // Crossing into a fresh todo-overlay-list starts a brand new
            // tree, unrelated to whatever ancestor chain got us here -
            // depth resets right along with entity. Crossing into a
            // tree-item's own shadow root (where its children render -
            // see todo-tree-item.ts) descends one level into ITS subtree.
            const nextDepth = isList ? 0 : isTreeItem ? currentDepth + 1 : currentDepth;

            rows.push(...collectAllRows(el.shadowRoot, nextEntity, nextDepth));
        }
    }

    return rows;
}

// rowChildren reflects VISIBLE children only (see collectAllRows - a
// collapsed row's children are passed as [] even though the data has
// them), which is what makes the two branches below sound: "no
// children" here means "nothing else currently rendered under this
// row for a drop to visually land among", not "no children at all".
//
// "inside" always appends as the LAST child of the anchor (see manager.py's
// move_item), and "after" always inserts as the anchor's next sibling at the
// anchor's OWN level (never as a child of it), regardless of whether that
// anchor has children of its own. For a row with no (visible) children,
// that's fine - the middle "inside" zone naturally means "become its
// (only visible) child", and the bottom "after" zone naturally means
// "become the next sibling".
//
// For a row that already has VISIBLE children, both of those go wrong the same way:
// "inside" appends past every existing child, and "after" jumps below the
// parent's entire subtree - either can render the drop far from wherever
// the pointer actually was, since both existing children sit visually
// between the parent's own row and either target. There's no drop point
// that could ever land there anyway - hovering anywhere below the "before"
// zone on such a row can only sensibly mean "become its new first child",
// so that's the one placement offered for the whole rest of the row.
// Widens whichever zone the pointer is ALREADY resolving to for this row,
// so a boundary sitting right under a slightly jittery finger doesn't
// flip the target back and forth every other pointermove - the resolved
// zone only changes once the pointer has moved convincingly past the
// boundary, not the instant it touches it. `sticky` is the previous
// frame's own resolved target (see findDropTarget's caller), so this is
// a no-op the very first time a row is hovered - there's nothing to be
// sticky about yet.
const ZONE_HYSTERESIS = 0.05;

function resolvePlacement(
    rowId: string,
    rowChildren: TodoItem[],
    relativeY: number,
    sticky?: {id: string; placement: Placement},
): {id: string; placement: Placement} {
    if (rowChildren.length > 0) {
        if (relativeY < BEFORE_AFTER_ZONE) {
            return {id: rowId, placement: "before"};
        }

        return {id: rowChildren[0].id, placement: "before"};
    }

    const beforeBoundary = sticky?.id === rowId && sticky.placement === "before"
        ? BEFORE_AFTER_ZONE + ZONE_HYSTERESIS
        : BEFORE_AFTER_ZONE - ZONE_HYSTERESIS;

    const afterBoundary = sticky?.id === rowId && sticky.placement === "after"
        ? (1 - BEFORE_AFTER_ZONE) - ZONE_HYSTERESIS
        : (1 - BEFORE_AFTER_ZONE) + ZONE_HYSTERESIS;

    if (relativeY < beforeBoundary) {
        return {id: rowId, placement: "before"};
    }

    if (relativeY > afterBoundary) {
        return {id: rowId, placement: "after"};
    }

    return {id: rowId, placement: "inside"};
}

// Shifts a DOMRect down by `amount` - deliberately NOT {...rect, top:
// rect.top + amount}, since a real (non-mocked) DOMRect's fields are
// inherited getters, not own properties, so a plain spread silently
// produces an empty object. Only the fields findDropTarget actually
// reads (top/bottom/height) need to be correct; the rest just need to
// satisfy the type.
function shiftRectDown(rect: DOMRect, amount: number): DOMRect {
    return {
        top: rect.top + amount,
        bottom: rect.bottom + amount,
        left: rect.left,
        right: rect.right,
        width: rect.width,
        height: rect.height,
        x: rect.x,
        y: rect.y + amount,
        toJSON: rect.toJSON,
    } as DOMRect;
}

// The frozen rowSnapshot below doesn't know about the one reflow a drag
// can cause on its own: the gap-before/gap-after margin the CURRENT
// target itself opens (see todo-tree-item.ts's own CSS - "inside" opens
// no gap at all, only before/after do). Re-measuring the DOM to find
// out would either reintroduce the live-position oscillation
// findDropTarget's own comment describes, or lag behind by however long
// the CSS transition takes to settle - live-reported: the orange
// highlight's hit-zone felt "fractionally high" relative to the
// browser's own (always-accurate) :hover, and could flip unexpectedly
// on a small move that still looked like it was inside the shown
// drop-shadow-box.
//
// Since the SIZE of that one gap is a known constant (DROP_GAP_PX) and
// WHICH row currently has it open is exactly `sticky` (the previous
// frame's own resolved target), the correction is computed directly
// instead of re-measured: every row that sits at or after the gap, in
// the snapshot's own frozen (pre-gap) top-to-bottom order, shifts down
// by that amount before hit-testing runs - analytically exact, with no
// re-measurement and no timing dependency at all.
function applyGapCorrection(
    rows: RowSnapshot[],
    sticky?: {id: string; placement: Placement},
): RowSnapshot[] {
    if (!sticky || sticky.placement === "inside") {
        return rows;
    }

    const sortedByTop = [...rows].sort((a, b) => a.rect.top - b.rect.top);
    const targetIndex = sortedByTop.findIndex(r => r.id === sticky.id);

    if (targetIndex === -1) {
        return rows;
    }

    // gap-before opens ABOVE the target row - it and everything below
    // it (in the original, pre-gap order) shifts down. gap-after opens
    // BELOW it - only rows strictly after it shift.
    const shiftFromIndex = sticky.placement === "before" ? targetIndex : targetIndex + 1;
    const shiftedIds = new Set(sortedByTop.slice(shiftFromIndex).map(r => r.id));

    if (shiftedIds.size === 0) {
        return rows;
    }

    return rows.map(row => (
        shiftedIds.has(row.id) ? {...row, rect: shiftRectDown(row.rect, DROP_GAP_PX)} : row
    ));
}

// Live-reported (real drag, not just theory): hovering right where a
// nested item's own row meets its ancestor's - e.g. a grandchild dragged
// up toward the boundary between its parent's row and its parent's OWN
// parent's row - could make the surrounding rows visibly jump up/down
// repeatedly even for a barely-moving pointer. Root cause: which row
// wins the nearest-row search below can flip between two DIFFERENT rows
// (say, an ancestor vs. one of its descendants) that each end up
// resolving to a different final target - and each is independently
// self-consistent once landed on, since applyGapCorrection's own
// shift (which rows move, and by how much) depends entirely on which
// target is currently sticky. Landing on either after a fast pointer
// jump (consecutive pointermove events several tens of px apart are
// completely normal for a real drag - browsers don't guarantee one
// event per pixel) is then a stable dead end on its own, but a little
// further jitter can tip the nearest-row search back the other way,
// each flip re-triggering applyGapCorrection's shift on a DIFFERENT set
// of rows - that's the visible up/down jump. ROW_SWITCH_HYSTERESIS_PX
// below closes this the same way ZONE_HYSTERESIS already protects a
// single row's own before/inside/after boundary: once a row has won
// the nearest-row search, a competing row has to be decisively closer,
// not just marginally so, before it can take over.
const ROW_SWITCH_HYSTERESIS_PX = 24;

// Hit-testing against LIVE row positions creates a feedback loop: hovering
// near a boundary opens a "gap" (a margin shift) on the rows next to it,
// which moves those rows' rects, which can put a now-stationary pointer over
// a *different* row's new zone, which opens a different gap, moving things
// again - the drop target oscillates even while the pointer holds still.
// Snapshotting every row's rect once when the drag engages, and hit-testing
// against that frozen snapshot for the rest of the gesture, breaks the loop:
// the coordinates being tested against never move in response to their own
// output (see applyGapCorrection above for the one exception - the
// current target's own gap - that's corrected for analytically instead).
// Distance-to-nearest-row (rather than requiring the pointer land inside a
// row's rect) also naturally covers dragging above the first item or below
// the last, where a direct hit would otherwise find nothing.
//
// `stickyNearestRowId` is the previous frame's own WINNING row from this
// same search (see ROW_SWITCH_HYSTERESIS_PX above) - distinct from
// `sticky`, which is the previous frame's own FINAL resolved id/placement
// after resolvePlacement has possibly renamed it (e.g. to that row's
// first child) - the two can legitimately name different rows, and it's
// specifically THIS search, not the final id, that needed protecting.
function findDropTarget(
    y: number,
    rows: RowSnapshot[],
    sticky?: {id: string; placement: Placement},
    stickyNearestRowId?: string,
): {id: string | undefined; entityId: string; placement: Placement; depth: number; nearestRowId: string | undefined} | undefined {
    if (rows.length === 0) {
        return undefined;
    }

    // Tracks both the RAW nearest row (no hysteresis at all) and the
    // hysteresis-adjusted nearest row in the same single pass - each
    // row's distance is computed once and fed into both. Which one
    // actually gets used is decided once, after the loop: see
    // `nearest`'s own comment below for why raw wins whenever it found
    // a genuine zero-distance row.
    let nearestRaw = rows[0];
    let nearestRawDistance = Infinity;
    let nearestWithHysteresis = rows[0];
    let nearestWithHysteresisDistance = Infinity;

    for (const row of rows) {
        const distance = y < row.rect.top
            ? row.rect.top - y
            : y > row.rect.bottom
                ? y - row.rect.bottom
                : 0;

        if (distance < nearestRawDistance) {
            nearestRaw = row;
            nearestRawDistance = distance;
        }

        const hysteresisDistance = stickyNearestRowId !== undefined && row.id === stickyNearestRowId
            ? Math.max(0, distance - ROW_SWITCH_HYSTERESIS_PX)
            : distance;

        if (hysteresisDistance < nearestWithHysteresisDistance) {
            nearestWithHysteresis = row;
            nearestWithHysteresisDistance = hysteresisDistance;
        }
    }

    // The pointer sitting literally inside some row's own rect (raw
    // distance 0) is completely unambiguous - there's nothing for
    // hysteresis to protect against, and letting it apply anyway would
    // let a merely-discounted STALE row tie with (and, by iteration
    // order, beat) the row the pointer is now decisively inside. Only
    // withhold hysteresis in that one case - it stays fully in effect
    // for the genuinely ambiguous "pointer is between two rows, inside
    // neither" case this exists for in the first place.
    const nearest = nearestRawDistance === 0 ? nearestRaw : nearestWithHysteresis;

    // The empty-list placeholder - nothing to be before/after/inside OF,
    // so the only meaningful placement is "become this entity's first
    // (and only) root item" (see onGlobalPointerUp's transferItem call,
    // which sends no reference_id at all for this case).
    if (nearest.id === undefined) {
        return {id: undefined, entityId: nearest.entityId, placement: "inside", depth: 0, nearestRowId: undefined};
    }

    const relativeY = (y - nearest.rect.top) / nearest.rect.height;

    // resolvePlacement may pick a different id (nearest's own, or its
    // first child's) depending on placement, but never a different
    // entity - a row's children always live on the same entity it does.
    const resolved = {
        ...resolvePlacement(nearest.id, nearest.children, relativeY, sticky),
        entityId: nearest.entityId,
    };

    // depth is purely informational (drives the shadow box's own indent -
    // see todo-tree-item.ts's hoverDepth). resolvePlacement may have
    // named a different row than `nearest` (its first VISIBLE child, for
    // a row with some already showing - see resolvePlacement's own
    // comment), so this re-looks-up whichever row `resolved.id` actually
    // names rather than assuming it's still `nearest`.
    const resolvedRow = rows.find(r => r.id === resolved.id) ?? nearest;
    const depth = resolvedRow.depth + (resolved.placement === "inside" ? 1 : 0);

    return {...resolved, depth, nearestRowId: nearest.id};
}

function findItem(items: TodoItem[], id: string): TodoItem | undefined {
    for (const item of items) {
        if (item.id === id) {
            return item;
        }

        const found = findItem(item.children, id);

        if (found) {
            return found;
        }
    }

    return undefined;
}

// A dragged row's own subtree keeps rendering normally beneath its lifted
// placeholder (see todo-tree-item.ts - only the dragged row's OWN content
// collapses, its child <ul> is untouched), so those descendant rows are
// still fully live, hit-testable rows for the rest of the drag. Dropping
// the dragged item before/after/inside any of them is always a cycle - the
// backend would reject it as one anyway - and it's not just a theoretical
// case: it's the easiest way to reproduce one, since it only takes the
// dragged item sitting at the very top (or bottom) of the list for its own
// first (or last) child to become the new nearest row once the dragged
// row's placeholder shrinks to almost nothing.
function collectDescendantIds(item: TodoItem, into: Set<string> = new Set()): Set<string> {
    for (const child of item.children) {
        into.add(child.id);
        collectDescendantIds(child, into);
    }

    return into;
}

function splitDueDateTime(iso: string | null): {date: string; time: string} {
    if (!iso) {
        return {date: "", time: ""};
    }

    // "YYYY-MM-DDTHH:mm[:ss...]" -> date/time <input> values, no seconds.
    const [date, time] = iso.split("T");

    return {date: date ?? "", time: (time ?? "").slice(0, 5)};
}

const UNDO_TIMEOUT_MS = 8000;
const ERROR_TIMEOUT_MS = 8000;

const FILTER_MODES: readonly FilterMode[] = ["all", "active", "completed", "overdue"];

const FILTER_LABELS: Record<FilterMode, string> = {
    all: "All",
    active: "Active",
    completed: "Completed",
    overdue: "Overdue",
};

// One entity's worth of everything the card used to do directly: quick-add,
// the tree(s), drag-and-drop, the item/save-load dialogs, undo. Pulled out
// of TodoOverlayCard so a single card can host more than one of these side
// by side (see TodoOverlayCardConfig's `entities`) - each instance is fully
// self-contained and entity-scoped, so nothing here needs to know whether
// it's the only list on the card or one of several.
@customElement("todo-overlay-list")
export class TodoOverlayList extends LitElement {

    static styles = css`
        .list-header-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            padding: 8px 8px 8px 12px;
        }

        .list-title-group {
            display: flex;
            align-items: center;
            gap: 6px;
            min-width: 0;
        }

        .list-title {
            font-family: Roboto, "Noto Sans", sans-serif;
            font-size: 16px;
            font-weight: 500;
            color: var(--primary-text-color);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            min-width: 0;
        }

        .link-badge {
            display: flex;
            align-items: center;
            flex-shrink: 0;
            color: var(--secondary-text-color);
        }

        .link-badge svg {
            width: 14px;
            height: 14px;
            fill: currentColor;
        }

        .toolbar {
            display: flex;
            align-items: center;
            gap: 4px;
            flex-shrink: 0;
        }

        .toolbar-icon {
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 36px;
            height: 36px;
            flex-shrink: 0;
            border: none;
            border-radius: 50%;
            background: none;
            padding: 0;
            color: var(--secondary-text-color);
            cursor: pointer;
        }

        .toolbar-icon:hover {
            background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.06);
        }

        .toolbar-icon.active {
            color: var(--primary-color);
        }

        .toolbar-icon svg {
            width: 20px;
            height: 20px;
            fill: currentColor;
        }

        .toolbar-icon .badge-dot {
            position: absolute;
            top: 6px;
            right: 6px;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: var(--primary-color);
        }

        /* Same visual language as a row's own hold-to-edit ripple
           (todo-tree-item.ts's .hold-ripple) - pops in once the press
           has been held long enough to trigger the hold action instead
           of a plain tap, so there's a clear "you can let go now"
           signal rather than needing to guess how long is long enough. */
        .toolbar-icon .hold-ripple {
            position: absolute;
            top: 50%;
            left: 50%;
            width: 32px;
            height: 32px;
            margin-left: -16px;
            margin-top: -16px;
            border-radius: 50%;
            background: var(--primary-color);
            opacity: 0.2;
            pointer-events: none;
            transform: scale(0);
            transition: transform 180ms ease-in-out;
        }

        .toolbar-icon .hold-ripple.active {
            transform: scale(1);
        }

        .toolbar-icon.quick-add-toggle svg {
            transition: transform 150ms ease;
        }

        .toolbar-icon.quick-add-toggle.expanded svg {
            transform: rotate(45deg);
        }

        /* Hidden by default (mouse/trackpad primary input) - hold-
           anywhere-to-drag already works reliably for a mouse, so this
           would just be clutter. (pointer: coarse) is the actual primary-
           input-is-imprecise signal, not a viewport-width breakpoint - a
           narrow desktop browser window shouldn't show it, and a tablet
           in the HA Companion App should, regardless of its screen size.
           See todo-tree-item.ts's .drag-handle for what this puts each
           row into once active. */
        .reorder-toggle {
            display: none;
        }

        @media (pointer: coarse) {
            .reorder-toggle {
                display: flex;
            }
        }

        .quick-add-panel {
            padding: 0 16px 10px;
            font-family: Roboto, "Noto Sans", sans-serif;
        }

        .quick-add-row {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .quick-add-row input {
            flex: 1;
            font-family: inherit;
            font-size: 14px;
            color: var(--primary-text-color);
            background: none;
            border: none;
            border-bottom: 1px solid var(--divider-color);
            padding: 6px 0;
            outline: none;
        }

        .quick-add-row input:focus {
            border-bottom: 2px solid var(--primary-color);
            padding-bottom: 5px;
        }

        .quick-add-row button {
            border: none;
            background: none;
            font-family: inherit;
            font-size: 14px;
            color: var(--primary-color);
            font-weight: 500;
            cursor: pointer;
        }

        .quick-add-details {
            display: block;
            margin-top: 4px;
            border: none;
            background: none;
            font-family: inherit;
            font-size: 12px;
            color: var(--secondary-text-color);
            cursor: pointer;
            padding: 4px 0;
        }

        /* The visible icon is purely decorative - an invisible native
           <select> is stretched over the whole button, so a click
           anywhere on the icon opens the browser's own dropdown. This
           gives a genuinely transient "pop out, pick one, gone" menu for
           free (native selects always auto-dismiss on choice or
           click-away) instead of a panel that has to be toggled open
           and closed by hand. */
        .filter-select-wrapper {
            padding: 0;
        }

        .filter-select {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            margin: 0;
            border: none;
            background: none;
            opacity: 0;
            cursor: pointer;
            appearance: none;
            -webkit-appearance: none;
        }

        .undo-snackbar {
            position: fixed;
            bottom: 16px;
            left: 50%;
            transform: translateX(-50%);
            display: flex;
            align-items: center;
            gap: 16px;
            padding: 12px 16px;
            border-radius: 4px;
            background: var(--primary-text-color);
            color: var(--primary-background-color);
            font-family: Roboto, "Noto Sans", sans-serif;
            font-size: 14px;
            z-index: 10;
        }

        .undo-snackbar button {
            border: none;
            background: none;
            color: var(--primary-color);
            font-family: inherit;
            font-weight: 600;
            text-transform: uppercase;
            cursor: pointer;
        }

        /* Sits above the list rather than replacing it (see render()) -
           an action failing is never a reason to hide items the user can
           already see, only to flag that the one action didn't go
           through. Auto-dismisses like the undo snackbar, and can be
           closed early by hand. */
        .error-banner {
            display: flex;
            align-items: center;
            gap: 12px;
            margin: 0 12px 8px;
            padding: 10px 12px;
            border-radius: 4px;
            background: rgba(var(--rgb-error-color, 219, 68, 55), 0.1);
            color: var(--error-color);
            font-family: Roboto, "Noto Sans", sans-serif;
            font-size: 13px;
        }

        .error-banner span {
            flex: 1;
        }

        .error-banner button {
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 20px;
            height: 20px;
            border: none;
            background: none;
            padding: 0;
            color: inherit;
            cursor: pointer;
            opacity: 0.7;
        }

        .error-banner button:hover {
            opacity: 1;
        }

        .error-banner button svg {
            width: 16px;
            height: 16px;
            fill: currentColor;
        }

        .section-header {
            padding: 14px 16px 6px;
            font-family: Roboto, "Noto Sans", sans-serif;
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: var(--secondary-text-color);
        }

        /* Follows the pointer while an item is being dragged (see
           onDragStart/onGlobalPointerMove) - pointer-events:none is
           essential, not just cosmetic: without it, this element would
           itself be hit by our own elementFromPoint-based hit-testing,
           since it's rendered on top of everything else. */
        .drag-ghost {
            position: fixed;
            z-index: 10;
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 8px 20px;
            border-radius: 4px;
            background: var(--card-background-color, var(--primary-background-color));
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            pointer-events: none;
            font-family: Roboto, "Noto Sans", sans-serif;
            font-size: 14px;
            color: var(--primary-text-color);
        }

        .drag-ghost-title {
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .drag-ghost-quantity {
            flex-shrink: 0;
            font-size: 12px;
            font-weight: 600;
            color: var(--primary-color);
            background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.12);
            padding: 1px 7px;
            border-radius: 10px;
        }

        /* "shrink" drag-ghost style only (see DragGhostStyle/
           renderDragGhost) - width is set inline per-instance (see
           DRAG_GHOST_SHRINK_WIDTH_PX), this just hides the content that
           no longer fits so nothing overflows or wraps oddly inside the
           collapsed box. */
        .drag-ghost.shrink {
            padding: 8px;
            justify-content: center;
            gap: 0;
        }

        .drag-ghost.shrink .drag-ghost-title,
        .drag-ghost.shrink .drag-ghost-quantity,
        .drag-ghost.shrink ha-checkbox {
            display: none;
        }

        /* "translucent" drag-ghost style only - lets the highlighted
           target row show through well enough to read while still
           fully covering it, unlike shrink (smaller box) or label (an
           entirely separate element). */
        .drag-ghost.translucent {
            opacity: 0.4;
        }

        /* "label" drag-ghost style only - a small satellite pill near
           (not on top of) the pointer, naming the parent a release
           right now would nest under. Never requires seeing the target
           row at all, which is what makes it work identically on touch
           (a finger blocks far more of the view than a mouse cursor
           does) and mouse alike. */
        /* Anchored directly under the ghost's own box (same left edge,
           see renderDragGhost) with a small upward-pointing arrow (see
           ::before below) so it reads as clearly attached to the thing
           being dragged, not as an independent floating chip with no
           obvious connection to it - the exact "dissociated" look
           live-reported against the first version, which anchored this
           near the raw pointer instead. */
        .drag-ghost-label {
            position: fixed;
            z-index: 11;
            pointer-events: none;
            display: inline-block;
            background: var(--accent-color, var(--primary-color));
            color: #fff;
            font-family: Roboto, "Noto Sans", sans-serif;
            font-size: 14px;
            font-weight: 600;
            padding: 7px 14px;
            border-radius: 8px;
            max-width: 260px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        }

        .drag-ghost-label::before {
            content: "";
            position: absolute;
            top: -6px;
            left: 16px;
            border-left: 6px solid transparent;
            border-right: 6px solid transparent;
            border-bottom: 6px solid var(--accent-color, var(--primary-color));
        }
    `;

    @property({attribute: false})
    public hass!: HassLike;

    @property()
    public entity!: string;

    // The section title shown on the same row as the +/icons toolbar -
    // the entity's friendly name in multi-entity mode, or the card's
    // (possibly default) title in single-entity mode. Rendering it here
    // rather than in a separate element one shadow root up is what lets
    // it share a single flex row with the toolbar at all.
    @property()
    public headerTitle?: string;

    @property({type: Boolean})
    public hideCompleteForParents = false;

    // Off by default - see todo-tree-item.ts's own showCheckboxes
    // property doc for why hiding the checkbox glyph never affects
    // whether a tap actually completes an item.
    @property({type: Boolean})
    public showCheckboxes = false;

    @property()
    public sortBy: SortBy = "manual";

    @property()
    public sortOrder: SortOrder = "asc";

    @property({type: Boolean})
    public showClearButton = true;

    @property({type: Boolean})
    public showSaveLoadButtons = true;

    @property({type: Boolean})
    public showQuickAdd = true;

    @property({type: Boolean})
    public confirmDelete = true;

    @property({type: Boolean})
    public showFilterMenu = false;

    // See TodoOverlayCardConfig's own show_reorder_toggle comment - the
    // toggle button itself is additionally CSS-gated to touch/coarse-
    // pointer devices (see .reorder-toggle's own @media rule), so this
    // being true doesn't put anything in front of a mouse user at all.
    @property({type: Boolean})
    public showReorderToggle = true;

    // Off by default: completing/uncompleting an item never repositions
    // it (backend) or splits it into a separate Active/Completed section
    // (see renderTree) - a plain checkbox tap just flips the check, full
    // stop. Turning this on restores the old "completed items sink to
    // the bottom, uncompleted rise back up" behavior end to end.
    @property({type: Boolean})
    public moveCompletedItems = false;

    // See DragGhostStyle's own comment for what each option does.
    @property()
    public dragGhostStyle: DragGhostStyle = "label";

    @state()
    private list?: TodoList;

    @state()
    private collapsedIds: Set<string> = new Set();

    @state()
    private filterMode: FilterMode = "all";

    // Whether add-mode is active - see this class's own "mode
    // exclusivity" note above enterAddMode/enterDeleteMode/
    // enterReorderMode for how this relates to deleteModeActive and
    // reorderModeActive. Live-reported: an earlier version only ever
    // showed a per-row "+" on items that ALREADY had children - nothing
    // that wasn't already a parent had any way to become one. Add-mode
    // fixes that: every row gets its own "+" (see todo-tree-item.ts's
    // per-row plus toggle) for the duration this is true, desktop only -
    // touch relies on the swipe-right gesture for the exact same thing
    // instead (see todo-tree-item.ts's own swipe handling).
    @state()
    private addModeActive = false;

    // Which items currently have their own inline "add a child" field
    // open - independent of each other; any number can be open at once.
    // Only ever cleared in bulk when add-mode itself is turned off (see
    // enterAddMode's else-branch) - closing one specific item's own
    // field happens via toggling it again, handled the same way opening
    // it did (see onToggleChildQuickAdd).
    @state()
    private childQuickAddParentIds: Set<string> = new Set();

    // Desktop-only per-row delete crosses, toggled by the clear-completed
    // button itself when there's nothing left to clear (see
    // onClearButtonPointerUp) - see this class's own "mode exclusivity"
    // note for how this relates to the other two modes. Touch never
    // shows these at all (crosses are removed entirely from mobile -
    // see todo-tree-item.ts's own CSS) - swipe-left is the mobile
    // equivalent instead.
    @state()
    private deleteModeActive = false;

    // Touch-only reorder mode - see TodoOverlayCardConfig's
    // show_reorder_toggle comment for why this exists as a separate
    // mode at all rather than just letting touch hold-and-drag like a
    // mouse does.
    @state()
    private reorderModeActive = false;

    // add-mode, delete-mode, and reorder-mode all want the same per-row
    // trailing-icon slot (see todo-tree-item.ts's rowClasses) - only one
    // can sensibly occupy it at a time, so turning any one of them on
    // turns the other two off. Each enter* method is the single place
    // that transition happens, including whatever cleanup turning a mode
    // OFF needs (childQuickAddParentIds for add-mode; nothing extra for
    // the other two, which have no per-row draft state of their own).
    private enterAddMode() {
        this.deleteModeActive = false;
        this.reorderModeActive = false;
        this.addModeActive = true;
    }

    private exitAddMode() {
        this.addModeActive = false;

        if (this.childQuickAddParentIds.size > 0) {
            this.childQuickAddParentIds = new Set();
        }
    }

    private enterDeleteMode() {
        this.addModeActive = false;
        this.reorderModeActive = false;
        this.deleteModeActive = true;

        if (this.childQuickAddParentIds.size > 0) {
            this.childQuickAddParentIds = new Set();
        }
    }

    private onToggleReorderMode = () => {
        if (this.reorderModeActive) {
            this.reorderModeActive = false;
            return;
        }

        this.addModeActive = false;
        this.deleteModeActive = false;

        if (this.childQuickAddParentIds.size > 0) {
            this.childQuickAddParentIds = new Set();
        }

        this.reorderModeActive = true;
    };

    @state()
    private error?: string;

    @state()
    private draggedId?: string;

    @state()
    private hoverId?: string;

    @state()
    private hoverPlacement?: Placement;

    // How deep the CURRENT target sits (root = 0) - purely cosmetic,
    // drives a reorder's (before/after) drop-shadow-box indent so it
    // visually lines up with the target's actual nesting level.
    // "inside" (becoming a child) doesn't use this at all - see
    // todo-tree-item.ts's render().
    @state()
    private hoverDepth = 0;

    // Which entity hoverId's row belongs to - may differ from this.entity
    // when hovering over a row from another entity's section (same
    // multi-entity card, or an entirely different card) - see
    // onGlobalPointerUp for how that's handled.
    private hoverEntityId?: string;

    // The previous frame's own WINNING row from findDropTarget's
    // nearest-row search - fed back in as that search's own hysteresis
    // anchor (see ROW_SWITCH_HYSTERESIS_PX). Deliberately separate from
    // hoverId, which is the FINAL resolved id after resolvePlacement may
    // have renamed it (e.g. to that row's own first child) - the two can
    // legitimately name different rows, and it's specifically the
    // nearest-row search that needed its own hysteresis anchor. Never
    // rendered, so no reason for this to be @state.
    private hoverNearestRowId?: string;

    // draggedId/hoverId/hoverEntityId above are only ever populated on
    // the ONE instance whose own row the drag actually started from -
    // every OTHER todo-overlay-list on the page (any other section of a
    // multi-entity card, or another card entirely) has no idea a drag is
    // even happening via those fields alone. That's fine for highlighting
    // an ordinary ROW (it's threaded down as a prop from ITS OWN
    // ancestor, which for a foreign entity's row is that OTHER instance -
    // still reachable), but an EMPTY list's placeholder belongs to a
    // DIFFERENT todo-overlay-list instance than the one driving the drag,
    // and by definition can never BE the drag-owning instance itself (an
    // entity being dragged FROM can't simultaneously be empty). Without
    // this broadcast, "am I currently a hovered empty-list target" would
    // never be knowable outside the drag-owning instance at all - so the
    // one dedicated to that specific state is populated for every
    // instance (see onGlobalPointerMove/onGlobalPointerUp, which send
    // it, and connectedCallback, which every instance listens for).
    @state()
    private foreignDragActive = false;

    private foreignDragHoverEntityId?: string;
    private foreignDragHoverId?: string;

    private onForeignDragHover = (e: CustomEvent<{draggedId?: string; hoverEntityId?: string; hoverId?: string}>) => {
        const wasEmptyTarget = this.isEmptyDropTarget;

        this.foreignDragActive = e.detail.draggedId !== undefined;
        this.foreignDragHoverEntityId = e.detail.hoverEntityId;
        this.foreignDragHoverId = e.detail.hoverId;

        // foreignDragHoverEntityId/foreignDragHoverId aren't reactive
        // @state() themselves (they'd only usefully matter in
        // combination with foreignDragActive anyway) - force a render
        // when the combined isEmptyDropTarget verdict actually flips, or
        // a hover arriving/leaving the empty placeholder would never
        // repaint it.
        if (wasEmptyTarget !== this.isEmptyDropTarget) {
            this.requestUpdate();
        }
    };

    @state()
    private ghostPosition?: {x: number; y: number};

    private dragGhostOffset = {x: 0, y: 0};
    private dragGhostSize?: {width: number; height: number};
    private rowSnapshot: RowSnapshot[] = [];
    private dragStartPointerPos = {x: 0, y: 0};

    @state()
    private dialogMode?: "create" | "edit";

    @state()
    private dialogItem?: TodoItem;

    @state()
    private dialogFormValue: TodoItemFormValue = EMPTY_FORM_VALUE;

    @state()
    private quickAddValue = "";

    @state()
    private undoState?: {message: string; changes: CompletionChange[]};

    @state()
    private saveLoadAction?: "save" | "load";

    @state()
    private saveLoadValue: SaveLoadFormValue = EMPTY_SAVE_LOAD_VALUE;

    @state()
    private savedNames: string[] = [];

    @state()
    private confirmingClearAll = false;

    private undoTimer?: number;
    private errorTimer?: number;
    private lastEntityUpdate?: string;
    private unsubItemChanged?: () => void;
    private itemChangedSubscribeStarted = false;

    // Native hass.states-based reloading (below) only fires for changes
    // that touch the native entity itself - a same-list reorder is purely
    // overlay metadata and never does (see manager_position.py's
    // move_item, which fires this event for exactly that reason). Without
    // this, another open card (a different browser/device/tab) has no
    // way to know a reorder - or a tag/quantity change, which also don't
    // reliably touch native state - happened at all. Subscribed once,
    // the first time hass becomes available - the callback re-reads
    // this.entity fresh on every event rather than closing over it, so a
    // live card-editor repoint to a different entity doesn't need a
    // fresh subscription.
    private async subscribeToItemChanged(): Promise<void> {
        this.unsubItemChanged = await this.hass.connection.subscribeEvents<{entity_id: string; action: string}>(
            (event) => {
                if (event.data.entity_id === this.entity) {
                    this.load();
                }
            },
            ITEM_CHANGED_EVENT,
        );
    }

    protected updated(changed: Map<string, unknown>) {
        // Restores whatever collapse state this entity was left in on a
        // previous visit - before anything else runs, so the very first
        // render already reflects it rather than flashing fully-expanded
        // first. Re-checked whenever `entity` itself changes (not just on
        // first connect), in case a live card-editor edit repoints this
        // same list instance at a different entity.
        if (changed.has("entity") && this.entity) {
            this.collapsedIds = loadCollapsedIds(this.entity);
        }

        if (this.hass && !this.itemChangedSubscribeStarted) {
            this.itemChangedSubscribeStarted = true;
            this.subscribeToItemChanged();
        }

        if (!changed.has("hass") || !this.hass || !this.entity) {
            return;
        }

        // hass updates on every state change globally, not just for our
        // entity - only reload when the entity itself actually changed,
        // so edits made elsewhere (the native card, automations, voice)
        // show up here too instead of only reacting to our own actions.
        const entityUpdate = this.hass.states[this.entity]?.last_updated;
        const entityChanged = entityUpdate !== undefined && entityUpdate !== this.lastEntityUpdate;
        this.lastEntityUpdate = entityUpdate;

        if (!this.list && !this.error) {
            this.load();
        } else if (entityChanged) {
            this.load();
        }
    }

    // A raw backend exception (a Python traceback line, an "already
    // exists" ValueError, etc.) is meaningless to whoever's actually
    // using this card - it's logged in full for whoever's debugging,
    // and everyone else just sees one plain, consistent message.
    //
    // This never hides an already-loaded list (see render()): a failed
    // drag, tap, or edit is just one action not going through, not a
    // reason to make every item the user can already see vanish until
    // they refresh the page. The banner auto-dismisses the same way the
    // undo snackbar does, rather than sitting there forever.
    private reportError(action: string, err: unknown): void {
        console.error(`todo-overlay-card: ${action} failed`, err);

        window.clearTimeout(this.errorTimer);
        this.error = "Something went wrong. Check the browser console for details.";
        this.errorTimer = window.setTimeout(() => {
            this.error = undefined;
        }, ERROR_TIMEOUT_MS);
    }

    private dismissError() {
        window.clearTimeout(this.errorTimer);
        this.error = undefined;
    }

    private async load() {
        try {
            this.list = await getList(
                this.hass,
                this.entity,
                this.moveCompletedItems,
            );

            window.clearTimeout(this.errorTimer);
            this.error = undefined;
        } catch (err) {
            this.reportError("loading the list", err);
        }
    }

    private get fieldSupport(): TodoItemDialogFieldSupport {
        const supportedFeatures = this.hass.states[this.entity]
            ?.attributes.supported_features;

        return {
            description: supportsFeature(supportedFeatures, TodoListEntityFeature.SET_DESCRIPTION_ON_ITEM),
            dueDate: supportsFeature(supportedFeatures, TodoListEntityFeature.SET_DUE_DATE_ON_ITEM),
            dueDateTime: supportsFeature(supportedFeatures, TodoListEntityFeature.SET_DUE_DATETIME_ON_ITEM),
        };
    }

    private get dragDisabled(): boolean {
        return this.sortBy !== "manual";
    }

    // True while a drag - from this instance or (far more commonly,
    // since an entity being dragged FROM can't also be empty) another
    // one entirely - is hovering this list's own empty-state placeholder
    // (see todo-tree.ts) as its drop target. Driven by the
    // foreignDragActive broadcast (see its own doc comment) rather than
    // this instance's own draggedId/hoverEntityId/hoverId, which are
    // only ever populated on whichever instance the drag actually
    // started from.
    private get isEmptyDropTarget(): boolean {
        return this.foreignDragActive
            && this.foreignDragHoverEntityId === this.entity
            && this.foreignDragHoverId === undefined;
    }

    // --- drag / tap / hold ---------------------------------------------
    //
    // A drag only ever reaches the "live" ghost-follow stage below once
    // the item's own hold threshold has been reached AND the pointer
    // then moves (see todo-tree-item.ts) - so a quick swipe on mobile
    // still scrolls the page normally, and only a sustained hold-then-
    // move actually picks an item up. Once that happens, this component
    // takes over entirely via window-level listeners and its own
    // hit-testing (findDropTarget against a frozen row snapshot, see
    // its own comment for why it's frozen), rather than relying on the
    // dragged item's own bubbled events for hover detection.

    private onPointerDown(e: CustomEvent) {
        this.draggedId = e.detail.id;
    }

    private snapshotRows() {
        const excluded = new Set<string>();

        if (this.draggedId) {
            excluded.add(this.draggedId);

            const dragged = this.list && findItem(this.list.items, this.draggedId);

            if (dragged) {
                collectDescendantIds(dragged, excluded);
            }
        }

        // Excludes the dragged item (and its own descendants) as a
        // standalone ROW below, but a row's own `children` field (used
        // by resolvePlacement to decide before-vs-inside) is read
        // straight from the item tree's data and needs the same
        // scrubbing - otherwise a parent whose dragged item happens to
        // be its own first VISIBLE child keeps "offering" that item as
        // resolvePlacement's before-target, which then gets invalidated
        // right back out (see onGlobalPointerMove's own hit.id !==
        // draggedId check) with no fallback at all. Live-reported: no
        // orange box at all when hovering that parent, and glitchy
        // flicker right around where the dragged row used to sit, since
        // that's exactly the boundary between "still offering the
        // now-invalid target" and whatever comes next.
        this.rowSnapshot = collectAllRows(document)
            .filter(row => row.id === undefined || !excluded.has(row.id))
            .map(row => (
                excluded.size > 0 && row.children.some(child => excluded.has(child.id))
                    ? {...row, children: row.children.filter(child => !excluded.has(child.id))}
                    : row
            ));
    }

    private onDragStart(e: CustomEvent) {
        const {rect, pointerX, pointerY, grabOffsetX, grabOffsetY, pointerType} = e.detail;

        // grabOffsetX/Y come from the original press position, not this
        // event's - see the dispatch site in todo-tree-item.ts for why
        // that distinction matters for fast drags.
        //
        // Live-reported: on a phone, touch can only ever start a drag
        // from the reorder handle (see todo-tree-item.ts's own class
        // docstring), which sits at the row's far-right edge - so
        // grabOffsetX ends up close to the ENTIRE row's width. Since the
        // ghost's left is pointerX minus this offset, a natural thumb
        // drag curving even slightly left (normal ergonomics when your
        // hand is anchored near a screen edge) gets amplified into the
        // ghost - and anything anchored to it, like the "label" style's
        // pill - jumping far to the left, often off-screen entirely.
        // Capping the offset for touch keeps the ghost tracking close
        // to the thumb regardless of where on the row the handle sits;
        // mouse keeps the exact grabbed point, since a cursor has no
        // equivalent edge-anchoring problem.
        const cappedGrabOffsetX = pointerType !== "mouse"
            ? Math.min(grabOffsetX ?? 0, TOUCH_DRAG_MAX_GRAB_OFFSET_X_PX)
            : (grabOffsetX ?? 0);

        this.dragGhostOffset = {x: cappedGrabOffsetX, y: grabOffsetY ?? 0};
        this.dragGhostSize = rect ? {width: rect.width, height: rect.height} : undefined;
        this.ghostPosition = {x: pointerX, y: pointerY};
        this.dragStartPointerPos = {x: pointerX, y: pointerY};

        // Captured twice: immediately (approximate - the dragged row's own
        // collapse to its lifted placeholder hasn't rendered yet, since
        // that's queued as a Lit update) and again next frame, once that
        // collapse has actually painted and every other row has settled
        // into its final resting position. Snapshotting only once, before
        // the collapse, would leave every row below the drag origin
        // measured taller than they end up - close enough to work, but the
        // immediate capture exists only so there's never a moment with no
        // snapshot at all (e.g. a release within the same frame it started).
        this.snapshotRows();
        requestAnimationFrame(() => this.snapshotRows());

        // Capture phase: HA's own frontend has various touch/gesture
        // handling that can call stopPropagation() on the way back up,
        // which would otherwise silently swallow these before a
        // bubble-phase window listener ever saw them.
        window.addEventListener("pointermove", this.onGlobalPointerMove, {capture: true});
        window.addEventListener("pointerup", this.onGlobalPointerUp, {capture: true});
        // Touch gestures often end with pointercancel rather than
        // pointerup - both need to finalize the drag the same way, or
        // it gets stuck with dangling listeners. Removed explicitly in
        // onGlobalPointerUp (rather than {once: true} on just one of
        // them) so exactly one clean-up always happens regardless of
        // which event actually fired.
        window.addEventListener("pointercancel", this.onGlobalPointerUp, {capture: true});
    }

    // Lets every OTHER todo-overlay-list on the page (any other section
    // of a multi-entity card, or a separate card entirely) know this
    // instance's current drag/hover state - see foreignDragActive's own
    // doc comment for why that's needed at all.
    private broadcastDragHover() {
        window.dispatchEvent(new CustomEvent("todo-overlay-drag-hover", {
            detail: {
                draggedId: this.draggedId,
                hoverEntityId: this.hoverEntityId,
                hoverId: this.hoverId,
            },
        }));
    }

    private onGlobalPointerMove = (e: PointerEvent) => {
        // Touch only: this handler only ever runs while a drag is already
        // engaged (registered in onDragStart, removed in
        // onGlobalPointerUp) - without this, the page can still scroll out
        // from under an in-progress drag on a real touchscreen the moment
        // the finger drifts far enough for the browser's own gesture
        // recognizer to reassert itself mid-gesture. See
        // todo-tree-item.ts's .row.holding comment for the matching
        // engagement-moment call this reinforces.
        if (e.pointerType !== "mouse") {
            e.preventDefault();
        }

        // Reorder-mode drags (touch's only path to a drag at all - see
        // the class docstring) are frozen to purely vertical ghost
        // movement - findDropTarget below only ever reads e.clientY, so
        // horizontal pointer position has zero effect on WHERE anything
        // drops. Live-reported: because touch can only start a drag
        // from the handle at the row's far-right edge, a natural thumb
        // drag curving even slightly left dragged the ghost along with
        // it, which read as the ghost (and the target row/label under
        // it) drifting or vanishing. A mouse drag (never reorder-mode -
        // it holds anywhere on the row instead) keeps full 2D tracking,
        // since it has no equivalent edge-anchoring problem to guard
        // against.
        this.ghostPosition = {
            x: this.reorderModeActive ? this.dragStartPointerPos.x : e.clientX,
            y: e.clientY,
        };

        // See HOVER_DEAD_ZONE_PX's own comment - skip hit-testing
        // entirely until the pointer has actually moved, rather than
        // resolving a drop target against the just-reflowed layout at
        // essentially the pickup point.
        const distanceFromStart = Math.hypot(
            e.clientX - this.dragStartPointerPos.x,
            e.clientY - this.dragStartPointerPos.y,
        );

        if (distanceFromStart < HOVER_DEAD_ZONE_PX) {
            return;
        }

        // The previous frame's own resolved target - fed into resolvePlacement
        // as the hysteresis anchor (see ZONE_HYSTERESIS), so a still-jittery
        // finger sitting right on a zone boundary doesn't flip the target
        // back and forth every pointermove, AND into applyGapCorrection,
        // which knows from this alone exactly which row's own gap (if any)
        // the frozen snapshot below needs correcting for.
        const sticky = this.hoverId !== undefined && this.hoverPlacement !== undefined
            ? {id: this.hoverId, placement: this.hoverPlacement}
            : undefined;

        const hit = findDropTarget(
            e.clientY,
            applyGapCorrection(this.rowSnapshot, sticky),
            sticky,
            this.hoverNearestRowId,
        );
        const valid = hit && hit.id !== this.draggedId;

        const previousHoverId = this.hoverId;
        const previousHoverPlacement = this.hoverPlacement;

        this.hoverNearestRowId = hit?.nearestRowId;

        this.hoverId = valid ? hit.id : undefined;
        this.hoverPlacement = valid ? hit.placement : undefined;
        this.hoverDepth = valid ? hit.depth : 0;
        // hit.id being undefined (the empty-list placeholder) is itself a
        // VALID target, so entity has to be tracked independently of
        // hoverId - hoverId alone can no longer answer "is anything being
        // hovered", only hoverEntityId can (see onGlobalPointerUp).
        this.hoverEntityId = valid ? hit.entityId : undefined;

        const targetChanged = this.hoverId !== previousHoverId || this.hoverPlacement !== previousHoverPlacement;

        // A light haptic tick whenever the actual target changes - mobile
        // physical confirmation that doesn't depend on catching a visual
        // highlight mid-gesture (see the collapsed-parent fix earlier in
        // this file for exactly how easy that visual catch is to miss).
        // Silently does nothing wherever unsupported (desktop, iOS
        // Safari) - navigator.vibrate simply isn't defined there.
        if (e.pointerType !== "mouse" && targetChanged) {
            navigator.vibrate?.(10);
        }

        this.broadcastDragHover();
    };

    private onGlobalPointerUp = async () => {
        window.removeEventListener("pointermove", this.onGlobalPointerMove, {capture: true});
        window.removeEventListener("pointerup", this.onGlobalPointerUp, {capture: true});
        window.removeEventListener("pointercancel", this.onGlobalPointerUp, {capture: true});

        const draggedId = this.draggedId;
        const hoverId = this.hoverId;
        const hoverPlacement = this.hoverPlacement;
        const hoverEntityId = this.hoverEntityId;

        this.ghostPosition = undefined;
        this.draggedId = undefined;
        this.hoverId = undefined;
        this.hoverPlacement = undefined;
        this.hoverDepth = 0;
        this.hoverEntityId = undefined;
        this.hoverNearestRowId = undefined;
        this.rowSnapshot = [];

        // Tell every other list the drag is over - otherwise an empty
        // list's placeholder that was highlighted mid-drag would stay
        // stuck highlighted forever (no further pointermove is coming to
        // naturally clear it).
        this.broadcastDragHover();

        // hoverEntityId (not hoverId) is the "is anything actually being
        // hovered" signal - hoverId undefined can validly mean "yes, the
        // empty-list placeholder for hoverEntityId", not just "nothing".
        if (draggedId && hoverEntityId) {
            try {
                if (hoverEntityId !== this.entity) {
                    // Dropped onto a row (or an empty list's own
                    // placeholder) belonging to a different entity -
                    // another section of a multi-entity card, or a
                    // separate card entirely - a physical move across two
                    // independent todo.* lists, not just a metadata
                    // reshuffle within one. hoverId is only undefined
                    // here when the target list has no items at all to
                    // position relative to; transferItem's own reference
                    // parameter accepts that directly.
                    await transferItem(
                        this.hass,
                        this.entity,
                        draggedId,
                        hoverEntityId,
                        hoverId,
                        hoverPlacement ?? "inside",
                    );
                } else if (hoverId && hoverId !== draggedId) {
                    // Same-entity reorder always has a real reference
                    // row - the dragged item already lives in this
                    // entity, so it can never be the empty-list case.
                    await moveItem(
                        this.hass,
                        this.entity,
                        draggedId,
                        hoverId,
                        hoverPlacement ?? "inside",
                    );
                } else {
                    return;
                }

                await this.load();
            } catch (err) {
                this.reportError("moving the item", err);
            }
        }
    };

    private async onPointerUp(e: CustomEvent) {
        // A real drag never reaches this handler at all (see
        // todo-tree-item.ts's pointerUp) - only a genuine tap, hold, or
        // an ambiguous "moved but never engaged a drag" release do.
        if (!e.detail.moved && this.draggedId && this.list) {
            const item = findItem(this.list.items, this.draggedId);

            if (item) {
                const pressDurationMs = e.detail.pressDurationMs as number;
                const checkboxHidden = this.hideCompleteForParents && item.children.length > 0;

                if (pressDurationMs < LONG_PRESS_MS) {
                    // A quick tap has nothing to complete when the row's
                    // own checkbox is hidden - completing such an item is
                    // only available via the edit dialog (see the hold
                    // branch below, and todo-item-dialog.ts's complete
                    // toggle) - so the tap toggles collapse instead, since
                    // that's the only thing left for it to usefully do on
                    // a row that's mostly there to show hierarchy.
                    if (checkboxHidden) {
                        this.toggleCollapseId(item.id);
                    } else {
                        await this.toggleComplete(item);
                    }
                } else {
                    this.openEditDialog(item);
                }
            }
        }

        this.draggedId = undefined;
    }

    connectedCallback() {
        super.connectedCallback();
        window.addEventListener("todo-overlay-drag-hover", this.onForeignDragHover as EventListener);
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        window.removeEventListener("pointermove", this.onGlobalPointerMove, {capture: true});
        window.removeEventListener("pointerup", this.onGlobalPointerUp, {capture: true});
        window.removeEventListener("pointercancel", this.onGlobalPointerUp, {capture: true});
        window.removeEventListener("todo-overlay-drag-hover", this.onForeignDragHover as EventListener);
        window.clearTimeout(this.undoTimer);
        window.clearTimeout(this.errorTimer);
        this.unsubItemChanged?.();
    }

    // --- collapse / filter -------------------------------------------------

    private toggleCollapseId(id: string) {
        const next = new Set(this.collapsedIds);

        if (next.has(id)) {
            next.delete(id);
        } else {
            next.add(id);
        }

        this.collapsedIds = next;
        saveCollapsedIds(this.entity, next);
    }

    private onToggleCollapse(e: CustomEvent<{id: string}>) {
        this.toggleCollapseId(e.detail.id);
    }

    private onFilterSelectChange(e: Event) {
        this.filterMode = (e.target as HTMLSelectElement).value as FilterMode;
    }

    private onToggleQuickAdd() {
        if (!this.showQuickAdd) {
            this.openCreateDialog();
            return;
        }

        if (this.addModeActive) {
            this.exitAddMode();
        } else {
            this.enterAddMode();
        }
    }

    // --- completion + cascade undo --------------------------------------

    private async toggleComplete(item: TodoItem) {
        try {
            const changes = await setCompleted(
                this.hass,
                this.entity,
                item.id,
                !item.completed,
                this.moveCompletedItems,
            );

            await this.load();

            if (changes.length > 1) {
                this.showUndo(
                    `Marked ${changes.length} items ${!item.completed ? "complete" : "incomplete"}`,
                    changes,
                );
            }
        } catch (err) {
            this.reportError("updating completion", err);
        }
    }

    private showUndo(message: string, changes: CompletionChange[]) {
        window.clearTimeout(this.undoTimer);

        this.undoState = {message, changes};

        this.undoTimer = window.setTimeout(() => {
            this.undoState = undefined;
        }, UNDO_TIMEOUT_MS);
    }

    private async onUndo() {
        if (!this.undoState) {
            return;
        }

        window.clearTimeout(this.undoTimer);

        try {
            await restoreCompleted(this.hass, this.entity, this.undoState.changes);
            await this.load();
        } catch (err) {
            this.reportError("undoing", err);
        }

        this.undoState = undefined;
    }

    private async onClearCompleted() {
        try {
            await clearCompleted(this.hass, this.entity);
            await this.load();
        } catch (err) {
            this.reportError("clearing completed items", err);
        }
    }

    // A plain tap's behavior depends on what's actually true right now:
    // - delete-mode already active -> exit it (the crosses it revealed
    //   are the one thing a tap can always turn back off).
    // - otherwise, any top-level item currently complete -> clear them,
    //   exactly like this button always used to (see onClearCompleted).
    // - otherwise (nothing to clear) -> there's nothing useful a plain
    //   clear-completed tap could DO, so it enters delete-mode instead,
    //   revealing per-row crosses (desktop only - see deleteModeActive's
    //   own comment) so individual items can still be removed by hand.
    private onClearButtonTap() {
        if (this.deleteModeActive) {
            this.deleteModeActive = false;
            return;
        }

        if (this.list?.items.some(item => item.completed)) {
            this.onClearCompleted();
        } else {
            this.enterDeleteMode();
        }
    }

    // HOLDING the clear-completed button (past LONG_PRESS_MS, same
    // threshold a row's own hold-to-edit uses) and then releasing offers
    // the much more destructive "delete literally everything" instead -
    // gated behind both the hold itself and the confirm dialog below,
    // since there's no undo for this one (see clear_all's own docstring
    // - same no-undo precedent as clear_completed already has).
    //
    // clearButtonPressedAt/clearButtonHoldTimer are deliberately plain
    // fields, not @state - mirrors todo-tree-item.ts's own row hold
    // gesture exactly (pointerDownAt/holdTimer there), including the
    // same "schedule a requestUpdate() for the moment the threshold is
    // crossed" trick, since holdReady below is a plain getter computed
    // from Date.now() rather than something Lit can track reactively on
    // its own.
    private clearButtonPressedAt = 0;
    private clearButtonHoldTimer?: number;

    private get clearButtonHoldReady(): boolean {
        return this.clearButtonPressedAt !== 0 && Date.now() - this.clearButtonPressedAt >= LONG_PRESS_MS;
    }

    private onClearButtonPointerDown = () => {
        this.clearButtonPressedAt = Date.now();
        // Immediate: shows the (not-yet-active) ripple right away - the
        // row's own equivalent gets this for free since its ripple
        // origin is @state; clearButtonPressedAt is a plain field (see
        // its own comment), so nothing re-renders without this.
        this.requestUpdate();

        window.clearTimeout(this.clearButtonHoldTimer);
        this.clearButtonHoldTimer = window.setTimeout(() => {
            this.requestUpdate();
        }, LONG_PRESS_MS);
    };

    private onClearButtonPointerUp = () => {
        if (this.clearButtonPressedAt === 0) {
            return;
        }

        const pressDurationMs = Date.now() - this.clearButtonPressedAt;
        this.clearButtonPressedAt = 0;
        window.clearTimeout(this.clearButtonHoldTimer);
        this.requestUpdate();

        if (pressDurationMs >= LONG_PRESS_MS) {
            this.confirmingClearAll = true;
        } else {
            this.onClearButtonTap();
        }
    };

    private onClearButtonPointerCancel = () => {
        this.clearButtonPressedAt = 0;
        window.clearTimeout(this.clearButtonHoldTimer);
        this.requestUpdate();
    };

    private closeClearAllConfirm = () => {
        this.confirmingClearAll = false;
    };

    private async onClearAllConfirmed() {
        this.confirmingClearAll = false;

        try {
            await clearAll(this.hass, this.entity);
            await this.load();
        } catch (err) {
            this.reportError("deleting all items", err);
        }
    }

    // --- save / load ---------------------------------------------------

    private async openSaveDialog() {
        try {
            this.savedNames = await listSaved(this.hass);
        } catch (err) {
            this.reportError("loading saved list names", err);
            return;
        }

        this.saveLoadValue = EMPTY_SAVE_LOAD_VALUE;
        this.saveLoadAction = "save";
    }

    private async openLoadDialog() {
        try {
            this.savedNames = await listSaved(this.hass);
        } catch (err) {
            this.reportError("loading saved list names", err);
            return;
        }

        this.saveLoadValue = EMPTY_SAVE_LOAD_VALUE;
        this.saveLoadAction = "load";
    }

    private closeSaveLoadDialog() {
        this.saveLoadAction = undefined;
    }

    private async onSaveLoadConfirm(e: CustomEvent<SaveLoadFormValue>) {
        const value = e.detail;

        try {
            if (this.saveLoadAction === "save") {
                await saveList(this.hass, this.entity, value.name, value.persistStates);
            } else {
                await loadList(this.hass, this.entity, value.name, value.mode, value.targetItem || undefined);
            }

            await this.load();
        } catch (err) {
            this.reportError(
                this.saveLoadAction === "save" ? "saving the list" : "loading the saved list",
                err,
            );
        }

        this.closeSaveLoadDialog();
    }

    private async onSaveLoadDeleteSaved(e: CustomEvent<{name: string}>) {
        try {
            await deleteSavedList(this.hass, e.detail.name);
            this.savedNames = await listSaved(this.hass);
            this.saveLoadValue = {...this.saveLoadValue, name: ""};
        } catch (err) {
            this.reportError("deleting the saved list", err);
        }
    }

    // --- add / edit / delete dialog --------------------------------------

    private openEditDialog(item: TodoItem) {
        this.dialogMode = "edit";
        this.dialogItem = item;
        this.dialogFormValue = this.toFormValue(item);
    }

    private openCreateDialog() {
        this.dialogMode = "create";
        this.dialogItem = undefined;
        this.dialogFormValue = EMPTY_FORM_VALUE;
    }

    private closeDialog() {
        this.dialogMode = undefined;
        this.dialogItem = undefined;
    }

    private async onDialogToggleComplete() {
        if (!this.dialogItem) {
            return;
        }

        // Reuses the exact same cascade+undo path a normal row's
        // checkbox tap goes through - this dialog toggle exists only
        // because that row has no checkbox to tap (see
        // hideCompleteForParents), not because it needs different
        // behavior once triggered.
        await this.toggleComplete(this.dialogItem);
        this.closeDialog();
    }

    // Seeded ONCE into dialogFormValue when the dialog opens (see
    // openEditDialog/openCreateDialog), never recomputed from here again
    // while it's open. Live-reproduced bug: this used to be called fresh
    // from render() on every parent re-render (an error banner timing
    // out, another item elsewhere in the same list changing, a linked
    // list's incoming sync notification - anything reactive), which
    // handed the child dialog a brand-new .value prop built from this
    // frozen dialogItem snapshot - silently overwriting whatever the
    // user had already typed into title/quantity/tags/description back
    // to the value the dialog opened with, before Save was ever pressed.
    private toFormValue(item: TodoItem): TodoItemFormValue {
        const due = item.due_datetime
            ? splitDueDateTime(item.due_datetime)
            : {date: item.due_date ?? "", time: ""};

        return {
            title: item.title,
            quantity: item.quantity ?? "",
            tags: item.tags.join(", "),
            description: item.description ?? "",
            dueDate: due.date,
            dueTime: due.time,
            triggerOnDue: item.trigger_on_due,
            pinType: item.pin_type ?? "",
            linked: item.linked,
            linkTarget: "",
        };
    }

    private async onDialogSave(e: CustomEvent<TodoItemFormValue>) {
        const value = e.detail;
        const support = this.fieldSupport;

        const description = support.description ? value.description : undefined;

        let dueDate: string | undefined;
        let dueDatetime: string | undefined;

        if (support.dueDateTime && value.dueDate && value.dueTime) {
            dueDatetime = `${value.dueDate}T${value.dueTime}:00`;
        } else if (support.dueDate && value.dueDate) {
            dueDate = value.dueDate;
        }

        const quantity = value.quantity.trim() || undefined;
        const tags = value.tags
            .split(",")
            .map(tag => tag.trim())
            .filter(tag => tag.length > 0);
        const pinType = value.pinType || undefined;

        try {
            if (this.dialogMode === "edit" && this.dialogItem) {
                // Must go through todo_overlay/update_item (TodoManager),
                // not the native todo.update_item service directly -
                // live-diagnosed bug: the native call never fired
                // EVENT_ITEM_CHANGED, so a title/description/due-date
                // edit here could never sync to a linked list or refresh
                // another open card, with no error anywhere.
                await updateItem(this.hass, this.entity, this.dialogItem.id, {
                    title: value.title,
                    description,
                    dueDate,
                    dueDatetime,
                });
                // This one has to finish first, not join the batch below -
                // setTriggerOnDue's own backend validation requires the
                // item's due_datetime to already be persisted (see
                // DueTimeRequiredError), which is exactly what the
                // updateItem call above just wrote. Racing them via
                // Promise.all risks setTriggerOnDue's websocket message
                // being processed before that write lands, wrongly
                // rejecting a due-time+trigger set in the very same edit.
                // The four calls below don't depend on each other or on
                // updateItem in that same way (each targets its own
                // metadata_store key), so batching them concurrently -
                // rather than the previous four separate sequential round
                // trips - is safe.
                await Promise.all([
                    setQuantity(this.hass, this.entity, this.dialogItem.id, quantity),
                    setTags(this.hass, this.entity, this.dialogItem.id, tags),
                    setTriggerOnDue(this.hass, this.entity, this.dialogItem.id, value.triggerOnDue),
                    setPinType(this.hass, this.entity, this.dialogItem.id, pinType),
                ]);

                // Deliberately AFTER the batch above, not inside it -
                // linking copies this item's CURRENT title/description/
                // due/quantity/tags/completed onto the new mirror (see
                // item_links.py's own link_item), so it has to run once
                // everything just edited in this same save has actually
                // landed, not race it.
                if (value.linked && !this.dialogItem.linked) {
                    await linkItem(this.hass, this.entity, this.dialogItem.id, value.linkTarget || undefined);
                } else if (!value.linked && this.dialogItem.linked) {
                    await unlinkItem(this.hass, this.entity, this.dialogItem.id);
                }
            } else {
                await createItem(this.hass, this.entity, {
                    title: value.title,
                    description,
                    dueDate,
                    dueDatetime,
                    quantity,
                    tags,
                    triggerOnDue: value.triggerOnDue,
                    pinType,
                });
            }

            await this.load();
        } catch (err) {
            this.reportError("saving the item", err);
        }

        this.closeDialog();
    }

    private async onDialogDelete() {
        if (!this.dialogItem) {
            return;
        }

        try {
            // Must go through todo_overlay/delete_item (TodoManager), not
            // the native todo.remove_item service directly - live-
            // diagnosed bug: the native call never fired
            // EVENT_ITEM_CHANGED, so a deletion here could never
            // propagate to a linked list at all, leaving a ghost item on
            // the other side forever, with no error anywhere.
            await deleteItem(this.hass, this.entity, this.dialogItem.id);

            await this.load();
        } catch (err) {
            this.reportError("deleting the item", err);
        }

        this.closeDialog();
    }

    // A row's own delete cross (see todo-tree-item.ts - leaf rows only,
    // already confirmed there before this ever fires) rather than the
    // edit dialog's Delete button - a separate, more direct path to the
    // same underlying delete.
    private async onDeleteItem(e: CustomEvent<{id: string}>) {
        try {
            await deleteItem(this.hass, this.entity, e.detail.id);

            await this.load();
        } catch (err) {
            this.reportError("deleting the item", err);
        }
    }

    // --- quick add ---------------------------------------------------

    private onQuickAddInput(e: InputEvent) {
        this.quickAddValue = (e.target as HTMLInputElement).value;
    }

    private onQuickAddKeydown(e: KeyboardEvent) {
        if (e.key === "Enter") {
            this.submitQuickAdd();
        }
    }

    private async submitQuickAdd() {
        const title = this.quickAddValue.trim();

        if (!title) {
            return;
        }

        try {
            // Must go through todo_overlay/create_item (TodoManager),
            // not the native todo.add_item service directly - live-
            // diagnosed bug: quick-add used to call add_item straight,
            // which silently never fires EVENT_ITEM_CHANGED (only
            // TodoManager.create_item does), so an item added via
            // quick-add could never sync to a linked list - no error,
            // no log, it just never reached any of that code at all.
            await createItem(this.hass, this.entity, {title});

            this.quickAddValue = "";

            await this.load();
        } catch (err) {
            this.reportError("adding the item", err);
        }
    }

    // Toggling a specific parent's own inline "add a child" field open/
    // closed (see todo-tree-item.ts's per-row plus icon) - independent
    // of the root quick-add and of every other parent's own field; see
    // childQuickAddParentIds' own comment for how the two relate.
    private onToggleChildQuickAdd(e: CustomEvent<{id: string}>) {
        const parentId = e.detail.id;
        const next = new Set(this.childQuickAddParentIds);

        if (next.has(parentId)) {
            next.delete(parentId);
        } else {
            next.add(parentId);

            // Opening it while the parent's own children are collapsed
            // would add the new item invisibly - opening the field is a
            // clear enough signal of intent to show where it'll land.
            if (this.collapsedIds.has(parentId)) {
                const nextCollapsed = new Set(this.collapsedIds);
                nextCollapsed.delete(parentId);
                this.collapsedIds = nextCollapsed;
                saveCollapsedIds(this.entity, nextCollapsed);
            }
        }

        this.childQuickAddParentIds = next;
    }

    private async onChildQuickAddSubmit(e: CustomEvent<{parentId: string; title: string}>) {
        const title = e.detail.title.trim();

        if (!title || !this.list) {
            return;
        }

        const parent = findItem(this.list.items, e.detail.parentId);

        if (!parent) {
            return;
        }

        // Directly below the parent's own row, above its EXISTING
        // children - "inside" alone would append PAST them instead
        // (same reason resolvePlacement never offers plain "inside" for
        // a row that already has visible children during drag-and-drop
        // hit-testing - see this file's own resolvePlacement).
        const referenceId = parent.children.length > 0 ? parent.children[0].id : e.detail.parentId;
        const placement: Placement = parent.children.length > 0 ? "before" : "inside";

        try {
            await createItem(this.hass, this.entity, {title, referenceId, placement});
            await this.load();
        } catch (err) {
            this.reportError("adding the item", err);
        }
    }

    private renderTree(list: TodoList) {
        const filtered = filterTree(list.items, this.filterMode);
        const items = sortTree(filtered, this.sortBy, this.sortOrder);

        // Splitting into separate Active/Completed sections is itself a
        // form of "moving" a completed item away from wherever it sits
        // among its siblings - gated on the same option as the backend's
        // own reposition-on-complete and completed-last sort (see
        // moveCompletedItems's own doc comment), so turning that off
        // really does mean nothing about an item's position changes
        // anywhere, frontend included.
        if (!this.moveCompletedItems) {
            return html`
                <todo-overlay-tree
                    .items=${items}
                    .draggedId=${this.draggedId}
                    .hoverId=${this.hoverId}
                    .hoverPlacement=${this.hoverPlacement}
                    .hoverDepth=${this.hoverDepth}
                    .emptyDropHighlight=${this.isEmptyDropTarget}
                    .hideCompleteForParents=${this.hideCompleteForParents}
                    .showCheckboxes=${this.showCheckboxes}
                    .confirmDelete=${this.confirmDelete}
                    .dragDisabled=${this.dragDisabled}
                    .collapsedIds=${this.collapsedIds}
                    .childQuickAddParentIds=${this.childQuickAddParentIds}
                    .addModeActive=${this.addModeActive}
                    .deleteModeActive=${this.deleteModeActive}
                    .reorderModeActive=${this.reorderModeActive}

                    @tree-pointer-down=${this.onPointerDown}
                    @tree-drag-start=${this.onDragStart}
                    @tree-pointer-up=${this.onPointerUp}
                    @tree-toggle-collapse=${this.onToggleCollapse}
                    @tree-delete-item=${this.onDeleteItem}
                    @tree-toggle-child-quick-add=${this.onToggleChildQuickAdd}
                    @tree-quick-add-child=${this.onChildQuickAddSubmit}

                ></todo-overlay-tree>
            `;
        }

        const completedItems = items.filter(item => item.completed);

        if (completedItems.length === 0) {
            return html`
                <todo-overlay-tree
                    .items=${items}
                    .draggedId=${this.draggedId}
                    .hoverId=${this.hoverId}
                    .hoverPlacement=${this.hoverPlacement}
                    .hoverDepth=${this.hoverDepth}
                    .emptyDropHighlight=${this.isEmptyDropTarget}
                    .hideCompleteForParents=${this.hideCompleteForParents}
                    .showCheckboxes=${this.showCheckboxes}
                    .confirmDelete=${this.confirmDelete}
                    .dragDisabled=${this.dragDisabled}
                    .collapsedIds=${this.collapsedIds}
                    .childQuickAddParentIds=${this.childQuickAddParentIds}
                    .addModeActive=${this.addModeActive}
                    .deleteModeActive=${this.deleteModeActive}
                    .reorderModeActive=${this.reorderModeActive}

                    @tree-pointer-down=${this.onPointerDown}
                    @tree-drag-start=${this.onDragStart}
                    @tree-pointer-up=${this.onPointerUp}
                    @tree-toggle-collapse=${this.onToggleCollapse}
                    @tree-delete-item=${this.onDeleteItem}
                    @tree-toggle-child-quick-add=${this.onToggleChildQuickAdd}
                    @tree-quick-add-child=${this.onChildQuickAddSubmit}

                ></todo-overlay-tree>
            `;
        }

        const activeItems = items.filter(item => !item.completed);

        return html`
            ${
                activeItems.length
                    ? html`
                        <div class="section-header">Active</div>
                        <todo-overlay-tree
                            .items=${activeItems}
                            .draggedId=${this.draggedId}
                            .hoverId=${this.hoverId}
                            .hoverPlacement=${this.hoverPlacement}
                            .hoverDepth=${this.hoverDepth}
                            .hideCompleteForParents=${this.hideCompleteForParents}
                            .showCheckboxes=${this.showCheckboxes}
                            .confirmDelete=${this.confirmDelete}
                            .dragDisabled=${this.dragDisabled}
                            .collapsedIds=${this.collapsedIds}
                            .childQuickAddParentIds=${this.childQuickAddParentIds}
                            .addModeActive=${this.addModeActive}
                            .deleteModeActive=${this.deleteModeActive}
                    .reorderModeActive=${this.reorderModeActive}

                            @tree-pointer-down=${this.onPointerDown}
                            @tree-drag-start=${this.onDragStart}
                            @tree-pointer-up=${this.onPointerUp}
                            @tree-toggle-collapse=${this.onToggleCollapse}
                            @tree-delete-item=${this.onDeleteItem}
                            @tree-toggle-child-quick-add=${this.onToggleChildQuickAdd}
                            @tree-quick-add-child=${this.onChildQuickAddSubmit}

                        ></todo-overlay-tree>
                    `
                    : ""
            }

            <div class="section-header">Completed</div>
            <todo-overlay-tree
                .items=${completedItems}
                .draggedId=${this.draggedId}
                .hoverId=${this.hoverId}
                .hoverPlacement=${this.hoverPlacement}
                .hoverDepth=${this.hoverDepth}
                .hideCompleteForParents=${this.hideCompleteForParents}
                .showCheckboxes=${this.showCheckboxes}
                .confirmDelete=${this.confirmDelete}
                .dragDisabled=${this.dragDisabled}
                .collapsedIds=${this.collapsedIds}
                .childQuickAddParentIds=${this.childQuickAddParentIds}
                .addModeActive=${this.addModeActive}
                .deleteModeActive=${this.deleteModeActive}
                .reorderModeActive=${this.reorderModeActive}

                @tree-pointer-down=${this.onPointerDown}
                @tree-drag-start=${this.onDragStart}
                @tree-pointer-up=${this.onPointerUp}
                @tree-toggle-collapse=${this.onToggleCollapse}
                @tree-delete-item=${this.onDeleteItem}
                @tree-toggle-child-quick-add=${this.onToggleChildQuickAdd}
                @tree-quick-add-child=${this.onChildQuickAddSubmit}

            ></todo-overlay-tree>
        `;
    }

    // Keeps a box positioned at (left, top) with the given size fully
    // on-screen - a backstop alongside onDragStart's own grab-offset
    // cap for touch, not a replacement for it: the cap addresses WHY
    // the ghost drifts far from the pointer in the first place (see its
    // own comment), this just guarantees nothing ever renders off-
    // screen regardless of cause.
    private clampToViewport(left: number, top: number, width: number, height: number): {left: number; top: number} {
        const maxLeft = Math.max(GHOST_VIEWPORT_MARGIN_PX, window.innerWidth - width - GHOST_VIEWPORT_MARGIN_PX);
        const maxTop = Math.max(GHOST_VIEWPORT_MARGIN_PX, window.innerHeight - height - GHOST_VIEWPORT_MARGIN_PX);

        return {
            left: Math.min(Math.max(left, GHOST_VIEWPORT_MARGIN_PX), maxLeft),
            top: Math.min(Math.max(top, GHOST_VIEWPORT_MARGIN_PX), maxTop),
        };
    }

    private renderDragGhost() {
        if (!this.ghostPosition || !this.draggedId || !this.list) {
            return "";
        }

        const item = findItem(this.list.items, this.draggedId);

        if (!item) {
            return "";
        }

        // The ghost's own top-left anchor is ALWAYS just the pointer
        // minus the original grab offset (itself capped for touch, see
        // onDragStart), regardless of dragGhostStyle - an earlier
        // attempt lifted this clear of the pointer entirely and was
        // live-reported as feeling visually disconnected from what was
        // actually being dragged. Every style below only ever changes
        // the ghost's own SIZE/opacity, or adds a separate satellite
        // element near it - never its position.
        const rawLeft = this.ghostPosition.x - this.dragGhostOffset.x;
        const rawTop = this.ghostPosition.y - this.dragGhostOffset.y;

        // Only while actually hovering a valid reparent ("inside")
        // target - that's the one case the ghost (sitting right at the
        // pointer, by design) can fully cover the very row being
        // judged. Before/after reordering already shows its own
        // always-visible shadow-box gap elsewhere in the list, so none
        // of this ever applies to it.
        const hoveringParent = this.hoverPlacement === "inside" && this.hoverId !== undefined;
        const targetItem = hoveringParent ? findItem(this.list.items, this.hoverId!) : undefined;
        const applyTreatment = hoveringParent && targetItem !== undefined && this.dragGhostStyle !== "none";
        const shrinking = applyTreatment && this.dragGhostStyle === "shrink";

        const ghostWidth = shrinking
            ? DRAG_GHOST_SHRINK_WIDTH_PX
            : (this.dragGhostSize?.width ?? DRAG_GHOST_FALLBACK_WIDTH_PX);
        const ghostHeight = this.dragGhostSize?.height ?? DRAG_GHOST_FALLBACK_HEIGHT_PX;
        const {left, top} = this.clampToViewport(rawLeft, rawTop, ghostWidth, ghostHeight);

        return html`
            <div
                class=${classMap({
                    "drag-ghost": true,
                    shrink: shrinking,
                    translucent: applyTreatment && this.dragGhostStyle === "translucent",
                })}
                style=${styleMap({
                    left: `${left}px`,
                    top: `${top}px`,
                    width: `${ghostWidth}px`,
                })}
            >
                <ha-checkbox .checked=${item.completed}></ha-checkbox>
                <span class="drag-ghost-title">${item.title}</span>
                ${
                    item.quantity
                        ? html`<span class="drag-ghost-quantity">${item.quantity}</span>`
                        : ""
                }
            </div>
            ${
                (() => {
                    if (!(applyTreatment && this.dragGhostStyle === "label")) {
                        return "";
                    }

                    const labelPos = this.clampToViewport(
                        left,
                        top + ghostHeight + DRAG_GHOST_LABEL_GAP_PX,
                        ghostWidth,
                        DRAG_GHOST_LABEL_FALLBACK_HEIGHT_PX,
                    );

                    return html`
                        <div
                            class="drag-ghost-label"
                            style=${styleMap({left: `${labelPos.left}px`, top: `${labelPos.top}px`})}
                        >
                            Add to: ${targetItem!.title}
                        </div>
                    `;
                })()
            }
        `;
    }

    render() {
        const hasToolbar =
            this.showQuickAdd
            || this.showFilterMenu
            || this.showSaveLoadButtons
            || this.showClearButton
            || this.showReorderToggle;
        const hasHeaderRow = !!this.headerTitle || hasToolbar;

        return html`
            ${
                hasHeaderRow
                    ? html`
                        <div class="list-header-row">
                            ${
                                this.headerTitle
                                    ? html`
                                        <div class="list-title-group">
                                            <span class="list-title">${this.headerTitle}</span>
                                            ${
                                                this.list?.link_id
                                                    ? html`
                                                        <span class="link-badge" title="Linked list">
                                                            ${LINK_ICON}
                                                        </span>
                                                    `
                                                    : ""
                                            }
                                        </div>
                                    `
                                    : ""
                            }
                            ${
                                hasToolbar
                                    ? html`
                                        <div class="toolbar">
                                            <button
                                                class=${classMap({
                                                    "toolbar-icon": true,
                                                    "quick-add-toggle": true,
                                                    expanded: this.addModeActive,
                                                })}
                                                aria-label="Add item"
                                                title="Add item"
                                                @click=${this.onToggleQuickAdd}
                                            >
                                                ${PLUS_ICON}
                                            </button>

                                            ${
                                                this.showFilterMenu
                                                    ? html`
                                                        <div
                                                            class=${classMap({
                                                                "toolbar-icon": true,
                                                                "filter-select-wrapper": true,
                                                                active: this.filterMode !== "all",
                                                            })}
                                                            title="Filter items"
                                                        >
                                                            ${FILTER_ICON}
                                                            ${
                                                                this.filterMode !== "all"
                                                                    ? html`<span class="badge-dot"></span>`
                                                                    : ""
                                                            }
                                                            <select
                                                                class="filter-select"
                                                                aria-label="Filter"
                                                                .value=${this.filterMode}
                                                                @change=${this.onFilterSelectChange}
                                                            >
                                                                ${FILTER_MODES.map(mode => html`
                                                                    <option value=${mode}>${FILTER_LABELS[mode]}</option>
                                                                `)}
                                                            </select>
                                                        </div>
                                                    `
                                                    : ""
                                            }

                                            ${
                                                this.showSaveLoadButtons
                                                    ? html`
                                                        <button
                                                            class="toolbar-icon"
                                                            aria-label="Save list"
                                                            title="Save list"
                                                            @click=${this.openSaveDialog}
                                                        >
                                                            ${SAVE_ICON}
                                                        </button>
                                                        <button
                                                            class="toolbar-icon"
                                                            aria-label="Load list"
                                                            title="Load list"
                                                            @click=${this.openLoadDialog}
                                                        >
                                                            ${LOAD_ICON}
                                                        </button>
                                                    `
                                                    : ""
                                            }

                                            ${
                                                this.showClearButton
                                                    ? html`
                                                        <button
                                                            class=${classMap({
                                                                "toolbar-icon": true,
                                                                active: this.deleteModeActive,
                                                            })}
                                                            aria-label=${this.deleteModeActive ? "Done deleting" : "Clear completed"}
                                                            title="Tap: clear completed (or delete items). Hold: delete all."
                                                            @pointerdown=${this.onClearButtonPointerDown}
                                                            @pointerup=${this.onClearButtonPointerUp}
                                                            @pointercancel=${this.onClearButtonPointerCancel}
                                                        >
                                                            ${
                                                                this.clearButtonPressedAt !== 0
                                                                    ? html`
                                                                        <div
                                                                            class=${classMap({
                                                                                "hold-ripple": true,
                                                                                active: this.clearButtonHoldReady,
                                                                            })}
                                                                        ></div>
                                                                    `
                                                                    : ""
                                                            }
                                                            ${CLEAR_COMPLETED_ICON}
                                                        </button>
                                                    `
                                                    : ""
                                            }

                                            ${
                                                this.showReorderToggle
                                                    ? html`
                                                        <button
                                                            class=${classMap({
                                                                "toolbar-icon": true,
                                                                "reorder-toggle": true,
                                                                active: this.reorderModeActive,
                                                            })}
                                                            aria-label=${
                                                                this.reorderModeActive
                                                                    ? "Done reordering"
                                                                    : "Reorder items"
                                                            }
                                                            title=${
                                                                this.reorderModeActive
                                                                    ? "Done reordering"
                                                                    : "Reorder items"
                                                            }
                                                            @click=${this.onToggleReorderMode}
                                                        >
                                                            ${REORDER_TOGGLE_ICON}
                                                        </button>
                                                    `
                                                    : ""
                                            }
                                        </div>
                                    `
                                    : ""
                            }
                        </div>
                    `
                    : ""
            }

            ${
                this.addModeActive
                    ? html`
                        <div class="quick-add-panel">
                            <div class="quick-add-row">
                                <input
                                    type="text"
                                    placeholder="Add item"
                                    .value=${this.quickAddValue}
                                    @input=${this.onQuickAddInput}
                                    @keydown=${this.onQuickAddKeydown}
                                />
                                <button @click=${this.submitQuickAdd}>
                                    Add
                                </button>
                            </div>
                            <button class="quick-add-details" @click=${this.openCreateDialog}>
                                Details…
                            </button>
                        </div>
                    `
                    : ""
            }

            ${
                this.list
                    ? html`
                        ${
                            this.error
                                ? html`
                                    <div class="error-banner">
                                        <span>${this.error}</span>
                                        <button aria-label="Dismiss" @click=${this.dismissError}>
                                            ${CLOSE_ICON}
                                        </button>
                                    </div>
                                `
                                : ""
                        }
                        ${this.renderTree(this.list)}
                    `
                    : this.error
                        ? html`
                            <div style="padding:16px; color: var(--error-color)">
                                ${this.error}
                            </div>
                        `
                        : html`
                            <div style="padding:16px">
                                Loading...
                            </div>
                        `
            }

            ${
                this.undoState
                    ? html`
                        <div class="undo-snackbar">
                            <span>${this.undoState.message}</span>
                            <button @click=${this.onUndo}>
                                Undo
                            </button>
                        </div>
                    `
                    : ""
            }

            ${
                this.dialogMode
                    ? html`
                        <todo-overlay-item-dialog
                            .heading=${this.dialogMode === "edit" ? "Edit item" : "Add item"}
                            .value=${this.dialogFormValue}
                            .fieldSupport=${this.fieldSupport}
                            ?showDelete=${this.dialogMode === "edit"}
                            ?confirmDelete=${this.confirmDelete}
                            ?showCompleteToggle=${
                                this.dialogMode === "edit" &&
                                this.hideCompleteForParents &&
                                (this.dialogItem?.children.length ?? 0) > 0
                            }
                            ?completed=${this.dialogItem?.completed ?? false}

                            @dialog-close=${this.closeDialog}
                            @dialog-save=${this.onDialogSave}
                            @dialog-delete=${this.onDialogDelete}
                            @dialog-toggle-complete=${this.onDialogToggleComplete}
                        ></todo-overlay-item-dialog>
                    `
                    : ""
            }

            ${
                this.saveLoadAction
                    ? html`
                        <todo-overlay-save-load-dialog
                            .action=${this.saveLoadAction}
                            .value=${this.saveLoadValue}
                            .savedNames=${this.savedNames}
                            .items=${this.list?.items ?? []}

                            @dialog-close=${this.closeSaveLoadDialog}
                            @dialog-confirm=${this.onSaveLoadConfirm}
                            @dialog-delete-saved=${this.onSaveLoadDeleteSaved}
                        ></todo-overlay-save-load-dialog>
                    `
                    : ""
            }

            ${
                this.confirmingClearAll
                    ? html`
                        <todo-overlay-confirm-dialog
                            .heading=${"Delete all items?"}
                            .message=${"This permanently deletes every item in this list - active and completed, parents and children. This can't be undone."}
                            .confirmLabel=${"Delete all"}

                            @dialog-close=${this.closeClearAllConfirm}
                            @dialog-confirm=${this.onClearAllConfirmed}
                        ></todo-overlay-confirm-dialog>
                    `
                    : ""
            }

            ${this.renderDragGhost()}
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        "todo-overlay-list": TodoOverlayList;
    }
}
