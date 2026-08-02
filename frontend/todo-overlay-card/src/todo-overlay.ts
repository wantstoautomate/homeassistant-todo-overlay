import {LitElement, html, css, nothing} from "lit";
import {customElement, property} from "lit/decorators.js";

import type {HassLike} from "./hass";
import type {SortBy, SortOrder} from "./sort";

import "./components/todo-overlay-list";
import "./components/todo-overlay-card-editor";

export interface TodoOverlayCardConfig {
    // Required unless `entities` is set instead - the two are mutually
    // exclusive modes, not combinable (see setConfig()).
    entity?: string;
    // When set (non-empty), the card shows one independent, entity-scoped
    // list per entry instead of a single list - each gets its own section
    // heading (the entity's friendly name) and behaves exactly like a
    // single-entity card would on its own, including its own drag-and-drop,
    // quick-add, and save/load. There is no cross-entity dragging: an item
    // can only move within the entity it already belongs to, since the
    // backend's hierarchy/positions are stored per entity and native todo
    // items belong to exactly one list at the Home Assistant level.
    entities?: string[];
    // Overrides the card's header text. Defaults to "Todo Overlay" in
    // single-entity mode; in multi-entity mode, omitted entirely unless
    // set (the per-entity section headings already label each list).
    title?: string;
    // When set (defaults to true), a parent item with children shows no
    // completion checkbox on its own row at all - ticking a parent
    // normally cascades to every descendant, which is easy to trigger by
    // accident on a row that's mostly there to show hierarchy rather
    // than be completed itself. With this on, the only way to complete
    // such an item is a deliberate one: hold the row to open its edit
    // dialog, which gets a "Mark complete" toggle in place of the row's
    // own (hidden) checkbox - or tap the row, which toggles collapse
    // instead of completion for a row with no checkbox to tap.
    hide_complete_for_parents?: boolean;
    // Off by default - a row's completion checkbox is purely a visual
    // affordance (tapping anywhere on the row already completes it, see
    // todo-overlay-list.ts's onPointerUp), so most configs don't need
    // the extra glyph at all. Turn this on to show it anyway.
    show_checkboxes?: boolean;
    // When set (off by default), completing/uncompleting an item
    // repositions it to the boundary of its own sibling group (newly-
    // completed to the top of the completed ones, newly-uncompleted to
    // the bottom of the incomplete ones) and splits the list into
    // separate Active/Completed sections. Off by default: a checkbox tap
    // just flips the check, full stop - nothing about the item's
    // position or grouping changes.
    move_completed_items?: boolean;
    // "manual" (the default) is drag-and-drop order, stored per item in
    // the backend. Any other value re-sorts the displayed tree on the fly
    // without touching that stored order - switching back to "manual"
    // always restores exactly what dragging last left it as. Drag-to-
    // reorder is disabled while a non-manual sort is active, since the
    // position an item visually lands in would have nothing to do with
    // where it was dropped.
    sort_by?: SortBy;
    sort_order?: SortOrder;
    // Deleting an item asks for confirmation first unless this is set to
    // false.
    confirm_delete?: boolean;
    // Visibility of UI that's shown by default - all opt-out, not opt-in,
    // so an existing config with none of these set keeps behaving exactly
    // as it already does.
    show_clear_completed_button?: boolean;
    show_save_load_buttons?: boolean;
    show_quick_add?: boolean;
    // Opt-in (unlike the show_* flags above) since it's new UI an existing
    // card has never shown before, not a pre-existing element being hidden.
    show_filter_menu?: boolean;
    // On by default (unlike show_filter_menu) since this is the fix for
    // existing broken functionality, not a purely optional add-on: a
    // touchscreen has no reliable way to distinguish "hold this row to
    // drag it" from "scroll the list" (see todo-tree-item.ts's .row.row
    // - drag-handle comment), so touch devices need an explicit way to
    // enter reorder mode instead. CSS-gated to touch/coarse-pointer
    // devices only (see todo-overlay-list.ts's @media (pointer: coarse))
    // - mouse users never see it, since hold-anywhere-to-drag already
    // works reliably for them.
    show_reorder_toggle?: boolean;
}

