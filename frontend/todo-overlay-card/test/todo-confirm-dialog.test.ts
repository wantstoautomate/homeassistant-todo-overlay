import {afterEach, describe, expect, it} from "vitest";

import "../src/components/todo-confirm-dialog";
import type {TodoConfirmDialog} from "../src/components/todo-confirm-dialog";

async function renderDialog(props: Partial<TodoConfirmDialog> = {}): Promise<TodoConfirmDialog> {
    const el = document.createElement("todo-overlay-confirm-dialog") as TodoConfirmDialog;

    Object.assign(el, props);

    document.body.appendChild(el);
    await el.updateComplete;

    return el;
}

function buttons(el: TodoConfirmDialog): HTMLButtonElement[] {
    return [...(el.shadowRoot?.querySelectorAll("button") ?? [])] as HTMLButtonElement[];
}

afterEach(() => {
    document.body.innerHTML = "";
});

describe("todo-overlay-confirm-dialog", () => {
    it("renders the given heading, message, and confirm label", async () => {
        const el = await renderDialog({
            heading: "Delete all items?",
            message: "This can't be undone.",
            confirmLabel: "Delete all",
        });

        const dialog = el.shadowRoot?.querySelector("ha-dialog") as unknown as {heading?: string};
        expect(dialog?.heading).toBe("Delete all items?");
        expect(el.shadowRoot?.querySelector("p")?.textContent).toBe("This can't be undone.");
        expect(buttons(el).find(b => b.textContent?.trim() === "Delete all")).toBeDefined();
    });

    it("emits dialog-confirm when the confirm button is clicked", async () => {
        const el = await renderDialog({confirmLabel: "Delete all"});

        let fired = false;
        el.addEventListener("dialog-confirm", () => { fired = true; });

        buttons(el).find(b => b.textContent?.trim() === "Delete all")!.click();

        expect(fired).toBe(true);
    });

    it("emits dialog-close when Cancel is clicked", async () => {
        const el = await renderDialog();

        let fired = false;
        el.addEventListener("dialog-close", () => { fired = true; });

        buttons(el).find(b => b.textContent?.trim() === "Cancel")!.click();

        expect(fired).toBe(true);
    });
});
