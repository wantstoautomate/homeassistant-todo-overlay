import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import "../src/components/todo-item-dialog";
import type {TodoItemDialog, TodoItemDialogFieldSupport, TodoItemFormValue} from "../src/components/todo-item-dialog";
import {EMPTY_FORM_VALUE} from "../src/components/todo-item-dialog";
import {formatShortDate} from "../src/recurrence";

// Pinned to Monday 12 Oct 2026, so "Today"/"Tomorrow", overdue and the
// next-due previews never depend on when the suite happens to run. Only
// Date is faked - Lit's own update scheduling keeps real timers.
const TODAY = new Date(2026, 9, 12, 10, 0);

const ALL_SUPPORT: TodoItemDialogFieldSupport = {description: true, dueDate: true, dueDateTime: true};

beforeEach(() => {
    vi.useFakeTimers({toFake: ["Date"]});
    vi.setSystemTime(TODAY);
});

afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
});

async function renderDialog(props: Partial<TodoItemDialog> = {}): Promise<TodoItemDialog> {
    const el = document.createElement("todo-overlay-item-dialog") as TodoItemDialog;

    Object.assign(el, {value: {...EMPTY_FORM_VALUE, title: "Bins out"}, fieldSupport: ALL_SUPPORT, ...props});

    document.body.appendChild(el);
    await el.updateComplete;

    return el;
}

function q<T extends Element = HTMLElement>(el: TodoItemDialog, selector: string): T {
    return el.shadowRoot!.querySelector(selector) as T;
}

function buttons(el: TodoItemDialog, scope = ""): HTMLButtonElement[] {
    return [...el.shadowRoot!.querySelectorAll(`${scope} button`)] as HTMLButtonElement[];
}

function button(el: TodoItemDialog, label: string, scope = ""): HTMLButtonElement {
    return buttons(el, scope).find(b => b.textContent?.trim() === label)!;
}

function saveButton(el: TodoItemDialog): HTMLButtonElement {
    return button(el, "Save", ".actions");
}

async function click(el: TodoItemDialog, target: HTMLElement): Promise<void> {
    target.click();
    await el.updateComplete;
}

async function type(el: TodoItemDialog, input: HTMLInputElement | HTMLTextAreaElement, text: string): Promise<void> {
    input.value = text;
    input.dispatchEvent(new Event("input", {bubbles: true}));
    await el.updateComplete;
}

async function setSwitch(el: TodoItemDialog, id: string, checked: boolean): Promise<void> {
    const input = q<HTMLInputElement>(el, `#${id}`);
    input.checked = checked;
    input.dispatchEvent(new Event("change", {bubbles: true}));
    await el.updateComplete;
}

async function selectPinType(el: TodoItemDialog, value: string): Promise<void> {
    const select = q<HTMLSelectElement>(el, "#todo-item-pin-type");
    select.value = value;
    select.dispatchEvent(new Event("change", {bubbles: true}));
    await el.updateComplete;
}

function rowValue(el: TodoItemDialog, rowId: string): string {
    return q(el, `#${rowId} .val`)?.textContent?.trim() ?? "";
}

function captureSave(el: TodoItemDialog): () => TodoItemFormValue | undefined {
    let detail: TodoItemFormValue | undefined;
    el.addEventListener("dialog-save", (e) => {
        detail = (e as CustomEvent<TodoItemFormValue>).detail;
    });
    return () => detail;
}

