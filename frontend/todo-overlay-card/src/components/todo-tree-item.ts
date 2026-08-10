import {LitElement, html, css, nothing, unsafeCSS} from "lit";
import {customElement, property, state} from "lit/decorators.js";
import {classMap} from "lit/directives/class-map.js";
import {styleMap} from "lit/directives/style-map.js";

import {LONG_PRESS_MS, type Placement, type TodoItem, isOverdue} from "../models";

// How far into a row's top/bottom the pointer needs to be to count as
// "before"/"after" rather than "inside" (reparent). Exported so the
// card's own hit-testing (which replaced per-row hover dispatch - see
// the module docstring below) computes placement the same way.
export const BEFORE_AFTER_ZONE = 0.3;

// One nesting level's worth of visual indent (matches the ul rule
// below). Exported so the drop-shadow-box preview's own indent (see
// render()) lines up with real row indentation instead of an
// independently-guessed pixel value that could drift out of sync
// with it.
export const ROW_INDENT_PX = 20;
const rowIndentPx = unsafeCSS(`${ROW_INDENT_PX}px`);

// Pointer movement beyond this many pixels, while still under the hold
// threshold, cancels the hold-to-edit gesture - a small allowance for
// natural hand/touch jitter rather than a strict zero-tolerance check.
// For a mouse, movement past this threshold also engages a live drag
// (see onWindowPointerMove) without waiting out the hold at all - touch
// never engages a drag through this path (see the class docstring
// above), only the hold-to-edit cancellation still applies to it.
const MOVE_CANCEL_THRESHOLD_PX = 6;
const HOLD_RIPPLE_SIZE = 72;
const holdRippleSizePx = unsafeCSS(`${HOLD_RIPPLE_SIZE}px`);

// A plain tap is delayed this long before it commits to toggling
// completion, so a following second click can still cancel it and open
// the edit dialog instead (see pointerUp's own double-click detection).
// Skipped entirely for drags and holds, which are unambiguous the
// moment they happen.
const CLICK_DEBOUNCE_MS = 250;

const CLOCK_ICON = html`
    <svg viewBox="0 0 24 24">
        <path
            d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm.5 5v5.4l4.2 2.5-.8 1.3-5-3V7h1.6z"
        ></path>
    </svg>
`;

// Points right when collapsed (children hidden), down when expanded -
// a single path, rotated via CSS rather than swapped, so the direction
// change can transition instead of popping.
const CHEVRON_ICON = html`
    <svg viewBox="0 0 24 24">
        <path d="M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z"></path>
    </svg>
`;

// Shown next to the due chip for an item with trigger_on_due enabled -
// the only visual sign an automation is armed against this item's due
// date, otherwise only visible by opening the edit dialog.
const BELL_ICON = html`
    <svg class="trigger-armed-icon" viewBox="0 0 24 24">
        <path
            d="M12,22C13.1,22 14,21.1 14,20H10C10,21.1 10.9,22 12,22M18,16V11C18,7.93 16.36,5.36 13.5,4.68V4C13.5,3.17 12.83,2.5 12,2.5C11.17,2.5 10.5,3.17 10.5,4V4.68C7.63,5.36 6,7.92 6,11V16L4,18V19H20V18L18,16Z"
        ></path>
    </svg>
`;

const CROSS_ICON = html`
    <svg viewBox="0 0 24 24">
        <path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"></path>
    </svg>
`;

// Only ever rendered while reorderModeActive - see .drag-handle's own
// comment for why this exists as a dedicated element rather than
// letting touch pick up a drag from anywhere on the row.
const DRAG_HANDLE_ICON = html`
    <svg viewBox="0 0 24 24">
        <path d="M9,3H11V5H9V3M13,3H15V5H13V3M9,7H11V9H9V7M13,7H15V9H13V7M9,11H11V13H9V11M13,11H15V13H13V11M9,15H11V17H9V15M13,15H15V17H13V15M9,19H11V21H9V19M13,19H15V21H13V19Z"></path>
    </svg>
`;

// A tap arms the delete button (turns it red, "Confirm delete"); a
// second tap within this window actually deletes. Not clicking again
// before it elapses quietly disarms it - the same "brief confirm window"
// idea as the item dialog's own confirm-delete step, just without a
// second button competing for the same tight row width.
const DELETE_CONFIRM_WINDOW_MS = 3000;

