import {LitElement, html, css} from "lit";
import {customElement, property, state} from "lit/decorators.js";
import {classMap} from "lit/directives/class-map.js";

const CALENDAR_ICON = html`
    <svg viewBox="0 0 24 24">
        <path d="M19,19H5V8H19M16,1V3H8V1H6V3H5C3.89,3 3,3.89 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V5C21,3.89 20.1,3 19,3H18V1M17,12H12V17H17V12Z"></path>
    </svg>
`;

const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
];

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

function daysInMonth(year: number, month0: number): number {
    return new Date(year, month0 + 1, 0).getDate();
}

function firstWeekdayOfMonth(year: number, month0: number): number {
    return new Date(year, month0, 1).getDay();
}

export interface TodoItemFormValue {
    title: string;
    quantity: string;
    tags: string;
    description: string;
    dueDate: string;
    dueTime: string;
    triggerOnDue: boolean;
}

export interface TodoItemDialogFieldSupport {
    description: boolean;
    dueDate: boolean;
    dueDateTime: boolean;
}

export const EMPTY_FORM_VALUE: TodoItemFormValue = {
    title: "",
    quantity: "",
    tags: "",
    description: "",
    dueDate: "",
    dueTime: "",
    triggerOnDue: false,
};

// Digits only, capped to maxLen - shared by every day/month/year/hour/
// minute segment input below, so a paste ("05/03/2026") or a stray
// non-numeric character can't end up baked into the field.
function digitsOnly(raw: string, maxLen: number): string {
    return raw.replace(/\D/g, "").slice(0, maxLen);
}

// The dialog only knows about the fields above today. Extending it for a
// new data field later means: add it to TodoItemFormValue and
// TodoItemDialogFieldSupport, add a matching <input>/<textarea> block in
// render() gated on the new support flag, and read it back out wherever
// TodoOverlayCard handles "dialog-save". Nothing else about this component
// needs to change shape for that.
@customElement("todo-overlay-item-dialog")
export class TodoItemDialog extends LitElement {

