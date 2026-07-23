import {LitElement, html, css} from "lit";
import {customElement, property, state} from "lit/decorators.js";

import type {HassLike} from "../hass";
import type {TodoOverlayCardConfig} from "../todo-overlay";

const EMPTY_CONFIG: TodoOverlayCardConfig = {entity: ""};

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

        .switch-row {
            display: flex;
            align-items: flex-start;
            gap: 12px;
            padding: 8px 0;
        }

        .switch-row ha-switch {
            margin-top: 2px;
            flex-shrink: 0;
        }

        .switch-row .label {
            flex: 1;
            font-family: Roboto, "Noto Sans", sans-serif;
        }

        .switch-row .title {
            font-size: 14px;
            color: var(--primary-text-color);
        }

        .switch-row .description {
            font-size: 12px;
            color: var(--secondary-text-color);
            margin-top: 2px;
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

    private onEntityChanged(e: CustomEvent<{value: string}>) {
        this.emitConfigChanged({...this._config, entity: e.detail.value});
    }

    private onHideCompleteForParentsChanged(e: Event) {
        const checked = (e.target as HTMLInputElement).checked;

        this.emitConfigChanged({
            ...this._config,
            hide_complete_for_parents: checked || undefined,
        });
    }

    render() {
        return html`
            <div class="field">
                <ha-entity-picker
                    .hass=${this.hass}
                    .value=${this._config.entity ?? ""}
                    .includeDomains=${["todo"]}
                    label="Todo entity"
                    required
                    @value-changed=${this.onEntityChanged}
                ></ha-entity-picker>
            </div>

            <div class="switch-row">
                <ha-switch
                    .checked=${this._config.hide_complete_for_parents ?? false}
                    @change=${this.onHideCompleteForParentsChanged}
                ></ha-switch>
                <div class="label">
                    <div class="title">Hide complete checkbox for parents</div>
                    <div class="description">
                        A parent item with children shows no completion checkbox on its
                        own row - ticking a parent normally completes every descendant
                        too. Complete it via its edit dialog (hold the row) instead.
                    </div>
                </div>
            </div>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        "todo-overlay-card-editor": TodoOverlayCardEditor;
    }
}