function formatDue(item: TodoItem): {label: string; overdue: boolean} | undefined {
    const raw = item.due_datetime ?? (item.due_date ? `${item.due_date}T00:00:00` : null);

    if (!raw) {
        return undefined;
    }

    const due = new Date(raw);
    const now = new Date();

    const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffDays = Math.round((dueDay.getTime() - today.getTime()) / 86_400_000);

    let label: string;

    if (diffDays === 0) {
        label = "Today";
    } else if (diffDays === 1) {
        label = "Tomorrow";
    } else if (diffDays === -1) {
        label = "Yesterday";
    } else {
        label = due.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: dueDay.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
        });
    }

    return {
        label,
        overdue: isOverdue(item),
    };
}

// Drag-and-drop model: for a mouse, a hold (matching the existing
// hold-to-edit threshold) followed by movement picks an item up - the
// card then takes over entirely via its own window-level pointermove/
// pointerup listeners and a floating "ghost" that follows the pointer,
// since per-row hover listeners don't work on touch (a touch pointer is
// implicitly captured to whichever element it started on, so
// pointerenter/pointermove never fire on OTHER rows during a real
// touch drag - see todo-overlay.ts's hit-testing).
//
// Touch does NOT use this hold-then-move path at all - see
// .drag-handle's own comment for why (live-reproduced: it doesn't
// reliably win the race against the browser's native scroll-gesture
// recognizer, even with preventDefault()/touch-action tried at the
// hold-ready moment - touch-action changes made mid-gesture aren't
// consistently honored). Touch instead drags only via the dedicated
// handle rendered while reorderModeActive, which engages immediately
// like a mouse does (see initiatedFromHandle) rather than waiting out
// a hold, since the handle has no competing "quick swipe = scroll"
// ambiguity to protect against in the first place.
@customElement("todo-overlay-tree-item")
export class TodoTreeItem extends LitElement {

