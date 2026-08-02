import {LitElement, html, css} from "lit";
import {customElement, property, state} from "lit/decorators.js";

import type {HassLike} from "../hass";
import type {SortBy, SortOrder} from "../sort";
import type {TodoOverlayCardConfig} from "../todo-overlay";

const EMPTY_CONFIG: TodoOverlayCardConfig = {entity: ""};

// ha-entities-picker (the multi-entity picker this needs) isn't loaded by
// HA's frontend upfront - it only gets lazily registered the first time
// something ELSE on the page triggers it, e.g. an entity selector inside
// the automation editor. On a fresh session where this card's editor is
// the first thing to need it, using <ha-entities-picker> directly renders
// an inert, empty custom element with no picker UI at all (confirmed live -
// this is why the entity field was invisible). Going through <ha-selector>
// instead avoids that: it's core dashboard-editor infrastructure that's
// always available, and it lazy-loads whatever picker a given selector
// config needs as part of its own render, rather than assuming it's
// already loaded. A module-level constant, not inlined in the template, so
// its identity stays stable across renders - ha-selector's internal picker
// can otherwise treat a fresh object every render as a config change.
const ENTITY_SELECTOR = {entity: {multiple: true, domain: "todo"}};

// Home Assistant's edit-card dialog instantiates this directly (via
// TodoOverlayCard.getConfigElement()), sets .hass, then calls
// setConfig() - never a constructor argument - and listens for
// "config-changed" bubbling up to read back edits. That contract (not
// getters/setters on a `config` property) is what every part of this
// component is built around.
@customElement("todo-overlay-card-editor")
export class TodoOverlayCardEditor extends LitElement {

    static styles = css`
        .field {
            margin-bottom: 16px;
        }

        .row {
            display: flex;
            gap: 16px;
        }

        .row > .field {
            flex: 1;
            min-width: 0;
        }

        .text-field label,
        .select-field label {
            display: block;
            font-size: 12px;
            color: var(--secondary-text-color);
            margin-bottom: 4px;
        }

        .text-field input,
        .select-field select {
            width: 100%;
            box-sizing: border-box;
            font-family: inherit;
            font-size: 14px;
            color: var(--primary-text-color);
            background: none;
            border: none;
            border-bottom: 1px solid var(--divider-color);
            padding: 8px 0;
            outline: none;
        }

        .text-field input:focus,
        .select-field select:focus {
            border-bottom: 2px solid var(--primary-color);
        }

        .section-title {
            font-size: 12px;
            font-weight: 500;
            text-transform: uppercase;
            color: var(--secondary-text-color);
            margin: 24px 0 8px;
        }

        ha-formfield {
            display: block;
        }

        .advanced {
            margin-top: 24px;
        }

        .advanced summary {
            font-size: 12px;
            font-weight: 500;
            text-transform: uppercase;
            color: var(--secondary-text-color);
            cursor: pointer;
        }

        .advanced-content {
            margin-top: 8px;
        }
    `;

    @property({attribute: false})
    hass!: HassLike;

    @state()
    private _config: TodoOverlayCardConfig = EMPTY_CONFIG;

    setConfig(config: TodoOverlayCardConfig) {
        this._config = config;
    }

    private emitConfigChanged(config: TodoOverlayCardConfig) {
        this._config = config;

        this.dispatchEvent(
            new CustomEvent("config-changed", {
                detail: {config},
                bubbles: true,
                composed: true,
            }),
        );
    }

    // Always edited as a list, even when it's a single entry - a config
    // written by hand can still use the older singular `entity` field
    // (TodoOverlayCard's render() falls back to it when `entities` is
    // empty), but any edit made here migrates it to `entities`, since
    // that's the one field capable of expressing both single- and
    // multi-entity configs.
    private get entities(): string[] {
        if (this._config.entities?.length) {
            return this._config.entities;
        }

        return this._config.entity ? [this._config.entity] : [];
    }

    private onEntitiesChanged(e: CustomEvent<{value: string[]}>) {
        const {entity: _entity, ...rest} = this._config;

        this.emitConfigChanged({...rest, entities: e.detail.value});
    }

    private onTitleChanged(e: InputEvent) {
        const value = (e.target as HTMLInputElement).value;

        this.emitConfigChanged({...this._config, title: value || undefined});
    }

    private onSortByChanged(e: Event) {
        const value = (e.target as HTMLSelectElement).value as SortBy;

        this.emitConfigChanged({...this._config, sort_by: value});
    }

    private onSortOrderChanged(e: Event) {
        const value = (e.target as HTMLSelectElement).value as SortOrder;

        this.emitConfigChanged({...this._config, sort_order: value});
    }