    static styles = css`
        .field {
            display: flex;
            flex-direction: column;
            gap: 4px;
            margin-bottom: 16px;
            font-family: Roboto, "Noto Sans", sans-serif;
        }

        .due-row {
            display: flex;
            flex-wrap: wrap;
            gap: 16px;
        }

        .due-row .field {
            flex: 1;
            min-width: 140px;
        }

        .title-row {
            display: flex;
            gap: 16px;
        }

        .title-row .field.title {
            flex: 2;
            min-width: 0;
        }

        .title-row .field.quantity {
            flex: 1;
            min-width: 90px;
        }

        .complete-toggle {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 16px;
            font-family: Roboto, "Noto Sans", sans-serif;
            font-size: 14px;
            color: var(--primary-text-color);
        }

        .complete-toggle ha-checkbox {
            margin-inline-start: -12px;
        }

        label {
            font-size: 12px;
            color: var(--secondary-text-color);
        }

        input,
        textarea {
            box-sizing: border-box;
            width: 100%;
            font-family: inherit;
            font-size: 16px;
            color: var(--primary-text-color);
            background: none;
            border: none;
            border-bottom: 1px solid var(--divider-color);
            padding: 8px 0;
            outline: none;
            color-scheme: light dark;
        }

        input:focus,
        textarea:focus {
            border-bottom: 2px solid var(--primary-color);
            padding-bottom: 7px;
        }

        /* Day/month/year and hour/minute, always in that fixed order
           regardless of browser or OS locale - see the .dueDay field's
           own doc comment for why this isn't a single native
           <input type="date">/<input type="time"> or ha-date-input/
           ha-time-input. */
        .dmy-row,
        .hm-row {
            display: flex;
            align-items: baseline;
            gap: 4px;
        }

        input.segment {
            width: 2.2em;
            flex: none;
            text-align: center;
            /* Hides the native up/down spinner some browsers add to a
               numeric-inputmode text field - these segments are typed
               into, not incremented. */
            -moz-appearance: textfield;
        }

        input.segment.year {
            width: 3.6em;
        }

        .segment-sep {
            color: var(--secondary-text-color);
            font-size: 16px;
        }

        .ampm-select {
            margin-inline-start: 4px;
            font-family: inherit;
            font-size: 14px;
            font-weight: 500;
            color: var(--primary-text-color);
            background: none;
            border: none;
            border-bottom: 1px solid var(--divider-color);
            padding: 8px 2px;
            outline: none;
        }

        .calendar-toggle {
            flex: none;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 28px;
            height: 28px;
            margin-inline-start: 4px;
            border: none;
            border-radius: 50%;
            background: none;
            padding: 0;
            color: var(--secondary-text-color);
            cursor: pointer;
        }

        .calendar-toggle:hover {
            background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.06);
        }

        .calendar-toggle svg {
            width: 18px;
            height: 18px;
            fill: currentColor;
        }

        .date-picker-panel {
            margin: 0 0 16px;
            padding: 12px;
            border: 1px solid var(--divider-color);
            border-radius: 8px;
            font-family: Roboto, "Noto Sans", sans-serif;
        }

        .date-picker-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 8px;
            font-size: 14px;
            font-weight: 500;
            color: var(--primary-text-color);
        }

        .date-picker-nav {
            border: none;
            background: none;
            padding: 4px 10px;
            border-radius: 4px;
            font-size: 16px;
            color: var(--secondary-text-color);
            cursor: pointer;
        }

        .date-picker-nav:hover {
            background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.06);
        }

        .date-picker-grid {
            display: grid;
            grid-template-columns: repeat(7, 1fr);
            gap: 2px;
        }

        .date-picker-weekday {
            text-align: center;
            font-size: 11px;
            color: var(--secondary-text-color);
            padding: 4px 0;
        }

        .date-picker-day {
            border: none;
            background: none;
            font-family: inherit;
            font-size: 13px;
            color: var(--primary-text-color);
            padding: 6px 0;
            border-radius: 50%;
            cursor: pointer;
        }

        .date-picker-day:hover {
            background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.08);
        }

        .date-picker-day.selected {
            background: var(--primary-color);
            color: var(--text-primary-color, #fff);
        }

        textarea {
            resize: vertical;
            min-height: 48px;
        }

        .actions {
            display: flex;
            align-items: center;
            width: 100%;
        }

        button {
            font-family: Roboto, "Noto Sans", sans-serif;
            font-size: 14px;
            font-weight: 500;
            text-transform: uppercase;
            border: none;
            background: none;
            cursor: pointer;
            padding: 8px 12px;
            border-radius: 4px;
            color: var(--primary-color);
        }

        button.destructive {
            color: var(--error-color);
            margin-inline-end: auto;
        }

        .confirm-delete {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 8px;
            width: 100%;
            font-family: Roboto, "Noto Sans", sans-serif;
            font-size: 14px;
            color: var(--primary-text-color);
        }

        /* flex-basis 100% forces this onto its own row rather than
           shrinking, so on a narrow (phone) dialog the Cancel/Delete
           buttons wrap onto the next line instead of ever being pushed
           out past the dialog's edge - a real risk with the plain
           flex:1 this used to have, since nothing capped how wide the
           text could push. */
        .confirm-delete span {
            flex: 1 1 100%;
            min-width: 0;
        }

        .field-hint {
            font-size: 12px;
            color: var(--error-color);
            margin-top: -8px;
            margin-bottom: 16px;
            font-family: Roboto, "Noto Sans", sans-serif;
        }

        button:disabled {
            opacity: 0.4;
            cursor: default;
        }
    `;

    @property({attribute: false})
    heading = "Item";

    // What the parent last handed in - read ONLY by willUpdate() to seed
    // draftValue exactly once (see below). Never read anywhere else.
    private _seedValue: TodoItemFormValue = EMPTY_FORM_VALUE;