    static styles = css`
        :host {
            display: block;
        }

        ul {
            list-style: none;
            margin: 0;
            padding-inline-start: ${rowIndentPx};
        }

        .row {
            position: relative;
            display: flex;
            align-items: center;
            gap: 8px;
            min-height: 32px;
            padding: 5px 12px;
            border-radius: 4px;
            outline: 2px solid transparent;
            outline-offset: -2px;
            user-select: none;
            cursor: pointer;
            transition: background-color 0.15s ease, outline-color 0.15s ease, margin 150ms ease;
        }

        .row:hover {
            background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.06);
        }

        .row.pressed {
            background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.12);
        }

        /* The dragged row itself is fully removed from the flow, not
           shrunk to a placeholder box - a lingering box here (whatever
           its size or fill) reads as debris left behind by the item,
           disconnected from the ghost that's now following the pointer
           (see renderDragGhost) elsewhere on screen. Hit-testing already
           treats this row as gone (collectAllRows/snapshotRows exclude
           it), so the visual now matches: nothing stays behind, the list
           closes up around the gap immediately, and the ghost is the
           only thing representing the item until it drops. */
        .row.lifted {
            display: none;
        }

        /* Marks every row inside a dragged parent's subtree as moving
           along with it - no height/layout change (unlike .lifted, which
           collapses), so nothing reflows and nothing else on the row
           shifts position mid-drag. */
        .row.dimmed {
            opacity: 0.45;
        }

        /* "inside" (becoming this row's child) draws a bounding box
           around the row itself, rather than opening a gap - dragging
           OVER an existing parent to nest under it is a fundamentally
           different gesture from reordering past a sibling, and reads
           more clearly as "drop into this container" when the container
           itself is outlined, the same way a file manager highlights a
           folder you're dragging onto rather than showing a shadow copy
           of the file inside it. */
        .row.drop-inside {
            outline-color: var(--accent-color, var(--primary-color));
            background: rgba(var(--rgb-accent-color, 255, 152, 0), 0.08);
        }

        /* Instead of a static line, the sibling next to the drop point
           opens a live gap (matching the space a lifted row leaves
           behind), so the list visibly reflows to show where the item
           would land rather than just marking the spot. Reordering only -
           see .row.drop-inside above for why becoming a child looks
           different. */
        .row.gap-before {
            margin-top: 52px;
        }

        .row.gap-after {
            margin-bottom: 52px;
        }

        /* The actual "it'll go here" preview for a reorder (before/after
           only - see .row.drop-inside above), rendered into whichever
           gap the row above just opened - a dashed placeholder the size
           of a real row, indented to match the target's own depth.
           Absolutely positioned against the row (which has its own
           position:relative) so it overlays the margin gap without
           adding any height of its own - the margin is what actually
           reflows the list; this just fills the space it opened. */
        .drop-shadow-box {
            position: absolute;
            left: 0;
            right: 8px;
            height: 44px;
            border: 2px dashed var(--accent-color, var(--primary-color));
            border-radius: 4px;
            background: rgba(var(--rgb-accent-color, 255, 152, 0), 0.08);
            transition: left 100ms ease;
            pointer-events: none;
        }

        .drop-shadow-box.above {
            top: -48px;
        }

        .drop-shadow-box.below {
            bottom: -48px;
        }

        .content {
            flex: 1;
            min-width: 0;
            display: flex;
            flex-direction: column;
            gap: 2px;
        }

        .title-line {
            display: flex;
            align-items: baseline;
            gap: 6px;
            min-width: 0;
        }

        .summary {
            min-width: 0;
            flex-shrink: 1;
            font-family: Roboto, "Noto Sans", sans-serif;
            font-size: 14px;
            font-weight: 400;
            line-height: 21px;
            color: var(--primary-text-color);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .quantity-chip {
            flex-shrink: 0;
            font-family: Roboto, "Noto Sans", sans-serif;
            font-size: 12px;
            font-weight: 600;
            color: var(--primary-color);
            background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.12);
            padding: 1px 7px;
            border-radius: 10px;
            white-space: nowrap;
        }

        .row.completed .quantity-chip {
            color: var(--secondary-text-color);
            background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.08);
        }

        .row.completed .summary {
            text-decoration: line-through;
            color: var(--secondary-text-color);
        }

        /* A row with children needs to read as a group header at a
           glance - it never shows a checkbox at all (see the template's
           checkboxHidden branch, which drops .checkbox-slot from the
           layout entirely rather than reserving empty space for it), so
           bold + very slightly larger text carries that signal on its
           own instead, the same way the reference card this design
           was inspired by distinguishes a single level of nesting with
           no indentation at all. */
        .summary.has-children {
            font-weight: 600;
            font-size: 15px;
        }

        ha-checkbox {
            pointer-events: none;
            flex-shrink: 0;
        }

        /* Only ever rendered around a real, visible checkbox (see the
           template's checkboxHidden branch) - never reserved as empty
           space, so there's nothing here for a hidden-checkbox parent
           row to misalign against. Deliberately does NOT clip overflow:
           an earlier version used overflow:hidden to crop ha-checkbox's
           own larger touch-target box down to this slot's tighter
           footprint, but ha-checkbox's actual VISIBLE glyph (not just
           its invisible touch padding) is wider than that box, so it
           was cropping part of the real checkmark - left un-clipped and
           centered instead, same alignment contribution, nothing gets
           cut off. */
        .checkbox-slot {
            flex-shrink: 0;
            width: 28px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .collapse-toggle {
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 20px;
            height: 20px;
            margin-inline-start: -4px;
            border: none;
            background: none;
            padding: 0;
            cursor: pointer;
            color: var(--secondary-text-color);
        }

        .collapse-toggle svg {
            width: 18px;
            height: 18px;
            fill: currentColor;
            transition: transform 150ms ease;
            transform: rotate(90deg);
        }

        .collapse-toggle.collapsed svg {
            transform: rotate(0deg);
        }

        .collapse-toggle-spacer {
            flex-shrink: 0;
            width: 20px;
            margin-inline-start: -4px;
        }

        .status-chip {
            flex-shrink: 0;
            font-family: Roboto, "Noto Sans", sans-serif;
            font-size: 12px;
            font-weight: 600;
            color: var(--secondary-text-color);
            background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.08);
            padding: 1px 7px;
            border-radius: 10px;
            white-space: nowrap;
        }

        .status-chip.all-done {
            color: var(--success-color, #4caf50);
            background: rgba(var(--rgb-success-color, 76, 175, 80), 0.12);
        }

        /* Secondary metadata line: due date + description today, with
           room to append more chips (e.g. tags) here later without
           restructuring the row. Lives in the same content column as
           the title, so it naturally lines up under it with no manual
           indent - the checkbox centers against the whole column. */
        .row-meta {
            display: flex;
            align-items: center;
            gap: 8px;
            font-family: Roboto, "Noto Sans", sans-serif;
            font-size: 12px;
            line-height: 14px;
            color: var(--secondary-text-color);
        }

        .due-chip {
            display: flex;
            align-items: center;
            gap: 4px;
            flex-shrink: 0;
            white-space: nowrap;
        }

        .due-chip.overdue {
            color: var(--error-color);
        }

        .due-chip svg {
            width: 14px;
            height: 14px;
            fill: currentColor;
        }

        .due-chip .trigger-armed-icon {
            width: 12px;
            height: 12px;
            fill: var(--primary-color);
        }

        .due-chip.overdue .trigger-armed-icon {
            fill: currentColor;
        }

        .tag-chip {
            flex-shrink: 0;
            padding: 0 6px;
            border-radius: 8px;
            border: 1px solid var(--divider-color);
            white-space: nowrap;
        }

        .description-text {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        /* Only ever shown on a leaf row (see hasChildren in the
           template) - a group header is deleted via its own edit
           dialog, same as before, since removing a whole subtree in one
           tap is a much bigger action than removing a single item. */
        .delete-button {
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 24px;
            height: 24px;
            margin-inline-end: -4px;
            border: none;
            background: none;
            padding: 0;
            border-radius: 50%;
            cursor: pointer;
            color: var(--secondary-text-color);
            opacity: 0.5;
            transition: opacity 0.15s ease, background-color 0.15s ease, color 0.15s ease;
        }

        .row:hover .delete-button {
            opacity: 1;
        }

        .delete-button svg {
            width: 16px;
            height: 16px;
            fill: currentColor;
        }

        /* Armed by a first tap - a second tap within
           DELETE_CONFIRM_WINDOW_MS actually deletes, otherwise it quietly
           disarms itself. Red + a filled background makes that state
           change unmistakable even on a small screen, since there's no
           room in the row for a second "are you sure" button. */
        .delete-button.confirming {
            opacity: 1;
            color: var(--error-color);
            background: rgba(var(--rgb-error-color, 219, 68, 55), 0.15);
        }

        /* Shown instead of the delete button (see the template) while
           reorderModeActive, for every row regardless of hasChildren -
           dragging needs to work on parents too, unlike delete.
           touch-action: none is static here, never toggled - that's the
           whole point: a dedicated element the browser knows from the
           very first touchstart is drag-only means its gesture
           recognition never has a native-scroll option to race against
           in the first place, unlike trying to flip touch-action on the
           row mid-gesture once a hold is judged "ready" (tried first,
           doesn't reliably work - see the class docstring above). */
        .drag-handle {
            touch-action: none;
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 24px;
            height: 24px;
            margin-inline-end: -4px;
            border: none;
            background: none;
            padding: 0;
            border-radius: 50%;
            cursor: grab;
            color: var(--secondary-text-color);
        }

        .drag-handle svg {
            width: 18px;
            height: 18px;
            fill: currentColor;
        }

        .hold-ripple {
            position: absolute;
            width: ${holdRippleSizePx};
            height: ${holdRippleSizePx};
            margin-left: calc(${holdRippleSizePx} / -2);
            margin-top: calc(${holdRippleSizePx} / -2);
            border-radius: 50%;
            background: var(--primary-color);
            opacity: 0.2;
            pointer-events: none;
            transform: scale(0);
            transition: transform 180ms ease-in-out;
        }

        .hold-ripple.active {
            transform: scale(1);
        }
    `;

