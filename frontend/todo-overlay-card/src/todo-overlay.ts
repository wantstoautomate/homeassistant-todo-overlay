import {LitElement, html, css, TemplateResult} from "lit";
import {customElement, property, state} from "lit/decorators.js";

import {getList, TodoItem, TodoList} from "./api";

@customElement("todo-overlay-card")
export class TodoOverlayCard extends LitElement {

    static styles = css`
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
            cursor: grab;
            user-select: none;
            transition: background 120ms;
        }

        .item.hover {
            background: rgba(33,150,243,.18);
            outline: 2px solid rgb(33,150,243);
        }

        .item:hover {
            background: rgba(255,255,255,0.05);
        }
    `;

    @property({attribute: false})
    public hass: any;

    @property()
    public config: any;

    @state()
    private list?: TodoList;

    @state()
    private dragging?: string;

    @state()
    private hoverItem?: string;

    private pointerDown = false;

    setConfig(config: any) {
        this.config = config;
    }




    protected updated(changed: Map<string, unknown>) {
        if (changed.has("hass") && this.hass && !this.list) {
            this.load();
        }
    }

    private async load() {
        this.list = await getList(
            this.hass,
            this.config.entity,
        );
    }


    private renderItem(item: TodoItem): TemplateResult {
        return html`
            <li data-id="${item.id}">

                <div
                    class="item ${this.hoverItem === item.id ? "hover" : ""}"

                    @pointerdown=${() => {
                        this.pointerDown = true;
                        this.dragging = item.id;
                    }}

                    @pointerenter=${() => {
                        if (this.pointerDown && this.dragging !== item.id) {
                            this.hoverItem = item.id;
                        }
                    }}

                    @pointerleave=${() => {
                        if (this.hoverItem === item.id) {
                            this.hoverItem = undefined;
                        }
                    }}

                    @pointerup=${async () => {

                        if (
                            this.pointerDown &&
                            this.dragging &&
                            this.hoverItem === item.id
                        ) {

                            await setParent(
                                this.hass,
                                this.config.entity,
                                this.dragging,
                                item.id,
                            );

                            await this.load();
                        }

                        this.pointerDown = false;
                        this.dragging = undefined;
                        this.hoverItem = undefined;
                    }}

                >
                    ${item.completed ? "☑" : "☐"}
                    ${item.title}
                </div>

                ${
                    item.children.length
                        ? html`
                            <ul>
                                ${item.children.map(child => this.renderItem(child))}
                            </ul>
                        `
                        : ""
                }

            </li>
        `;
    }

    render() {
        return html`
            <ha-card header="Todo Overlay">
                ${this.list
                    ? html`
                        <ul id="tree">
                            ${this.list.items.map(item => this.renderItem(item))}
                        </ul>
                    `
                    : "Loading..."}
            </ha-card>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        "todo-overlay-card": TodoOverlayCard;
    }
}
