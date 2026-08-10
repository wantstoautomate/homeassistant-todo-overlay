import {LitElement, html, css} from "lit";
import {customElement, property} from "lit/decorators.js";

// A small, generic yes/no confirmation dialog - currently only used
// for "delete all items" (see todo-overlay-list.ts's clear-all hold
// gesture), but kept generic (heading/message/confirmLabel as props,
// dialog-confirm/dialog-close as the only events) rather than named
// after that one use, since any future destructive action that needs
// an "are you sure?" step can reuse it as-is.
@customElement("todo-overlay-confirm-dialog")
export class TodoConfirmDialog extends LitElement {

    static styles = css`
        p {
            font-family: Roboto, "Noto Sans", sans-serif;
            font-size: 14px;
            color: var(--primary-text-color);
            margin: 0;
        }

        .actions {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            width: 100%;
            gap: 8px;
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
        }
    `;

    @property({attribute: false})
    heading = "Are you sure?";

    @property({attribute: false})
    message = "";

    @property({attribute: false})
    confirmLabel = "Confirm";

    private close() {
        this.dispatchEvent(
            new CustomEvent("dialog-close", {bubbles: true, composed: true}),
        );
    }

    private confirm() {
        this.dispatchEvent(
            new CustomEvent("dialog-confirm", {bubbles: true, composed: true}),
        );
    }

    render() {
        return html`
            <ha-dialog open .heading=${this.heading} @closed=${this.close}>
                <p>${this.message}</p>
                <div class="actions" slot="footer">
                    <button @click=${this.close}>Cancel</button>
                    <button class="destructive" @click=${this.confirm}>${this.confirmLabel}</button>
                </div>
            </ha-dialog>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        "todo-overlay-confirm-dialog": TodoConfirmDialog;
    }
}
