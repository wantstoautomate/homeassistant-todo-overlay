import {LitElement, html, css} from "lit";
import {customElement, property} from "lit/decorators.js";

import type {TodoItem} from "../models";

@customElement("todo-tree-item")
export class TodoTreeItem extends LitElement {

    static styles = css`
        :host {
            display: block;
        }

        ul {
            list-style: none;
            margin: 0;
            padding-left: 20px;
        }

        li {
            margin: 2px 0;
        }

        .item {
            padding: 6px 10px;
            border-radius: 6px;
            user-select: none;
            cursor: grab;
            transition: background .12s ease;
        }

        .item:hover {
            background: rgba(255,255,255,.05);
        }
    `;

    @property({attribute: false})
    item!: TodoItem;

    private pointerDown() {
        this.dispatchEvent(
            new CustomEvent("tree-pointer-down", {
                detail: {
                    id: this.item.id,
                },
                bubbles: true,
                composed: true,
            }),
        );
    }

    private pointerEnter() {
        this.dispatchEvent(
            new CustomEvent("tree-pointer-enter", {
                detail: {
                    id: this.item.id,
                },
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
                },
                bubbles: true,
                composed: true,
            }),
        );
    }

    render() {
        return html`
            <li>

                <div
                    class="item"

                    @pointerdown=${this.pointerDown}
                    @pointerenter=${this.pointerEnter}
                    @pointerup=${this.pointerUp}
                >
                    ${this.item.completed ? "☑" : "☐"}
                    ${this.item.title}
                </div>

                ${
                    this.item.children.length
                        ? html`
                            <ul>
                                ${this.item.children.map(
                                    child => html`
                                        <todo-tree-item
                                            .item=${child}
                                        ></todo-tree-item>
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
        "todo-tree-item": TodoTreeItem;
    }
}