    private onSwitchChanged(field: keyof TodoOverlayCardConfig, defaultValue: boolean) {
        return (e: Event) => {
            const checked = (e.target as HTMLInputElement).checked;

            this.emitConfigChanged({
                ...this._config,
                [field]: checked === defaultValue ? undefined : checked,
            });
        };
    }

    render() {
        const sortBy = this._config.sort_by ?? "manual";

        return html`
            <div class="field">
                <ha-selector
                    .hass=${this.hass}
                    .selector=${ENTITY_SELECTOR}
                    .value=${this.entities}
                    label="Todo entities"
                    @value-changed=${this.onEntitiesChanged}
                ></ha-selector>
            </div>

            <div class="field text-field">
                <label for="todo-overlay-title">Title</label>
                <input
                    id="todo-overlay-title"
                    type="text"
                    placeholder="Todo Overlay"
                    .value=${this._config.title ?? ""}
                    @input=${this.onTitleChanged}
                />
            </div>

            <div class="section-title">Sorting</div>

            <div class="row">
                <div class="field select-field">
                    <label for="todo-overlay-sort-by">Sort by</label>
                    <select id="todo-overlay-sort-by" .value=${sortBy} @change=${this.onSortByChanged}>
                        <option value="manual">Manual (drag and drop)</option>
                        <option value="title">Title</option>
                        <option value="due_date">Due date</option>
                    </select>
                </div>

                ${
                    sortBy !== "manual"
                        ? html`
                            <div class="field select-field">
                                <label for="todo-overlay-sort-order">Order</label>
                                <select
                                    id="todo-overlay-sort-order"
                                    .value=${this._config.sort_order ?? "asc"}
                                    @change=${this.onSortOrderChanged}
                                >
                                    <option value="asc">Ascending</option>
                                    <option value="desc">Descending</option>
                                </select>
                            </div>
                        `
                        : ""
                }
            </div>

            <div class="section-title">Behavior</div>

            <ha-formfield label="Hide complete checkbox for parents">
                <ha-switch
                    .checked=${this._config.hide_complete_for_parents ?? true}
                    @change=${this.onSwitchChanged("hide_complete_for_parents", true)}
                ></ha-switch>
            </ha-formfield>

            <ha-formfield label="Show checkboxes">
                <ha-switch
                    .checked=${this._config.show_checkboxes ?? false}
                    @change=${this.onSwitchChanged("show_checkboxes", false)}
                ></ha-switch>
            </ha-formfield>

            <div class="section-title">Show</div>

            <ha-formfield label="Clear completed button">
                <ha-switch
                    .checked=${this._config.show_clear_completed_button ?? true}
                    @change=${this.onSwitchChanged("show_clear_completed_button", true)}
                ></ha-switch>
            </ha-formfield>

            <ha-formfield label="Quick-add bar">
                <ha-switch
                    .checked=${this._config.show_quick_add ?? true}
                    @change=${this.onSwitchChanged("show_quick_add", true)}
                ></ha-switch>
            </ha-formfield>

            <details class="advanced">
                <summary>Advanced</summary>
                <div class="advanced-content">
                    <ha-formfield label="Move completed items to the bottom">
                        <ha-switch
                            .checked=${this._config.move_completed_items ?? false}
                            @change=${this.onSwitchChanged("move_completed_items", false)}
                        ></ha-switch>
                    </ha-formfield>

                    <ha-formfield label="Confirm before deleting an item">
                        <ha-switch
                            .checked=${this._config.confirm_delete ?? true}
                            @change=${this.onSwitchChanged("confirm_delete", true)}
                        ></ha-switch>
                    </ha-formfield>

                    <ha-formfield label="Save/load list buttons">
                        <ha-switch
                            .checked=${this._config.show_save_load_buttons ?? true}
                            @change=${this.onSwitchChanged("show_save_load_buttons", true)}
                        ></ha-switch>
                    </ha-formfield>

                    <ha-formfield label="Filter icon in toolbar">
                        <ha-switch
                            .checked=${this._config.show_filter_menu ?? false}
                            @change=${this.onSwitchChanged("show_filter_menu", false)}
                        ></ha-switch>
                    </ha-formfield>

                    <ha-formfield label="Reorder-mode toggle (touch devices only)">
                        <ha-switch
                            .checked=${this._config.show_reorder_toggle ?? true}
                            @change=${this.onSwitchChanged("show_reorder_toggle", true)}
                        ></ha-switch>
                    </ha-formfield>
                </div>
            </details>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        "todo-overlay-card-editor": TodoOverlayCardEditor;
    }
}