    // The dialog's own live working copy - seeded exactly once from
    // whatever `value` was set to (see willUpdate(), same gate as the
    // date/time segments below) and never resynced from it afterwards.
    // Every input in this dialog reads from and writes to this, not the
    // incoming `value` assignment directly.
    //
    // Without this, the parent (todo-overlay-list.ts) re-renders for all
    // sorts of reasons that have nothing to do with this dialog (another
    // item elsewhere in the list changing, a linked list's incoming sync
    // notification, an error banner timing out) - and since lit-html
    // always recommits a non-primitive property value regardless of
    // whether its reference actually changed (see PropertyPart._$setValue
    // - only primitives are dirty-checked), every single one of those
    // re-renders reassigned `value` right back to the object the parent
    // was holding, clobbering whatever the user had already typed but
    // not yet saved. Live-reproduced: editing a quantity, then having it
    // silently revert before Save was ever pressed.
    //
    // `value` itself stays a real settable/readable property (rather
    // than being renamed) purely so external code - the parent's initial
    // seed on dialog-open, and this component's own tests - keeps reading
    // and writing the same name it always has; the getter transparently
    // returns the live draft instead of the frozen seed.
    @state()
    private draftValue: TodoItemFormValue = EMPTY_FORM_VALUE;

    // hasChanged forced to always-true: Lit's default wrapping of a custom
    // accessor pair compares the OLD value via this getter (i.e. against
    // draftValue) - which hasn't been touched by a fresh assignment yet,
    // so the default reference-equality check would see no change and
    // never register 'value' in willUpdate()'s changed map at all. Since
    // this setter only ever runs when the parent hands in a genuinely new
    // seed (once, at dialog-open - see openEditDialog/openCreateDialog in
    // todo-overlay-list.ts), always treating it as changed is correct.
    @property({attribute: false, hasChanged: () => true})
    set value(newValue: TodoItemFormValue) {
        this._seedValue = newValue;
    }

    get value(): TodoItemFormValue {
        return this.draftValue;
    }

    @property({attribute: false})
    fieldSupport: TodoItemDialogFieldSupport = {
        description: false,
        dueDate: false,
        dueDateTime: false,
    };

    @property({type: Boolean})
    showDelete = false;

    // Only relevant for an item whose own row hides its completion
    // checkbox (see TodoOverlayCardConfig's hide_complete_for_parents) -
    // this dialog is that item's only way to complete it, so the toggle
    // only renders when it's actually needed.
    @property({type: Boolean})
    showCompleteToggle = false;

    @property({type: Boolean})
    completed = false;

    // Deleting is the one destructive action this dialog can trigger, so
    // it defaults to on - set false to skip straight to dialog-delete, as
    // it always used to.
    @property({type: Boolean})
    confirmDelete = true;

    @state()
    private confirmingDelete = false;

    // Day/month/year and hour/minute are edited as separate segments (see
    // render()'s .dmy-row/.hm-row) rather than a single native
    // <input type="date">/<input type="time"> - a native date input's
    // displayed order/format follows the browser's own locale (confirmed
    // live: even an explicit lang="en-GB" on the element didn't change
    // Chrome's rendered mm/dd/yyyy), and Home Assistant's own themed
    // ha-date-input/ha-time-input aren't reliably loaded in a third-party
    // card's context (confirmed live: customElements.get('ha-date-input')
    // was false on a fresh dashboard load, leaving the fields invisible
    // and uneditable). Plain digit segments in a fixed day-month-year
    // order sidestep both problems entirely - nothing here depends on
    // what the browser or Home Assistant happen to have loaded.
    //
    // Kept as local state (not derived from `value` on every render) so
    // a partially-typed date/time isn't wiped out mid-entry - see
    // willUpdate(), which seeds these from `value` exactly once.
    @state()
    private dueDay = "";

    @state()
    private dueMonth = "";

    @state()
    private dueYear = "";

    // 12-hour clock + AM/PM, matching how due times are actually read
    // aloud/entered day to day - dueHour12 holds "1".."12" as typed;
    // converted to/from the 24-hour "HH:MM" that TodoItemFormValue.dueTime
    // and the rest of the save pipeline (todo-overlay-list.ts's
    // dueDatetime string) expect - see syncDueTime()/willUpdate().
    @state()
    private dueHour12 = "";

    @state()
    private dueMinute = "";

    @state()
    private dueAmPm: "AM" | "PM" = "AM";

