import {LitElement, html, css, unsafeCSS} from "lit";
import {customElement, property, state} from "lit/decorators.js";
import {classMap} from "lit/directives/class-map.js";
import {styleMap} from "lit/directives/style-map.js";

import {LONG_PRESS_MS, type Placement, type TodoItem} from "../models";

const BEFORE_AFTER_ZONE = 0.3;
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
        overdue: !item.completed && dueDay.getTime() < today.getTime(),
    };
}

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
            flex-direction: column;
            padding: 0 20px;
            border-radius: 4px;
            outline: 2px solid transparent;
            outline-offset: -2px;
            user-select: none;
            cursor: pointer;
            transition: background-color 0.15s ease, outline-color 0.15s ease;
        }

        .row:hover {
            background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.06);
        }

        .row.pressed {
            background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.12);
        }

        .row.dragging {
            opacity: 0.5;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        }

        .row.drop-inside {
            outline-color: var(--accent-color, var(--primary-color));
            background: rgba(var(--rgb-accent-color, 255, 152, 0), 0.08);
        }

        .row.drop-before::before,
        .row.drop-after::after {
            content: "";
            position: absolute;
            left: 20px;
            right: 20px;
            height: 2px;
            border-radius: 1px;
            background: var(--accent-color, var(--primary-color));
        }

        .row.drop-before::before {
            top: -1px;
        }

        .row.drop-after::after {
            bottom: -1px;
        }

        .row-main {
            display: flex;
            align-items: center;
            gap: 12px;
            min-height: 40px;
            font-family: Roboto, "Noto Sans", sans-serif;
            font-size: 14px;
            font-weight: 400;
            line-height: 21px;
            color: var(--primary-text-color);
        }

        .row.completed .summary {
            text-decoration: line-through;
            color: var(--secondary-text-color);
        }

        ha-checkbox {
            pointer-events: none;
            flex-shrink: 0;
        }

        .summary {
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        /* Secondary metadata line: due date + description today, with
           room to append more chips (e.g. tags) here later without
           restructuring the row. Indented to align under the title,
           past the checkbox (28px) and its gap (12px). */
        .row-meta {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 0 0 4px 40px;
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

    @state()
    private holdRippleOrigin?: {x: number; y: number};

    private pointerDownAt = 0;
    private holdTimer?: number;
    private clickTimer?: number;

    private get isPressed(): boolean {
        return this.draggedId === this.item.id;
    }

    private get isDragging(): boolean {
        return (
            this.isPressed &&
            this.hoverId !== undefined &&
            this.hoverId !== this.item.id
        );
    }

    private get isDropTarget(): boolean {
        return (
            this.hoverId === this.item.id &&
            this.draggedId !== undefined &&
            this.draggedId !== this.item.id
        );
    }

    private pointerDown(e: PointerEvent) {
        this.pointerDownAt = Date.now();

        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        this.holdRippleOrigin = {x: e.clientX - rect.left, y: e.clientY - rect.top};

        window.clearTimeout(this.holdTimer);
        this.holdTimer = window.setTimeout(() => {
            this.requestUpdate();
        }, LONG_PRESS_MS);

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

    private pointerEnterOrMove(e: PointerEvent) {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const relativeY = (e.clientY - rect.top) / rect.height;

        let placement: Placement;

        if (relativeY < BEFORE_AFTER_ZONE) {
            placement = "before";
        } else if (relativeY > 1 - BEFORE_AFTER_ZONE) {
            placement = "after";
        } else {
            placement = "inside";
        }

        this.dispatchEvent(
            new CustomEvent("tree-pointer-enter", {
                detail: {id: this.item.id, placement},
                bubbles: true,
                composed: true,
            }),
        );
    }

    private emitPointerUp(pressDurationMs: number) {
        this.dispatchEvent(
            new CustomEvent("tree-pointer-up", {
                detail: {id: this.item.id, pressDurationMs},
                bubbles: true,
                composed: true,
            }),
        );
    }

    private pointerUp() {
        this.clearHoldRipple();

        const pressDurationMs = Date.now() - this.pointerDownAt;
        const wasDragging = this.hoverId !== undefined && this.hoverId !== this.item.id;

        if (pressDurationMs >= LONG_PRESS_MS || wasDragging) {
            this.emitPointerUp(pressDurationMs);
            return;
        }

        // Might be the first click of a double-click - give it a brief
        // window to arrive before committing to a plain toggle.
        window.clearTimeout(this.clickTimer);
        this.clickTimer = window.setTimeout(() => {
            this.emitPointerUp(pressDurationMs);
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

        const rowClasses = {
            row: true,
            pressed: this.isPressed && !this.isDragging,
            dragging: this.isDragging,
            "drop-before": isDropTarget && this.hoverPlacement === "before",
            "drop-after": isDropTarget && this.hoverPlacement === "after",
            "drop-inside": isDropTarget && this.hoverPlacement === "inside",
            completed: this.item.completed,
        };

        const due = formatDue(this.item);
        const hasMeta = due || this.item.description;

        return html`
            <li>

                <div
                    class=${classMap(rowClasses)}

                    @pointerdown=${this.pointerDown}
                    @pointerenter=${this.pointerEnterOrMove}
                    @pointermove=${this.pointerEnterOrMove}
                    @pointerup=${this.pointerUp}
                    @dblclick=${this.onDoubleClick}
                >
                    <div class="row-main">
                        <ha-checkbox .checked=${this.item.completed}></ha-checkbox>
                        <span class="summary">${this.item.title}</span>
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
                                    ${
                                        this.item.description
                                            ? html`<span class="description-text">${this.item.description}</span>`
                                            : ""
                                    }
                                </div>
                            `
                            : ""
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
                </div>

                ${
                    this.item.children.length
                        ? html`
                            <ul>
                                ${this.item.children.map(
                                    child => html`
                                        <todo-overlay-tree-item
                                            .item=${child}
                                            .draggedId=${this.draggedId}
                                            .hoverId=${this.hoverId}
                                            .hoverPlacement=${this.hoverPlacement}
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
