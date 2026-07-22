import {LitElement, html, css} from "lit";
import {customElement, property, state} from "lit/decorators.js";
import {styleMap} from "lit/directives/style-map.js";

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
    setTags,
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
import {BEFORE_AFTER_ZONE} from "./components/todo-tree-item";

import "./components/todo-tree";
import "./components/todo-item-dialog";
import "./components/todo-save-load-dialog";

interface TreeItemElement extends Element {
    item?: TodoItem;
}

type RowSnapshot = {id: string; children: TodoItem[]; rect: DOMRect};

// Recursively collects every rendered row across all nested shadow roots.
// Reaching even the FIRST todo-overlay-tree-item at all means crossing
// several ancestor shadow roots (ha-card, todo-overlay-card,
// todo-overlay-tree) that don't themselves match the selector - so this has
// to walk every element's shadow root, not just the ones that happen to
// match.
function collectAllRows(root: ParentNode): RowSnapshot[] {
    const rows: RowSnapshot[] = [];

    for (const el of Array.from(root.querySelectorAll("*"))) {
        const itemEl = el as TreeItemElement;

        if (el.localName === "todo-overlay-tree-item" && itemEl.item) {
            const rowEl = itemEl.shadowRoot?.querySelector(".row");

            if (rowEl) {
                rows.push({id: itemEl.item.id, children: itemEl.item.children, rect: rowEl.getBoundingClientRect()});
            }
        }

        if (el.shadowRoot) {
            rows.push(...collectAllRows(el.shadowRoot));
        }
    }

    return rows;
}

// "inside" always appends as the LAST child of the anchor (see manager.py's
// move_item), and "after" always inserts as the anchor's next sibling at the
// anchor's OWN level (never as a child of it), regardless of whether that
// anchor has children of its own. For a row with no children, that's fine -
// the middle "inside" zone naturally means "become its (only) child", and
// the bottom "after" zone naturally means "become the next sibling".
//
// For a row that already HAS children, both of those go wrong the same way:
// "inside" appends past every existing child, and "after" jumps below the
// parent's entire subtree - either can render the drop far from wherever
// the pointer actually was, since both existing children sit visually
// between the parent's own row and either target. There's no drop point
// that could ever land there anyway - hovering anywhere below the "before"
// zone on such a row can only sensibly mean "become its new first child",
// so that's the one placement offered for the whole rest of the row.
function resolvePlacement(
    rowId: string,
    rowChildren: TodoItem[],
    relativeY: number,
): {id: string; placement: Placement} {
    if (rowChildren.length > 0) {
        if (relativeY < BEFORE_AFTER_ZONE) {
            return {id: rowId, placement: "before"};
        }

        return {id: rowChildren[0].id, placement: "before"};
    }

    if (relativeY < BEFORE_AFTER_ZONE) {
        return {id: rowId, placement: "before"};
    }

    if (relativeY > 1 - BEFORE_AFTER_ZONE) {
        return {id: rowId, placement: "after"};
    }

    return {id: rowId, placement: "inside"};
}