    @property({attribute: false})
    item!: TodoItem;

    @property({attribute: false})
    draggedId?: string;

    @property({attribute: false})
    hoverId?: string;

    @property({attribute: false})
    hoverPlacement?: Placement;

    // How deep the CURRENT target sits (root = 0) - see
    // todo-overlay-list.ts's own hoverDepth for what drives this. Only
    // used for a before/after reorder's drop-shadow-box, to inset it to
    // match the target's own nesting level - "inside" (becoming a
    // child) shows no shadow box at all, see rowClasses/render() below.
    @property({attribute: false})
    hoverDepth = 0;

    @property({attribute: false})
    hideCompleteForParents = false;

    // Off by default: most users complete an item by tapping the row
    // itself (see todo-overlay-list.ts's onPointerUp - the checkbox has
    // pointer-events:none and was never the actual tap target), so the
    // checkbox glyph is purely a visual affordance, not a required one.
    // Purely visual: turning this off never changes what a tap on the
    // row does, only whether the little checkbox renders.
    @property({attribute: false})
    showCheckboxes = false;

    @property({attribute: false})
    confirmDelete = true;

    // When a sort mode other than "manual" is active, drag-to-reorder
    // would be actively misleading - the position it visually ends up in
    // has nothing to do with where it was dropped, since sort order
    // overrides it on the next render. Movement past the jitter threshold
    // still cancels a hold (same as the touch pre-holdReady path), it
    // just never engages a drag.
    @property({attribute: false})
    dragDisabled = false;

    // Owned by todo-overlay-list.ts, not this component - collapse state
    // needs to survive this row's own re-renders (e.g. every list reload)
    // and be visible to ancestors for the same reason draggedId/hoverId
    // already are, so it's threaded down rather than kept as local state.
    @property({attribute: false})
    collapsedIds: Set<string> = new Set();