function friendlyName(hass: HassLike, entityId: string): string {
    const name = hass.states[entityId]?.attributes.friendly_name;

    return typeof name === "string" && name ? name : entityId;
}

@customElement("todo-overlay-card")
export class TodoOverlayCard extends LitElement {

    static styles = css`
        .entity-section + .entity-section {
            border-top: 1px solid var(--divider-color);
        }
    `;

    @property({attribute: false})
    public hass!: HassLike;

    @property()
    public config!: TodoOverlayCardConfig;

    setConfig(config: TodoOverlayCardConfig) {
        const hasEntities = Array.isArray(config.entities) && config.entities.length > 0;

        if (!config.entity && !hasEntities) {
            throw new Error("todo-overlay-card: 'entity' or 'entities' is required");
        }

        this.config = config;
    }

    // Picked up by Home Assistant's edit-card dialog to show a UI editor
    // instead of leaving the user to hand-write YAML - the returned
    // element just needs a setConfig() method and to emit "config-changed"
    // (see todo-overlay-card-editor.ts), the same contract every native
    // card's editor follows.
    static getConfigElement() {
        return document.createElement("todo-overlay-card-editor");
    }

    // Called by the card picker when this card is first added to a
    // dashboard, so it starts from a usable config rather than an empty
    // one the editor would immediately complain about. HA's own call
    // signature for this varies by version (some pass only `hass`), so
    // every parameter here is optional and this falls back to scanning
    // hass.states directly if entities/entitiesFallback come back empty.
    static getStubConfig(
        hass?: HassLike,
        entities: string[] = [],
        entitiesFallback: string[] = [],
    ): TodoOverlayCardConfig {
        const isTodoEntity = (entityId: string) => entityId.startsWith("todo.");

        const fromStates = hass ? Object.keys(hass.states).filter(isTodoEntity) : [];

        const entity =
            entities.find(isTodoEntity) ??
            entitiesFallback.find(isTodoEntity) ??
            fromStates[0] ??
            "";

        return {entity};
    }

    render() {
        const entityIds = this.config.entities?.length
            ? this.config.entities
            : this.config.entity
                ? [this.config.entity]
                : [];

        const isMulti = entityIds.length > 1;

        // In multi-entity mode the card-level header is optional (there's
        // no default - the per-entity titles below already label each
        // list). In single-entity mode there's always a title, but it's
        // rendered by todo-overlay-list itself, merged into the same row
        // as its own +/icons toolbar, rather than via ha-card's separate
        // header slot - that's what keeps a list's title and its toolbar
        // on one visual line instead of stacked.
        const cardHeader = isMulti ? this.config.title : undefined;

        const entityTitle = (entityId: string) =>
            isMulti ? friendlyName(this.hass, entityId) : (this.config.title ?? "Todo Overlay");

        return html`
            <ha-card header=${cardHeader || nothing}>
                ${entityIds.map(entityId => html`
                    <div class="entity-section">
                        <todo-overlay-list
                            .hass=${this.hass}
                            .entity=${entityId}
                            .headerTitle=${entityTitle(entityId)}
                            .hideCompleteForParents=${this.config.hide_complete_for_parents ?? true}
                            .showCheckboxes=${this.config.show_checkboxes ?? false}
                            .sortBy=${this.config.sort_by ?? "manual"}
                            .sortOrder=${this.config.sort_order ?? "asc"}
                            .showClearButton=${this.config.show_clear_completed_button ?? true}
                            .showSaveLoadButtons=${this.config.show_save_load_buttons ?? true}
                            .showQuickAdd=${this.config.show_quick_add ?? true}
                            .confirmDelete=${this.config.confirm_delete ?? true}
                            .showFilterMenu=${this.config.show_filter_menu ?? false}
                            .showReorderToggle=${this.config.show_reorder_toggle ?? true}
                            .moveCompletedItems=${this.config.move_completed_items ?? false}
                        ></todo-overlay-list>
                    </div>
                `)}
            </ha-card>
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
