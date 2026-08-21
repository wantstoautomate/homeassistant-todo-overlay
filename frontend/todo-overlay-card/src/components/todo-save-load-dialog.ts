import {LitElement, html, css} from "lit";
import {customElement, property, state} from "lit/decorators.js";

import type {LoadMode, TodoItem} from "../models";

export interface SaveLoadFormValue {
    name: string;
    persistStates: boolean;
    mode: LoadMode;
    // "" means "load at the list's own root" - a plain string, not
    // string | undefined, so it sits in the same draftValue shape every
    // other field here already uses. The id of whatever was picked in
    // the "Load into" browser below - only meaningful for "load".
    targetItem: string;
}

export const EMPTY_SAVE_LOAD_VALUE: SaveLoadFormValue = {
    name: "",
    persistStates: false,
    mode: "merge",
    targetItem: "",
};

const MODE_LABELS: Record<LoadMode, string> = {
    merge: "Merge (skip items already there)",
    full_merge: "Add all (allow duplicates)",
    replace: "Replace (clear the list first)",
};

// Live-reported: an earlier version offered "Load into" as a single
// flat <select> with every item indented by depth - reads as an
// unreadable wall once a list has any real nesting. This is a
// breadcrumb file-explorer instead: one level of the real tree at a
// time, entered depth-first, closer to a folder picker than a <select>.
const CHEVRON_ICON = html`
    <svg viewBox="0 0 24 24">
        <path d="M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z"></path>
    </svg>
`;

