import {LitElement, html, css, unsafeCSS} from "lit";
import {customElement, property, state} from "lit/decorators.js";
import {classMap} from "lit/directives/class-map.js";
import {styleMap} from "lit/directives/style-map.js";

import {LONG_PRESS_MS, type Placement, type TodoItem, isOverdue} from "../models";

// How far into a row's top/bottom the pointer needs to be to count as
// "before"/"after" rather than "inside" (reparent). Exported so the
// card's own hit-testing (which replaced per-row hover dispatch - see
// the module docstring below) computes placement the same way.
export const BEFORE_AFTER_ZONE = 0.3;

// Pointer movement beyond this many pixels, while still under the hold
// threshold, cancels the hold-to-edit gesture rather than engaging a
// drag - a small allowance for natural hand/touch jitter rather than a
// strict zero-tolerance check. Movement past the hold threshold instead
// engages a live drag (see onWindowPointerMove) - the two are gated on
// timing so a quick swipe on mobile still scrolls the page normally,
// and only a sustained hold-then-move picks an item up.
const MOVE_CANCEL_THRESHOLD_PX = 6;
const HOLD_RIPPLE_SIZE = 72;
const holdRippleSizePx = unsafeCSS(`${HOLD_RIPPLE_SIZE}px`);

// A plain tap is delayed this long before it commits to toggling
// completion, so a following second click can still cancel it and open
// the edit dialog instead (see onDoubleClick). Skipped entirely for
// drags and holds, which are unambiguous the moment they happen.
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

// Drag-and-drop model: a hold (matching the existing hold-to-edit
// threshold) followed by movement picks an item up - the card then
// takes over entirely via its own window-level pointermove/pointerup
// listeners and a floating "ghost" that follows the pointer, since
// per-row hover listeners don't work on touch (a touch pointer is
// implicitly captured to whichever element it started on, so
// pointerenter/pointermove never fire on OTHER rows during a real
// touch drag - see todo-overlay.ts's hit-testing). Movement BEFORE the
// hold threshold is left alone entirely (no preventDefault), so a
// quick swipe still scrolls the page normally instead of fighting a
// drag that was never actually intended.
@customElement("todo-overlay-tree-item")
export class TodoTreeItem extends LitElement {

    static styles = css`
        :host {
            display: block;
        }

        ul {
            list-style: none;
            margin: 0;
            padding-inline-start: 32px;
        }

        .row {
            position: relative;
            display: flex;
            align-items: center;
            gap: 10px;
            min-height: 32px;
            padding: 5px 16px;
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

        .row.lifted {
            min-height: 10px;
            padding: 4px 20px;
            border-radius: 4px;
            border: 1px dashed var(--divider-color);
            background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.03);
            cursor: grabbing;
        }

        .row.drop-inside {
            outline-color: var(--accent-color, var(--primary-color));
            background: rgba(var(--rgb-accent-color, 255, 152, 0), 0.08);
        }

        /* Instead of a static line, the sibling next to the drop point
           opens a live gap (matching the space a lifted row leaves
           behind), so the list visibly reflows to show where the item
           would land rather than just marking the spot. */
        .row.gap-before {
            margin-top: 52px;
        }

        .row.gap-after {
            margin-bottom: 52px;
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

        ha-checkbox {
            pointer-events: none;
            flex-shrink: 0;
        }

        /* Always reserves the same width whether a checkbox is actually
           rendered inside it or not (see checkboxHidden) - a parent with
           hide_complete_for_parents active and a plain leaf item are
           logically siblings at the same level, and need to align the
           same way regardless of which one happens to show a checkbox.
           overflow:hidden clips ha-checkbox's own oversized touch-target
           box down to this slot's tighter footprint - harmless, since
           the checkbox here is purely decorative (pointer-events: none;
           the row itself owns tap handling). */
        .checkbox-slot {
            flex-shrink: 0;
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
        }

        .collapse-toggle {
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 24px;
            height: 24px;
            margin-inline-start: -8px;
            border: none;
            background: none;
            padding: 0;
            cursor: pointer;
            color: var(--secondary-text-color);
        }

        .collapse-toggle svg {
            width: 20px;
            height: 20px;
            fill: currentColor;
            transition: transform 150ms ease;
            transform: rotate(90deg);
        }

        .collapse-toggle.collapsed svg {
            transform: rotate(0deg);
        }

        .collapse-toggle-spacer {
            flex-shrink: 0;
            width: 24px;
            margin-inline-start: -8px;
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

    @property({attribute: false})
    hideCompleteForParents = false;

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

    @state()
    private holdRippleOrigin?: {x: number; y: number};

    @state()
    private dragEngaged = false;

    private pointerDownAt = 0;
    private pointerDownScreenPos?: {x: number; y: number};
    private hasMoved = false;
    private holdTimer?: number;
    private clickTimer?: number;
    // Mouse users have no reason to wait out the hold timer before a drag
    // picks up - there's no competing "swipe to scroll" gesture to protect
    // against, unlike touch, where a quick swipe must be left alone (see
    // onWindowPointerMove) so the page still scrolls normally.
    private pointerIsMouse = false;

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

    private pointerDown(e: PointerEvent) {
        this.pointerDownAt = Date.now();
        this.pointerDownScreenPos = {x: e.clientX, y: e.clientY};
        this.hasMoved = false;
        this.dragEngaged = false;
        this.pointerIsMouse = e.pointerType === "mouse";

        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
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

        if (!this.dragDisabled && (this.pointerIsMouse || this.holdReady)) {
            this.hasMoved = true;
            this.dragEngaged = true;

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

        // Might be the first click of a double-click - give it a brief
        // window to arrive before committing to a plain toggle.
        window.clearTimeout(this.clickTimer);
        this.clickTimer = window.setTimeout(() => {
            this.emitPointerUp(pressDurationMs, false);
        }, CLICK_DEBOUNCE_MS);
    }

    private onDoubleClick() {
        window.clearTimeout(this.clickTimer);

        this.dispatchEvent(
            new CustomEvent("tree-pointer-down", {
                detail: {id: this.item.id},
                bubbles: true,
                composed: true,
            }),
        );

        this.emitPointerUp(LONG_PRESS_MS);
    }

    render() {
        const isDropTarget = this.isDropTarget;
        const isBeingDragged = this.isBeingDragged;

        const rowClasses = {
            row: true,
            pressed: this.isPressed && !isBeingDragged,
            lifted: isBeingDragged,
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
                    @dblclick=${this.onDoubleClick}
                >
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
                                                @dblclick=${(e: Event) => e.stopPropagation()}
                                                @pointerdown=${(e: Event) => e.stopPropagation()}
                                            >
                                                ${CHEVRON_ICON}
                                            </button>
                                        `
                                        : html`<span class="collapse-toggle-spacer"></span>`
                                }

                                <div class="checkbox-slot">
                                    ${
                                        this.checkboxHidden
                                            ? ""
                                            : html`<ha-checkbox .checked=${this.item.completed}></ha-checkbox>`
                                    }
                                </div>

                                <div class="content">
                                    <div class="title-line">
                                        <span class="summary">${this.item.title}</span>
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
                                                                <span class=${classMap({"due-chip": true, overdue: due.overdue})}>
                                                                    ${CLOCK_ICON}${due.label}
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
                                            .hideCompleteForParents=${this.hideCompleteForParents}
                                            .dragDisabled=${this.dragDisabled}
                                            .collapsedIds=${this.collapsedIds}
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
