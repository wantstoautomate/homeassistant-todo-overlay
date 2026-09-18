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

function triggerOnDueCheckbox(el: TodoItemDialog): HTMLElement & {checked?: boolean} {
    const rows = [...(el.shadowRoot?.querySelectorAll(".complete-toggle") ?? [])];
    const row = rows.find(r => r.textContent?.includes("Trigger automation when due"))!;
    return row.querySelector("ha-checkbox") as HTMLElement & {checked?: boolean};
}

function segment(el: TodoItemDialog, cls: string): HTMLInputElement {
    return el.shadowRoot?.querySelector(`input.segment.${cls}`) as HTMLInputElement;
}

function setSegment(el: TodoItemDialog, cls: string, text: string): void {
    const input = segment(el, cls);
    input.value = text;
    input.dispatchEvent(new Event("input", {bubbles: true}));
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

    describe("pin type", () => {
        function pinTypeSelect(el: TodoItemDialog): HTMLSelectElement {
            return el.shadowRoot?.querySelector("#todo-item-pin-type") as HTMLSelectElement;
        }

        it("defaults to 'Normal item' (empty) and shows no hint", async () => {
            const el = await renderDialog({value: {...EMPTY_FORM_VALUE, title: "Milk"}});

            expect(pinTypeSelect(el).value).toBe("");
            expect(el.shadowRoot?.querySelector(".pin-type-hint")).toBeNull();
        });

        it("seeds the select from an already-pinned item's value", async () => {
            const el = await renderDialog({value: {...EMPTY_FORM_VALUE, title: "Brodie", pinType: "person"}});

            expect(pinTypeSelect(el).value).toBe("person");
            expect(el.shadowRoot?.querySelector(".pin-type-hint")).not.toBeNull();
        });

        it("updates the draft value and emits it on save when changed", async () => {
            const el = await renderDialog({value: {...EMPTY_FORM_VALUE, title: "Groceries"}});

            const select = pinTypeSelect(el);
            select.value = "category";
            select.dispatchEvent(new Event("change"));

            expect(el.value.pinType).toBe("category");

            let detail: TodoItemFormValue | undefined;
            el.addEventListener("dialog-save", (e) => {
                detail = (e as CustomEvent<TodoItemFormValue>).detail;
            });
            saveButton(el).click();

            expect(detail?.pinType).toBe("category");
        });
    });

    // Live use case: 7 permanent day-of-week pins, each tagged ONCE with
    // its own weekday - the label ("Today"/"Tomorrow"/plain name) and
    // sort order are then fully computed server-side from there on,
    // with nothing further to maintain (see tree.py's own build_tree).
    describe("day of week pin type", () => {
        function pinTypeSelect(el: TodoItemDialog): HTMLSelectElement {
            return el.shadowRoot?.querySelector("#todo-item-pin-type") as HTMLSelectElement;
        }

        function weekdaySelect(el: TodoItemDialog): HTMLSelectElement | null {
            return el.shadowRoot?.querySelector("#todo-item-day-weekday") as HTMLSelectElement | null;
        }

        function titleInput(el: TodoItemDialog): HTMLInputElement {
            return el.shadowRoot?.querySelector("#todo-item-title") as HTMLInputElement;
        }

        it("shows no weekday picker until 'Day of week' is actually selected", async () => {
            const el = await renderDialog({value: {...EMPTY_FORM_VALUE, title: "Milk"}});

            expect(weekdaySelect(el)).toBeNull();
        });

        it("selecting 'Day of week' reveals the weekday picker and disables the title field", async () => {
            const el = await renderDialog({value: {...EMPTY_FORM_VALUE, title: "whatever"}});

            const select = pinTypeSelect(el);
            select.value = "day";
            select.dispatchEvent(new Event("change"));
            await el.updateComplete;

            expect(weekdaySelect(el)).not.toBeNull();
            expect(titleInput(el).disabled).toBe(true);
        });

        it("the title field shows the computed weekday name, not the original stored title, once a weekday is picked", async () => {
            const el = await renderDialog({value: {...EMPTY_FORM_VALUE, title: "whatever"}});

            pinTypeSelect(el).value = "day";
            pinTypeSelect(el).dispatchEvent(new Event("change"));
            await el.updateComplete;

            const weekday = weekdaySelect(el)!;
            weekday.value = "2";
            weekday.dispatchEvent(new Event("change"));
            await el.updateComplete;

            expect(titleInput(el).value).toBe("Wednesday");
        });

        it("Save is disabled while 'Day of week' is selected but no weekday has been picked yet", async () => {
            const el = await renderDialog({value: {...EMPTY_FORM_VALUE, title: "whatever"}});

            pinTypeSelect(el).value = "day";
            pinTypeSelect(el).dispatchEvent(new Event("change"));
            await el.updateComplete;

            expect(saveButton(el).disabled).toBe(true);
        });

        it("Save re-enables once a weekday is picked, and emits the weekday's own name as the title", async () => {
            const el = await renderDialog({value: {...EMPTY_FORM_VALUE, title: "whatever"}});

            pinTypeSelect(el).value = "day";
            pinTypeSelect(el).dispatchEvent(new Event("change"));
            await el.updateComplete;

            const weekday = weekdaySelect(el)!;
            weekday.value = "2";
            weekday.dispatchEvent(new Event("change"));
            await el.updateComplete;

            expect(saveButton(el).disabled).toBe(false);

            let detail: TodoItemFormValue | undefined;
            el.addEventListener("dialog-save", (e) => {
                detail = (e as CustomEvent<TodoItemFormValue>).detail;
            });
            saveButton(el).click();

            expect(detail?.pinType).toBe("day");
            expect(detail?.dayWeekday).toBe("2");
            expect(detail?.title).toBe("Wednesday");
        });

        it("seeds the weekday picker and disabled title from an already-tagged day pin", async () => {
            const el = await renderDialog({
                value: {...EMPTY_FORM_VALUE, title: "Wednesday", pinType: "day", dayWeekday: "2"},
            });

            expect(weekdaySelect(el)?.value).toBe("2");
            expect(titleInput(el).disabled).toBe(true);
            expect(titleInput(el).value).toBe("Wednesday");
        });
    });

    // Live use case: mirroring an item on a purely local list (e.g.
    // "Tent" on "Travel") onto a cross-instance-linked "Shared" list, so
    // completing/editing/deleting either one keeps the other in sync.
    describe("item linking", () => {
        function linkedRow(el: TodoItemDialog): Element | undefined {
            const rows = [...(el.shadowRoot?.querySelectorAll(".complete-toggle") ?? [])];
            return rows.find(r => r.textContent?.includes("Link to shared list"));
        }

        function linkedCheckbox(el: TodoItemDialog): HTMLElement & {checked?: boolean} {
            return linkedRow(el)!.querySelector("ha-checkbox") as HTMLElement & {checked?: boolean};
        }

        function linkTargetInput(el: TodoItemDialog): HTMLInputElement | null {
            return el.shadowRoot?.querySelector("#todo-item-link-target") as HTMLInputElement | null;
        }

        it("defaults to unchecked, with no destination override field shown", async () => {
            const el = await renderDialog({value: {...EMPTY_FORM_VALUE, title: "Tent"}});

            expect(linkedCheckbox(el).checked).toBe(false);
            expect(linkTargetInput(el)).toBeNull();
        });

        it("seeds the checkbox as checked for an already-linked item, with no override field", async () => {
            const el = await renderDialog({value: {...EMPTY_FORM_VALUE, title: "Tent", linked: true}});

            expect(linkedCheckbox(el).checked).toBe(true);
            // Already linked when the dialog opened - nothing new being
            // created this session, so there's no destination to override.
            expect(linkTargetInput(el)).toBeNull();
        });

        it("reveals the destination override only once ticked from unlinked - a NEW link being created", async () => {
            const el = await renderDialog({value: {...EMPTY_FORM_VALUE, title: "Tent", linked: false}});
            expect(linkTargetInput(el)).toBeNull();

            const checkbox = linkedCheckbox(el);
            (checkbox as unknown as {checked: boolean}).checked = true;
            checkbox.dispatchEvent(new Event("change"));
            await el.updateComplete;

            expect(el.value.linked).toBe(true);
            expect(linkTargetInput(el)).not.toBeNull();
        });

        it("emits the typed destination override on save", async () => {
            const el = await renderDialog({value: {...EMPTY_FORM_VALUE, title: "Tent", linked: false}});

            const checkbox = linkedCheckbox(el);
            (checkbox as unknown as {checked: boolean}).checked = true;
            checkbox.dispatchEvent(new Event("change"));
            await el.updateComplete;

            const input = linkTargetInput(el)!;
            input.value = "Brodie";
            input.dispatchEvent(new Event("input"));
            await el.updateComplete;

            expect(el.value.linkTarget).toBe("Brodie");

            let detail: TodoItemFormValue | undefined;
            el.addEventListener("dialog-save", (e) => {
                detail = (e as CustomEvent<TodoItemFormValue>).detail;
            });
            saveButton(el).click();

            expect(detail?.linked).toBe(true);
            expect(detail?.linkTarget).toBe("Brodie");
        });

        it("unticking an already-linked item shows an unlink hint, not the destination override", async () => {
            const el = await renderDialog({value: {...EMPTY_FORM_VALUE, title: "Tent", linked: true}});

            const checkbox = linkedCheckbox(el);
            (checkbox as unknown as {checked: boolean}).checked = false;
            checkbox.dispatchEvent(new Event("change"));
            await el.updateComplete;

            expect(el.value.linked).toBe(false);
            expect(linkTargetInput(el)).toBeNull();
        });

        // Live-reported: this showed unconditionally, including on items
        // that already live ON the one configured cross-instance-linked
        // list itself - ticking it there could only ever mirror the item
        // onto a copy of itself on the SAME list (the frontend has no way
        // to target a different entity - see api.ts's own linkItem),
        // never anything useful.
        it("hides the checkbox entirely for an unlinked item on an already-linked entity", async () => {
            const el = await renderDialog({
                value: {...EMPTY_FORM_VALUE, title: "Tent", linked: false},
                entityIsLinked: true,
            });

            expect(linkedRow(el)).toBeUndefined();
        });

        it("still shows the checkbox (to allow unlinking) for an item already linked on an already-linked entity", async () => {
            const el = await renderDialog({
                value: {...EMPTY_FORM_VALUE, title: "Tent", linked: true},
                entityIsLinked: true,
            });

            expect(linkedCheckbox(el).checked).toBe(true);
        });
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

        // Not "no .complete-toggle row at all" - the "Link to shared
        // list" checkbox below uses that same row styling and always
        // renders regardless of due-datetime support.
        const rows = [...(el.shadowRoot?.querySelectorAll(".complete-toggle") ?? [])];
        expect(rows.some(r => r.textContent?.includes("Trigger automation when due"))).toBe(false);
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

    // Live use case: avoid inadvertently deleting an anchor item (e.g.
    // a "person" pin like "Brodie"/"Anna" a shared list's own
    // organization relies on).
    describe("delete protection", () => {
        function deleteProtectedCheckbox(el: TodoItemDialog): HTMLElement & {checked?: boolean} {
            return el.shadowRoot?.querySelector("#todo-item-delete-protected") as HTMLElement & {checked?: boolean};
        }

        function deleteButton(el: TodoItemDialog): HTMLButtonElement {
            return [...(el.shadowRoot?.querySelectorAll("button") ?? [])]
                .find(b => b.textContent?.trim() === "Delete") as HTMLButtonElement;
        }

        it("defaults to unchecked and shows no hint", async () => {
            const el = await renderDialog({value: {...EMPTY_FORM_VALUE, title: "Milk"}});

            expect(deleteProtectedCheckbox(el).checked).toBe(false);
            const hints = [...(el.shadowRoot?.querySelectorAll(".field-hint") ?? [])];
            expect(hints.some(h => h.textContent?.includes("Blocks the delete button"))).toBe(false);
        });

        it("seeds the checkbox from an already-protected item's value and shows the hint", async () => {
            const el = await renderDialog({value: {...EMPTY_FORM_VALUE, title: "Brodie", deleteProtected: true}});

            expect(deleteProtectedCheckbox(el).checked).toBe(true);
            const hints = [...(el.shadowRoot?.querySelectorAll(".field-hint") ?? [])];
            expect(hints.some(h => h.textContent?.includes("Blocks the delete button"))).toBe(true);
        });

        it("updates the draft value and emits it on save when toggled", async () => {
            const el = await renderDialog({value: {...EMPTY_FORM_VALUE, title: "Brodie"}});

            deleteProtectedCheckbox(el).checked = true;
            deleteProtectedCheckbox(el).dispatchEvent(new Event("change"));
            await el.updateComplete;

            expect(el.value.deleteProtected).toBe(true);

            let detail: TodoItemFormValue | undefined;
            el.addEventListener("dialog-save", (e) => {
                detail = (e as CustomEvent<TodoItemFormValue>).detail;
            });
            saveButton(el).click();

            expect(detail?.deleteProtected).toBe(true);
        });

        it("disables the Delete button, with an explanatory title, while the item is protected", async () => {
            const el = await renderDialog({
                showDelete: true,
                value: {...EMPTY_FORM_VALUE, title: "Brodie", deleteProtected: true},
            });

            expect(deleteButton(el).disabled).toBe(true);
            expect(deleteButton(el).title).toContain("Prevent deletion");
        });

        it("re-enables the Delete button as soon as the checkbox is unticked, without saving first", async () => {
            const el = await renderDialog({
                showDelete: true,
                value: {...EMPTY_FORM_VALUE, title: "Brodie", deleteProtected: true},
            });

            deleteProtectedCheckbox(el).checked = false;
            deleteProtectedCheckbox(el).dispatchEvent(new Event("change"));
            await el.updateComplete;

            expect(deleteButton(el).disabled).toBe(false);
        });

        it("leaves the Delete button enabled for a normal (unprotected) item", async () => {
            const el = await renderDialog({showDelete: true, value: {...EMPTY_FORM_VALUE, title: "Milk"}});

            expect(deleteButton(el).disabled).toBe(false);
        });
    });

    it("emits dialog-toggle-complete when the complete-toggle checkbox changes", async () => {
        const el = await renderDialog({showCompleteToggle: true, completed: false});

        let fired = false;
        el.addEventListener("dialog-toggle-complete", () => { fired = true; });

        // Bound to "change", not "click" - see toggleComplete's own doc
        // comment: ha-checkbox's internal label/input structure fires
        // "click" twice per physical click (a real-browser-verified bug
        // that plain synthetic click dispatch never reproduced), so the
        // toggle listens for "change" instead, which fires exactly once.
        el.shadowRoot?.querySelector(".complete-toggle ha-checkbox")?.dispatchEvent(
            new Event("change", {bubbles: true}),
        );

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

    describe("trigger-on-due checkbox (change-driven, not click-driven)", () => {
        // Live-reproduced bug: a real physical click on ha-checkbox fires
        // TWO bubbling "click" events (its internal <label> wraps a native
        // <input>, and a label click both fires its own click AND the
        // browser's automatically-forwarded click to the input it labels).
        // The old @click-bound toggle (value.triggerOnDue = !value.
        // triggerOnDue) silently cancelled itself out on every real click -
        // on, then immediately back off. A directly-dispatched synthetic
        // "click" CustomEvent never reproduced this (it bypasses the
        // internal label entirely, so it only ever fires once) - which is
        // exactly why this slipped through earlier testing. "change" fires
        // exactly once per genuine value transition regardless of how many
        // internal clicks produced it, so these confirm the fix reads the
        // checkbox's own resulting state rather than blindly toggling.

        it("sets triggerOnDue to match the checkbox's resulting checked state on change", async () => {
            const el = await renderDialog({
                value: {...EMPTY_FORM_VALUE, dueDate: "2026-01-01", dueTime: "09:00", triggerOnDue: false},
                fieldSupport: {description: false, dueDate: true, dueDateTime: true},
            });

            const checkbox = triggerOnDueCheckbox(el);
            checkbox.checked = true;
            checkbox.dispatchEvent(new Event("change", {bubbles: true}));

            expect(el.value.triggerOnDue).toBe(true);
        });

        it("a real checkbox's double bubbling click never cancels the toggle back out, "
            + "since only 'change' is listened for", async () => {
            const el = await renderDialog({
                value: {...EMPTY_FORM_VALUE, dueDate: "2026-01-01", dueTime: "09:00", triggerOnDue: false},
                fieldSupport: {description: false, dueDate: true, dueDateTime: true},
            });

            const checkbox = triggerOnDueCheckbox(el);

            // Exactly what one real physical click produces: two "click"
            // events (ignored - no listener), then a single "change" once
            // the underlying value has actually settled.
            checkbox.dispatchEvent(new Event("click", {bubbles: true}));
            checkbox.dispatchEvent(new Event("click", {bubbles: true}));
            checkbox.checked = true;
            checkbox.dispatchEvent(new Event("change", {bubbles: true}));

            expect(el.value.triggerOnDue).toBe(true);
        });

        it("unchecking (checked -> false) is also reflected correctly on change", async () => {
            const el = await renderDialog({
                value: {...EMPTY_FORM_VALUE, dueDate: "2026-01-01", dueTime: "09:00", triggerOnDue: true},
                fieldSupport: {description: false, dueDate: true, dueDateTime: true},
            });

            const checkbox = triggerOnDueCheckbox(el);
            checkbox.checked = false;
            checkbox.dispatchEvent(new Event("change", {bubbles: true}));

            expect(el.value.triggerOnDue).toBe(false);
        });
    });

    describe("due date/time - hand-rolled day/month/year + hour/minute segments", () => {
        // Live-reproduced bug: both <input type="date"> (follows the
        // browser/OS locale, confirmed via a real Chrome session that a
        // "lang" attribute override does NOT change) and ha-date-input/
        // ha-time-input (confirmed via a real dashboard session to not
        // even be registered as custom elements, rendering invisible and
        // uneditable) failed to reliably give a day-month-year field. A
        // fixed set of plain digit segments sidesteps both.

        // Hour/minute are a stepper widget (see the CSS ".stepper"/
        // ".stepper-value") rather than plain digit segments - found by
        // aria-label, not a shared class, since both live inside the
        // same .hm-row.
        function timeStepperInput(el: TodoItemDialog, label: "Hour" | "Minute"): HTMLInputElement {
            return el.shadowRoot?.querySelector(`.hm-row input[aria-label="${label}"]`) as HTMLInputElement;
        }

        function setTimeStepperInput(el: TodoItemDialog, label: "Hour" | "Minute", text: string): void {
            const input = timeStepperInput(el, label);
            input.value = text;
            input.dispatchEvent(new Event("input", {bubbles: true}));
        }

        function stepperButton(el: TodoItemDialog, label: "Hour" | "Minute", dir: "Increase" | "Decrease"): HTMLButtonElement {
            return el.shadowRoot?.querySelector(`.hm-row button[aria-label="${dir} ${label.toLowerCase()}"]`) as HTMLButtonElement;
        }

        function ampmToggle(el: TodoItemDialog): HTMLElement {
            return el.shadowRoot?.querySelector('.hm-row .segmented[aria-label="AM or PM"]') as HTMLElement;
        }

        function ampmButton(el: TodoItemDialog, period: "AM" | "PM"): HTMLButtonElement {
            return [...ampmToggle(el).querySelectorAll("button")].find(b => b.textContent?.trim() === period) as HTMLButtonElement;
        }

        function activeAmPm(el: TodoItemDialog): string | undefined {
            return ampmToggle(el).querySelector("button.active")?.textContent?.trim();
        }

        function setAmPm(el: TodoItemDialog, period: "AM" | "PM"): void {
            ampmButton(el, period).click();
        }

        it("renders plain digit-segment date inputs and a stepper time widget, never a native date/time input or ha-date-input/ha-time-input", async () => {
            const el = await renderDialog({
                fieldSupport: {description: false, dueDate: true, dueDateTime: true},
            });

            expect(el.shadowRoot?.querySelector("input[type='date']")).toBeNull();
            expect(el.shadowRoot?.querySelector("input[type='time']")).toBeNull();
            expect(el.shadowRoot?.querySelector("ha-date-input")).toBeNull();
            expect(el.shadowRoot?.querySelector("ha-time-input")).toBeNull();
            expect(el.shadowRoot?.querySelector("select.ampm-select")).toBeNull();

            expect(segment(el, "day")).not.toBeNull();
            expect(segment(el, "month")).not.toBeNull();
            expect(segment(el, "year")).not.toBeNull();
            expect(timeStepperInput(el, "Hour")).not.toBeNull();
            expect(timeStepperInput(el, "Minute")).not.toBeNull();
        });

        it("lays segments out in day, then month, then year order - never month-first", async () => {
            const el = await renderDialog({
                fieldSupport: {description: false, dueDate: true, dueDateTime: true},
            });

            const dmyRow = el.shadowRoot?.querySelector(".dmy-row");
            const classes = [...(dmyRow?.querySelectorAll("input") ?? [])].map(i => i.className);

            expect(classes).toEqual(["segment day", "segment month", "segment year"]);
        });

        it("pre-fills day/month/year and hour/minute from an existing dueDate/dueTime", async () => {
            const el = await renderDialog({
                value: {...EMPTY_FORM_VALUE, dueDate: "2026-03-05", dueTime: "09:07"},
                fieldSupport: {description: false, dueDate: true, dueDateTime: true},
            });

            expect(segment(el, "day").value).toBe("05");
            expect(segment(el, "month").value).toBe("03");
            expect(segment(el, "year").value).toBe("2026");
            expect(timeStepperInput(el, "Hour").value).toBe("09");
            expect(timeStepperInput(el, "Minute").value).toBe("07");
        });

        it("renders the time as a 12-hour clock with an AM/PM toggle, not 24-hour or a dropdown", async () => {
            const el = await renderDialog({
                fieldSupport: {description: false, dueDate: true, dueDateTime: true},
            });

            const buttons = [...ampmToggle(el).querySelectorAll("button")].map(b => b.textContent?.trim());
            expect(buttons).toEqual(["AM", "PM"]);
        });

        it("pre-fills an afternoon 24h dueTime (14:30) as 12h PM (02:30 PM)", async () => {
            const el = await renderDialog({
                value: {...EMPTY_FORM_VALUE, dueTime: "14:30"},
                fieldSupport: {description: false, dueDate: true, dueDateTime: true},
            });

            expect(timeStepperInput(el, "Hour").value).toBe("02");
            expect(timeStepperInput(el, "Minute").value).toBe("30");
            expect(activeAmPm(el)).toBe("PM");
        });

        it("pre-fills midnight (00:15) as 12 AM, and noon (12:00) as 12 PM", async () => {
            const midnight = await renderDialog({
                value: {...EMPTY_FORM_VALUE, dueTime: "00:15"},
                fieldSupport: {description: false, dueDate: true, dueDateTime: true},
            });
            expect(timeStepperInput(midnight, "Hour").value).toBe("12");
            expect(activeAmPm(midnight)).toBe("AM");

            const noon = await renderDialog({
                value: {...EMPTY_FORM_VALUE, dueTime: "12:00"},
                fieldSupport: {description: false, dueDate: true, dueDateTime: true},
            });
            expect(timeStepperInput(noon, "Hour").value).toBe("12");
            expect(activeAmPm(noon)).toBe("PM");
        });

        it("combines 12h + AM/PM back into 24h dueTime correctly (2:30 PM -> 14:30)", async () => {
            const el = await renderDialog({
                value: {...EMPTY_FORM_VALUE, dueTime: ""},
                fieldSupport: {description: false, dueDate: true, dueDateTime: true},
            });

            setTimeStepperInput(el, "Hour", "2");
            setTimeStepperInput(el, "Minute", "30");
            setAmPm(el, "PM");

            expect(el.value.dueTime).toBe("14:30");
        });

        it("combines 12 AM and 12 PM to the correct 24h boundary values (midnight/noon)", async () => {
            const el = await renderDialog({
                value: {...EMPTY_FORM_VALUE, dueTime: ""},
                fieldSupport: {description: false, dueDate: true, dueDateTime: true},
            });

            setTimeStepperInput(el, "Hour", "12");
            setTimeStepperInput(el, "Minute", "00");
            setAmPm(el, "AM");
            expect(el.value.dueTime).toBe("00:00");

            setAmPm(el, "PM");
            expect(el.value.dueTime).toBe("12:00");
        });

        it("the hour stepper's + button nudges by 1, wrapping 12 -> 1", async () => {
            const el = await renderDialog({
                value: {...EMPTY_FORM_VALUE, dueTime: "11:00"},
                fieldSupport: {description: false, dueDate: true, dueDateTime: true},
            });

            stepperButton(el, "Hour", "Increase").click();
            await el.updateComplete;
            expect(timeStepperInput(el, "Hour").value).toBe("12");

            stepperButton(el, "Hour", "Increase").click();
            await el.updateComplete;
            expect(timeStepperInput(el, "Hour").value).toBe("01");
        });

        it("the minute stepper's buttons nudge by 15, wrapping 59 -> 00 and 00 -> 45", async () => {
            const el = await renderDialog({
                value: {...EMPTY_FORM_VALUE, dueTime: "09:50"},
                fieldSupport: {description: false, dueDate: true, dueDateTime: true},
            });

            stepperButton(el, "Minute", "Increase").click();
            await el.updateComplete;
            expect(timeStepperInput(el, "Minute").value).toBe("05");

            stepperButton(el, "Minute", "Decrease").click();
            await el.updateComplete;
            expect(timeStepperInput(el, "Minute").value).toBe("50");

            stepperButton(el, "Minute", "Decrease").click();
            await el.updateComplete;
            expect(timeStepperInput(el, "Minute").value).toBe("35");
        });

        it("only sets dueDate once day, month, AND year are all filled in", async () => {
            const el = await renderDialog({
                value: {...EMPTY_FORM_VALUE, dueDate: ""},
                fieldSupport: {description: false, dueDate: true, dueDateTime: true},
            });

            setSegment(el, "day", "5");
            expect(el.value.dueDate).toBe("");

            setSegment(el, "month", "3");
            expect(el.value.dueDate).toBe("");

            setSegment(el, "year", "2026");
            expect(el.value.dueDate).toBe("2026-03-05");
        });

        it("only sets dueTime once both hour and minute are filled in", async () => {
            const el = await renderDialog({
                value: {...EMPTY_FORM_VALUE, dueTime: ""},
                fieldSupport: {description: false, dueDate: true, dueDateTime: true},
            });

            setTimeStepperInput(el, "Hour", "9");
            expect(el.value.dueTime).toBe("");

            setTimeStepperInput(el, "Minute", "5");
            expect(el.value.dueTime).toBe("09:05");
        });

        it("strips non-digit characters and caps segment length (paste-safety)", async () => {
            const el = await renderDialog({
                value: {...EMPTY_FORM_VALUE, dueDate: ""},
                fieldSupport: {description: false, dueDate: true, dueDateTime: true},
            });

            setSegment(el, "day", "3a1");
            setSegment(el, "month", "12x");
            setSegment(el, "year", "abc20267");
            await el.updateComplete;

            expect(segment(el, "day").value).toBe("31");
            expect(segment(el, "month").value).toBe("12");
            expect(segment(el, "year").value).toBe("2026");
            expect(el.value.dueDate).toBe("2026-12-31");
        });

        it("clearing a previously-complete date back out empties dueDate again", async () => {
            const el = await renderDialog({
                value: {...EMPTY_FORM_VALUE, dueDate: "2026-01-01", dueTime: "09:00"},
                fieldSupport: {description: false, dueDate: true, dueDateTime: true},
            });

            setSegment(el, "year", "");

            expect(el.value.dueDate).toBe("");
        });
    });

    describe("repeats", () => {
        function chip(el: TodoItemDialog, label: string): HTMLButtonElement {
            return [...(el.shadowRoot?.querySelectorAll(".chip") ?? [])]
                .find(b => b.textContent?.trim() === label) as HTMLButtonElement;
        }

        function fromToggle(el: TodoItemDialog): HTMLElement {
            return el.shadowRoot?.querySelector('.segmented[aria-label="Repeat from"]') as HTMLElement;
        }

        function fromButton(el: TodoItemDialog, label: "From due date" | "From completion"): HTMLButtonElement {
            return [...fromToggle(el).querySelectorAll("button")].find(b => b.textContent?.trim() === label) as HTMLButtonElement;
        }

        function activeFrom(el: TodoItemDialog): string | undefined {
            return fromToggle(el).querySelector("button.active")?.textContent?.trim();
        }

        function intervalInput(el: TodoItemDialog): HTMLInputElement {
            return el.shadowRoot?.querySelector(".stepper-value.interval") as HTMLInputElement;
        }

        function unitSelect(el: TodoItemDialog): HTMLSelectElement {
            return el.shadowRoot?.querySelector(".unit-select") as HTMLSelectElement;
        }

        function withDueDate(overrides: Partial<TodoItemFormValue> = {}): TodoItemFormValue {
            return {...EMPTY_FORM_VALUE, dueDate: "2026-01-05", ...overrides};
        }

        const fieldSupport = {description: false, dueDate: true, dueDateTime: true};

        it("defaults to \"Doesn't repeat\" with no due date needed to show the chips", async () => {
            const el = await renderDialog({value: EMPTY_FORM_VALUE, fieldSupport});

            expect(chip(el, "Doesn't repeat").classList.contains("active")).toBe(true);
            expect(fromToggle(el)).toBeNull();
        });

        it("clicking Daily/Weekly/Monthly sets interval=1 with the matching unit, defaulting from to \"due\"", async () => {
            const el = await renderDialog({value: withDueDate(), fieldSupport});

            chip(el, "Weekly").click();
            await el.updateComplete;

            expect(el.value.repeatInterval).toBe(1);
            expect(el.value.repeatUnit).toBe("weeks");
            expect(el.value.repeatFrom).toBe("due");
            expect(activeFrom(el)).toBe("From due date");
        });

        it("clicking Custom reveals an interval stepper and unit select, defaulting to 2 days (never 1 - that's Daily)", async () => {
            const el = await renderDialog({value: withDueDate(), fieldSupport});

            chip(el, "Custom").click();
            await el.updateComplete;

            expect(el.value.repeatInterval).toBe(2);
            expect(el.value.repeatUnit).toBe("days");
            expect(intervalInput(el)).not.toBeNull();
            expect(unitSelect(el).value).toBe("days");
        });

        it("typing a custom interval and changing the unit updates the value", async () => {
            const el = await renderDialog({value: withDueDate({repeatInterval: 2, repeatUnit: "days", repeatFrom: "due"}), fieldSupport});

            const input = intervalInput(el);
            input.value = "30";
            input.dispatchEvent(new Event("input", {bubbles: true}));
            await el.updateComplete;

            unitSelect(el).value = "weeks";
            unitSelect(el).dispatchEvent(new Event("change", {bubbles: true}));
            await el.updateComplete;

            expect(el.value.repeatInterval).toBe(30);
            expect(el.value.repeatUnit).toBe("weeks");
        });

        it("the interval stepper's buttons nudge by 1, clamped to [1, 365]", async () => {
            const el = await renderDialog({value: withDueDate({repeatInterval: 2, repeatUnit: "days", repeatFrom: "due"}), fieldSupport});

            const decrease = el.shadowRoot?.querySelector('button[aria-label="Decrease repeat interval"]') as HTMLButtonElement;
            const increase = el.shadowRoot?.querySelector('button[aria-label="Increase repeat interval"]') as HTMLButtonElement;

            decrease.click();
            decrease.click();
            await el.updateComplete;
            expect(el.value.repeatInterval).toBe(1);

            increase.click();
            increase.click();
            await el.updateComplete;
            expect(el.value.repeatInterval).toBe(3);
        });

        it("clicking \"Doesn't repeat\" clears interval, unit, and from together", async () => {
            const el = await renderDialog({
                value: withDueDate({repeatInterval: 2, repeatUnit: "weeks", repeatFrom: "completion"}),
                fieldSupport,
            });

            chip(el, "Doesn't repeat").click();
            await el.updateComplete;

            expect(el.value.repeatInterval).toBeNull();
            expect(el.value.repeatUnit).toBe("");
            expect(el.value.repeatFrom).toBe("");
        });

        it("toggling repeat-from between due and completion updates the value and the caption", async () => {
            const el = await renderDialog({value: withDueDate({repeatInterval: 1, repeatUnit: "weeks", repeatFrom: "due"}), fieldSupport});

            fromButton(el, "From completion").click();
            await el.updateComplete;

            expect(el.value.repeatFrom).toBe("completion");
            expect(el.shadowRoot?.querySelector(".repeat-from-caption")?.textContent).toContain("Floating schedule");

            fromButton(el, "From due date").click();
            await el.updateComplete;

            expect(el.value.repeatFrom).toBe("due");
            expect(el.shadowRoot?.querySelector(".repeat-from-caption")?.textContent).toContain("Fixed schedule");
        });

        it("shows a hint and disables Save when a repeat is set but there is no due date yet", async () => {
            const el = await renderDialog({
                value: {...EMPTY_FORM_VALUE, repeatInterval: 1, repeatUnit: "weeks", repeatFrom: "due"},
                fieldSupport,
            });

            expect(el.shadowRoot?.querySelector(".field-hint")?.textContent).toContain("Set a due date above");
            expect(saveButton(el).disabled).toBe(true);
        });

        it("re-enables Save once a due date is filled in for a pending repeat", async () => {
            const el = await renderDialog({
                value: {...EMPTY_FORM_VALUE, repeatInterval: 1, repeatUnit: "weeks", repeatFrom: "due"},
                fieldSupport,
            });
            expect(saveButton(el).disabled).toBe(true);

            setSegment(el, "day", "05");
            setSegment(el, "month", "01");
            setSegment(el, "year", "2026");
            await el.updateComplete;

            expect(saveButton(el).disabled).toBe(false);
        });

        it("shows a summary line naming the interval and schedule type", async () => {
            const el = await renderDialog({value: withDueDate({repeatInterval: 1, repeatUnit: "weeks", repeatFrom: "due"}), fieldSupport});

            const summary = el.shadowRoot?.querySelector(".repeat-summary")?.textContent;
            expect(summary).toContain("Repeats every week");
            expect(summary).toContain("from its own due date");
        });
    });

    describe("calendar date-picker panel", () => {
        function calendarToggle(el: TodoItemDialog): HTMLButtonElement {
            return el.shadowRoot?.querySelector(".calendar-toggle") as HTMLButtonElement;
        }

        function panel(el: TodoItemDialog): Element | null | undefined {
            return el.shadowRoot?.querySelector(".date-picker-panel");
        }

        function dayButtons(el: TodoItemDialog): HTMLButtonElement[] {
            return [...(el.shadowRoot?.querySelectorAll(".date-picker-day") ?? [])] as HTMLButtonElement[];
        }

        function dayButton(el: TodoItemDialog, day: number): HTMLButtonElement {
            return dayButtons(el).find(b => b.textContent?.trim() === String(day))!;
        }

        it("is closed by default, and toggles open/closed via the calendar button", async () => {
            const el = await renderDialog({
                fieldSupport: {description: false, dueDate: true, dueDateTime: true},
            });

            expect(panel(el)).toBeNull();

            calendarToggle(el).click();
            await el.updateComplete;
            expect(panel(el)).not.toBeNull();

            calendarToggle(el).click();
            await el.updateComplete;
            expect(panel(el)).toBeNull();
        });

        it("opens showing the month of an already-selected date, with that day marked selected", async () => {
            const el = await renderDialog({
                value: {...EMPTY_FORM_VALUE, dueDate: "2026-03-05"},
                fieldSupport: {description: false, dueDate: true, dueDateTime: true},
            });

            calendarToggle(el).click();
            await el.updateComplete;

            expect(panel(el)?.querySelector(".date-picker-header span")?.textContent?.trim()).toBe("March 2026");
            expect(dayButton(el, 5).classList.contains("selected")).toBe(true);
            expect(dayButton(el, 6).classList.contains("selected")).toBe(false);
        });

        it("defaults to the current real month when no date is set yet, with nothing marked selected", async () => {
            const el = await renderDialog({
                fieldSupport: {description: false, dueDate: true, dueDateTime: true},
            });

            calendarToggle(el).click();
            await el.updateComplete;

            const now = new Date();
            const expectedHeader = `${now.toLocaleString("en-US", {month: "long"})} ${now.getFullYear()}`;
            expect(panel(el)?.querySelector(".date-picker-header span")?.textContent?.trim()).toBe(expectedHeader);
            expect(dayButtons(el).some(b => b.classList.contains("selected"))).toBe(false);
        });

        it("clicking a day fills in day/month/year and closes the panel", async () => {
            const el = await renderDialog({
                value: {...EMPTY_FORM_VALUE, dueDate: "2026-03-05"},
                fieldSupport: {description: false, dueDate: true, dueDateTime: true},
            });

            calendarToggle(el).click();
            await el.updateComplete;

            dayButton(el, 17).click();
            await el.updateComplete;

            expect(panel(el)).toBeNull();
            expect(el.value.dueDate).toBe("2026-03-17");
            expect(segment(el, "day").value).toBe("17");
            expect(segment(el, "month").value).toBe("03");
            expect(segment(el, "year").value).toBe("2026");
        });

        it("navigates to the previous/next month without changing the selected date", async () => {
            const el = await renderDialog({
                value: {...EMPTY_FORM_VALUE, dueDate: "2026-03-05"},
                fieldSupport: {description: false, dueDate: true, dueDateTime: true},
            });

            calendarToggle(el).click();
            await el.updateComplete;

            const [prevButton, nextButton] = [
                ...(panel(el)?.querySelectorAll(".date-picker-nav") ?? []),
            ] as HTMLButtonElement[];

            nextButton.click();
            await el.updateComplete;
            expect(panel(el)?.querySelector(".date-picker-header span")?.textContent?.trim()).toBe("April 2026");
            expect(el.value.dueDate).toBe("2026-03-05");

            prevButton.click();
            prevButton.click();
            await el.updateComplete;
            expect(panel(el)?.querySelector(".date-picker-header span")?.textContent?.trim()).toBe("February 2026");
            expect(el.value.dueDate).toBe("2026-03-05");
        });

        it("crosses a year boundary correctly (December -> January and back)", async () => {
            const el = await renderDialog({
                value: {...EMPTY_FORM_VALUE, dueDate: "2026-12-15"},
                fieldSupport: {description: false, dueDate: true, dueDateTime: true},
            });

            calendarToggle(el).click();
            await el.updateComplete;
            expect(panel(el)?.querySelector(".date-picker-header span")?.textContent?.trim()).toBe("December 2026");

            const [, nextButton] = [
                ...(panel(el)?.querySelectorAll(".date-picker-nav") ?? []),
            ] as HTMLButtonElement[];
            nextButton.click();
            await el.updateComplete;

            expect(panel(el)?.querySelector(".date-picker-header span")?.textContent?.trim()).toBe("January 2027");
        });
    });
});
