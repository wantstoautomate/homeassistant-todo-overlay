import {LitElement, html, css} from "lit";
import {customElement, property} from "lit/decorators.js";

import type {TodoItem} from "../models";

import "./todo-tree-item";

@customElement("todo-tree")
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

    private onPointerDown(e: CustomEvent) {
        this.dispatchEvent(
            new CustomEvent("tree-pointer-down", {
                detail: e.detail,
                bubbles: true,
                composed: true,
            }),
        );
    }

    private onPointerEnter(e: CustomEvent) {
        this.dispatchEvent(
            new CustomEvent("tree-pointer-enter", {
                detail: e.detail,
                bubbles: true,
                composed: true,
            }),
        );
    }

    private onPointerUp(e: CustomEvent) {
        this.dispatchEvent(
            new CustomEvent("tree-pointer-up", {
                detail: e.detail,
                bubbles: true,
                composed: true,
            }),
        );
    }

    render() {
        return html`
            <ul>
                ${this.items.map(
                    item => html`
                        <todo-tree-item
                            .item=${item}
                            @tree-pointer-down=${this.onPointerDown}
                            @tree-pointer-enter=${this.onPointerEnter}
                            @tree-pointer-up=${this.onPointerUp}
                        ></todo-tree-item>
                    `,
                )}
            </ul>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        "todo-tree": TodoTree;
    }
}
