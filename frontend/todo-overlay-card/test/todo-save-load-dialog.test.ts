import {afterEach, describe, expect, it} from "vitest";

import "../src/components/todo-save-load-dialog";
import type {SaveLoadFormValue, TodoSaveLoadDialog} from "../src/components/todo-save-load-dialog";
import {EMPTY_SAVE_LOAD_VALUE} from "../src/components/todo-save-load-dialog";

async function renderDialog(props: Partial<TodoSaveLoadDialog> = {}): Promise<TodoSaveLoadDialog> {
    const el = document.createElement("todo-overlay-save-load-dialog") as TodoSaveLoadDialog;

    Object.assign(el, props);

    document.body.appendChild(el);
    await el.updateComplete;

    return el;
}

afterEach(() => {
    document.body.innerHTML = "";
});

describe("todo-overlay-save-load-dialog", () => {
    it("renders the name and persist-states fields in save mode", async () => {
        const el = await renderDialog({action: "save"});

        expect(el.shadowRoot?.querySelector("#save-load-name")).not.toBeNull();
        expect(el.shadowRoot?.querySelector("#save-load-persist")).not.toBeNull();
        expect(el.shadowRoot?.querySelector("#save-load-select")).toBeNull();
    });

    it("renders the saved-list select and mode select in load mode", async () => {
        const el = await renderDialog({action: "load", savedNames: ["a", "b"]});

        expect(el.shadowRoot?.querySelector("#save-load-select")).not.toBeNull();
        expect(el.shadowRoot?.querySelector("#save-load-mode")).not.toBeNull();
        expect(el.shadowRoot?.querySelector("#save-load-name")).toBeNull();
    });

    it("disables Load/Save until a name is chosen", async () => {
        const el = await renderDialog({action: "save", value: {...EMPTY_SAVE_LOAD_VALUE, name: ""}});

        const buttons = [...(el.shadowRoot?.querySelectorAll("button") ?? [])] as HTMLButtonElement[];
        const confirmButton = buttons.find(b => b.textContent?.trim() === "Save")!;
        expect(confirmButton.disabled).toBe(true);
    });

    it("emits dialog-confirm with the current value when confirmed", async () => {
        const value: SaveLoadFormValue = {...EMPTY_SAVE_LOAD_VALUE, name: "weekly_groceries"};
        const el = await renderDialog({action: "save", value});

        let detail: SaveLoadFormValue | undefined;
        el.addEventListener("dialog-confirm", (e) => {
            detail = (e as CustomEvent<SaveLoadFormValue>).detail;
        });

        const buttons = [...(el.shadowRoot?.querySelectorAll("button") ?? [])] as HTMLButtonElement[];
        buttons.find(b => b.textContent?.trim() === "Save")!.click();

        expect(detail).toEqual(value);
    });

    it("only shows the delete-saved button once a name is selected in load mode", async () => {
        const noneChosen = await renderDialog({
            action: "load", value: {...EMPTY_SAVE_LOAD_VALUE, name: ""}, savedNames: ["a"],
        });
        expect(noneChosen.shadowRoot?.querySelector(".delete-row")).toBeNull();

        const chosen = await renderDialog({
            action: "load", value: {...EMPTY_SAVE_LOAD_VALUE, name: "a"}, savedNames: ["a"],
        });
        expect(chosen.shadowRoot?.querySelector(".delete-row")).not.toBeNull();
    });

    it("emits dialog-delete-saved with the selected name", async () => {
        const el = await renderDialog({
            action: "load", value: {...EMPTY_SAVE_LOAD_VALUE, name: "weekly_groceries"}, savedNames: ["weekly_groceries"],
        });

        let detail: {name: string} | undefined;
        el.addEventListener("dialog-delete-saved", (e) => {
            detail = (e as CustomEvent<{name: string}>).detail;
        });

        (el.shadowRoot?.querySelector(".delete-row button") as HTMLElement).click();

        expect(detail).toEqual({name: "weekly_groceries"});
    });

    it("emits dialog-close when Cancel is clicked", async () => {
        const el = await renderDialog();

        let fired = false;
        el.addEventListener("dialog-close", () => { fired = true; });

        const buttons = [...(el.shadowRoot?.querySelectorAll("button") ?? [])] as HTMLButtonElement[];
        buttons.find(b => b.textContent?.trim() === "Cancel")!.click();

        expect(fired).toBe(true);
    });

    it("updates the name field as the user types (save mode)", async () => {
        const el = await renderDialog({action: "save"});

        const input = el.shadowRoot?.querySelector("#save-load-name") as HTMLInputElement;
        input.value = "my_template";
        input.dispatchEvent(new Event("input"));
        await el.updateComplete;

        expect(el.value.name).toBe("my_template");
    });

    // Live use case: loading a saved template AS THE CHILDREN of an
    // existing parent ("To buy") rather than as new root-level siblings.
    describe("load-into target picker", () => {
        it("defaults to 'Top level' with no target set", async () => {
            const el = await renderDialog({
                action: "load", savedNames: ["a"], value: {...EMPTY_SAVE_LOAD_VALUE, name: "a"},
                targetOptions: [{id: "1", label: "To buy"}],
            });

            const select = el.shadowRoot?.querySelector("#save-load-target") as HTMLSelectElement;
            expect(select).not.toBeNull();
            expect(select.value).toBe("");
        });

        it("renders every offered target, indented labels intact", async () => {
            const el = await renderDialog({
                action: "load", savedNames: ["a"], value: {...EMPTY_SAVE_LOAD_VALUE, name: "a"},
                targetOptions: [{id: "1", label: "To buy"}, {id: "2", label: "  — Milk"}],
            });

            const select = el.shadowRoot?.querySelector("#save-load-target") as HTMLSelectElement;
            const labels = [...select.querySelectorAll("option")].map(o => o.textContent?.trim());
            expect(labels).toEqual(["Top level", "To buy", "— Milk"]);
        });

        it("updates the draft value when a target is chosen", async () => {
            const el = await renderDialog({
                action: "load", savedNames: ["a"], value: {...EMPTY_SAVE_LOAD_VALUE, name: "a"},
                targetOptions: [{id: "parent-1", label: "To buy"}],
            });

            const select = el.shadowRoot?.querySelector("#save-load-target") as HTMLSelectElement;
            select.value = "parent-1";
            select.dispatchEvent(new Event("change"));
            await el.updateComplete;

            expect(el.value.targetItem).toBe("parent-1");
        });

        it("shows the scoped-replace hint only when Replace mode AND a target are both set", async () => {
            const neitherSet = await renderDialog({
                action: "load", savedNames: ["a"],
                value: {...EMPTY_SAVE_LOAD_VALUE, name: "a", mode: "merge", targetItem: ""},
                targetOptions: [{id: "1", label: "To buy"}],
            });
            expect(neitherSet.shadowRoot?.querySelector(".field-hint")).toBeNull();

            const replaceOnly = await renderDialog({
                action: "load", savedNames: ["a"],
                value: {...EMPTY_SAVE_LOAD_VALUE, name: "a", mode: "replace", targetItem: ""},
                targetOptions: [{id: "1", label: "To buy"}],
            });
            expect(replaceOnly.shadowRoot?.querySelector(".field-hint")).toBeNull();

            const targetOnly = await renderDialog({
                action: "load", savedNames: ["a"],
                value: {...EMPTY_SAVE_LOAD_VALUE, name: "a", mode: "merge", targetItem: "1"},
                targetOptions: [{id: "1", label: "To buy"}],
            });
            expect(targetOnly.shadowRoot?.querySelector(".field-hint")).toBeNull();

            const both = await renderDialog({
                action: "load", savedNames: ["a"],
                value: {...EMPTY_SAVE_LOAD_VALUE, name: "a", mode: "replace", targetItem: "1"},
                targetOptions: [{id: "1", label: "To buy"}],
            });
            expect(both.shadowRoot?.querySelector(".field-hint")).not.toBeNull();
        });
    });

    it("does not clobber an in-progress unsaved name when the parent re-passes value", async () => {
        // Live-reported bug: "typing a name to save the list in the
        // mobile browser wipes it occasionally." The parent
        // (todo-overlay-list.ts) re-renders for all sorts of reasons
        // unrelated to this dialog (a live-sync reload, a hass poll
        // tick) and always re-passes `.value` on every render -
        // lit-html always recommits a non-primitive property value
        // regardless of whether its reference changed, so re-assigning
        // the SAME (or an equal-content) value object here simulates
        // exactly that.
        const el = await renderDialog({action: "save"});

        const input = el.shadowRoot?.querySelector("#save-load-name") as HTMLInputElement;
        input.value = "weekly_groceries";
        input.dispatchEvent(new Event("input"));
        await el.updateComplete;

        expect(input.value).toBe("weekly_groceries");

        // The parent re-renders and re-passes its own (stale, pre-edit)
        // value object - a brand new object, same content as what the
        // dialog originally opened with.
        el.value = {...EMPTY_SAVE_LOAD_VALUE};
        await el.updateComplete;

        expect(input.value).toBe("weekly_groceries");
        expect(el.value.name).toBe("weekly_groceries");
    });
});
