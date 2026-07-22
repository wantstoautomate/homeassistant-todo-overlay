import {LitElement, html} from "lit";
import {customElement, property, state} from "lit/decorators.js";

import {getList, setParent} from "./api";
import type {HassLike} from "./hass";
import type {TodoItem, TodoList} from "./models";

import "./components/todo-tree";

export interface TodoOverlayCardConfig {
    entity: string;
}

const LONG_PRESS_MS = 500;

function findItem(items: TodoItem[], id: string): TodoItem | undefined {
    for (const item of items) {
        if (item.id === id) {
            return item;
        }

        const found = findItem(item.children, id);

        if (found) {
            return found;
        }
    }

    return undefined;
}

@customElement("todo-overlay-card")
export class TodoOverlayCard extends LitElement {

    @property({attribute: false})
    public hass!: HassLike;

    @property()
    public config!: TodoOverlayCardConfig;

    @state()
    private list?: TodoList;

    @state()
    private error?: string;

    @state()
    private draggedId?: string;

    @state()
    private hoverId?: string;

    @state()
    private editingItem?: TodoItem;

    @state()
    private editValue = "";

    setConfig(config: TodoOverlayCardConfig) {
        if (!config.entity) {
            throw new Error("todo-overlay-card: 'entity' is required");
        }

        this.config = config;
    }

    protected updated(changed: Map<string, unknown>) {
        if (changed.has("hass") && this.hass && !this.list && !this.error) {
            this.load();
        }
    }

    private async load() {
        try {
            this.list = await getList(
                this.hass,
                this.config.entity,
            );

            this.error = undefined;
        } catch (err) {
            this.error = err instanceof Error ? err.message : String(err);
        }
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

    private async onPointerUp(e: CustomEvent) {

        if (
            this.draggedId &&
            this.hoverId &&
            this.draggedId !== this.hoverId
        ) {

            try {
                await setParent(
                    this.hass,
                    this.config.entity,
                    this.draggedId,
                    this.hoverId,
                );

                await this.load();
            } catch (err) {
                this.error = err instanceof Error ? err.message : String(err);
            }
        } else if (this.draggedId && this.list) {
            const item = findItem(this.list.items, this.draggedId);

            if (item) {
                const pressDurationMs = e.detail.pressDurationMs as number;

                if (pressDurationMs < LONG_PRESS_MS) {
                    await this.toggleComplete(item);
                } else {
                    this.openEdit(item);
                }
            }
        }

        this.draggedId = undefined;
        this.hoverId = undefined;
    }

    private async toggleComplete(item: TodoItem) {
        try {
            await this.hass.callService("todo", "update_item", {
                entity_id: this.config.entity,
                item: item.id,
                status: item.completed ? "needs_action" : "completed",
            });

            await this.load();
        } catch (err) {
            this.error = err instanceof Error ? err.message : String(err);
        }
    }

    private openEdit(item: TodoItem) {
        this.editingItem = item;
        this.editValue = item.title;
    }

    private closeEdit() {
        this.editingItem = undefined;
    }

    private onEditValueInput(e: InputEvent) {
        this.editValue = (e.target as HTMLInputElement).value;
    }

    private async saveEdit() {
        if (!this.editingItem) {
            return;
        }

        try {
            await this.hass.callService("todo", "update_item", {
                entity_id: this.config.entity,
                item: this.editingItem.id,
                rename: this.editValue,
            });

            this.editingItem = undefined;

            await this.load();
        } catch (err) {
            this.error = err instanceof Error ? err.message : String(err);
        }
    }

    render() {
        return html`
            <ha-card header="Todo Overlay">

                ${
                    this.error
                        ? html`
                            <div style="padding:16px; color: var(--error-color)">
                                ${this.error}
                            </div>
                        `
                        : this.list
                            ? html`
                                <todo-overlay-tree
                                    .items=${this.list.items}
                                    .draggedId=${this.draggedId}
                                    .hoverId=${this.hoverId}

                                    @tree-pointer-down=${this.onPointerDown}
                                    @tree-pointer-enter=${this.onPointerEnter}
                                    @tree-pointer-up=${this.onPointerUp}

                                ></todo-overlay-tree>
                            `
                            : html`
                                <div style="padding:16px">
                                    Loading...
                                </div>
                            `
                }

            </ha-card>

            ${
                this.editingItem
                    ? html`
                        <ha-dialog
                            open
                            heading="Edit item"
                            @closed=${this.closeEdit}
                        >
                            <ha-textfield
                                label="Title"
                                .value=${this.editValue}
                                @input=${this.onEditValueInput}
                            ></ha-textfield>

                            <mwc-button slot="secondaryAction" @click=${this.closeEdit}>
                                Cancel
                            </mwc-button>
                            <mwc-button slot="primaryAction" @click=${this.saveEdit}>
                                Save
                            </mwc-button>
                        </ha-dialog>
                    `
                    : ""
            }
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        "todo-overlay-card": TodoOverlayCard;
    }
}

interface CustomCardEntry {
    type: string;
    name: string;
    description: string;
}

declare global {
    interface Window {
        customCards?: CustomCardEntry[];
    }
}

window.customCards = window.customCards || [];
window.customCards.push({
    type: "todo-overlay-card",
    name: "Todo Overlay",
    description: "Hierarchical overlay for a Home Assistant Todo list.",
});