    private dateTimePartsInitialized = false;

    // The day/month/year segments are always the source of truth for
    // what's SELECTED - this panel is purely an alternate, visual way to
    // fill them in (a calendar to click through rather than digits to
    // type), so it never holds its own copy of the chosen date. It does
    // need its own "which month is currently being browsed" state,
    // though, since that's allowed to differ from the selected date
    // while navigating (e.g. paging forward to pick a date next month).
    @state()
    private datePickerOpen = false;

    @state()
    private datePickerViewYear = 0;

    @state()
    private datePickerViewMonth = 0;

    private openDatePicker() {
        const now = new Date();
        this.datePickerViewYear = this.dueYear.length === 4 ? Number(this.dueYear) : now.getFullYear();
        this.datePickerViewMonth = this.dueMonth ? Number(this.dueMonth) - 1 : now.getMonth();
        this.datePickerOpen = true;
    }

    private toggleDatePicker() {
        if (this.datePickerOpen) {
            this.datePickerOpen = false;
        } else {
            this.openDatePicker();
        }
    }

    private shiftDatePickerMonth(delta: number) {
        let month = this.datePickerViewMonth + delta;
        let year = this.datePickerViewYear;

        if (month < 0) {
            month = 11;
            year -= 1;
        } else if (month > 11) {
            month = 0;
            year += 1;
        }

        this.datePickerViewMonth = month;
        this.datePickerViewYear = year;
    }

    private pickDate(day: number) {
        this.dueDay = String(day).padStart(2, "0");
        this.dueMonth = String(this.datePickerViewMonth + 1).padStart(2, "0");
        this.dueYear = String(this.datePickerViewYear);
        this.syncDueDate();
        this.datePickerOpen = false;
    }

    protected willUpdate(changed: Map<string, unknown>): void {
        if (!changed.has("value") || this.dateTimePartsInitialized) {
            return;
        }

        this.dateTimePartsInitialized = true;
        this.draftValue = this._seedValue;

        const [year, month, day] = this._seedValue.dueDate ? this._seedValue.dueDate.split("-") : ["", "", ""];
        this.dueYear = year ?? "";
        this.dueMonth = month ?? "";
        this.dueDay = day ?? "";

        const [hour24Str, minute] = this._seedValue.dueTime ? this._seedValue.dueTime.split(":") : ["", ""];
        this.dueMinute = minute ?? "";

        if (hour24Str) {
            const hour24 = Number(hour24Str);
            const hour12 = hour24 % 12 || 12;
            this.dueHour12 = String(hour12).padStart(2, "0");
            this.dueAmPm = hour24 >= 12 ? "PM" : "AM";
        } else {
            this.dueHour12 = "";
            this.dueAmPm = "AM";
        }
    }

    private close() {
        this.dispatchEvent(
            new CustomEvent("dialog-close", {bubbles: true, composed: true}),
        );
    }

    private save() {
        if (this.triggerOnDueBlocked) {
            return;
        }

        this.dispatchEvent(
            new CustomEvent("dialog-save", {
                detail: this.draftValue,
                bubbles: true,
                composed: true,
            }),
        );
    }

    private requestDelete() {
        if (this.confirmDelete) {
            this.confirmingDelete = true;
            return;
        }

        this.dispatchEvent(
            new CustomEvent("dialog-delete", {bubbles: true, composed: true}),
        );
    }

    private cancelDelete() {
        this.confirmingDelete = false;
    }

    private confirmDeleteNow() {
        this.confirmingDelete = false;

        this.dispatchEvent(
            new CustomEvent("dialog-delete", {bubbles: true, composed: true}),
        );
    }