const CHECK_ICON = html`
    <svg viewBox="0 0 24 24">
        <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"></path>
    </svg>
`;

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

        .field-hint {
            font-size: 12px;
            color: var(--secondary-text-color);
            margin-top: 2px;
        }

        /* --- "Load into" breadcrumb picker ------------------------- */

        .target-summary {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            width: 100%;
            box-sizing: border-box;
            border: 1px solid var(--divider-color);
            border-radius: 8px;
            padding: 8px 10px;
            font-family: inherit;
            font-size: 14px;
            color: var(--primary-text-color);
            background: none;
            text-transform: none;
            text-align: left;
            cursor: pointer;
        }

        .target-summary:hover {
            background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.04);
        }

        .target-summary .value {
            flex: 1;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .target-summary .value .muted {
            color: var(--secondary-text-color);
        }

        .target-summary .change {
            flex-shrink: 0;
            font-size: 11.5px;
            font-weight: 600;
            letter-spacing: 0.03em;
            color: var(--primary-color);
        }

        .picker {
            margin-top: 6px;
            border: 1px solid var(--divider-color);
            border-radius: 8px;
            overflow: hidden;
        }

        .crumbs {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 2px;
            padding: 8px 10px;
            background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.03);
            border-bottom: 1px solid var(--divider-color);
            font-size: 12.5px;
        }

        .crumbs button {
            font-family: inherit;
            font-size: 12.5px;
            font-weight: 400;
            text-transform: none;
            background: none;
            border: none;
            padding: 2px 4px;
            border-radius: 4px;
            cursor: pointer;
            color: var(--secondary-text-color);
        }

        .crumbs button:not(:disabled):hover {
            background: var(--divider-color);
            color: var(--primary-text-color);
        }

        .crumbs button.current {
            color: var(--primary-text-color);
            font-weight: 600;
            cursor: default;
        }

        .crumbs .sep {
            color: var(--secondary-text-color);
            font-size: 11px;
        }

        .picker-list {
            max-height: 216px;
            overflow-y: auto;
        }

        /* Selects the level currently being browsed ITSELF - the only
           way to target something you've stepped INTO (its own row,
           one level up, only offers stepping in or selecting IT, not
           targeting whatever's already inside it). */
        .pin-row {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 9px 10px;
            cursor: pointer;
            border: none;
            border-bottom: 1px solid var(--divider-color);
            background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.08);
            color: var(--primary-color);
            font-family: inherit;
            font-size: 13px;
            font-weight: 500;
            text-align: left;
            width: 100%;
        }

        .pin-row:hover {
            background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.14);
        }

        .pin-row svg {
            width: 16px;
            height: 16px;
            fill: currentColor;
            flex-shrink: 0;
        }

        .picker-row {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 9px 10px;
        }

        .picker-row:not(:last-child) {
            border-bottom: 1px solid var(--divider-color);
        }

        /* Clicking the title selects THIS item as the target directly -
           leaves included, not just items that already have children -
           any item is a valid parent to load into. The separate
           enter-btn (only shown when there's somewhere to go) steps
           into it instead, without selecting it. */
        .picker-row .title-btn {
            flex: 1;
            min-width: 0;
            text-align: left;
            background: none;
            border: none;
            padding: 0;
            font-family: inherit;
            font-size: 13.5px;
            font-weight: 400;
            text-transform: none;
            color: var(--primary-text-color);
            cursor: pointer;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .picker-row .title-btn:hover {
            color: var(--primary-color);
        }

        .picker-row .enter-btn {
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 26px;
            height: 26px;
            border: none;
            background: none;
            border-radius: 50%;
            padding: 0;
            cursor: pointer;
            color: var(--secondary-text-color);
        }

        .picker-row .enter-btn:hover {
            background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.06);
            color: var(--primary-text-color);
        }

        .picker-row .enter-btn svg {
            width: 18px;
            height: 18px;
            fill: currentColor;
        }

        .picker-empty {
            padding: 14px 10px;
            font-size: 12.5px;
            color: var(--secondary-text-color);
            text-align: center;
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

    // What the parent last handed in - read ONLY by willUpdate() to seed
    // draftValue exactly once. Never read anywhere else. See draftValue's
    // own comment, and todo-item-dialog.ts's identical pattern (this
    // dialog had the exact same bug: typing a save name on mobile could
    // get silently wiped mid-type by an unrelated parent re-render).
    private _seedValue: SaveLoadFormValue = EMPTY_SAVE_LOAD_VALUE;

    // The dialog's own live working copy - seeded exactly once from
    // whatever `value` was set to (see willUpdate()) and never resynced
    // from it afterwards. Every input in this dialog reads from and
    // writes to this, not the incoming `value` assignment directly.
    //
    // Without this, the parent (todo-overlay-list.ts) re-renders for all
    // sorts of reasons that have nothing to do with this dialog (a
    // live-sync reload, a hass state poll tick, an error banner timing
    // out) - and since lit-html always recommits a non-primitive
    // property value regardless of whether its reference actually
    // changed (only primitives are dirty-checked - see
    // PropertyPart._$setValue), every one of those re-renders reasserted
    // `value` right back to whatever the parent was holding, wiping out
    // a save name typed but not yet confirmed. Live-reported: "typing a
    // name to save the list in the mobile browser wipes it
    // occasionally" - mobile's slower/janated render cycle just made an
    // existing race far easier to hit than on desktop.
    @state()
    private draftValue: SaveLoadFormValue = EMPTY_SAVE_LOAD_VALUE;

    @property({attribute: false, hasChanged: () => true})
    set value(newValue: SaveLoadFormValue) {
        this._seedValue = newValue;
    }

    get value(): SaveLoadFormValue {
        return this.draftValue;
    }

    @property({attribute: false})
    savedNames: string[] = [];

    // The list's own real item tree - what the "Load into" browser
    // below walks. Load-only; save has no equivalent field. The real
    // hierarchy, not a pre-flattened list, since the browser only ever
    // shows one level at a time (see currentLevelItems).
    @property({attribute: false})
    items: TodoItem[] = [];

    private valueInitialized = false;

    // Whether the "Load into" browser is currently expanded below its
    // own collapsed summary row - local UI state, not part of
    // draftValue, since it has no bearing on what actually gets
    // submitted.
    @state()
    private pickerOpen = false;

    // The drill-down trail for the "Load into" browser - [] means
    // currently viewing the root. Each entry is the item that was
    // stepped INTO to reach the level now showing; entry N's own
    // children are exactly what's currently listed. Reset to [] every
    // time the browser (re-)opens (see togglePicker) - it isn't part of
    // the submitted value, just where you're currently looking.
    @state()
    private pickerPath: {id: string; title: string}[] = [];

    protected willUpdate(changed: Map<string, unknown>): void {
        if (!changed.has("value") || this.valueInitialized) {
            return;
        }

        this.valueInitialized = true;
        this.draftValue = this._seedValue;
    }

    private findItem(id: string, nodes: TodoItem[] = this.items): TodoItem | undefined {
        for (const node of nodes) {
            if (node.id === id) {
                return node;
            }

            const found = this.findItem(id, node.children);

            if (found) {
                return found;
            }
        }

        return undefined;
    }

    // What the "Load into" browser is currently listing - the root
    // items with an empty pickerPath, or whichever item was last
    // stepped into's own children. Looked up fresh (rather than cached)
    // so it stays correct if `items` itself changes while the dialog is
    // open (e.g. a live-sync reload).
    private get currentLevelItems(): TodoItem[] {
        if (this.pickerPath.length === 0) {
            return this.items;
        }

        const here = this.pickerPath[this.pickerPath.length - 1];

        return this.findItem(here.id)?.children ?? [];
    }

    // The currently-selected target's own title, for the collapsed
    // summary row - resolved by id from `items` rather than carried
    // alongside draftValue.targetItem, since that field only ever holds
    // the id (all the backend needs).
    private get selectedTitle(): string | undefined {
        return this.draftValue.targetItem
            ? this.findItem(this.draftValue.targetItem)?.title
            : undefined;
    }

    private togglePicker() {
        this.pickerOpen = !this.pickerOpen;

        if (this.pickerOpen) {
            this.pickerPath = [];
        }
    }

    private enterItem(id: string, title: string) {
        this.pickerPath = [...this.pickerPath, {id, title}];
    }

    // index 0 means "Top level" itself (an empty path); index N means
    // pickerPath[N - 1] - see renderCrumbs, the only caller.
    private jumpToCrumb(index: number) {
        this.pickerPath = this.pickerPath.slice(0, index);
    }

    private selectTarget(id: string) {
        this.draftValue = {...this.draftValue, targetItem: id};
        this.pickerOpen = false;
    }

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
        this.draftValue = {...this.draftValue, name};
    }

    private updatePersistStates(persistStates: boolean) {
        this.draftValue = {...this.draftValue, persistStates};
    }

    private updateMode(mode: LoadMode) {
        this.draftValue = {...this.draftValue, mode};
    }

    private renderCrumbs() {
        const crumbs = [{id: null as string | null, title: "Top level"}, ...this.pickerPath];

        return crumbs.map((crumb, i) => {
            const isCurrent = i === crumbs.length - 1;

            return html`
                ${i > 0 ? html`<span class="sep">›</span>` : ""}
                <button
                    type="button"
                    class=${isCurrent ? "current" : ""}
                    ?disabled=${isCurrent}
                    @click=${() => this.jumpToCrumb(i)}
                >
                    ${crumb.title}
                </button>
            `;
        });
    }

    private renderPickerList() {
        const here = this.pickerPath[this.pickerPath.length - 1];
        const nodes = this.currentLevelItems;

        return html`
            ${
                here
                    ? html`
                        <button type="button" class="pin-row" @click=${() => this.selectTarget(here.id)}>
                            ${CHECK_ICON}
                            <span>Load into "${here.title}" itself</span>
                        </button>
                    `
                    : ""
            }
            ${
                nodes.length === 0
                    ? html`<div class="picker-empty">No items here yet.</div>`
                    : nodes.map(
                        node => html`
                            <div class="picker-row">
                                <button
                                    type="button"
                                    class="title-btn"
                                    @click=${() => this.selectTarget(node.id)}
                                >
                                    ${node.title}
                                </button>
                                ${
                                    node.children.length > 0
                                        ? html`
                                            <button
                                                type="button"
                                                class="enter-btn"
                                                aria-label="Open ${node.title}"
                                                @click=${() => this.enterItem(node.id, node.title)}
                                            >
                                                ${CHEVRON_ICON}
                                            </button>
                                        `
                                        : ""
                                }
                            </div>
                        `,
                    )
            }
        `;
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
                                    .value=${this.draftValue.name}
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
                                    .checked=${this.draftValue.persistStates}
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
                                    .value=${this.draftValue.name}
                                    @change=${(e: Event) =>
                                        this.updateName((e.target as HTMLSelectElement).value)}
                                >
                                    <option value="" disabled ?selected=${!this.draftValue.name}>
                                        Choose a saved list…
                                    </option>
                                    ${this.savedNames.map(
                                        name => html`
                                            <option value=${name} ?selected=${this.draftValue.name === name}>
                                                ${name}
                                            </option>
                                        `,
                                    )}
                                </select>
                            </div>

                            ${
                                this.draftValue.name
                                    ? html`
                                        <div class="delete-row">
                                            <button @click=${this.requestDeleteSaved}>
                                                Delete "${this.draftValue.name}"
                                            </button>
                                        </div>
                                    `
                                    : ""
                            }

                            <div class="field">
                                <label for="save-load-mode">Mode</label>
                                <select
                                    id="save-load-mode"
                                    .value=${this.draftValue.mode}
                                    @change=${(e: Event) =>
                                        this.updateMode((e.target as HTMLSelectElement).value as LoadMode)}
                                >
                                    ${(Object.keys(MODE_LABELS) as LoadMode[]).map(
                                        mode => html`
                                            <option value=${mode} ?selected=${this.draftValue.mode === mode}>
                                                ${MODE_LABELS[mode]}
                                            </option>
                                        `,
                                    )}
                                </select>
                            </div>

                            <div class="field">
                                <label>Load into</label>

                                <button
                                    type="button"
                                    class="target-summary"
                                    @click=${this.togglePicker}
                                >
                                    <span class="value">
                                        ${
                                            this.selectedTitle
                                                ?? html`<span class="muted">Top level</span>`
                                        }
                                    </span>
                                    <span class="change">${this.pickerOpen ? "Close" : "Browse"}</span>
                                </button>

                                ${
                                    this.pickerOpen
                                        ? html`
                                            <div class="picker">
                                                <div class="crumbs">${this.renderCrumbs()}</div>
                                                <div class="picker-list">${this.renderPickerList()}</div>
                                            </div>
                                        `
                                        : ""
                                }

                                ${
                                    this.draftValue.targetItem && this.draftValue.mode === "replace"
                                        ? html`
                                            <div class="field-hint">
                                                Only this item's own existing children are cleared first -
                                                the rest of the list is untouched.
                                            </div>
                                        `
                                        : ""
                                }
                            </div>
                        `
                }

                <div class="actions" slot="footer">
                    <button @click=${this.close}>Cancel</button>
                    <button @click=${this.confirm} ?disabled=${!this.draftValue.name}>
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
