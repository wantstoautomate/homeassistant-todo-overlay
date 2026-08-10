import {LitElement, html, css} from "lit";
import {customElement, property, state} from "lit/decorators.js";
import {classMap} from "lit/directives/class-map.js";
import {styleMap} from "lit/directives/style-map.js";

import {
    type CompletionChange,
    clearCompleted,
    createItem,
    deleteItem,
    deleteSavedList,
    getList,
    listSaved,
    loadList,
    moveItem,
    restoreCompleted,
    saveList,
    setCompleted,
    setQuantity,
    setTags,
    setTriggerOnDue,
    transferItem,
    updateItem,
} from "../api";
import {loadCollapsedIds, saveCollapsedIds} from "../collapse-storage";
import type {FilterMode} from "../filter";
import {filterTree} from "../filter";
import type {HassLike} from "../hass";
import {
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
import {BEFORE_AFTER_ZONE} from "./todo-tree-item";

import "./todo-tree";
import "./todo-item-dialog";
import "./todo-save-load-dialog";

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
type RowSnapshot = {id: string | undefined; entityId: string; children: TodoItem[]; rect: DOMRect};

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
function collectAllRows(root: ParentNode, currentEntity?: string): RowSnapshot[] {
    const rows: RowSnapshot[] = [];

    for (const el of Array.from(root.querySelectorAll("*"))) {
        const itemEl = el as TreeItemElement;

        if (el.localName === "todo-overlay-tree-item" && itemEl.item && currentEntity) {
            const rowEl = itemEl.shadowRoot?.querySelector(".row");

            if (rowEl) {
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
                    id: itemEl.item.id,
                    entityId: currentEntity,
                    children: hasVisibleChildren ? itemEl.item.children : [],
                    rect: rowEl.getBoundingClientRect(),
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
                });
            }
        }

        if (el.shadowRoot) {
            const nextEntity = el.localName === "todo-overlay-list"
                ? (el as TodoListElement).entity
                : currentEntity;

            rows.push(...collectAllRows(el.shadowRoot, nextEntity));
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
function resolvePlacement(
    rowId: string,
    rowChildren: TodoItem[],
    relativeY: number,
): {id: string; placement: Placement} {
    if (rowChildren.length > 0) {
        if (relativeY < BEFORE_AFTER_ZONE) {
            return {id: rowId, placement: "before"};
        }

        return {id: rowChildren[0].id, placement: "before"};
    }

    if (relativeY < BEFORE_AFTER_ZONE) {
        return {id: rowId, placement: "before"};
    }

    if (relativeY > 1 - BEFORE_AFTER_ZONE) {
        return {id: rowId, placement: "after"};
    }

    return {id: rowId, placement: "inside"};
}

// Hit-testing against LIVE row positions creates a feedback loop: hovering
// near a boundary opens a "gap" (a margin shift) on the rows next to it,
// which moves those rows' rects, which can put a now-stationary pointer over
// a *different* row's new zone, which opens a different gap, moving things
// again - the drop target oscillates even while the pointer holds still.
// Snapshotting every row's rect once when the drag engages, and hit-testing
// against that frozen snapshot for the rest of the gesture, breaks the loop:
// the coordinates being tested against never move in response to their own
// output. Distance-to-nearest-row (rather than requiring the pointer land
// inside a row's rect) also naturally covers dragging above the first item
// or below the last, where a direct hit would otherwise find nothing.
function findDropTarget(
    y: number,
    rows: RowSnapshot[],
): {id: string | undefined; entityId: string; placement: Placement} | undefined {
    if (rows.length === 0) {
        return undefined;
    }

    let nearest = rows[0];
    let nearestDistance = Infinity;

    for (const row of rows) {
        const distance = y < row.rect.top
            ? row.rect.top - y
            : y > row.rect.bottom
                ? y - row.rect.bottom
                : 0;

        if (distance < nearestDistance) {
            nearest = row;
            nearestDistance = distance;
        }
    }

    // The empty-list placeholder - nothing to be before/after/inside OF,
    // so the only meaningful placement is "become this entity's first
    // (and only) root item" (see onGlobalPointerUp's transferItem call,
    // which sends no reference_id at all for this case).
    if (nearest.id === undefined) {
        return {id: undefined, entityId: nearest.entityId, placement: "inside"};
    }

    const relativeY = (y - nearest.rect.top) / nearest.rect.height;

    // resolvePlacement may pick a different id (nearest's own, or its
    // first child's) depending on placement, but never a different
    // entity - a row's children always live on the same entity it does.
    return {...resolvePlacement(nearest.id, nearest.children, relativeY), entityId: nearest.entityId};
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

    @state()
    private list?: TodoList;

    @state()
    private collapsedIds: Set<string> = new Set();

    @state()
    private filterMode: FilterMode = "all";

    @state()
    private quickAddExpanded = false;

    // Touch-only reorder mode - see TodoOverlayCardConfig's
    // show_reorder_toggle comment for why this exists as a separate
    // mode at all rather than just letting touch hold-and-drag like a
    // mouse does.
    @state()
    private reorderModeActive = false;

    private onToggleReorderMode = () => {
        this.reorderModeActive = !this.reorderModeActive;
    };

    @state()
    private error?: string;

    @state()
    private draggedId?: string;

    @state()
    private hoverId?: string;

    @state()
    private hoverPlacement?: Placement;

    // Which entity hoverId's row belongs to - may differ from this.entity
    // when hovering over a row from another entity's section (same
    // multi-entity card, or an entirely different card) - see
    // onGlobalPointerUp for how that's handled.
    private hoverEntityId?: string;

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

        this.rowSnapshot = collectAllRows(document).filter(row => row.id === undefined || !excluded.has(row.id));
    }

    private onDragStart(e: CustomEvent) {
        const {rect, pointerX, pointerY, grabOffsetX, grabOffsetY} = e.detail;

        // grabOffsetX/Y come from the original press position, not this
        // event's - see the dispatch site in todo-tree-item.ts for why
        // that distinction matters for fast drags.
        this.dragGhostOffset = {x: grabOffsetX ?? 0, y: grabOffsetY ?? 0};
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

        this.ghostPosition = {x: e.clientX, y: e.clientY};

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

        const hit = findDropTarget(e.clientY, this.rowSnapshot);
        const valid = hit && hit.id !== this.draggedId;

        this.hoverId = valid ? hit.id : undefined;
        this.hoverPlacement = valid ? hit.placement : undefined;
        // hit.id being undefined (the empty-list placeholder) is itself a
        // VALID target, so entity has to be tracked independently of
        // hoverId - hoverId alone can no longer answer "is anything being
        // hovered", only hoverEntityId can (see onGlobalPointerUp).
        this.hoverEntityId = valid ? hit.entityId : undefined;

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
        this.hoverEntityId = undefined;
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
        if (this.showQuickAdd) {
            this.quickAddExpanded = !this.quickAddExpanded;
        } else {
            this.openCreateDialog();
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
                await loadList(this.hass, this.entity, value.name, value.mode);
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
                await setQuantity(this.hass, this.entity, this.dialogItem.id, quantity);
                await setTags(this.hass, this.entity, this.dialogItem.id, tags);
                await setTriggerOnDue(this.hass, this.entity, this.dialogItem.id, value.triggerOnDue);
            } else {
                await createItem(this.hass, this.entity, {
                    title: value.title,
                    description,
                    dueDate,
                    dueDatetime,
                    quantity,
                    tags,
                    triggerOnDue: value.triggerOnDue,
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
                    .emptyDropHighlight=${this.isEmptyDropTarget}
                    .hideCompleteForParents=${this.hideCompleteForParents}
                    .showCheckboxes=${this.showCheckboxes}
                    .confirmDelete=${this.confirmDelete}
                    .dragDisabled=${this.dragDisabled}
                    .collapsedIds=${this.collapsedIds}
                    .reorderModeActive=${this.reorderModeActive}

                    @tree-pointer-down=${this.onPointerDown}
                    @tree-drag-start=${this.onDragStart}
                    @tree-pointer-up=${this.onPointerUp}
                    @tree-toggle-collapse=${this.onToggleCollapse}
                    @tree-delete-item=${this.onDeleteItem}

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
                    .emptyDropHighlight=${this.isEmptyDropTarget}
                    .hideCompleteForParents=${this.hideCompleteForParents}
                    .showCheckboxes=${this.showCheckboxes}
                    .confirmDelete=${this.confirmDelete}
                    .dragDisabled=${this.dragDisabled}
                    .collapsedIds=${this.collapsedIds}
                    .reorderModeActive=${this.reorderModeActive}

                    @tree-pointer-down=${this.onPointerDown}
                    @tree-drag-start=${this.onDragStart}
                    @tree-pointer-up=${this.onPointerUp}
                    @tree-toggle-collapse=${this.onToggleCollapse}
                    @tree-delete-item=${this.onDeleteItem}

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
                            .hideCompleteForParents=${this.hideCompleteForParents}
                            .showCheckboxes=${this.showCheckboxes}
                            .confirmDelete=${this.confirmDelete}
                            .dragDisabled=${this.dragDisabled}
                            .collapsedIds=${this.collapsedIds}
                    .reorderModeActive=${this.reorderModeActive}

                            @tree-pointer-down=${this.onPointerDown}
                            @tree-drag-start=${this.onDragStart}
                            @tree-pointer-up=${this.onPointerUp}
                            @tree-toggle-collapse=${this.onToggleCollapse}
                            @tree-delete-item=${this.onDeleteItem}

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
                .hideCompleteForParents=${this.hideCompleteForParents}
                .showCheckboxes=${this.showCheckboxes}
                .confirmDelete=${this.confirmDelete}
                .dragDisabled=${this.dragDisabled}
                .collapsedIds=${this.collapsedIds}
                .reorderModeActive=${this.reorderModeActive}

                @tree-pointer-down=${this.onPointerDown}
                @tree-drag-start=${this.onDragStart}
                @tree-pointer-up=${this.onPointerUp}
                @tree-toggle-collapse=${this.onToggleCollapse}
                @tree-delete-item=${this.onDeleteItem}

            ></todo-overlay-tree>
        `;
    }

    private renderDragGhost() {
        if (!this.ghostPosition || !this.draggedId || !this.list) {
            return "";
        }

        const item = findItem(this.list.items, this.draggedId);

        if (!item) {
            return "";
        }

        const left = this.ghostPosition.x - this.dragGhostOffset.x;
        const top = this.ghostPosition.y - this.dragGhostOffset.y;

        return html`
            <div
                class="drag-ghost"
                style=${styleMap({
                    left: `${left}px`,
                    top: `${top}px`,
                    width: this.dragGhostSize ? `${this.dragGhostSize.width}px` : undefined,
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
                                                    expanded: this.quickAddExpanded,
                                                })}
                                                aria-label="Add item"
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
                                                            @click=${this.openSaveDialog}
                                                        >
                                                            ${SAVE_ICON}
                                                        </button>
                                                        <button
                                                            class="toolbar-icon"
                                                            aria-label="Load list"
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
                                                            class="toolbar-icon"
                                                            aria-label="Clear completed"
                                                            @click=${this.onClearCompleted}
                                                        >
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
                this.quickAddExpanded
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

                            @dialog-close=${this.closeSaveLoadDialog}
                            @dialog-confirm=${this.onSaveLoadConfirm}
                            @dialog-delete-saved=${this.onSaveLoadDeleteSaved}
                        ></todo-overlay-save-load-dialog>
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