    // Bound to "change", not "click" - ha-checkbox wraps a native
    // <input type="checkbox"> inside an internal <label>, and a single
    // physical click on it fires TWO bubbling "click" events (the
    // label's own, plus the browser's automatic forwarded click to the
    // input it labels - standard native label/control behavior). A
    // click-driven toggle (this.value.triggerOnDue = !this.value.
    // triggerOnDue) silently cancelled itself out on every real click:
    // on, then immediately back off, net no-op - confirmed live via a
    // real (not synthetic) click, the actual bug behind "the toggle
    // doesn't work" that a directly-dispatched synthetic click event
    // never reproduced, since it bypasses the internal label entirely.
    // "change" fires exactly once per genuine state transition
    // regardless of how many internal clicks produced it, so both
    // toggles below read the checkbox's own resulting .checked state
    // rather than blindly flipping a local boolean.
    private toggleComplete() {
        this.dispatchEvent(
            new CustomEvent("dialog-toggle-complete", {bubbles: true, composed: true}),
        );
    }

    private onTriggerOnDueChanged(e: Event) {
        const checked = (e.target as unknown as {checked: boolean}).checked;
        this.draftValue = {...this.draftValue, triggerOnDue: checked};
    }

    private updateField(field: keyof Omit<TodoItemFormValue, "triggerOnDue">, fieldValue: string) {
        this.draftValue = {...this.draftValue, [field]: fieldValue};
    }

    // Combines the three segments into "YYYY-MM-DD" only once all three
    // are actually present - a day and month with no year yet (etc.)
    // isn't a real date, so dueDate stays empty (matching what a native
    // date input's .value does while incomplete) rather than guessing.
    private syncDueDate() {
        if (this.dueDay && this.dueMonth && this.dueYear.length === 4) {
            this.updateField(
                "dueDate",
                `${this.dueYear}-${this.dueMonth.padStart(2, "0")}-${this.dueDay.padStart(2, "0")}`,
            );
        } else {
            this.updateField("dueDate", "");
        }
    }

    private syncDueTime() {
        if (this.dueHour12 && this.dueMinute) {
            const hour12 = Number(this.dueHour12) % 12;
            const hour24 = this.dueAmPm === "PM" ? hour12 + 12 : hour12;
            this.updateField("dueTime", `${String(hour24).padStart(2, "0")}:${this.dueMinute.padStart(2, "0")}`);
        } else {
            this.updateField("dueTime", "");
        }
    }

    private updateDueDay(raw: string) {
        this.dueDay = digitsOnly(raw, 2);
        this.syncDueDate();
    }

    private updateDueMonth(raw: string) {
        this.dueMonth = digitsOnly(raw, 2);
        this.syncDueDate();
    }

    private updateDueYear(raw: string) {
        this.dueYear = digitsOnly(raw, 4);
        this.syncDueDate();
    }

    private updateDueHour12(raw: string) {
        this.dueHour12 = digitsOnly(raw, 2);
        this.syncDueTime();
    }

    private updateDueMinute(raw: string) {
        this.dueMinute = digitsOnly(raw, 2);
        this.syncDueTime();
    }

    private setDueAmPm(period: "AM" | "PM") {
        this.dueAmPm = period;
        this.syncDueTime();
    }

    // Enabling "trigger on due" without a due time is meaningless - the
    // backend enforces the same rule (see DueTimeRequiredError), but
    // blocking Save here gives immediate feedback instead of a
    // round-trip error.
    private get triggerOnDueBlocked(): boolean {
        return this.draftValue.triggerOnDue && !(this.draftValue.dueDate && this.draftValue.dueTime);
    }

