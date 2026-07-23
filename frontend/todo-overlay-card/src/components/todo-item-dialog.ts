import {LitElement, html, css} from "lit";
import {customElement, property, state} from "lit/decorators.js";

export interface TodoItemFormValue {
    title: string;
    quantity: string;
    tags: string;
    description: string;
    dueDate: string;
    dueTime: string;
    triggerOnDue: boolean;
}

export interface TodoItemDialogFieldSupport {
    description: boolean;
    dueDate: boolean;
    dueDateTime: boolean;
}

export const EMPTY_FORM_VALUE: TodoItemFormValue = {
    title: "",
    quantity: "",
    tags: "",
    description: "",
    dueDate: "",
    dueTime: "",
    triggerOnDue: false,
};

// The dialog only knows about the fields above today. Extending it for a
// new data field later means: add it to TodoItemFormValue and
// TodoItemDialogFieldSupport, add a matching <input>/<textarea> block in
// render() gated on the new support flag, and read it back out wherever
// TodoOverlayCard handles "dialog-save". Nothing else about this component
// needs to change shape for that.
@customElement("todo-overlay-item-dialog")
export class TodoItemDialog extends LitElement {

    static styles = css`
        .field {
            display: flex;
            flex-direction: column;
            gap: 4px;
            margin-bottom: 16px;
            font-family: Roboto, "Noto Sans", sans-serif;
        }

        .due-row {
            display: flex;
            flex-wrap: wrap;
            gap: 16px;
        }

        .due-row .field {
            flex: 1;
            min-width: 140px;
        }

        .title-row {
            display: flex;
            gap: 16px;
        }

        .title-row .field.title {
            flex: 2;
            min-width: 0;
        }

        .title-row .field.quantity {
            flex: 1;
            min-width: 90px;
        }

        .complete-toggle {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 16px;
            font-family: Roboto, "Noto Sans", sans-serif;
            font-size: 14px;
            color: var(--primary-text-color);
        }

        .complete-toggle ha-checkbox {
            margin-inline-start: -12px;
        }

        label {
            font-size: 12px;
            color: var(--secondary-text-color);
        }

        input,
        textarea {
            box-sizing: border-box;
            width: 100%;
            font-family: inherit;
            font-size: 16px;
            color: var(--primary-text-color);
            background: none;
            border: none;
            border-bottom: 1px solid var(--divider-color);
            padding: 8px 0;
            outline: none;
            /* Without this, the native calendar/clock picker icons render
               black-on-transparent and vanish against a dark theme. */
            color-scheme: light dark;
        }

        input:focus,
        textarea:focus {
            border-bottom: 2px solid var(--primary-color);
            padding-bottom: 7px;
        }

        textarea {
            resize: vertical;
            min-height: 48px;
        }

        .actions {
            display: flex;
            align-items: center;
            width: 100%;
        }

        button {
            font-family: Roboto, "Noto Sans", sans-serif;
            font-size: 14px;
            font-weight: 500;
            text-transform: uppercase;
            border: none;
            background: none;
            cursor: pointer;
            padding: 8px 12px;
            border-radius: 4px;
            color: var(--primary-color);
        }

        button.destructive {
            color: var(--error-color);
            margin-inline-end: auto;
        }

        .confirm-delete {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 8px;
            width: 100%;
            font-family: Roboto, "Noto Sans", sans-serif;
            font-size: 14px;
            color: var(--primary-text-color);
        }

        /* flex-basis 100% forces this onto its own row rather than
           shrinking, so on a narrow (phone) dialog the Cancel/Delete
           buttons wrap onto the next line instead of ever being pushed
           out past the dialog's edge - a real risk with the plain
           flex:1 this used to have, since nothing capped how wide the
           text could push. */
        .confirm-delete span {
            flex: 1 1 100%;
            min-width: 0;
        }

        .field-hint {
            font-size: 12px;
            color: var(--error-color);
            margin-top: -8px;
            margin-bottom: 16px;
            font-family: Roboto, "Noto Sans", sans-serif;
        }

        button:disabled {
            opacity: 0.4;
            cursor: default;
        }
    `;

    @property({attribute: false})
    heading = "Item";

    @property({attribute: false})
    value: TodoItemFormValue = EMPTY_FORM_VALUE;

    @property({attribute: false})
    fieldSupport: TodoItemDialogFieldSupport = {
        description: false,
        dueDate: false,
        dueDateTime: false,
    };

    @property({type: Boolean})
    showDelete = false;

    // Only relevant for an item whose own row hides its completion
    // checkbox (see TodoOverlayCardConfig's hide_complete_for_parents) -
    // this dialog is that item's only way to complete it, so the toggle
    // only renders when it's actually needed.
    @property({type: Boolean})
    showCompleteToggle = false;

    @property({type: Boolean})
    completed = false;

    // Deleting is the one destructive action this dialog can trigger, so
    // it defaults to on - set false to skip straight to dialog-delete, as
    // it always used to.
    @property({type: Boolean})
    confirmDelete = true;

    @state()
    private confirmingDelete = false;

    private close() {
        this.dispatchEvent(
            new CustomEvent("dialog-close", {bubbles: true, composed: true}),
        );
    }

    private save() {
        if (this.triggerOnDueBlocked) {
            return;
        }

        this.dispatchEvent(
            new CustomEvent("dialog-save", {
                detail: this.value,
                bubbles: true,
                composed: true,
            }),
        );
    }

    private requestDelete() {
        if (this.confirmDelete) {
            this.confirmingDelete = true;
            return;
        }

        this.dispatchEvent(
            new CustomEvent("dialog-delete", {bubbles: true, composed: true}),
        );
    }