    // True for every row inside a dragged parent's subtree, at any depth -
    // set by an ancestor row once ITS OWN isBeingDragged goes true (see the
    // child-rendering loop below, which passes isBeingDragged down as this
    // property, and re-passes its own already-true value further down in
    // turn so it keeps propagating past however many levels of nesting).
    // Purely a dimmed style (see rowClasses) - deliberately NOT collapsing
    // or unmounting these rows, which would reflow the list around the
    // sudden gap and produce a jarring flash of blank space where the
    // subtree used to be. Dimming in place needs no layout change at all,
    // so there's nothing to flash: the whole moving subtree just visibly
    // reads as one unit, exactly where it's already sitting.
    @property({attribute: false})
    dimmedByAncestorDrag = false;

    // Set by todo-overlay-list.ts's toolbar toggle - see .drag-handle's
    // own comment for why touch needs this at all instead of just
    // holding anywhere on the row like a mouse does.
    @property({attribute: false})
    reorderModeActive = false;

    @state()
    private holdRippleOrigin?: {x: number; y: number};

    @state()
    private dragEngaged = false;

    @state()
    private confirmingDelete = false;

    private pointerDownAt = 0;
    private pointerDownScreenPos?: {x: number; y: number};
    private hasMoved = false;
    private holdTimer?: number;
    private clickTimer?: number;
    private deleteConfirmTimer?: number;
    // Mouse users have no reason to wait out the hold timer before a drag
    // picks up - there's no competing "swipe to scroll" gesture to protect
    // against, unlike touch, where a quick swipe must be left alone (see
    // onWindowPointerMove) so the page still scrolls normally.
    private pointerIsMouse = false;
    // Set only by handlePointerDown (the dedicated .drag-handle, touch's
    // only path to a drag) - engages immediately on the first move past
    // the jitter threshold, same as pointerIsMouse, since the handle has
    // no "quick swipe = scroll" ambiguity to wait out in the first place.
    private initiatedFromHandle = false;

    private get isPressed(): boolean {
        return this.draggedId === this.item.id;
    }

    private get isBeingDragged(): boolean {
        return this.isPressed && this.dragEngaged;
    }

    private get isDropTarget(): boolean {
        return (
            this.hoverId === this.item.id &&
            this.draggedId !== undefined &&
            this.draggedId !== this.item.id
        );
    }

    // Ticking a parent normally cascades completion to every descendant -
    // easy to trigger by accident on a row that's mostly there to show
    // hierarchy. With hideCompleteForParents on, such a row shows no
    // checkbox at all; completing it becomes a deliberate action via the
    // edit dialog instead (see todo-overlay.ts's onPointerUp and
    // todo-item-dialog.ts's complete toggle).
    private get checkboxHidden(): boolean {
        if (!this.showCheckboxes) {
            return true;
        }

        return this.hideCompleteForParents && this.item.children.length > 0;
    }

    private get hasChildren(): boolean {
        return this.item.children.length > 0;
    }

    private get isCollapsed(): boolean {
        return this.hasChildren && this.collapsedIds.has(this.item.id);
    }

    private get childStatus(): {completed: number; total: number} | undefined {
        if (!this.hasChildren) {
            return undefined;
        }

        return {
            completed: this.item.children.filter(child => child.completed).length,
            total: this.item.children.length,
        };
    }

    private toggleCollapse(e: Event) {
        e.stopPropagation();

        this.dispatchEvent(
            new CustomEvent("tree-toggle-collapse", {
                detail: {id: this.item.id},
                bubbles: true,
                composed: true,
            }),
        );
    }

    private onDeleteClick(e: Event) {
        e.stopPropagation();

        window.clearTimeout(this.deleteConfirmTimer);

        if (this.confirmDelete && !this.confirmingDelete) {
            this.confirmingDelete = true;
            this.deleteConfirmTimer = window.setTimeout(() => {
                this.confirmingDelete = false;
            }, DELETE_CONFIRM_WINDOW_MS);
            return;
        }

        this.confirmingDelete = false;

        this.dispatchEvent(
            new CustomEvent("tree-delete-item", {
                detail: {id: this.item.id},
                bubbles: true,
                composed: true,
            }),
        );
    }

