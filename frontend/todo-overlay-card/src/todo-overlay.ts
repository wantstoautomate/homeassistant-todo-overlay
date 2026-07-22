import {LitElement, html, css} from "lit";
import {customElement, property, state} from "lit/decorators.js";

import {
    type CompletionChange,
    getList,
    moveItem,
    restoreCompleted,
    setCompleted,
} from "./api";
import type {HassLike} from "./hass";
import {
    LONG_PRESS_MS,
    type Placement,
    type TodoItem,
    type TodoList,
    TodoListEntityFeature,
    supportsFeature,
} from "./models";
import type {TodoItemDialogFieldSupport, TodoItemFormValue} from "./components/todo-item-dialog";
import {EMPTY_FORM_VALUE} from "./components/todo-item-dialog";

import "./components/todo-tree";
import "./components/todo-item-dialog";

export interface TodoOverlayCardConfig {
    entity: string;
}

const UNDO_TIMEOUT_MS = 8000;

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

function splitDueDateTime(iso: string | null): {date: string; time: string} {
    if (!iso) {
        return {date: "", time: ""};
    }

    // "YYYY-MM-DDTHH:mm[:ss...]" -> date/time <input> values, no seconds.
    const [date, time] = iso.split("T");

    return {date: date ?? "", time: (time ?? "").slice(0, 5)};
}

@customElement("todo-overlay-card")
export class TodoOverlayCard extends LitElement {

    static styles = css`
        .quick-add {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 4px 20px 12px;
            font-family: Roboto, "Noto Sans", sans-serif;
        }

        .quick-add input {
            flex: 1;
            font-family: inherit;
            font-size: 14px;
            color: var(--primary-text-color);
            background: none;
            border: none;
            border-bottom: 1px solid var(--divider-color);
            padding: 6px 0;
            outline: none;
        }

        .quick-add input:focus {
            border-bottom: 2px solid var(--primary-color);
            padding-bottom: 5px;
        }

        .quick-add button {
            border: none;
            background: none;
            font-family: inherit;
            cursor: pointer;
        }

        .quick-add .add {
            color: var(--primary-color);
            font-weight: 500;
        }

        .quick-add .details {
            color: var(--secondary-text-color);
            font-size: 12px;
        }

        .undo-snackbar {
            position: fixed;
            bottom: 16px;
            left: 50%;
            transform: translateX(-50%);
            display: flex;
            align-items: center;
            gap: 16px;
            padding: 12px 16px;
            border-radius: 4px;
            background: var(--primary-text-color);
            color: var(--primary-background-color);
            font-family: Roboto, "Noto Sans", sans-serif;
            font-size: 14px;
            z-index: 10;
        }

        .undo-snackbar button {
            border: none;
            background: none;
            color: var(--primary-color);
            font-family: inherit;
            font-weight: 600;
            text-transform: uppercase;
            cursor: pointer;
        }
    `;

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
    private hoverPlacement?: Placement;

    @state()
    private dialogMode?: "create" | "edit";

    @state()
    private dialogItem?: TodoItem;

    @state()
    private quickAddValue = "";

    @state()
    private undoState?: {message: string; changes: CompletionChange[]};

    private undoTimer?: number;
    private lastEntityUpdate?: string;

    setConfig(config: TodoOverlayCardConfig) {
        if (!config.entity) {
            throw new Error("todo-overlay-card: 'entity' is required");
        }

        this.config = config;
    }