// Hit-testing against LIVE row positions creates a feedback loop: hovering
// near a boundary opens a "gap" (a margin shift) on the rows next to it,
// which moves those rows' rects, which can put a now-stationary pointer over
// a *different* row's new zone, which opens a different gap, moving things
// again - the drop target oscillates even while the pointer holds still.
// Snapshotting every row's rect once when the drag engages, and hit-testing
// against that frozen snapshot for the rest of the gesture, breaks the loop:
// the coordinates being tested against never move in response to their own
// output. Distance-to-nearest-row (rather than requiring the pointer land
// inside a row's rect) also naturally covers dragging above the first item
// or below the last, where a direct hit would otherwise find nothing.
function findDropTarget(y: number, rows: RowSnapshot[]): {id: string; placement: Placement} | undefined {
    if (rows.length === 0) {
        return undefined;
    }

    let nearest = rows[0];
    let nearestDistance = Infinity;

    for (const row of rows) {
        const distance = y < row.rect.top
            ? row.rect.top - y
            : y > row.rect.bottom
                ? y - row.rect.bottom
                : 0;

        if (distance < nearestDistance) {
            nearest = row;
            nearestDistance = distance;
        }
    }

    const relativeY = (y - nearest.rect.top) / nearest.rect.height;

    return resolvePlacement(nearest.id, nearest.children, relativeY);
}

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

        /* Follows the pointer while an item is being dragged (see
           onDragStart/onGlobalPointerMove) - pointer-events:none is
           essential, not just cosmetic: without it, this element would
           itself be hit by our own elementFromPoint-based hit-testing,
           since it's rendered on top of everything else. */
        .drag-ghost {
            position: fixed;
            z-index: 10;
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 8px 20px;
            border-radius: 4px;
            background: var(--card-background-color, var(--primary-background-color));
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            pointer-events: none;
            font-family: Roboto, "Noto Sans", sans-serif;
            font-size: 14px;
            color: var(--primary-text-color);
        }

        .drag-ghost-title {
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .drag-ghost-quantity {
            flex-shrink: 0;
            font-size: 12px;
            font-weight: 600;
            color: var(--primary-color);
            background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.12);
            padding: 1px 7px;
            border-radius: 10px;
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
    private ghostPosition?: {x: number; y: number};

    private dragGhostOffset = {x: 0, y: 0};
    private dragGhostSize?: {width: number; height: number};
    private rowSnapshot: RowSnapshot[] = [];

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
    //
    // A drag only ever reaches the "live" ghost-follow stage below once
    // the item's own hold threshold has been reached AND the pointer
    // then moves (see todo-tree-item.ts) - so a quick swipe on mobile
    // still scrolls the page normally, and only a sustained hold-then-
    // move actually picks an item up. Once that happens, this component
    // takes over entirely via window-level listeners and its own
    // hit-testing (findDropTarget against a frozen row snapshot, see
    // its own comment for why it's frozen), rather than relying on the
    // dragged item's own bubbled events for hover detection.

    private onPointerDown(e: CustomEvent) {
        this.draggedId = e.detail.id;
    }

    private snapshotRows() {
        this.rowSnapshot = collectAllRows(document).filter(row => row.id !== this.draggedId);
    }

    private onDragStart(e: CustomEvent) {
        const {rect, pointerX, pointerY, grabOffsetX, grabOffsetY} = e.detail;

        // grabOffsetX/Y come from the original press position, not this
        // event's - see the dispatch site in todo-tree-item.ts for why
        // that distinction matters for fast drags.
        this.dragGhostOffset = {x: grabOffsetX ?? 0, y: grabOffsetY ?? 0};
        this.dragGhostSize = rect ? {width: rect.width, height: rect.height} : undefined;
        this.ghostPosition = {x: pointerX, y: pointerY};

        // Captured twice: immediately (approximate - the dragged row's own
        // collapse to its lifted placeholder hasn't rendered yet, since
        // that's queued as a Lit update) and again next frame, once that
        // collapse has actually painted and every other row has settled
        // into its final resting position. Snapshotting only once, before
        // the collapse, would leave every row below the drag origin
        // measured taller than they end up - close enough to work, but the
        // immediate capture exists only so there's never a moment with no
        // snapshot at all (e.g. a release within the same frame it started).
        this.snapshotRows();
        requestAnimationFrame(() => this.snapshotRows());

        // Capture phase: HA's own frontend has various touch/gesture
        // handling that can call stopPropagation() on the way back up,
        // which would otherwise silently swallow these before a
        // bubble-phase window listener ever saw them.
        window.addEventListener("pointermove", this.onGlobalPointerMove, {capture: true});
        window.addEventListener("pointerup", this.onGlobalPointerUp, {capture: true});
        // Touch gestures often end with pointercancel rather than
        // pointerup - both need to finalize the drag the same way, or
        // it gets stuck with dangling listeners. Removed explicitly in
        // onGlobalPointerUp (rather than {once: true} on just one of
        // them) so exactly one clean-up always happens regardless of
        // which event actually fired.
        window.addEventListener("pointercancel", this.onGlobalPointerUp, {capture: true});
    }

    private onGlobalPointerMove = (e: PointerEvent) => {
        this.ghostPosition = {x: e.clientX, y: e.clientY};

        const hit = findDropTarget(e.clientY, this.rowSnapshot);

        this.hoverId = hit && hit.id !== this.draggedId ? hit.id : undefined;
        this.hoverPlacement = hit && hit.id !== this.draggedId ? hit.placement : undefined;
    };

    private onGlobalPointerUp = async () => {
        window.removeEventListener("pointermove", this.onGlobalPointerMove, {capture: true});
        window.removeEventListener("pointerup", this.onGlobalPointerUp, {capture: true});
        window.removeEventListener("pointercancel", this.onGlobalPointerUp, {capture: true});

        const draggedId = this.draggedId;
        const hoverId = this.hoverId;
        const hoverPlacement = this.hoverPlacement;

        this.ghostPosition = undefined;
        this.draggedId = undefined;
        this.hoverId = undefined;
        this.hoverPlacement = undefined;
        this.rowSnapshot = [];

        if (draggedId && hoverId && draggedId !== hoverId) {
            try {
                await moveItem(
                    this.hass,
                    this.config.entity,
                    draggedId,
                    hoverId,
                    hoverPlacement ?? "inside",
                );

                await this.load();
            } catch (err) {
                this.error = err instanceof Error ? err.message : String(err);
            }
        }
    };

    private async onPointerUp(e: CustomEvent) {
        // A real drag never reaches this handler at all (see
        // todo-tree-item.ts's pointerUp) - only a genuine tap, hold, or
        // an ambiguous "moved but never engaged a drag" release do.
        if (!e.detail.moved && this.draggedId && this.list) {
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
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        window.removeEventListener("pointermove", this.onGlobalPointerMove, {capture: true});
        window.removeEventListener("pointerup", this.onGlobalPointerUp, {capture: true});
        window.removeEventListener("pointercancel", this.onGlobalPointerUp, {capture: true});
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
                tags: this.dialogItem.tags.join(", "),
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
        const tags = value.tags
            .split(",")
            .map(tag => tag.trim())
            .filter(tag => tag.length > 0);

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
                await setTags(this.hass, this.config.entity, this.dialogItem.id, tags);
            } else {
                await createItem(this.hass, this.config.entity, {
                    title: value.title,
                    description,
                    dueDate,
                    dueDatetime,
                    quantity,
                    tags,
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
                    @tree-drag-start=${this.onDragStart}
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
                            @tree-drag-start=${this.onDragStart}
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
                @tree-drag-start=${this.onDragStart}
                @tree-pointer-up=${this.onPointerUp}

            ></todo-overlay-tree>
        `;
    }

    private renderDragGhost() {
        if (!this.ghostPosition || !this.draggedId || !this.list) {
            return "";
        }

        const item = findItem(this.list.items, this.draggedId);

        if (!item) {
            return "";
        }

        const left = this.ghostPosition.x - this.dragGhostOffset.x;
        const top = this.ghostPosition.y - this.dragGhostOffset.y;

        return html`
            <div
                class="drag-ghost"
                style=${styleMap({
                    left: `${left}px`,
                    top: `${top}px`,
                    width: this.dragGhostSize ? `${this.dragGhostSize.width}px` : undefined,
                })}
            >
                <ha-checkbox .checked=${item.completed}></ha-checkbox>
                <span class="drag-ghost-title">${item.title}</span>
                ${
                    item.quantity
                        ? html`<span class="drag-ghost-quantity">${item.quantity}</span>`
                        : ""
                }
            </div>
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

            ${this.renderDragGhost()}
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