    private pointerDown(e: PointerEvent) {
        this.pointerDownAt = Date.now();
        this.pointerDownScreenPos = {x: e.clientX, y: e.clientY};
        this.hasMoved = false;
        this.dragEngaged = false;
        this.initiatedFromHandle = false;
        this.pointerIsMouse = e.pointerType === "mouse";

        // Always the ROW's rect, even when this fires from the small
        // .drag-handle (handlePointerDown calls straight into this) - the
        // ghost is sized and dragged as the whole row (see onDragStart in
        // todo-overlay-list.ts), so its grab offset needs to be relative
        // to the row too, not to whichever small element the pointer
        // actually landed on.
        const rect = (this.shadowRoot?.querySelector(".row") as HTMLElement | null)?.getBoundingClientRect()
            ?? (e.currentTarget as HTMLElement).getBoundingClientRect();
        this.holdRippleOrigin = {x: e.clientX - rect.left, y: e.clientY - rect.top};

        window.clearTimeout(this.holdTimer);
        this.holdTimer = window.setTimeout(() => {
            this.requestUpdate();
        }, LONG_PRESS_MS);

        // Capture phase, not bubble: HA's own frontend has various
        // touch/gesture handling that can call stopPropagation() on its
        // way back up, which would otherwise silently swallow these
        // before a bubble-phase window listener ever saw them -
        // capturing at the very outermost point sidesteps that entirely.
        window.addEventListener("pointermove", this.onWindowPointerMove, {capture: true});
        window.addEventListener("pointerup", this.onWindowPointerUp, {capture: true});
        // Touch gestures often end with pointercancel rather than
        // pointerup (the browser treats an ambiguous or interrupted
        // touch as "cancelled" rather than a deliberate release) - both
        // need to end the gesture the same way, or a touch drag would
        // get stuck with dangling listeners and never finalize.
        window.addEventListener("pointercancel", this.onWindowPointerUp, {capture: true});

        this.dispatchEvent(
            new CustomEvent("tree-pointer-down", {
                detail: {id: this.item.id},
                bubbles: true,
                composed: true,
            }),
        );
    }

    // .drag-handle's own pointerdown - stops propagation so the row's own
    // pointerDown (bound on .row) doesn't ALSO fire for the same press
    // (it would otherwise, since the handle is a child of .row). Runs the
    // exact same setup as a normal press, then marks it as handle-
    // initiated so onWindowPointerMove engages immediately instead of
    // waiting out (or ever reaching) the hold threshold.
    private handlePointerDown = (e: PointerEvent) => {
        e.stopPropagation();
        this.pointerDown(e);
        this.initiatedFromHandle = true;
    };

    private get holdReady(): boolean {
        return (
            this.isPressed &&
            Date.now() - this.pointerDownAt >= LONG_PRESS_MS
        );
    }

    private clearHoldRipple() {
        window.clearTimeout(this.holdTimer);
        this.holdRippleOrigin = undefined;
    }

    // Hold and drag are mutually exclusive - once the pointer has moved
    // meaningfully before the hold threshold, this permanently cancels
    // the hold for the rest of the gesture (the ripple disappears, and
    // pointerUp will treat it as an ambiguous no-op rather than a hold).
    private cancelHoldForMovement() {
        if (this.hasMoved) {
            return;
        }

        this.hasMoved = true;
        this.clearHoldRipple();
    }

    private onWindowPointerMove = (e: PointerEvent) => {
        if (!this.pointerDownScreenPos || this.dragEngaged) {
            return;
        }

        const dx = e.clientX - this.pointerDownScreenPos.x;
        const dy = e.clientY - this.pointerDownScreenPos.y;

        if (Math.hypot(dx, dy) <= MOVE_CANCEL_THRESHOLD_PX) {
            return;
        }

        if (!this.dragDisabled && (this.pointerIsMouse || this.initiatedFromHandle)) {
            this.hasMoved = true;
            this.dragEngaged = true;

            // Handle-initiated only: belt-and-suspenders alongside the
            // handle's static touch-action: none - see .drag-handle's own
            // comment. No-op for mouse, which has no competing native
            // gesture to suppress. todo-overlay-list.ts's
            // onGlobalPointerMove keeps preventing default for the rest
            // of the drag once it's engaged.
            if (this.initiatedFromHandle) {
                e.preventDefault();
            }

            // Captured from the ORIGINAL press, not the current event: for
            // a mouse, drag now engages on the very first move past the
            // jitter threshold (see pointerIsMouse above), so a fast flick
            // can already be well clear of pointerDownScreenPos by the time
            // this fires. The ghost tracks the pointer by subtracting a
            // fixed grab offset from its current position every frame - if
            // that offset were taken from THIS event instead of the
            // original press, a fast first move bakes in a bogus offset
            // (however far the pointer already travelled before engaging),
            // and the ghost stays visibly behind the cursor for the rest of
            // the drag by exactly that amount.
            const grabOffset = this.holdRippleOrigin ?? {x: 0, y: 0};
            this.clearHoldRipple();

            const rowEl = this.shadowRoot?.querySelector(".row");
            const rect = rowEl?.getBoundingClientRect();

            this.dispatchEvent(
                new CustomEvent("tree-drag-start", {
                    detail: {
                        id: this.item.id,
                        rect: rect
                            ? {x: rect.left, y: rect.top, width: rect.width, height: rect.height}
                            : undefined,
                        grabOffsetX: grabOffset.x,
                        grabOffsetY: grabOffset.y,
                        pointerX: e.clientX,
                        pointerY: e.clientY,
                    },
                    bubbles: true,
                    composed: true,
                }),
            );
        } else {
            this.cancelHoldForMovement();
        }
    };