    private cancelDelete() {
        this.confirmingDelete = false;
    }

    private confirmDeleteNow() {
        this.confirmingDelete = false;

        this.dispatchEvent(
            new CustomEvent("dialog-delete", {bubbles: true, composed: true}),
        );
    }

    private toggleComplete() {
        this.dispatchEvent(
            new CustomEvent("dialog-toggle-complete", {bubbles: true, composed: true}),
        );
    }

    private toggleTriggerOnDue() {
        this.value = {...this.value, triggerOnDue: !this.value.triggerOnDue};
    }

    private updateField(field: keyof Omit<TodoItemFormValue, "triggerOnDue">, fieldValue: string) {
        this.value = {...this.value, [field]: fieldValue};
    }

    // Enabling "trigger on due" without a due time is meaningless - the
    // backend enforces the same rule (see DueTimeRequiredError), but
    // blocking Save here gives immediate feedback instead of a
    // round-trip error.
    private get triggerOnDueBlocked(): boolean {
        return this.value.triggerOnDue && !(this.value.dueDate && this.value.dueTime);
    }

    render() {
        const showDue = this.fieldSupport.dueDate || this.fieldSupport.dueDateTime;

        return html`
            <ha-dialog open .heading=${this.heading} @closed=${this.close}>
                <div class="title-row">
                    <div class="field title">
                        <label for="todo-item-title">Title</label>
                        <input
                            id="todo-item-title"
                            type="text"
                            .value=${this.value.title}
                            @input=${(e: InputEvent) =>
                                this.updateField("title", (e.target as HTMLInputElement).value)}
                        />
                    </div>

                    <div class="field quantity">
                        <label for="todo-item-quantity">Quantity</label>
                        <input
                            id="todo-item-quantity"
                            type="text"
                            placeholder="e.g. 150g"
                            .value=${this.value.quantity}
                            @input=${(e: InputEvent) =>
                                this.updateField("quantity", (e.target as HTMLInputElement).value)}
                        />
                    </div>
                </div>

                ${
                    this.showCompleteToggle
                        ? html`
                            <div class="complete-toggle">
                                <ha-checkbox
                                    .checked=${this.completed}
                                    @click=${this.toggleComplete}
                                ></ha-checkbox>
                                <span>${this.completed ? "Completed" : "Mark complete"}</span>
                            </div>
                        `
                        : ""
                }

                ${
                    this.fieldSupport.description
                        ? html`
                            <div class="field">
                                <label for="todo-item-description">Description</label>
                                <textarea
                                    id="todo-item-description"
                                    .value=${this.value.description}
                                    @input=${(e: InputEvent) =>
                                        this.updateField(
                                            "description",
                                            (e.target as HTMLTextAreaElement).value,
                                        )}
                                ></textarea>
                            </div>
                        `
                        : ""
                }

                <div class="field">
                    <label for="todo-item-tags">Tags</label>
                    <input
                        id="todo-item-tags"
                        type="text"
                        placeholder="e.g. urgent, weekend"
                        .value=${this.value.tags}
                        @input=${(e: InputEvent) =>
                            this.updateField("tags", (e.target as HTMLInputElement).value)}
                    />
                </div>

                ${
                    showDue
                        ? html`
                            <div class="due-row">
                                <div class="field">
                                    <label for="todo-item-due-date">Due date</label>
                                    <input
                                        id="todo-item-due-date"
                                        type="date"
                                        .value=${this.value.dueDate}
                                        @input=${(e: InputEvent) =>
                                            this.updateField(
                                                "dueDate",
                                                (e.target as HTMLInputElement).value,
                                            )}
                                    />
                                </div>

                                ${
                                    this.fieldSupport.dueDateTime
                                        ? html`
                                            <div class="field">
                                                <label for="todo-item-due-time">Due time</label>
                                                <input
                                                    id="todo-item-due-time"
                                                    type="time"
                                                    .value=${this.value.dueTime}
                                                    @input=${(e: InputEvent) =>
                                                        this.updateField(
                                                            "dueTime",
                                                            (e.target as HTMLInputElement).value,
                                                        )}
                                                />
                                            </div>
                                        `
                                        : ""
                                }
                            </div>

                            ${
                                this.fieldSupport.dueDateTime
                                    ? html`
                                        <div class="complete-toggle">
                                            <ha-checkbox
                                                .checked=${this.value.triggerOnDue}
                                                @click=${this.toggleTriggerOnDue}
                                            ></ha-checkbox>
                                            <span>Trigger automation when due</span>
                                        </div>
                                        ${
                                            this.triggerOnDueBlocked
                                                ? html`
                                                    <div class="field-hint">
                                                        Requires a due time to enable
                                                    </div>
                                                `
                                                : ""
                                        }
                                    `
                                    : ""
                            }
                        `
                        : ""
                }

                <div class="actions" slot="footer">
                    ${
                        this.confirmingDelete
                            ? html`
                                <div class="confirm-delete">
                                    <span>Delete this item?</span>
                                    <button @click=${this.cancelDelete}>
                                        Cancel
                                    </button>
                                    <button class="destructive" @click=${this.confirmDeleteNow}>
                                        Delete
                                    </button>
                                </div>
                            `
                            : html`
                                ${
                                    this.showDelete
                                        ? html`
                                            <button class="destructive" @click=${this.requestDelete}>
                                                Delete
                                            </button>
                                        `
                                        : ""
                                }
                                <button @click=${this.save} ?disabled=${this.triggerOnDueBlocked}>
                                    Save
                                </button>
                            `
                    }
                </div>
            </ha-dialog>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        "todo-overlay-item-dialog": TodoItemDialog;
    }
}
