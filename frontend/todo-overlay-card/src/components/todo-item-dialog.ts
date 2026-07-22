import {LitElement, html, css} from "lit";
import {customElement, property} from "lit/decorators.js";

export interface TodoItemFormValue {
    title: string;
    description: string;
    dueDate: string;
    dueTime: string;
}

export interface TodoItemDialogFieldSupport {
    description: boolean;
    dueDate: boolean;
    dueDateTime: boolean;
}

export const EMPTY_FORM_VALUE: TodoItemFormValue = {
    title: "",
    description: "",
    dueDate: "",
    dueTime: "",
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

    private close() {
        this.dispatchEvent(
            new CustomEvent("dialog-close", {bubbles: true, composed: true}),
        );
    }

    private save() {
        this.dispatchEvent(
            new CustomEvent("dialog-save", {
                detail: this.value,
                bubbles: true,
                composed: true,
            }),
        );
    }

    private requestDelete() {
        this.dispatchEvent(
            new CustomEvent("dialog-delete", {bubbles: true, composed: true}),
        );
    }

    private updateField(field: keyof TodoItemFormValue, fieldValue: string) {
        this.value = {...this.value, [field]: fieldValue};
    }

    render() {
        const showDue = this.fieldSupport.dueDate || this.fieldSupport.dueDateTime;

        return html`
            <ha-dialog open .heading=${this.heading} @closed=${this.close}>
                <div class="field">
                    <label for="todo-item-title">Title</label>
                    <input
                        id="todo-item-title"
                        type="text"
                        .value=${this.value.title}
                        @input=${(e: InputEvent) =>
                            this.updateField("title", (e.target as HTMLInputElement).value)}
                    />
                </div>

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
                        `
                        : ""
                }

                <div class="actions" slot="footer">
                    ${
                        this.showDelete
                            ? html`
                                <button class="destructive" @click=${this.requestDelete}>
                                    Delete
                                </button>
                            `
                            : ""
                    }
                    <button @click=${this.save}>
                        Save
                    </button>
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