    private onWindowPointerUp = () => {
        this.pointerUp();
    };

    private detachWindowListeners() {
        window.removeEventListener("pointermove", this.onWindowPointerMove, {capture: true});
        window.removeEventListener("pointerup", this.onWindowPointerUp, {capture: true});
        window.removeEventListener("pointercancel", this.onWindowPointerUp, {capture: true});
    }

    private emitPointerUp(pressDurationMs: number, moved = false) {
        this.dispatchEvent(
            new CustomEvent("tree-pointer-up", {
                detail: {id: this.item.id, pressDurationMs, moved},
                bubbles: true,
                composed: true,
            }),
        );
    }

    private pointerUp() {
        this.detachWindowListeners();
        this.clearHoldRipple();

        const pressDurationMs = Date.now() - this.pointerDownAt;

        if (this.dragEngaged) {
            // The card's own global pointerup listener (attached when
            // tree-drag-start fired) owns finalizing this - it already
            // has the current hover target from its own hit-testing.
            this.dragEngaged = false;
            return;
        }

        if (this.hasMoved || pressDurationMs >= LONG_PRESS_MS) {
            this.emitPointerUp(pressDurationMs, this.hasMoved);
            return;
        }

        // A PREVIOUS quick tap's debounce timer is still armed and
        // waiting - this tap arrived before it fired, so together the
        // two are a double click. Detected this way (a second tap
        // landing inside the first tap's own debounce window) rather
        // than by listening for the browser's native "dblclick" event -
        // that event depends on the browser's own click-pairing timing,
        // which was found (via CDP-driven testing, not just theory) to
        // sometimes never fire at all for two otherwise-ordinary clicks,
        // silently losing the second click's ability to open the edit
        // dialog. This mirrors the row's own hand-rolled hold-to-edit
        // gesture (see onWindowPointerMove) rather than trusting a
        // native browser gesture event to show up reliably.
        if (this.clickTimer !== undefined) {
            window.clearTimeout(this.clickTimer);
            this.clickTimer = undefined;
            this.emitPointerUp(LONG_PRESS_MS, false);
            return;
        }

        this.clickTimer = window.setTimeout(() => {
            this.clickTimer = undefined;
            this.emitPointerUp(pressDurationMs, false);
        }, CLICK_DEBOUNCE_MS);
    }