    protected updated(changed: Map<string, unknown>) {
        if (!changed.has("hass") || !this.hass || !this.config) {
            return;
        }

        // hass updates on every state change globally, not just for our
        // entity - only reload when the entity itself actually changed,
        // so edits made elsewhere (the native card, automations, voice)
        // show up here too instead of only reacting to our own actions.
        const entityUpdate = this.hass.states[this.config.entity]?.last_updated;
        const entityChanged = entityUpdate !== undefined && entityUpdate !== this.lastEntityUpdate;
        this.lastEntityUpdate = entityUpdate;

        if (!this.list && !this.error) {
            this.load();
        } else if (entityChanged) {
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

    private get fieldSupport(): TodoItemDialogFieldSupport {
        const supportedFeatures = this.hass.states[this.config.entity]
            ?.attributes.supported_features;

        return {
            description: supportsFeature(supportedFeatures, TodoListEntityFeature.SET_DESCRIPTION_ON_ITEM),
            dueDate: supportsFeature(supportedFeatures, TodoListEntityFeature.SET_DUE_DATE_ON_ITEM),
            dueDateTime: supportsFeature(supportedFeatures, TodoListEntityFeature.SET_DUE_DATETIME_ON_ITEM),
        };
    }

    // --- drag / tap / hold ---------------------------------------------

    private onPointerDown(e: CustomEvent) {
        this.draggedId = e.detail.id;
    }

    private onPointerEnter(e: CustomEvent) {
        if (!this.draggedId) {
            return;
        }

        this.hoverId = e.detail.id;
        this.hoverPlacement = e.detail.placement;
    }

    private async onPointerUp(e: CustomEvent) {

        if (
            this.draggedId &&
            this.hoverId &&
            this.draggedId !== this.hoverId
        ) {

            try {
                await moveItem(
                    this.hass,
                    this.config.entity,
                    this.draggedId,
                    this.hoverId,
                    this.hoverPlacement ?? "inside",
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
                    this.openEditDialog(item);
                }
            }
        }

        this.draggedId = undefined;
        this.hoverId = undefined;
        this.hoverPlacement = undefined;
    }

    // --- completion + cascade undo --------------------------------------

    private async toggleComplete(item: TodoItem) {
        try {
            const changes = await setCompleted(
                this.hass,
                this.config.entity,
                item.id,
                !item.completed,
            );

            await this.load();

            if (changes.length > 1) {
                this.showUndo(
                    `Marked ${changes.length} items ${!item.completed ? "complete" : "incomplete"}`,
                    changes,
                );
            }
        } catch (err) {
            this.error = err instanceof Error ? err.message : String(err);
        }
    }

    private showUndo(message: string, changes: CompletionChange[]) {
        window.clearTimeout(this.undoTimer);

        this.undoState = {message, changes};

        this.undoTimer = window.setTimeout(() => {
            this.undoState = undefined;
        }, UNDO_TIMEOUT_MS);
    }

    private async onUndo() {
        if (!this.undoState) {
            return;
        }

        window.clearTimeout(this.undoTimer);

        try {
            await restoreCompleted(this.hass, this.config.entity, this.undoState.changes);
            await this.load();
        } catch (err) {
            this.error = err instanceof Error ? err.message : String(err);
        }

        this.undoState = undefined;
    }

    // --- add / edit / delete dialog --------------------------------------

    private openEditDialog(item: TodoItem) {
        this.dialogMode = "edit";
        this.dialogItem = item;
    }

    private openCreateDialog() {
        this.dialogMode = "create";
        this.dialogItem = undefined;
    }

    private closeDialog() {
        this.dialogMode = undefined;
        this.dialogItem = undefined;
    }

    private dialogValue(): TodoItemFormValue {
        if (this.dialogMode === "edit" && this.dialogItem) {
            const due = this.dialogItem.due_datetime
                ? splitDueDateTime(this.dialogItem.due_datetime)
                : {date: this.dialogItem.due_date ?? "", time: ""};

            return {
                title: this.dialogItem.title,
                description: this.dialogItem.description ?? "",
                dueDate: due.date,
                dueTime: due.time,
            };
        }

        return EMPTY_FORM_VALUE;
    }

    private async onDialogSave(e: CustomEvent<TodoItemFormValue>) {
        const value = e.detail;
        const support = this.fieldSupport;

        const serviceData: Record<string, unknown> = {
            entity_id: this.config.entity,
        };

        if (support.description) {
            serviceData.description = value.description;
        }

        if (support.dueDateTime && value.dueDate && value.dueTime) {
            serviceData.due_datetime = `${value.dueDate}T${value.dueTime}:00`;
        } else if (support.dueDate && value.dueDate) {
            serviceData.due_date = value.dueDate;
        }

        try {
            if (this.dialogMode === "edit" && this.dialogItem) {
                await this.hass.callService("todo", "update_item", {
                    ...serviceData,
                    item: this.dialogItem.id,
                    rename: value.title,
                });
            } else {
                await this.hass.callService("todo", "add_item", {
                    ...serviceData,
                    item: value.title,
                });
            }

            await this.load();
        } catch (err) {
            this.error = err instanceof Error ? err.message : String(err);
        }

        this.closeDialog();
    }

    private async onDialogDelete() {
        if (!this.dialogItem) {
            return;
        }

        try {
            await this.hass.callService("todo", "remove_item", {
                entity_id: this.config.entity,
                item: this.dialogItem.id,
            });

            await this.load();
        } catch (err) {
            this.error = err instanceof Error ? err.message : String(err);
        }

        this.closeDialog();
    }

    // --- quick add ---------------------------------------------------

    private onQuickAddInput(e: InputEvent) {
        this.quickAddValue = (e.target as HTMLInputElement).value;
    }

    private onQuickAddKeydown(e: KeyboardEvent) {
        if (e.key === "Enter") {
            this.submitQuickAdd();
        }
    }

    private async submitQuickAdd() {
        const title = this.quickAddValue.trim();

        if (!title) {
            return;
        }

        try {
            await this.hass.callService("todo", "add_item", {
                entity_id: this.config.entity,
                item: title,
            });

            this.quickAddValue = "";

            await this.load();
        } catch (err) {
            this.error = err instanceof Error ? err.message : String(err);
        }
    }

    render() {
        return html`
            <ha-card header="Todo Overlay">

                <div class="quick-add">
                    <input
                        type="text"
                        placeholder="Add item"
                        .value=${this.quickAddValue}
                        @input=${this.onQuickAddInput}
                        @keydown=${this.onQuickAddKeydown}
                    />
                    <button class="add" @click=${this.submitQuickAdd}>
                        Add
                    </button>
                    <button class="details" @click=${this.openCreateDialog}>
                        Details…
                    </button>
                </div>

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
                                    .hoverPlacement=${this.hoverPlacement}

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
                this.undoState
                    ? html`
                        <div class="undo-snackbar">
                            <span>${this.undoState.message}</span>
                            <button @click=${this.onUndo}>
                                Undo
                            </button>
                        </div>
                    `
                    : ""
            }

            ${
                this.dialogMode
                    ? html`
                        <todo-overlay-item-dialog
                            .heading=${this.dialogMode === "edit" ? "Edit item" : "Add item"}
                            .value=${this.dialogValue()}
                            .fieldSupport=${this.fieldSupport}
                            ?showDelete=${this.dialogMode === "edit"}

                            @dialog-close=${this.closeDialog}
                            @dialog-save=${this.onDialogSave}
                            @dialog-delete=${this.onDialogDelete}
                        ></todo-overlay-item-dialog>
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
