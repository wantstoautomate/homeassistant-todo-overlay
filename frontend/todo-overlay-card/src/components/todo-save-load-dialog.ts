import {LitElement, html, css} from "lit";
import {customElement, property} from "lit/decorators.js";

import type {LoadMode} from "../models";

export interface SaveLoadFormValue {
    name: string;
    persistStates: boolean;
    mode: LoadMode;
}

export const EMPTY_SAVE_LOAD_VALUE: SaveLoadFormValue = {
    name: "",
    persistStates: false,
    mode: "merge",
};

const MODE_LABELS: Record<LoadMode, string> = {
    merge: "Merge (skip items already there)",
    full_merge: "Add all (allow duplicates)",
    replace: "Replace (clear the list first)",
};

@customElement("todo-overlay-save-load-dialog")
export class TodoSaveLoadDialog extends LitElement {

    static styles = css`
        .field {
            display: flex;
            flex-direction: column;
            gap: 4px;
            margin-bottom: 16px;
            font-family: Roboto, "Noto Sans", sans-serif;
        }

        label {
            font-size: 12px;
            color: var(--secondary-text-color);
        }

        input,
        select {
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
            color-scheme: light dark;
        }

        input:focus,
        select:focus {
            border-bottom: 2px solid var(--primary-color);
            padding-bottom: 7px;
        }

        .checkbox-field {
            flex-direction: row;
            align-items: center;
            gap: 8px;
        }

        .checkbox-field input {
            width: auto;
            border: none;
        }

        .checkbox-field label {
            font-size: 14px;
            color: var(--primary-text-color);
        }

        .delete-row {
            display: flex;
            justify-content: flex-end;
            margin-top: -8px;
            margin-bottom: 16px;
        }

        .delete-row button {
            font-family: inherit;
            font-size: 12px;
            color: var(--error-color);
            background: none;
            border: none;
            cursor: pointer;
            padding: 4px;
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

        button:disabled {
            color: var(--disabled-text-color);
            cursor: default;
        }
    `;

    @property({attribute: false})
    action: "save" | "load" = "save";

    @property({attribute: false})
    value: SaveLoadFormValue = EMPTY_SAVE_LOAD_VALUE;

    @property({attribute: false})
    savedNames: string[] = [];

    private close() {
        this.dispatchEvent(
            new CustomEvent("dialog-close", {bubbles: true, composed: true}),
        );
    }

    private confirm() {
        this.dispatchEvent(
            new CustomEvent("dialog-confirm", {
                detail: this.value,
                bubbles: true,
                composed: true,
            }),
        );
    }

    private requestDeleteSaved() {
        this.dispatchEvent(
            new CustomEvent("dialog-delete-saved", {
                detail: {name: this.value.name},
                bubbles: true,
                composed: true,
            }),
        );
    }

    private updateName(name: string) {
        this.value = {...this.value, name};
    }

    private updatePersistStates(persistStates: boolean) {
        this.value = {...this.value, persistStates};
    }

    private updateMode(mode: LoadMode) {
        this.value = {...this.value, mode};
    }

    render() {
        const isSave = this.action === "save";

        return html`
            <ha-dialog open .heading=${isSave ? "Save list" : "Load list"} @closed=${this.close}>
                ${
                    isSave
                        ? html`
                            <div class="field">
                                <label for="save-load-name">Name</label>
                                <input
                                    id="save-load-name"
                                    type="text"
                                    list="save-load-existing-names"
                                    placeholder="e.g. weekly_groceries"
                                    .value=${this.value.name}
                                    @input=${(e: InputEvent) =>
                                        this.updateName((e.target as HTMLInputElement).value)}
                                />
                                <datalist id="save-load-existing-names">
                                    ${this.savedNames.map(name => html`<option value=${name}></option>`)}
                                </datalist>
                            </div>

                            <div class="field checkbox-field">
                                <input
                                    id="save-load-persist"
                                    type="checkbox"
                                    .checked=${this.value.persistStates}
                                    @change=${(e: Event) =>
                                        this.updatePersistStates((e.target as HTMLInputElement).checked)}
                                />
                                <label for="save-load-persist">Persist completion states</label>
                            </div>
                        `
                        : html`
                            <div class="field">
                                <label for="save-load-select">Saved list</label>
                                <select
                                    id="save-load-select"
                                    .value=${this.value.name}
                                    @change=${(e: Event) =>
                                        this.updateName((e.target as HTMLSelectElement).value)}
                                >
                                    <option value="" disabled ?selected=${!this.value.name}>
                                        Choose a saved list…
                                    </option>
                                    ${this.savedNames.map(
                                        name => html`
                                            <option value=${name} ?selected=${this.value.name === name}>
                                                ${name}
                                            </option>
                                        `,
                                    )}
                                </select>
                            </div>

                            ${
                                this.value.name
                                    ? html`
                                        <div class="delete-row">
                                            <button @click=${this.requestDeleteSaved}>
                                                Delete "${this.value.name}"
                                            </button>
                                        </div>
                                    `
                                    : ""
                            }

                            <div class="field">
                                <label for="save-load-mode">Mode</label>
                                <select
                                    id="save-load-mode"
                                    .value=${this.value.mode}
                                    @change=${(e: Event) =>
                                        this.updateMode((e.target as HTMLSelectElement).value as LoadMode)}
                                >
                                    ${(Object.keys(MODE_LABELS) as LoadMode[]).map(
                                        mode => html`
                                            <option value=${mode} ?selected=${this.value.mode === mode}>
                                                ${MODE_LABELS[mode]}
                                            </option>
                                        `,
                                    )}
                                </select>
                            </div>
                        `
                }

                <div class="actions" slot="footer">
                    <button @click=${this.close}>Cancel</button>
                    <button @click=${this.confirm} ?disabled=${!this.value.name}>
                        ${isSave ? "Save" : "Load"}
                    </button>
                </div>
            </ha-dialog>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        "todo-overlay-save-load-dialog": TodoSaveLoadDialog;
    }
}
