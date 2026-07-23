import {afterEach, describe, expect, it} from "vitest";

import "../src/components/todo-item-dialog";
import type {TodoItemDialog, TodoItemFormValue} from "../src/components/todo-item-dialog";
import {EMPTY_FORM_VALUE} from "../src/components/todo-item-dialog";

async function renderDialog(props: Partial<TodoItemDialog> = {}): Promise<TodoItemDialog> {
    const el = document.createElement("todo-overlay-item-dialog") as TodoItemDialog;

    Object.assign(el, props);

    document.body.appendChild(el);
    await el.updateComplete;

    return el;
}

function saveButton(el: TodoItemDialog): HTMLButtonElement {
    const buttons = [...(el.shadowRoot?.querySelectorAll("button") ?? [])] as HTMLButtonElement[];
    return buttons.find(b => b.textContent?.trim() === "Save")!;
}

afterEach(() => {
    document.body.innerHTML = "";
});

describe("todo-overlay-item-dialog", () => {
    it("emits dialog-save with the current value when Save is clicked", async () => {
        const value: TodoItemFormValue = {...EMPTY_FORM_VALUE, title: "Buy milk"};
        const el = await renderDialog({value});

        let detail: TodoItemFormValue | undefined;
        el.addEventListener("dialog-save", (e) => {
            detail = (e as CustomEvent<TodoItemFormValue>).detail;
        });

        saveButton(el).click();

        expect(detail).toEqual(value);
    });

    it("blocks Save (disabled, no event) when triggerOnDue is set without a due date/time", async () => {
        const value: TodoItemFormValue = {
            ...EMPTY_FORM_VALUE, title: "Renew passport", triggerOnDue: true,
        };
        const el = await renderDialog({
            value,
            fieldSupport: {description: false, dueDate: true, dueDateTime: true},
        });

        const button = saveButton(el);
        expect(button.disabled).toBe(true);

        let fired = false;
        el.addEventListener("dialog-save", () => { fired = true; });
        button.click();

        expect(fired).toBe(false);
    });

    it("shows the 'requires a due time' hint only when triggerOnDue is blocked", async () => {
        const blocked = await renderDialog({
            value: {...EMPTY_FORM_VALUE, triggerOnDue: true},
            fieldSupport: {description: false, dueDate: true, dueDateTime: true},
        });
        expect(blocked.shadowRoot?.querySelector(".field-hint")).not.toBeNull();

        const complete = await renderDialog({
            value: {...EMPTY_FORM_VALUE, triggerOnDue: true, dueDate: "2026-01-01", dueTime: "09:00"},
            fieldSupport: {description: false, dueDate: true, dueDateTime: true},
        });
        expect(complete.shadowRoot?.querySelector(".field-hint")).toBeNull();
    });

    it("allows Save once a due date and time are both filled in", async () => {
        const value: TodoItemFormValue = {
            ...EMPTY_FORM_VALUE, triggerOnDue: true, dueDate: "2026-01-01", dueTime: "09:00",
        };
        const el = await renderDialog({
            value,
            fieldSupport: {description: false, dueDate: true, dueDateTime: true},
        });

        const button = saveButton(el);
        expect(button.disabled).toBe(false);

        let detail: TodoItemFormValue | undefined;
        el.addEventListener("dialog-save", (e) => {
            detail = (e as CustomEvent<TodoItemFormValue>).detail;
        });
        button.click();

        expect(detail).toEqual(value);
    });

    it("does not render the trigger-on-due toggle when the entity has no due-datetime support", async () => {
        const el = await renderDialog({
            fieldSupport: {description: false, dueDate: true, dueDateTime: false},
        });

        expect(el.shadowRoot?.querySelector(".complete-toggle")).toBeNull();
    });

    it("asks for confirmation before emitting dialog-delete by default", async () => {
        const el = await renderDialog({showDelete: true});

        let fired = false;
        el.addEventListener("dialog-delete", () => { fired = true; });

        const deleteButton = [...(el.shadowRoot?.querySelectorAll("button") ?? [])]
            .find(b => b.textContent?.trim() === "Delete") as HTMLButtonElement;
        deleteButton.click();
        await el.updateComplete;

        expect(fired).toBe(false);
        expect(el.shadowRoot?.querySelector(".confirm-delete")).not.toBeNull();

        const confirmButton = [...(el.shadowRoot?.querySelectorAll(".confirm-delete button") ?? [])]
            .find(b => b.textContent?.trim() === "Delete") as HTMLButtonElement;
        confirmButton.click();

        expect(fired).toBe(true);
    });

    it("skips confirmation and emits dialog-delete immediately when confirmDelete is false", async () => {
        const el = await renderDialog({showDelete: true, confirmDelete: false});

        let fired = false;
        el.addEventListener("dialog-delete", () => { fired = true; });

        const deleteButton = [...(el.shadowRoot?.querySelectorAll("button") ?? [])]
            .find(b => b.textContent?.trim() === "Delete") as HTMLButtonElement;
        deleteButton.click();

        expect(fired).toBe(true);
    });

    it("cancelling the delete confirmation leaves the item alone", async () => {
        const el = await renderDialog({showDelete: true});

        let fired = false;
        el.addEventListener("dialog-delete", () => { fired = true; });

        (
            [...(el.shadowRoot?.querySelectorAll("button") ?? [])]
                .find(b => b.textContent?.trim() === "Delete") as HTMLButtonElement
        ).click();
        await el.updateComplete;

        (
            [...(el.shadowRoot?.querySelectorAll(".confirm-delete button") ?? [])]
                .find(b => b.textContent?.trim() === "Cancel") as HTMLButtonElement
        ).click();
        await el.updateComplete;

        expect(fired).toBe(false);
        expect(el.shadowRoot?.querySelector(".confirm-delete")).toBeNull();
    });

    it("emits dialog-toggle-complete when the complete-toggle checkbox is clicked", async () => {
        const el = await renderDialog({showCompleteToggle: true, completed: false});

        let fired = false;
        el.addEventListener("dialog-toggle-complete", () => { fired = true; });

        (el.shadowRoot?.querySelector(".complete-toggle ha-checkbox") as HTMLElement).click();

        expect(fired).toBe(true);
    });

    it("emits dialog-close when the dialog fires 'closed'", async () => {
        const el = await renderDialog();

        let fired = false;
        el.addEventListener("dialog-close", () => { fired = true; });

        el.shadowRoot?.querySelector("ha-dialog")?.dispatchEvent(new Event("closed"));

        expect(fired).toBe(true);
    });

    it("updates the title field's value as the user types", async () => {
        const el = await renderDialog({value: {...EMPTY_FORM_VALUE, title: ""}});

        const input = el.shadowRoot?.querySelector("#todo-item-title") as HTMLInputElement;
        input.value = "New title";
        input.dispatchEvent(new Event("input"));
        await el.updateComplete;

        expect(el.value.title).toBe("New title");
    });
});
