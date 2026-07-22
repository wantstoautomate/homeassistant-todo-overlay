import {LitElement, html, css} from "lit";
import {customElement, property, state} from "lit/decorators.js";

import {
    type CompletionChange,
    clearCompleted,
    createItem,
    deleteSavedList,
    getList,
    listSaved,
    loadList,
    moveItem,
    restoreCompleted,
    saveList,
    setCompleted,
    setQuantity,
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
import type {SaveLoadFormValue} from "./components/todo-save-load-dialog";
import {EMPTY_SAVE_LOAD_VALUE} from "./components/todo-save-load-dialog";

import "./components/todo-tree";
import "./components/todo-item-dialog";
import "./components/todo-save-load-dialog";

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

        .list-actions {
            display: flex;
            justify-content: flex-end;
            gap: 16px;
            padding: 8px 20px 0;
        }

        .list-actions button {
            border: none;
            background: none;
            font-family: Roboto, "Noto Sans", sans-serif;
            font-size: 12px;
            color: var(--secondary-text-color);
            cursor: pointer;
            padding: 4px;
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

        .section-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 16px 20px 4px;
            font-family: Roboto, "Noto Sans", sans-serif;
            font-size: 14px;
            font-weight: 500;
            color: var(--secondary-text-color);
        }

        .section-header .clear-completed {
            border: none;
            background: none;
            color: var(--primary-color);
            font-family: inherit;
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            padding: 4px;
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

    @state()
    private saveLoadAction?: "save" | "load";

    @state()
    private saveLoadValue: SaveLoadFormValue = EMPTY_SAVE_LOAD_VALUE;

    @state()
    private savedNames: string[] = [];

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
        } else if (!e.detail.moved && this.draggedId && this.list) {
            // Hold-to-edit and drag are mutually exclusive: if the
            // pointer moved but didn't land on a valid drop target
            // (e.g. dragged out and back over itself), this is neither
            // a tap nor a hold - do nothing, rather than guessing.
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

    private async onClearCompleted() {
        try {
            await clearCompleted(this.hass, this.config.entity);
            await this.load();
        } catch (err) {
            this.error = err instanceof Error ? err.message : String(err);
        }
    }

    // --- save / load ---------------------------------------------------

    private async openSaveDialog() {
        try {
            this.savedNames = await listSaved(this.hass);
        } catch (err) {
            this.error = err instanceof Error ? err.message : String(err);
            return;
        }

        this.saveLoadValue = EMPTY_SAVE_LOAD_VALUE;
        this.saveLoadAction = "save";
    }

    private async openLoadDialog() {
        try {
            this.savedNames = await listSaved(this.hass);
        } catch (err) {
            this.error = err instanceof Error ? err.message : String(err);
            return;
        }

        this.saveLoadValue = EMPTY_SAVE_LOAD_VALUE;
        this.saveLoadAction = "load";
    }

    private closeSaveLoadDialog() {
        this.saveLoadAction = undefined;
    }

    private async onSaveLoadConfirm(e: CustomEvent<SaveLoadFormValue>) {
        const value = e.detail;

        try {
            if (this.saveLoadAction === "save") {
                await saveList(this.hass, this.config.entity, value.name, value.persistStates);
            } else {
                await loadList(this.hass, this.config.entity, value.name, value.mode);
            }

            await this.load();
        } catch (err) {
            this.error = err instanceof Error ? err.message : String(err);
        }

        this.closeSaveLoadDialog();
    }

    private async onSaveLoadDeleteSaved(e: CustomEvent<{name: string}>) {
        try {
            await deleteSavedList(this.hass, e.detail.name);
            this.savedNames = await listSaved(this.hass);
            this.saveLoadValue = {...this.saveLoadValue, name: ""};
        } catch (err) {
            this.error = err instanceof Error ? err.message : String(err);
        }
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
                quantity: this.dialogItem.quantity ?? "",
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

        const description = support.description ? value.description : undefined;

        let dueDate: string | undefined;
        let dueDatetime: string | undefined;

        if (support.dueDateTime && value.dueDate && value.dueTime) {
            dueDatetime = `${value.dueDate}T${value.dueTime}:00`;
        } else if (support.dueDate && value.dueDate) {
            dueDate = value.dueDate;
        }

        const quantity = value.quantity.trim() || undefined;

        try {
            if (this.dialogMode === "edit" && this.dialogItem) {
                const serviceData: Record<string, unknown> = {
                    entity_id: this.config.entity,
                    item: this.dialogItem.id,
                    rename: value.title,
                };

                if (description !== undefined) {
                    serviceData.description = description;
                }

                if (dueDatetime) {
                    serviceData.due_datetime = dueDatetime;
                } else if (dueDate) {
                    serviceData.due_date = dueDate;
                }

                await this.hass.callService("todo", "update_item", serviceData);
                await setQuantity(this.hass, this.config.entity, this.dialogItem.id, quantity);
            } else {
                await createItem(this.hass, this.config.entity, {
                    title: value.title,
                    description,
                    dueDate,
                    dueDatetime,
                    quantity,
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

    private renderTree(list: TodoList) {
        const completedItems = list.items.filter(item => item.completed);

        if (completedItems.length === 0) {
            return html`
                <todo-overlay-tree
                    .items=${list.items}
                    .draggedId=${this.draggedId}
                    .hoverId=${this.hoverId}
                    .hoverPlacement=${this.hoverPlacement}

                    @tree-pointer-down=${this.onPointerDown}
                    @tree-pointer-enter=${this.onPointerEnter}
                    @tree-pointer-up=${this.onPointerUp}

                ></todo-overlay-tree>
            `;
        }

        const activeItems = list.items.filter(item => !item.completed);

        return html`
            ${
                activeItems.length
                    ? html`
                        <div class="section-header">Active</div>
                        <todo-overlay-tree
                            .items=${activeItems}
                            .draggedId=${this.draggedId}
                            .hoverId=${this.hoverId}
                            .hoverPlacement=${this.hoverPlacement}

                            @tree-pointer-down=${this.onPointerDown}
                            @tree-pointer-enter=${this.onPointerEnter}
                            @tree-pointer-up=${this.onPointerUp}

                        ></todo-overlay-tree>
                    `
                    : ""
            }

            <div class="section-header">
                <span>Completed</span>
                <button class="clear-completed" @click=${this.onClearCompleted}>
                    Clear completed
                </button>
            </div>
            <todo-overlay-tree
                .items=${completedItems}
                .draggedId=${this.draggedId}
                .hoverId=${this.hoverId}
                .hoverPlacement=${this.hoverPlacement}

                @tree-pointer-down=${this.onPointerDown}
                @tree-pointer-enter=${this.onPointerEnter}
                @tree-pointer-up=${this.onPointerUp}

            ></todo-overlay-tree>
        `;
    }

    render() {
        return html`
            <ha-card header="Todo Overlay">

                <div class="list-actions">
                    <button @click=${this.openSaveDialog}>Save list</button>
                    <button @click=${this.openLoadDialog}>Load list</button>
                </div>

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
                            ? this.renderTree(this.list)
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

            ${
                this.saveLoadAction
                    ? html`
                        <todo-overlay-save-load-dialog
                            .action=${this.saveLoadAction}
                            .value=${this.saveLoadValue}
                            .savedNames=${this.savedNames}

                            @dialog-close=${this.closeSaveLoadDialog}
                            @dialog-confirm=${this.onSaveLoadConfirm}
                            @dialog-delete-saved=${this.onSaveLoadDeleteSaved}
                        ></todo-overlay-save-load-dialog>
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