describe("todo-overlay-item-dialog", () => {
    describe("basics", () => {
        it("emits dialog-save with the current value when Save is clicked", async () => {
            const value: TodoItemFormValue = {...EMPTY_FORM_VALUE, title: "Buy milk"};
            const el = await renderDialog({value});
            const saved = captureSave(el);

            saveButton(el).click();

            expect(saved()).toEqual(value);
        });

        it("puts the heading and the Show as picker in ha-dialog's headerTitle slot", async () => {
            const el = await renderDialog({heading: "Edit"});

            const title = q(el, '[slot="headerTitle"]');
            expect(title.textContent).toContain("Edit");
            expect(title.querySelector("#todo-item-pin-type")).not.toBeNull();
        });

        it("emits dialog-close when the dialog fires 'closed', and when Cancel is clicked", async () => {
            const el = await renderDialog();
            let closes = 0;
            el.addEventListener("dialog-close", () => {
                closes += 1;
            });

            q(el, "ha-dialog").dispatchEvent(new Event("closed"));
            button(el, "Cancel", ".actions").click();

            expect(closes).toBe(2);
        });

        it("updates the title as the user types, and blocks Save while it's empty", async () => {
            const el = await renderDialog({value: {...EMPTY_FORM_VALUE}});
            expect(saveButton(el).disabled).toBe(true);

            await type(el, q<HTMLInputElement>(el, "#todo-item-title"), "Renew passport");

            expect(el.value.title).toBe("Renew passport");
            expect(saveButton(el).disabled).toBe(false);
        });

        it("never renders a native date/time input or HA's date/time pickers", async () => {
            const el = await renderDialog({value: {...EMPTY_FORM_VALUE, title: "x", dueDate: "2026-10-16", dueTime: "09:00"}});
            await click(el, q(el, "#todo-item-due-date-row"));

            expect(q(el, "input[type='date']")).toBeNull();
            expect(q(el, "input[type='time']")).toBeNull();
            expect(q(el, "ha-date-input")).toBeNull();
            expect(q(el, "ha-time-input")).toBeNull();
        });

        it("goes two-column wide when it has a When section, and stays single when it doesn't", async () => {
            const withDue = await renderDialog();
            expect(q(withDue, "ha-dialog").classList.contains("wide")).toBe(true);
            expect(q(withDue, ".cols").classList.contains("two")).toBe(true);

            const withoutDue = await renderDialog({fieldSupport: {description: true, dueDate: false, dueDateTime: false}});
            expect(q(withoutDue, "ha-dialog").classList.contains("wide")).toBe(false);
            expect(q(withoutDue, ".area-when")).toBeNull();
        });
    });

    describe("Show as", () => {
        it("defaults to a normal item and seeds from an already-pinned item", async () => {
            const plain = await renderDialog();
            expect(q<HTMLSelectElement>(plain, "#todo-item-pin-type").value).toBe("");

            const pinned = await renderDialog({value: {...EMPTY_FORM_VALUE, title: "Groceries", pinType: "category"}});
            expect(q<HTMLSelectElement>(pinned, "#todo-item-pin-type").value).toBe("category");
        });

        it("emits the picked pin type on save", async () => {
            const el = await renderDialog();
            const saved = captureSave(el);

            await selectPinType(el, "person");
            saveButton(el).click();

            expect(saved()?.pinType).toBe("person");
        });

        it("drops Quantity and relabels the title for Category and Person", async () => {
            const el = await renderDialog();
            expect(q(el, "#todo-item-quantity")).not.toBeNull();

            await selectPinType(el, "category");
            expect(q(el, "#todo-item-quantity")).toBeNull();
            expect(q(el, 'label[for="todo-item-title"]').textContent).toBe("Category name");

            await selectPinType(el, "person");
            expect(q(el, 'label[for="todo-item-title"]').textContent).toBe("Name");
        });
    });

    describe("day of week pin", () => {
        function weekdayButton(el: TodoItemDialog, name: string): HTMLButtonElement {
            return q(el, `[aria-label="Day of week"] button[aria-label="${name}"]`) as HTMLButtonElement;
        }

        it("shows no weekday picker until Day of week is picked", async () => {
            const el = await renderDialog();

            expect(q(el, '[aria-label="Day of week"]')).toBeNull();
        });

        it("swaps the title for a day picker and replaces When with how day pins behave", async () => {
            const el = await renderDialog({value: {...EMPTY_FORM_VALUE, title: "Gym", dueDate: "2026-10-16"}});

            await selectPinType(el, "day");

            expect(q<HTMLInputElement>(el, "#todo-item-title").disabled).toBe(true);
            expect(q(el, '[aria-label="Day of week"]')).not.toBeNull();
            expect(q(el, "#todo-item-due-date-row")).toBeNull();
            expect(q(el, ".day-card").textContent).toContain("Overdue");
        });

        it("blocks Save until a weekday is picked, then emits that weekday's name as the title", async () => {
            const el = await renderDialog({value: {...EMPTY_FORM_VALUE, title: "Something else"}});
            const saved = captureSave(el);

            await selectPinType(el, "day");
            expect(saveButton(el).disabled).toBe(true);

            await click(el, weekdayButton(el, "Wednesday"));
            expect(q<HTMLInputElement>(el, "#todo-item-title").value).toBe("Wednesday");
            expect(saveButton(el).disabled).toBe(false);

            saveButton(el).click();
            expect(saved()?.title).toBe("Wednesday");
            expect(saved()?.dayWeekday).toBe("2");
        });

        it("seeds the picker and title from an existing day pin", async () => {
            const el = await renderDialog({value: {...EMPTY_FORM_VALUE, title: "Friday", pinType: "day", dayWeekday: "4"}});

            expect(weekdayButton(el, "Friday").getAttribute("aria-pressed")).toBe("true");
            expect(q<HTMLInputElement>(el, "#todo-item-title").value).toBe("Friday");
        });
    });

    describe("When - locked until there's a date", () => {
        it("locks Time and Repeats with the reason, and says what the automation needs", async () => {
            const el = await renderDialog();

            expect(q<HTMLButtonElement>(el, "#todo-item-due-time-row").disabled).toBe(true);
            expect(q<HTMLButtonElement>(el, "#todo-item-repeat-row").disabled).toBe(true);
            expect(q(el, "#todo-item-repeat-row").textContent).toContain("Set a date first");
            expect(q<HTMLInputElement>(el, "#todo-item-trigger-on-due").disabled).toBe(true);
            expect(el.shadowRoot!.textContent).toContain("Needs a due date and time");
            expect(rowValue(el, "todo-item-due-date-row")).toBe("None");
        });

        it("unlocks Time and Repeats once a date is picked", async () => {
            const el = await renderDialog();
            await click(el, q(el, "#todo-item-due-date-row"));
            await click(el, button(el, "Tomorrow", ".date-panel"));

            expect(el.value.dueDate).toBe("2026-10-13");
            expect(q<HTMLButtonElement>(el, "#todo-item-due-time-row").disabled).toBe(false);
            expect(q<HTMLButtonElement>(el, "#todo-item-repeat-row").disabled).toBe(false);
        });

        it("clearing the date also clears time, repeat and the automation trigger", async () => {
            const el = await renderDialog({value: {
                ...EMPTY_FORM_VALUE, title: "Bins out", dueDate: "2026-10-16", dueTime: "09:00", triggerOnDue: true,
                repeatInterval: 1, repeatUnit: "weeks", repeatFrom: "due",
            }});

            await click(el, q(el, "#todo-item-due-date-row"));
            await click(el, button(el, "Clear date", ".date-panel"));

            expect(el.value).toMatchObject({
                dueDate: "", dueTime: "", triggerOnDue: false, repeatInterval: null, repeatUnit: "", repeatFrom: "",
            });
        });

        it("keeps only one row open at a time", async () => {
            const el = await renderDialog({value: {...EMPTY_FORM_VALUE, title: "x", dueDate: "2026-10-16"}});

            await click(el, q(el, "#todo-item-due-date-row"));
            expect(q(el, ".date-panel")).not.toBeNull();

            await click(el, q(el, "#todo-item-repeat-row"));
            expect(q(el, ".date-panel")).toBeNull();
            expect(q(el, "#todo-item-repeat-row").getAttribute("aria-expanded")).toBe("true");
        });

        it("flags a past due date as overdue on its row", async () => {
            const el = await renderDialog({value: {...EMPTY_FORM_VALUE, title: "x", dueDate: "2026-10-09"}});

            expect(rowValue(el, "todo-item-due-date-row")).toContain("overdue");
            expect(q(el, "#todo-item-due-date-row .val").classList.contains("late")).toBe(true);
        });
    });

    describe("due date panel", () => {
        function dayButton(el: TodoItemDialog, day: number): HTMLButtonElement {
            return buttons(el, ".cal-grid").find(b => b.textContent?.trim() === String(day))!;
        }

        it("opens on the selected date's month, Monday-first, with that day marked", async () => {
            const el = await renderDialog({value: {...EMPTY_FORM_VALUE, title: "x", dueDate: "2027-03-05"}});
            await click(el, q(el, "#todo-item-due-date-row"));

            expect(q(el, ".cal-head").textContent).toContain("March 2027");
            expect(q(el, ".cal-dow").textContent).toBe("M");
            expect(dayButton(el, 5).classList.contains("selected")).toBe(true);
        });

        it("opens on the current month when there's no date yet", async () => {
            const el = await renderDialog();
            await click(el, q(el, "#todo-item-due-date-row"));

            expect(q(el, ".cal-head").textContent).toContain("October 2026");
            expect(el.shadowRoot!.querySelector(".cal-day.selected")).toBeNull();
        });

        it("picking a day sets the date and closes the panel", async () => {
            const el = await renderDialog();
            await click(el, q(el, "#todo-item-due-date-row"));
            await click(el, dayButton(el, 20));

            expect(el.value.dueDate).toBe("2026-10-20");
            expect(q(el, ".date-panel")).toBeNull();
        });

        it("navigates months across a year boundary without changing the date", async () => {
            const el = await renderDialog({value: {...EMPTY_FORM_VALUE, title: "x", dueDate: "2026-12-15"}});
            await click(el, q(el, "#todo-item-due-date-row"));

            await click(el, q(el, 'button[aria-label="Next month"]'));
            expect(q(el, ".cal-head").textContent).toContain("January 2027");

            await click(el, q(el, 'button[aria-label="Previous month"]'));
            await click(el, q(el, 'button[aria-label="Previous month"]'));
            expect(q(el, ".cal-head").textContent).toContain("November 2026");
            expect(el.value.dueDate).toBe("2026-12-15");
        });

        it("quick picks set Today and Next week", async () => {
            const el = await renderDialog();
            await click(el, q(el, "#todo-item-due-date-row"));
            await click(el, button(el, "Next week", ".date-panel"));
            expect(el.value.dueDate).toBe("2026-10-19");

            await click(el, q(el, "#todo-item-due-date-row"));
            await click(el, button(el, "Today", ".date-panel"));
            expect(el.value.dueDate).toBe("2026-10-12");
        });
    });

    describe("due time", () => {
        function timeInput(el: TodoItemDialog, label: "Hour" | "Minute"): HTMLInputElement {
            return q(el, `.time-row input[aria-label="${label}"]`) as HTMLInputElement;
        }

        function activeAmPm(el: TodoItemDialog): string | undefined {
            return q(el, ".ampm button.on")?.textContent?.trim();
        }

        async function openTime(el: TodoItemDialog): Promise<void> {
            await click(el, q(el, "#todo-item-due-time-row"));
        }

        it("opening Time on an item with none starts it at 9:00 AM", async () => {
            const el = await renderDialog({value: {...EMPTY_FORM_VALUE, title: "x", dueDate: "2026-10-16"}});
            expect(rowValue(el, "todo-item-due-time-row")).toBe("Any time");

            await openTime(el);

            expect(el.value.dueTime).toBe("09:00");
            expect(timeInput(el, "Hour").value).toBe("09");
            expect(activeAmPm(el)).toBe("AM");
            expect(rowValue(el, "todo-item-due-time-row")).toBe("9:00 AM");
        });

        it("shows a 24h time as 12h with AM/PM, including the midnight/noon boundaries", async () => {
            const afternoon = await renderDialog({value: {...EMPTY_FORM_VALUE, title: "x", dueDate: "2026-10-16", dueTime: "14:30"}});
            await openTime(afternoon);
            expect(timeInput(afternoon, "Hour").value).toBe("02");
            expect(timeInput(afternoon, "Minute").value).toBe("30");
            expect(activeAmPm(afternoon)).toBe("PM");

            const midnight = await renderDialog({value: {...EMPTY_FORM_VALUE, title: "x", dueDate: "2026-10-16", dueTime: "00:15"}});
            await openTime(midnight);
            expect(timeInput(midnight, "Hour").value).toBe("12");
            expect(activeAmPm(midnight)).toBe("AM");

            const noon = await renderDialog({value: {...EMPTY_FORM_VALUE, title: "x", dueDate: "2026-10-16", dueTime: "12:00"}});
            await openTime(noon);
            expect(activeAmPm(noon)).toBe("PM");
        });

        it("combines typed 12h + AM/PM back into 24h, including 12 AM/PM", async () => {
            const el = await renderDialog({value: {...EMPTY_FORM_VALUE, title: "x", dueDate: "2026-10-16"}});
            await openTime(el);

            await type(el, timeInput(el, "Hour"), "2");
            await type(el, timeInput(el, "Minute"), "30");
            await click(el, button(el, "PM", ".ampm"));
            expect(el.value.dueTime).toBe("14:30");

            await type(el, timeInput(el, "Hour"), "12");
            await type(el, timeInput(el, "Minute"), "00");
            await click(el, button(el, "AM", ".ampm"));
            expect(el.value.dueTime).toBe("00:00");

            await click(el, button(el, "PM", ".ampm"));
            expect(el.value.dueTime).toBe("12:00");
        });

        it("strips non-digits from typed hours/minutes", async () => {
            const el = await renderDialog({value: {...EMPTY_FORM_VALUE, title: "x", dueDate: "2026-10-16"}});
            await openTime(el);

            await type(el, timeInput(el, "Minute"), "4a5");

            expect(timeInput(el, "Minute").value).toBe("45");
        });

        async function step(el: TodoItemDialog, label: string, times = 1): Promise<void> {
            for (let i = 0; i < times; i++) {
                await click(el, q(el, `button[aria-label="${label}"]`));
            }
        }

        async function openAt(dueTime: string): Promise<TodoItemDialog> {
            const el = await renderDialog({value: {...EMPTY_FORM_VALUE, title: "x", dueDate: "2026-10-16", dueTime}});
            await openTime(el);
            return el;
        }

        it("the hour arrows flip AM/PM crossing noon: 11 AM -> 12 PM -> 1 PM, and back", async () => {
            const el = await openAt("11:00");

            await step(el, "Increase hour");
            expect([timeInput(el, "Hour").value, activeAmPm(el), el.value.dueTime]).toEqual(["12", "PM", "12:00"]);

            await step(el, "Increase hour");
            expect([timeInput(el, "Hour").value, activeAmPm(el), el.value.dueTime]).toEqual(["01", "PM", "13:00"]);

            await step(el, "Decrease hour", 2);
            expect([timeInput(el, "Hour").value, activeAmPm(el), el.value.dueTime]).toEqual(["11", "AM", "11:00"]);
        });

        it("the hour arrows flip AM/PM crossing midnight: 11 PM -> 12 AM, and 12 AM back to 11 PM", async () => {
            const el = await openAt("23:00");

            await step(el, "Increase hour");
            expect([timeInput(el, "Hour").value, activeAmPm(el), el.value.dueTime]).toEqual(["12", "AM", "00:00"]);

            await step(el, "Decrease hour");
            expect([timeInput(el, "Hour").value, activeAmPm(el), el.value.dueTime]).toEqual(["11", "PM", "23:00"]);
        });

        it("12 AM steps up to 1 AM - still morning, no flip", async () => {
            const el = await openAt("00:00");

            await step(el, "Increase hour");

            expect([timeInput(el, "Hour").value, activeAmPm(el), el.value.dueTime]).toEqual(["01", "AM", "01:00"]);
        });

        it("the minute arrows step 15 and carry into the hour", async () => {
            const el = await openAt("10:45");

            await step(el, "Increase minute");
            expect([timeInput(el, "Hour").value, timeInput(el, "Minute").value, el.value.dueTime]).toEqual(["11", "00", "11:00"]);

            await step(el, "Decrease minute");
            expect([timeInput(el, "Hour").value, timeInput(el, "Minute").value, el.value.dueTime]).toEqual(["10", "45", "10:45"]);
        });

        it("the minute arrows flip AM/PM too: 11:45 AM -> 12:00 PM, and 12:00 AM back to 11:45 PM", async () => {
            const noon = await openAt("11:45");
            await step(noon, "Increase minute");
            expect([timeInput(noon, "Hour").value, timeInput(noon, "Minute").value, activeAmPm(noon), noon.value.dueTime])
                .toEqual(["12", "00", "PM", "12:00"]);

            const midnight = await openAt("00:00");
            await step(midnight, "Decrease minute");
            expect([timeInput(midnight, "Hour").value, timeInput(midnight, "Minute").value, activeAmPm(midnight), midnight.value.dueTime])
                .toEqual(["11", "45", "PM", "23:45"]);
        });

        it("an off-quarter typed minute carries correctly (9:50 + 15 -> 10:05)", async () => {
            const el = await openAt("09:50");

            await step(el, "Increase minute");

            expect(el.value.dueTime).toBe("10:05");
        });

        it("Remove time clears the time and turns the automation trigger back off", async () => {
            const el = await renderDialog({value: {...EMPTY_FORM_VALUE, title: "x", dueDate: "2026-10-16", dueTime: "09:00", triggerOnDue: true}});
            await openTime(el);

            await click(el, button(el, "Remove time", ".panel"));

            expect(el.value.dueTime).toBe("");
            expect(el.value.triggerOnDue).toBe(false);
            expect(q(el, ".time-row")).toBeNull();
        });

        it("has no Time row or automation switch when the entity can't store a due time", async () => {
            const el = await renderDialog({fieldSupport: {description: true, dueDate: true, dueDateTime: false}});

            expect(q(el, "#todo-item-due-time-row")).toBeNull();
            expect(q(el, "#todo-item-trigger-on-due")).toBeNull();
            expect(q(el, "#todo-item-repeat-row")).not.toBeNull();
        });
    });

    describe("run automation when due", () => {
        it("is locked until there's a time, then follows the switch's own checked state", async () => {
            const el = await renderDialog({value: {...EMPTY_FORM_VALUE, title: "x", dueDate: "2026-10-16"}});
            expect(q<HTMLInputElement>(el, "#todo-item-trigger-on-due").disabled).toBe(true);
            expect(el.shadowRoot!.textContent).toContain("Needs a due time");

            await click(el, q(el, "#todo-item-due-time-row"));
            expect(q<HTMLInputElement>(el, "#todo-item-trigger-on-due").disabled).toBe(false);

            await setSwitch(el, "todo-item-trigger-on-due", true);
            expect(el.value.triggerOnDue).toBe(true);

            await setSwitch(el, "todo-item-trigger-on-due", false);
            expect(el.value.triggerOnDue).toBe(false);
        });

        it("says when it fires", async () => {
            const el = await renderDialog({value: {...EMPTY_FORM_VALUE, title: "x", dueDate: "2026-10-13", dueTime: "09:00"}});

            expect(el.shadowRoot!.textContent).toContain("Fires Tomorrow, 9:00 AM");
        });
    });

    describe("repeats", () => {
        const dated: TodoItemFormValue = {...EMPTY_FORM_VALUE, title: "Bins out", dueDate: "2026-10-16"};

        async function openRepeat(el: TodoItemDialog): Promise<void> {
            await click(el, q(el, "#todo-item-repeat-row"));
        }

        function nextOption(el: TodoItemDialog, from: "due" | "completion"): HTMLButtonElement {
            return q(el, `.next-option[data-from="${from}"]`) as HTMLButtonElement;
        }

        it("shows Never on the row by default", async () => {
            const el = await renderDialog({value: dated});

            expect(rowValue(el, "todo-item-repeat-row")).toBe("Never");
        });

        it("Daily/Weekly/Monthly set interval 1 with the matching unit, counting from the due date by default", async () => {
            const el = await renderDialog({value: dated});
            await openRepeat(el);

            await click(el, button(el, "Weekly", ".seg"));

            expect(el.value).toMatchObject({repeatInterval: 1, repeatUnit: "weeks", repeatFrom: "due"});
            expect(rowValue(el, "todo-item-repeat-row")).toBe("Weekly");
        });

        it("Custom starts at 2 days (1 day is Daily) and shows an interval and unit", async () => {
            const el = await renderDialog({value: dated});
            await openRepeat(el);

            await click(el, button(el, "Custom", ".seg"));

            expect(el.value).toMatchObject({repeatInterval: 2, repeatUnit: "days"});
            expect(q(el, "input.interval")).not.toBeNull();
            expect(q<HTMLSelectElement>(el, ".unit-select").value).toBe("days");
            expect(rowValue(el, "todo-item-repeat-row")).toBe("Every 2 days");
        });

        it("typing a custom interval and unit updates the value; clearing the box mid-edit keeps the row open", async () => {
            const el = await renderDialog({value: {...dated, repeatInterval: 2, repeatUnit: "days", repeatFrom: "due"}});
            await openRepeat(el);

            await type(el, q<HTMLInputElement>(el, "input.interval"), "");
            expect(q(el, "input.interval")).not.toBeNull();

            await type(el, q<HTMLInputElement>(el, "input.interval"), "3");
            const unit = q<HTMLSelectElement>(el, ".unit-select");
            unit.value = "months";
            unit.dispatchEvent(new Event("change", {bubbles: true}));
            await el.updateComplete;

            expect(el.value).toMatchObject({repeatInterval: 3, repeatUnit: "months"});
            expect(rowValue(el, "todo-item-repeat-row")).toBe("Every 3 months");
        });

        it("the interval arrows step by 1, never below 1", async () => {
            const el = await renderDialog({value: {...dated, repeatInterval: 2, repeatUnit: "days", repeatFrom: "due"}});
            await openRepeat(el);

            await click(el, q(el, 'button[aria-label="Decrease repeat interval"]'));
            await click(el, q(el, 'button[aria-label="Decrease repeat interval"]'));
            expect(el.value.repeatInterval).toBe(1);

            await click(el, q(el, 'button[aria-label="Increase repeat interval"]'));
            await click(el, q(el, 'button[aria-label="Increase repeat interval"]'));
            expect(el.value.repeatInterval).toBe(3);
        });

        it("Never clears interval, unit and from together", async () => {
            const el = await renderDialog({value: {...dated, repeatInterval: 2, repeatUnit: "weeks", repeatFrom: "completion"}});
            await openRepeat(el);

            await click(el, button(el, "Never", ".seg"));

            expect(el.value).toMatchObject({repeatInterval: null, repeatUnit: "", repeatFrom: ""});
        });

        it("previews the real next due date for both choices, and picking one sets repeatFrom", async () => {
            const el = await renderDialog({value: {...dated, repeatInterval: 1, repeatUnit: "weeks", repeatFrom: "due"}});
            await openRepeat(el);

            expect(nextOption(el, "due").querySelector(".date")?.textContent).toBe(formatShortDate(new Date(2026, 9, 23), TODAY));
            expect(nextOption(el, "completion").querySelector(".date")?.textContent).toBe(formatShortDate(new Date(2026, 9, 19), TODAY));
            expect(nextOption(el, "due").getAttribute("aria-pressed")).toBe("true");

            await click(el, nextOption(el, "completion"));

            expect(el.value.repeatFrom).toBe("completion");
            expect(nextOption(el, "completion").getAttribute("aria-pressed")).toBe("true");
        });

        it("the on-schedule preview skips occurrences already missed", async () => {
            const el = await renderDialog({value: {...dated, dueDate: "2026-10-01", repeatInterval: 1, repeatUnit: "weeks", repeatFrom: "due"}});
            await openRepeat(el);

            expect(nextOption(el, "due").querySelector(".date")?.textContent).toBe(formatShortDate(new Date(2026, 9, 15), TODAY));
        });
    });

    describe("tags", () => {
        function chipLabels(el: TodoItemDialog): string[] {
            return [...el.shadowRoot!.querySelectorAll(".chip")].map(chip => chip.textContent?.trim() ?? "");
        }

        async function keydown(el: TodoItemDialog, key: string): Promise<void> {
            q(el, "#todo-item-tags").dispatchEvent(new KeyboardEvent("keydown", {key, bubbles: true}));
            await el.updateComplete;
        }

        it("shows existing tags as chips", async () => {
            const el = await renderDialog({value: {...EMPTY_FORM_VALUE, title: "x", tags: "chores, outside"}});

            expect(chipLabels(el)).toEqual(["chores", "outside"]);
        });

        it("adds a typed tag on Enter, ignoring a duplicate", async () => {
            const el = await renderDialog({value: {...EMPTY_FORM_VALUE, title: "x", tags: "chores"}});

            await type(el, q<HTMLInputElement>(el, "#todo-item-tags"), "weekend");
            await keydown(el, "Enter");
            await type(el, q<HTMLInputElement>(el, "#todo-item-tags"), "chores");
            await keydown(el, "Enter");

            expect(el.value.tags).toBe("chores, weekend");
            expect(q<HTMLInputElement>(el, "#todo-item-tags").value).toBe("");
        });

        it("removes a tag via its chip, and Backspace on an empty box removes the last", async () => {
            const el = await renderDialog({value: {...EMPTY_FORM_VALUE, title: "x", tags: "a, b, c"}});

            await click(el, q(el, 'button[aria-label="Remove tag a"]'));
            expect(el.value.tags).toBe("b, c");

            await keydown(el, "Backspace");
            expect(el.value.tags).toBe("b");
        });

        it("commits a half-typed tag when the box loses focus", async () => {
            const el = await renderDialog({value: {...EMPTY_FORM_VALUE, title: "x"}});

            await type(el, q<HTMLInputElement>(el, "#todo-item-tags"), "urgent");
            q(el, "#todo-item-tags").dispatchEvent(new Event("blur"));
            await el.updateComplete;

            expect(el.value.tags).toBe("urgent");
        });
    });

    describe("Sharing & safety", () => {
        async function openOptions(el: TodoItemDialog): Promise<void> {
            await click(el, q(el, "#todo-item-options-row"));
        }

        it("starts folded with a one-line summary", async () => {
            const el = await renderDialog();

            expect(q(el, "#todo-item-linked")).toBeNull();
            expect(rowValue(el, "todo-item-options-row")).toBe("Off");
        });

        it("the summary names only what's switched on", async () => {
            const el = await renderDialog({value: {...EMPTY_FORM_VALUE, title: "Brodie", linked: true, deleteProtected: true}});

            expect(rowValue(el, "todo-item-options-row")).toBe("Linked · Protected");
        });

        it("reveals the destination field only when creating a new link, and emits it on save", async () => {
            const el = await renderDialog();
            const saved = captureSave(el);
            await openOptions(el);
            expect(q(el, "#todo-item-link-target")).toBeNull();

            await setSwitch(el, "todo-item-linked", true);
            await type(el, q<HTMLInputElement>(el, "#todo-item-link-target"), "Brodie");
            saveButton(el).click();

            expect(saved()).toMatchObject({linked: true, linkTarget: "Brodie"});
            expect(rowValue(el, "todo-item-options-row")).toContain("Linked");
        });

        it("an already-linked item shows an unlink hint instead of the destination field", async () => {
            const el = await renderDialog({value: {...EMPTY_FORM_VALUE, title: "Tent", linked: true}});
            await openOptions(el);

            expect(q<HTMLInputElement>(el, "#todo-item-linked").checked).toBe(true);
            expect(q(el, "#todo-item-link-target")).toBeNull();
            expect(el.shadowRoot!.textContent).toContain("only unlinks");
        });

        it("hides linking for an unlinked item on an already-linked list, but keeps it for a linked one", async () => {
            const unlinked = await renderDialog({entityIsLinked: true});
            await openOptions(unlinked);
            expect(q(unlinked, "#todo-item-linked")).toBeNull();

            const linked = await renderDialog({entityIsLinked: true, value: {...EMPTY_FORM_VALUE, title: "Tent", linked: true}});
            await openOptions(linked);
            expect(q(linked, "#todo-item-linked")).not.toBeNull();
        });

        it("Prevent deletion disables Delete with a reason, and re-enables it when switched off", async () => {
            const el = await renderDialog({showDelete: true});
            const saved = captureSave(el);
            await openOptions(el);

            await setSwitch(el, "todo-item-delete-protected", true);
            const del = button(el, "Delete", ".actions");
            expect(del.disabled).toBe(true);
            expect(del.title).toContain("Prevent deletion");

            await setSwitch(el, "todo-item-delete-protected", false);
            expect(button(el, "Delete", ".actions").disabled).toBe(false);

            await setSwitch(el, "todo-item-delete-protected", true);
            saveButton(el).click();
            expect(saved()?.deleteProtected).toBe(true);
        });
    });

    describe("delete", () => {
        it("asks for confirmation by default before emitting dialog-delete", async () => {
            const el = await renderDialog({showDelete: true});
            let deleted = false;
            el.addEventListener("dialog-delete", () => {
                deleted = true;
            });

            await click(el, button(el, "Delete", ".actions"));
            expect(deleted).toBe(false);
            expect(q(el, ".confirm-delete")).not.toBeNull();

            await click(el, button(el, "Delete", ".confirm-delete"));
            expect(deleted).toBe(true);
        });

        it("cancelling the confirmation leaves the item alone", async () => {
            const el = await renderDialog({showDelete: true});
            let deleted = false;
            el.addEventListener("dialog-delete", () => {
                deleted = true;
            });

            await click(el, button(el, "Delete", ".actions"));
            await click(el, button(el, "Cancel", ".confirm-delete"));

            expect(deleted).toBe(false);
            expect(q(el, ".confirm-delete")).toBeNull();
        });

        it("skips confirmation when confirmDelete is off", async () => {
            const el = await renderDialog({showDelete: true, confirmDelete: false});
            let deleted = false;
            el.addEventListener("dialog-delete", () => {
                deleted = true;
            });

            await click(el, button(el, "Delete", ".actions"));

            expect(deleted).toBe(true);
        });

        it("has no Delete button for a new item", async () => {
            const el = await renderDialog({showDelete: false});

            expect(button(el, "Delete", ".actions")).toBeUndefined();
        });
    });

    it("the Completed switch (rows with a hidden checkbox) emits dialog-toggle-complete", async () => {
        const el = await renderDialog({showCompleteToggle: true, completed: false});
        let fired = false;
        el.addEventListener("dialog-toggle-complete", () => {
            fired = true;
        });

        await setSwitch(el, "todo-item-completed", true);

        expect(fired).toBe(true);
    });
});
