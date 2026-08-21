import {afterEach, describe, expect, it} from "vitest";

import "../src/components/todo-save-load-dialog";
import type {SaveLoadFormValue, TodoSaveLoadDialog} from "../src/components/todo-save-load-dialog";
import {EMPTY_SAVE_LOAD_VALUE} from "../src/components/todo-save-load-dialog";
import type {TodoItem} from "../src/models";

function makeItem(overrides: Partial<TodoItem> = {}): TodoItem {
    return {
        id: "1", title: "Item", completed: false, description: null,
        due_date: null, due_datetime: null, quantity: null, tags: [],
        trigger_on_due: false, pin_type: null, linked: false, children: [], ...overrides,
    };
}

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
    // Live-reported: a flat, fully-indented <select> read as an
    // unreadable wall once the list had any real nesting - replaced
    // with a breadcrumb file-explorer browser instead.
    describe("load-into target picker", () => {
        const TREE: TodoItem[] = [
            makeItem({id: "1", title: "To buy", children: [
                makeItem({id: "2", title: "Milk"}),
                makeItem({id: "3", title: "Fruit & veg", children: [
                    makeItem({id: "4", title: "Apples"}),
                ]}),
            ]}),
            makeItem({id: "5", title: "Errands"}),
        ];

        it("defaults to a collapsed summary reading 'Top level', with no picker open", async () => {
            const el = await renderDialog({
                action: "load", savedNames: ["a"], value: {...EMPTY_SAVE_LOAD_VALUE, name: "a"},
                items: TREE,
            });

            expect(el.shadowRoot?.querySelector(".target-summary")?.textContent).toContain("Top level");
            expect(el.shadowRoot?.querySelector(".picker")).toBeNull();
        });

        it("opens the picker, showing only the root level, on Browse", async () => {
            const el = await renderDialog({
                action: "load", savedNames: ["a"], value: {...EMPTY_SAVE_LOAD_VALUE, name: "a"},
                items: TREE,
            });

            (el.shadowRoot?.querySelector(".target-summary") as HTMLElement).click();
            await el.updateComplete;

            const rows = [...(el.shadowRoot?.querySelectorAll(".picker-row .title-btn") ?? [])];
            expect(rows.map(r => r.textContent?.trim())).toEqual(["To buy", "Errands"]);
            // The root gets a pin row too - "Load into 'Top level'" -
            // otherwise there'd be no way back to it once you'd
            // navigated anywhere, only entering was ever wired as an
            // action.
            expect(el.shadowRoot?.querySelector(".pin-row")?.textContent).toContain("Top level");
        });

        it("selecting the root's own pin row clears the target back to Top level", async () => {
            const el = await renderDialog({
                action: "load", savedNames: ["a"],
                value: {...EMPTY_SAVE_LOAD_VALUE, name: "a", targetItem: "1"},
                items: TREE,
            });

            expect(el.shadowRoot?.querySelector(".target-summary")?.textContent).toContain("To buy");

            (el.shadowRoot?.querySelector(".target-summary") as HTMLElement).click();
            await el.updateComplete;
            (el.shadowRoot?.querySelector(".pin-row") as HTMLElement).click();
            await el.updateComplete;

            expect(el.value.targetItem).toBe("");
            expect(el.shadowRoot?.querySelector(".target-summary")?.textContent).toContain("Top level");
        });

        it("selects a leaf directly via its title, with no way to step further into it", async () => {
            const el = await renderDialog({
                action: "load", savedNames: ["a"], value: {...EMPTY_SAVE_LOAD_VALUE, name: "a"},
                items: TREE,
            });

            (el.shadowRoot?.querySelector(".target-summary") as HTMLElement).click();
            await el.updateComplete;

            const rows = [...(el.shadowRoot?.querySelectorAll(".picker-row") ?? [])];
            const errandsRow = rows.find(r => r.textContent?.includes("Errands"))!;
            expect(errandsRow.querySelector(".enter-btn"), "a leaf has nothing to step into").toBeNull();

            (errandsRow.querySelector(".title-btn") as HTMLElement).click();
            await el.updateComplete;

            expect(el.value.targetItem).toBe("5");
            // Picking a target closes the picker back to its summary.
            expect(el.shadowRoot?.querySelector(".picker")).toBeNull();
            expect(el.shadowRoot?.querySelector(".target-summary")?.textContent).toContain("Errands");
        });

        it("steps into a parent via its enter button, pushing a breadcrumb, without selecting it", async () => {
            const el = await renderDialog({
                action: "load", savedNames: ["a"], value: {...EMPTY_SAVE_LOAD_VALUE, name: "a"},
                items: TREE,
            });

            (el.shadowRoot?.querySelector(".target-summary") as HTMLElement).click();
            await el.updateComplete;

            const rows = [...(el.shadowRoot?.querySelectorAll(".picker-row") ?? [])];
            const toBuyRow = rows.find(r => r.textContent?.includes("To buy"))!;
            (toBuyRow.querySelector(".enter-btn") as HTMLElement).click();
            await el.updateComplete;

            // Still nothing selected - only navigated.
            expect(el.value.targetItem).toBe("");

            const crumbLabels = [...(el.shadowRoot?.querySelectorAll(".crumbs button") ?? [])]
                .map(b => b.textContent?.trim());
            expect(crumbLabels).toEqual(["Top level", "To buy"]);

            const childTitles = [...(el.shadowRoot?.querySelectorAll(".picker-row .title-btn") ?? [])]
                .map(b => b.textContent?.trim());
            expect(childTitles).toEqual(["Milk", "Fruit & veg"]);
        });

        it("offers a pinned row to select the currently-stepped-into item itself", async () => {
            const el = await renderDialog({
                action: "load", savedNames: ["a"], value: {...EMPTY_SAVE_LOAD_VALUE, name: "a"},
                items: TREE,
            });

            (el.shadowRoot?.querySelector(".target-summary") as HTMLElement).click();
            await el.updateComplete;
            const rows = [...(el.shadowRoot?.querySelectorAll(".picker-row") ?? [])];
            (rows.find(r => r.textContent?.includes("To buy"))!.querySelector(".enter-btn") as HTMLElement).click();
            await el.updateComplete;

            const pin = el.shadowRoot?.querySelector(".pin-row") as HTMLElement;
            expect(pin.textContent).toContain("To buy");
            pin.click();
            await el.updateComplete;

            expect(el.value.targetItem).toBe("1");
        });

        it("jumps back to any ancestor level, Top level included, via the breadcrumb", async () => {
            const el = await renderDialog({
                action: "load", savedNames: ["a"], value: {...EMPTY_SAVE_LOAD_VALUE, name: "a"},
                items: TREE,
            });

            (el.shadowRoot?.querySelector(".target-summary") as HTMLElement).click();
            await el.updateComplete;

            // Drill two levels deep: To buy > Fruit & veg.
            let rows = [...(el.shadowRoot?.querySelectorAll(".picker-row") ?? [])];
            (rows.find(r => r.textContent?.includes("To buy"))!.querySelector(".enter-btn") as HTMLElement).click();
            await el.updateComplete;

            rows = [...(el.shadowRoot?.querySelectorAll(".picker-row") ?? [])];
            (rows.find(r => r.textContent?.includes("Fruit & veg"))!.querySelector(".enter-btn") as HTMLElement).click();
            await el.updateComplete;

            expect([...(el.shadowRoot?.querySelectorAll(".picker-row .title-btn") ?? [])].map(b => b.textContent?.trim()))
                .toEqual(["Apples"]);

            // Jump straight back to root via the breadcrumb, skipping "To buy".
            const crumbs = [...(el.shadowRoot?.querySelectorAll(".crumbs button") ?? [])] as HTMLElement[];
            crumbs[0].click();
            await el.updateComplete;

            expect([...(el.shadowRoot?.querySelectorAll(".picker-row .title-btn") ?? [])].map(b => b.textContent?.trim()))
                .toEqual(["To buy", "Errands"]);
        });

        it("resets to the root every time the picker is (re-)opened", async () => {
            const el = await renderDialog({
                action: "load", savedNames: ["a"], value: {...EMPTY_SAVE_LOAD_VALUE, name: "a"},
                items: TREE,
            });

            const summary = el.shadowRoot?.querySelector(".target-summary") as HTMLElement;
            summary.click();
            await el.updateComplete;

            let rows = [...(el.shadowRoot?.querySelectorAll(".picker-row") ?? [])];
            (rows.find(r => r.textContent?.includes("To buy"))!.querySelector(".enter-btn") as HTMLElement).click();
            await el.updateComplete;

            // Close, then reopen.
            summary.click();
            await el.updateComplete;
            summary.click();
            await el.updateComplete;

            expect([...(el.shadowRoot?.querySelectorAll(".crumbs button") ?? [])].map(b => b.textContent?.trim()))
                .toEqual(["Top level"]);
        });

        it("shows the scoped-replace hint only when Replace mode AND a target are both set", async () => {
            const neitherSet = await renderDialog({
                action: "load", savedNames: ["a"],
                value: {...EMPTY_SAVE_LOAD_VALUE, name: "a", mode: "merge", targetItem: ""},
                items: TREE,
            });
            expect(neitherSet.shadowRoot?.querySelector(".field-hint")).toBeNull();

            const replaceOnly = await renderDialog({
                action: "load", savedNames: ["a"],
                value: {...EMPTY_SAVE_LOAD_VALUE, name: "a", mode: "replace", targetItem: ""},
                items: TREE,
            });
            expect(replaceOnly.shadowRoot?.querySelector(".field-hint")).toBeNull();

            const targetOnly = await renderDialog({
                action: "load", savedNames: ["a"],
                value: {...EMPTY_SAVE_LOAD_VALUE, name: "a", mode: "merge", targetItem: "1"},
                items: TREE,
            });
            expect(targetOnly.shadowRoot?.querySelector(".field-hint")).toBeNull();

            const both = await renderDialog({
                action: "load", savedNames: ["a"],
                value: {...EMPTY_SAVE_LOAD_VALUE, name: "a", mode: "replace", targetItem: "1"},
                items: TREE,
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
