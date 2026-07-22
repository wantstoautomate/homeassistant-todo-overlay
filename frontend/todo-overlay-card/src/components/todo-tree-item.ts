import {LitElement, html, css} from "lit";
import {customElement, property} from "lit/decorators.js";
import {classMap} from "lit/directives/class-map.js";

import type {TodoItem} from "../models";

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
            display: flex;
            align-items: center;
            gap: 12px;
            min-height: 40px;
            padding: 0 20px;
            border-radius: 4px;
            outline: 2px solid transparent;
            outline-offset: -2px;
            user-select: none;
            cursor: pointer;
            font-family: Roboto, "Noto Sans", sans-serif;
            font-size: 14px;
            font-weight: 400;
            line-height: 21px;
            color: var(--primary-text-color);
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

        .row.drop-target {
            outline-color: var(--accent-color, var(--primary-color));
            background: rgba(var(--rgb-accent-color, 255, 152, 0), 0.08);
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
    `;

    @property({attribute: false})
    item!: TodoItem;

    @property({attribute: false})
    draggedId?: string;

    @property({attribute: false})
    hoverId?: string;

    private pointerDownAt = 0;

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

    private pointerDown() {
        this.pointerDownAt = Date.now();

        this.dispatchEvent(
            new CustomEvent("tree-pointer-down", {
                detail: {id: this.item.id},
                bubbles: true,
                composed: true,
            }),
        );
    }

    private pointerEnter() {
        this.dispatchEvent(
            new CustomEvent("tree-pointer-enter", {
                detail: {id: this.item.id},
                bubbles: true,
                composed: true,
            }),
        );
    }

    private pointerUp() {
        this.dispatchEvent(
            new CustomEvent("tree-pointer-up", {
                detail: {
                    id: this.item.id,
                    pressDurationMs: Date.now() - this.pointerDownAt,
                },
                bubbles: true,
                composed: true,
            }),
        );
    }

    render() {
        const rowClasses = {
            row: true,
            pressed: this.isPressed && !this.isDragging,
            dragging: this.isDragging,
            "drop-target": this.isDropTarget,
            completed: this.item.completed,
        };

        return html`
            <li>

                <div
                    class=${classMap(rowClasses)}

                    @pointerdown=${this.pointerDown}
                    @pointerenter=${this.pointerEnter}
                    @pointerup=${this.pointerUp}
                >
                    <ha-checkbox .checked=${this.item.completed}></ha-checkbox>
                    <span class="summary">${this.item.title}</span>
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
