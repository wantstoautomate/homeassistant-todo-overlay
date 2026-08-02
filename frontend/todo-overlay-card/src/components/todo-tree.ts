import {LitElement, html, css} from "lit";
import {customElement, property} from "lit/decorators.js";
import {classMap} from "lit/directives/class-map.js";

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

        /* Rendered instead of the item list when there's nothing in it -
           an empty <ul> has zero height, so without this there'd be
           nothing to see AND nothing for a drag-and-drop to hit-test
           against (see todo-overlay-list.ts's collectAllRows, which
           looks for this element specifically by its data attribute) -
           dragging an item into a list with nothing in it yet would
           have no possible drop target at all otherwise. */
        .empty-drop-zone {
            margin: 4px 8px;
            padding: 16px 12px;
            border: 1px dashed var(--divider-color);
            border-radius: 4px;
            outline: 2px solid transparent;
            outline-offset: -2px;
            text-align: center;
            font-family: Roboto, "Noto Sans", sans-serif;
            font-size: 13px;
            color: var(--secondary-text-color);
            transition: outline-color 0.15s ease, background-color 0.15s ease;
        }

        .empty-drop-zone.drop-target {
            outline-color: var(--accent-color, var(--primary-color));
            background: rgba(var(--rgb-accent-color, 255, 152, 0), 0.08);
            color: var(--primary-text-color);
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

    // True while a drag is hovering this (empty) list as its drop
    // target - see todo-overlay-list.ts's isEmptyDropTarget getter, the
    // only place this is ever set true.
    @property({attribute: false})
    emptyDropHighlight = false;

    @property({attribute: false})
    hideCompleteForParents = false;

    @property({attribute: false})
    showCheckboxes = false;

    @property({attribute: false})
    confirmDelete = true;

    @property({attribute: false})
    dragDisabled = false;

    @property({attribute: false})
    collapsedIds: Set<string> = new Set();

    @property({attribute: false})
    reorderModeActive = false;

    render() {
        return html`
            <ul>
                ${
                    this.items.length === 0
                        ? html`
                            <li>
                                <div
                                    class=${classMap({"empty-drop-zone": true, "drop-target": this.emptyDropHighlight})}
                                    data-empty-drop-zone
                                >
                                    ${this.emptyDropHighlight ? "Drop here" : "No items"}
                                </div>
                            </li>
                        `
                        : this.items.map(
                            item => html`
                                <todo-overlay-tree-item
                                    .item=${item}
                                    .draggedId=${this.draggedId}
                                    .hoverId=${this.hoverId}
                                    .hoverPlacement=${this.hoverPlacement}
                                    .hideCompleteForParents=${this.hideCompleteForParents}
                                    .showCheckboxes=${this.showCheckboxes}
                                    .confirmDelete=${this.confirmDelete}
                                    .dragDisabled=${this.dragDisabled}
                                    .collapsedIds=${this.collapsedIds}
                                    .reorderModeActive=${this.reorderModeActive}
                                ></todo-overlay-tree-item>
                            `,
                        )
                }
            </ul>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        "todo-overlay-tree": TodoTree;
    }
}