    render() {
        const isDropTarget = this.isDropTarget;
        const isBeingDragged = this.isBeingDragged;

        const rowClasses = {
            row: true,
            pressed: this.isPressed && !isBeingDragged,
            lifted: isBeingDragged,
            dimmed: this.dimmedByAncestorDrag,
            "drop-inside": isDropTarget && this.hoverPlacement === "inside",
            "gap-before": isDropTarget && this.hoverPlacement === "before",
            "gap-after": isDropTarget && this.hoverPlacement === "after",
            completed: this.item.completed,
        };

        const due = formatDue(this.item);
        const hasMeta = due || this.item.description || this.item.tags.length > 0;
        const status = this.childStatus;

        return html`
            <li>

                <div
                    class=${classMap(rowClasses)}

                    @pointerdown=${this.pointerDown}
                >
                    ${
                        // Reordering (before/after) shows the shadow box in
                        // the gap it just opened; becoming a child ("inside")
                        // shows no shadow box at all - the bounding-box
                        // outline on THIS row (see rowClasses' drop-inside)
                        // is the whole highlight for that case.
                        isDropTarget && this.hoverPlacement !== "inside"
                            ? html`
                                <div
                                    class=${classMap({
                                        "drop-shadow-box": true,
                                        above: this.hoverPlacement === "before",
                                        below: this.hoverPlacement === "after",
                                    })}
                                    style=${styleMap({left: `${this.hoverDepth * ROW_INDENT_PX}px`})}
                                ></div>
                            `
                            : ""
                    }
                    ${
                        isBeingDragged
                            ? ""
                            : html`
                                ${
                                    this.hasChildren
                                        ? html`
                                            <button
                                                class=${classMap({
                                                    "collapse-toggle": true,
                                                    collapsed: this.isCollapsed,
                                                })}
                                                aria-label=${this.isCollapsed ? "Expand" : "Collapse"}
                                                @click=${this.toggleCollapse}
                                                @pointerdown=${(e: Event) => e.stopPropagation()}
                                            >
                                                ${CHEVRON_ICON}
                                            </button>
                                        `
                                        : html`<span class="collapse-toggle-spacer"></span>`
                                }

                                ${
                                    this.checkboxHidden
                                        ? ""
                                        : html`
                                            <div class="checkbox-slot">
                                                <ha-checkbox .checked=${this.item.completed}></ha-checkbox>
                                            </div>
                                        `
                                }

                                <div class="content">
                                    <div class="title-line">
                                        <span class=${classMap({summary: true, "has-children": this.hasChildren})}>${this.item.title}</span>
                                        ${
                                            this.item.quantity
                                                ? html`<span class="quantity-chip">${this.item.quantity}</span>`
                                                : ""
                                        }
                                        ${
                                            status
                                                ? html`
                                                    <span class=${classMap({
                                                        "status-chip": true,
                                                        "all-done": status.completed === status.total,
                                                    })}>
                                                        ${status.completed}/${status.total}
                                                    </span>
                                                `
                                                : ""
                                        }
                                    </div>

                                    ${
                                        hasMeta
                                            ? html`
                                                <div class="row-meta">
                                                    ${
                                                        due
                                                            ? html`
                                                                <span
                                                                    class=${classMap({"due-chip": true, overdue: due.overdue})}
                                                                    title=${this.item.trigger_on_due ? "Triggers an automation when due" : nothing}
                                                                >
                                                                    ${CLOCK_ICON}${due.label}
                                                                    ${this.item.trigger_on_due ? BELL_ICON : ""}
                                                                </span>
                                                            `
                                                            : ""
                                                    }
                                                    ${this.item.tags.map(tag => html`<span class="tag-chip">${tag}</span>`)}
                                                    ${
                                                        this.item.description
                                                            ? html`<span class="description-text">${this.item.description}</span>`
                                                            : ""
                                                    }
                                                </div>
                                            `
                                            : ""
                                    }
                                </div>

                                ${
                                    this.reorderModeActive
                                        ? html`
                                            <button
                                                class="drag-handle"
                                                aria-label="Drag to reorder"
                                                @pointerdown=${this.handlePointerDown}
                                            >
                                                ${DRAG_HANDLE_ICON}
                                            </button>
                                        `
                                        : this.hasChildren
                                            ? ""
                                            : html`
                                                <button
                                                    class=${classMap({
                                                        "delete-button": true,
                                                        confirming: this.confirmingDelete,
                                                    })}
                                                    aria-label=${this.confirmingDelete ? "Confirm delete" : "Delete"}
                                                    @click=${this.onDeleteClick}
                                                    @pointerdown=${(e: Event) => e.stopPropagation()}
                                                >
                                                    ${CROSS_ICON}
                                                </button>
                                            `
                                }

                                ${
                                    this.holdRippleOrigin
                                        ? html`
                                            <div
                                                class=${classMap({"hold-ripple": true, active: this.holdReady})}
                                                style=${styleMap({
                                                    left: `${this.holdRippleOrigin.x}px`,
                                                    top: `${this.holdRippleOrigin.y}px`,
                                                })}
                                            ></div>
                                        `
                                        : ""
                                }
                            `
                    }
                </div>

                ${
                    this.hasChildren && !this.isCollapsed
                        ? html`
                            <ul>
                                ${this.item.children.map(
                                    child => html`
                                        <todo-overlay-tree-item
                                            .item=${child}
                                            .draggedId=${this.draggedId}
                                            .hoverId=${this.hoverId}
                                            .hoverPlacement=${this.hoverPlacement}
                                            .hoverDepth=${this.hoverDepth}
                                            .hideCompleteForParents=${this.hideCompleteForParents}
                                            .showCheckboxes=${this.showCheckboxes}
                                            .confirmDelete=${this.confirmDelete}
                                            .dragDisabled=${this.dragDisabled}
                                            .collapsedIds=${this.collapsedIds}
                                            .dimmedByAncestorDrag=${isBeingDragged || this.dimmedByAncestorDrag}
                                            .reorderModeActive=${this.reorderModeActive}
                                        ></todo-overlay-tree-item>
                                    `,
                                )}
                            </ul>
                        `
                        : ""
                }

            </li>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        "todo-overlay-tree-item": TodoTreeItem;
    }
}
