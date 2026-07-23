import {LitElement, html, css} from "lit";
import {customElement, property} from "lit/decorators.js";

import type {Placement, TodoItem} from "../models";

import "./todo-tree-item";

@customElement("todo-overlay-tree")
export class TodoTree extends LitElement {

    static styles = css`
        ul {
            list-style: none;
            margin: 0;
            padding: 0;
        }
    `;

    @property({attribute: false})
    items: TodoItem[] = [];

    @property({attribute: false})
    draggedId?: string;

    @property({attribute: false})
    hoverId?: string;

    @property({attribute: false})
    hoverPlacement?: Placement;

    @property({attribute: false})
    hideCompleteForParents = false;

    render() {
        return html`
            <ul>
                ${this.items.map(
                    item => html`
                        <todo-overlay-tree-item
                            .item=${item}
                            .draggedId=${this.draggedId}
                            .hoverId=${this.hoverId}
                            .hoverPlacement=${this.hoverPlacement}
                            .hideCompleteForParents=${this.hideCompleteForParents}
                        ></todo-overlay-tree-item>
                    `,
                )}
            </ul>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        "todo-overlay-tree": TodoTree;
    }
}