    // Rendered inline, full-width, right below .due-row - not as an
    // absolutely-positioned floating popup. ha-dialog's own content area
    // is externally defined and out of this component's control; an
    // absolutely-positioned child risks being silently clipped by
    // whatever overflow behavior that container happens to have. Pushing
    // the rest of the dialog down instead has no such risk, at the minor
    // cost of the dialog growing taller while the panel is open - the
    // same tradeoff the quick-add "Details…" panel elsewhere in this
    // card already makes.
    private renderDatePickerPanel() {
        const year = this.datePickerViewYear;
        const month = this.datePickerViewMonth;
        const leadingBlanks = firstWeekdayOfMonth(year, month);
        const totalDays = daysInMonth(year, month);
        const selectedDay = Number(this.dueDay) || undefined;
        const selectedMonth = this.dueMonth ? Number(this.dueMonth) - 1 : undefined;
        const selectedYear = this.dueYear.length === 4 ? Number(this.dueYear) : undefined;

        return html`
            <div class="date-picker-panel">
                <div class="date-picker-header">
                    <button
                        type="button"
                        class="date-picker-nav"
                        aria-label="Previous month"
                        @click=${() => this.shiftDatePickerMonth(-1)}
                    >‹</button>
                    <span>${MONTH_NAMES[month]} ${year}</span>
                    <button
                        type="button"
                        class="date-picker-nav"
                        aria-label="Next month"
                        @click=${() => this.shiftDatePickerMonth(1)}
                    >›</button>
                </div>
                <div class="date-picker-grid">
                    ${WEEKDAY_LABELS.map(label => html`<span class="date-picker-weekday">${label}</span>`)}
                    ${Array.from({length: leadingBlanks}, () => html`<span></span>`)}
                    ${
                        Array.from({length: totalDays}, (_, i) => {
                            const day = i + 1;
                            const isSelected = day === selectedDay && month === selectedMonth && year === selectedYear;

                            return html`
                                <button
                                    type="button"
                                    class=${classMap({"date-picker-day": true, selected: isSelected})}
                                    @click=${() => this.pickDate(day)}
                                >${day}</button>
                            `;
                        })
                    }
                </div>
            </div>
        `;
    }

