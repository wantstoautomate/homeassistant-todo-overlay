import {afterEach, describe, expect, it} from "vitest";

import "../src/components/todo-overlay-card-editor";
import type {TodoOverlayCardEditor} from "../src/components/todo-overlay-card-editor";
import type {TodoOverlayCardConfig} from "../src/todo-overlay";
import {makeFakeHass} from "./fakes";

async function renderEditor(config: TodoOverlayCardConfig): Promise<TodoOverlayCardEditor> {
    const el = document.createElement("todo-overlay-card-editor") as TodoOverlayCardEditor;
    el.hass = makeFakeHass();
    el.setConfig(config);

    document.body.appendChild(el);
    await el.updateComplete;

    return el;
}

function lastConfigChange(el: TodoOverlayCardEditor): Promise<TodoOverlayCardConfig> {
    return new Promise((resolve) => {
        el.addEventListener("config-changed", (e) => {
            resolve((e as CustomEvent<{config: TodoOverlayCardConfig}>).detail.config);
        }, {once: true});
    });
}

afterEach(() => {
    document.body.innerHTML = "";
});

describe("todo-overlay-card-editor", () => {
    it("migrates a singular entity into the entities list shown in the selector", async () => {
        const el = await renderEditor({entity: "todo.shopping"});

        const selector = el.shadowRoot?.querySelector("ha-selector") as HTMLElement & {value: string[]};
        expect(selector.value).toEqual(["todo.shopping"]);
    });

    it("onEntitiesChanged replaces entity with entities and drops the old key", async () => {
        const el = await renderEditor({entity: "todo.shopping"});
        const changed = lastConfigChange(el);

        el.shadowRoot?.querySelector("ha-selector")?.dispatchEvent(
            new CustomEvent("value-changed", {detail: {value: ["todo.a", "todo.b"]}}),
        );

        const config = await changed;
        expect(config).toEqual({entities: ["todo.a", "todo.b"]});
    });

    it("onTitleChanged sets title, and clears it to undefined when emptied", async () => {
        const el = await renderEditor({entity: "todo.shopping"});
        let changed = lastConfigChange(el);

        const input = el.shadowRoot?.querySelector("#todo-overlay-title") as HTMLInputElement;
        input.value = "My List";
        input.dispatchEvent(new Event("input"));

        expect((await changed).title).toBe("My List");

        await el.updateComplete;
        changed = lastConfigChange(el);
        input.value = "";
        input.dispatchEvent(new Event("input"));

        expect((await changed).title).toBeUndefined();
    });

    it("onSortByChanged updates sort_by", async () => {
        const el = await renderEditor({entity: "todo.shopping"});
        const changed = lastConfigChange(el);

        const select = el.shadowRoot?.querySelector("#todo-overlay-sort-by") as HTMLSelectElement;
        select.value = "title";
        select.dispatchEvent(new Event("change"));

        expect((await changed).sort_by).toBe("title");
    });

    it("only shows the sort-order selector once sort_by is not manual", async () => {
        const manual = await renderEditor({entity: "todo.shopping"});
        expect(manual.shadowRoot?.querySelector("#todo-overlay-sort-order")).toBeNull();

        const byTitle = await renderEditor({entity: "todo.shopping", sort_by: "title"});
        expect(byTitle.shadowRoot?.querySelector("#todo-overlay-sort-order")).not.toBeNull();
    });

    it("onSwitchChanged clears the field to undefined when toggled back to its default", async () => {
        const el = await renderEditor({entity: "todo.shopping", show_quick_add: false});
        const changed = lastConfigChange(el);

        const formfields = [...(el.shadowRoot?.querySelectorAll("ha-formfield") ?? [])];
        const quickAddSwitch = formfields
            .find(f => f.getAttribute("label") === "Quick-add bar")
            ?.querySelector("ha-switch") as HTMLInputElement;

        quickAddSwitch.checked = true;
        quickAddSwitch.dispatchEvent(new Event("change"));

        const config = await changed;
        expect(config.show_quick_add).toBeUndefined();
    });

    it("onSwitchChanged sets an explicit value when toggled away from the default", async () => {
        const el = await renderEditor({entity: "todo.shopping"});
        const changed = lastConfigChange(el);

        const formfields = [...(el.shadowRoot?.querySelectorAll("ha-formfield") ?? [])];
        const filterSwitch = formfields
            .find(f => f.getAttribute("label") === "Filter icon in toolbar")
            ?.querySelector("ha-switch") as HTMLInputElement;

        filterSwitch.checked = true;
        filterSwitch.dispatchEvent(new Event("change"));

        const config = await changed;
        expect(config.show_filter_menu).toBe(true);
    });

    it("show_checkboxes toggle sets an explicit value when turned on", async () => {
        const el = await renderEditor({entity: "todo.shopping"});
        const changed = lastConfigChange(el);

        const formfields = [...(el.shadowRoot?.querySelectorAll("ha-formfield") ?? [])];
        const checkboxSwitch = formfields
            .find(f => f.getAttribute("label") === "Show checkboxes")
            ?.querySelector("ha-switch") as HTMLInputElement;

        checkboxSwitch.checked = true;
        checkboxSwitch.dispatchEvent(new Event("change"));

        const config = await changed;
        expect(config.show_checkboxes).toBe(true);
    });

    it("tucks the less-common toggles behind a collapsed Advanced disclosure", async () => {
        const el = await renderEditor({entity: "todo.shopping"});

        const advanced = el.shadowRoot?.querySelector("details.advanced") as HTMLDetailsElement;
        expect(advanced).not.toBeNull();
        expect(advanced.open).toBe(false);

        const advancedLabels = [...advanced.querySelectorAll("ha-formfield")]
            .map(f => f.getAttribute("label"));
        expect(advancedLabels).toEqual([
            "Move completed items to the bottom",
            "Confirm before deleting an item",
            "Save/load list buttons",
            "Filter icon in toolbar",
            "Reorder-mode toggle (touch devices only)",
        ]);

        const mainLabels = [...(el.shadowRoot?.querySelectorAll("ha-formfield") ?? [])]
            .filter(f => !advanced.contains(f))
            .map(f => f.getAttribute("label"));
        expect(mainLabels).toEqual([
            "Hide complete checkbox for parents",
            "Show checkboxes",
            "Clear completed button",
            "Quick-add bar",
        ]);
    });
});
