import {LitElement, html} from "lit";
import {customElement, property, state} from "lit/decorators.js";

import {getList, setParent} from "./api";
import type {TodoList} from "./models";

import "./components/todo-tree";

@customElement("todo-overlay-card")
export class TodoOverlayCard extends LitElement {

    @property({attribute: false})
    public hass: any;

    @property()
    public config: any;

    @state()
    private list?: TodoList;

    private draggedId?: string;
    private hoverId?: string;

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

    private onPointerDown(e: CustomEvent) {
        this.draggedId = e.detail.id;
    }

    private onPointerEnter(e: CustomEvent) {
        if (!this.draggedId) {
            return;
        }

        this.hoverId = e.detail.id;
    }

    private async onPointerUp() {

        if (
            this.draggedId &&
            this.hoverId &&
            this.draggedId !== this.hoverId
        ) {

            await setParent(
                this.hass,
                this.config.entity,
                this.draggedId,
                this.hoverId,
            );

            await this.load();
        }

        this.draggedId = undefined;
        this.hoverId = undefined;
    }

    render() {
        return html`
            <ha-card header="Todo Overlay">

                ${
                    this.list
                        ? html`
                            <todo-tree
                                .items=${this.list.items}

                                @tree-pointer-down=${this.onPointerDown}
                                @tree-pointer-enter=${this.onPointerEnter}
                                @tree-pointer-up=${this.onPointerUp}

                            ></todo-tree>
                        `
                        : html`
                            <div style="padding:16px">
                                Loading...
                            </div>
                        `
                }

            </ha-card>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        "todo-overlay-card": TodoOverlayCard;
    }
}