    render() {
        const showDue = this.fieldSupport.dueDate || this.fieldSupport.dueDateTime;

        return html`
            <ha-dialog open .heading=${this.heading} @closed=${this.close}>
                <div class="title-row">
                    <div class="field title">
                        <label for="todo-item-title">Title</label>
                        <input
                            id="todo-item-title"
                            type="text"
                            .value=${this.draftValue.title}
                            @input=${(e: InputEvent) =>
                                this.updateField("title", (e.target as HTMLInputElement).value)}
                        />
                    </div>

                    <div class="field quantity">
                        <label for="todo-item-quantity">Quantity</label>
                        <input
                            id="todo-item-quantity"
                            type="text"
                            placeholder="e.g. 150g"
                            .value=${this.draftValue.quantity}
                            @input=${(e: InputEvent) =>
                                this.updateField("quantity", (e.target as HTMLInputElement).value)}
                        />
                    </div>
                </div>

                ${
                    this.showCompleteToggle
                        ? html`
                            <div class="complete-toggle">
                                <ha-checkbox
                                    .checked=${this.completed}
                                    @change=${this.toggleComplete}
                                ></ha-checkbox>
                                <span>${this.completed ? "Completed" : "Mark complete"}</span>
                            </div>
                        `
                        : ""
                }

                ${
                    this.fieldSupport.description
                        ? html`
                            <div class="field">
                                <label for="todo-item-description">Description</label>
                                <textarea
                                    id="todo-item-description"
                                    .value=${this.draftValue.description}
                                    @input=${(e: InputEvent) =>
                                        this.updateField(
                                            "description",
                                            (e.target as HTMLTextAreaElement).value,
                                        )}
                                ></textarea>
                            </div>
                        `
                        : ""
                }

                <div class="field">
                    <label for="todo-item-tags">Tags</label>
                    <input
                        id="todo-item-tags"
                        type="text"
                        placeholder="e.g. urgent, weekend"
                        .value=${this.draftValue.tags}
                        @input=${(e: InputEvent) =>
                            this.updateField("tags", (e.target as HTMLInputElement).value)}
                    />
                </div>

                ${
                    showDue
                        ? html`
                            <div class="due-row">
                                <div class="field">
                                    <label id="due-date-label">Due date</label>
                                    <div class="dmy-row" aria-labelledby="due-date-label">
                                        <input
                                            class="segment day"
                                            type="text"
                                            inputmode="numeric"
                                            maxlength="2"
                                            placeholder="DD"
                                            aria-label="Day"
                                            .value=${this.dueDay}
                                            @input=${(e: InputEvent) =>
                                                this.updateDueDay((e.target as HTMLInputElement).value)}
                                        />
                                        <span class="segment-sep">/</span>
                                        <input
                                            class="segment month"
                                            type="text"
                                            inputmode="numeric"
                                            maxlength="2"
                                            placeholder="MM"
                                            aria-label="Month"
                                            .value=${this.dueMonth}
                                            @input=${(e: InputEvent) =>
                                                this.updateDueMonth((e.target as HTMLInputElement).value)}
                                        />
                                        <span class="segment-sep">/</span>
                                        <input
                                            class="segment year"
                                            type="text"
                                            inputmode="numeric"
                                            maxlength="4"
                                            placeholder="YYYY"
                                            aria-label="Year"
                                            .value=${this.dueYear}
                                            @input=${(e: InputEvent) =>
                                                this.updateDueYear((e.target as HTMLInputElement).value)}
                                        />
                                        <button
                                            type="button"
                                            class="calendar-toggle"
                                            aria-label=${this.datePickerOpen ? "Close date picker" : "Open date picker"}
                                            @click=${this.toggleDatePicker}
                                        >
                                            ${CALENDAR_ICON}
                                        </button>
                                    </div>
                                </div>

                                ${
                                    this.fieldSupport.dueDateTime
                                        ? html`
                                            <div class="field">
                                                <label id="due-time-label">Due time</label>
                                                <div class="hm-row" aria-labelledby="due-time-label">
                                                    <input
                                                        class="segment hour"
                                                        type="text"
                                                        inputmode="numeric"
                                                        maxlength="2"
                                                        placeholder="HH"
                                                        aria-label="Hour"
                                                        .value=${this.dueHour12}
                                                        @input=${(e: InputEvent) =>
                                                            this.updateDueHour12((e.target as HTMLInputElement).value)}
                                                    />
                                                    <span class="segment-sep">:</span>
                                                    <input
                                                        class="segment minute"
                                                        type="text"
                                                        inputmode="numeric"
                                                        maxlength="2"
                                                        placeholder="MM"
                                                        aria-label="Minute"
                                                        .value=${this.dueMinute}
                                                        @input=${(e: InputEvent) =>
                                                            this.updateDueMinute((e.target as HTMLInputElement).value)}
                                                    />
                                                    <select
                                                        class="ampm-select"
                                                        aria-label="AM or PM"
                                                        .value=${this.dueAmPm}
                                                        @change=${(e: Event) =>
                                                            this.setDueAmPm((e.target as HTMLSelectElement).value as "AM" | "PM")}
                                                    >
                                                        <option value="AM">AM</option>
                                                        <option value="PM">PM</option>
                                                    </select>
                                                </div>
                                            </div>
                                        `
                                        : ""
                                }
                            </div>

                            ${this.datePickerOpen ? this.renderDatePickerPanel() : ""}

                            ${
                                this.fieldSupport.dueDateTime
                                    ? html`
                                        <div class="complete-toggle">
                                            <ha-checkbox
                                                .checked=${this.draftValue.triggerOnDue}
                                                @change=${this.onTriggerOnDueChanged}
                                            ></ha-checkbox>
                                            <span>Trigger automation when due</span>
                                        </div>
                                        ${
                                            this.triggerOnDueBlocked
                                                ? html`
                                                    <div class="field-hint">
                                                        Requires a due time to enable
                                                    </div>
                                                `
                                                : ""
                                        }
                                    `
                                    : ""
                            }
                        `
                        : ""
                }

                <div class="actions" slot="footer">
                    ${
                        this.confirmingDelete
                            ? html`
                                <div class="confirm-delete">
                                    <span>Delete this item?</span>
                                    <button @click=${this.cancelDelete}>
                                        Cancel
                                    </button>
                                    <button class="destructive" @click=${this.confirmDeleteNow}>
                                        Delete
                                    </button>
                                </div>
                            `
                            : html`
                                ${
                                    this.showDelete
                                        ? html`
                                            <button class="destructive" @click=${this.requestDelete}>
                                                Delete
                                            </button>
                                        `
                                        : ""
                                }
                                <button @click=${this.save} ?disabled=${this.triggerOnDueBlocked}>
                                    Save
                                </button>
                            `
                    }
                </div>
            </ha-dialog>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        "todo-overlay-item-dialog": TodoItemDialog;
    }
}
