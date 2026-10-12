import {LitElement, html, css, svg, nothing, type SVGTemplateResult} from "lit";
import {customElement, property, state} from "lit/decorators.js";
import {classMap} from "lit/directives/class-map.js";

import type {PinType, RepeatFrom, RepeatUnit} from "../models";
import {WEEKDAY_NAMES} from "../models";
import {addDays, formatShortDate, nextOccurrence, parseIsoDate, startOfDay, toIsoDate} from "../recurrence";

const I_CAL = svg`<rect x="3.5" y="5" width="17" height="15" rx="2"></rect><path d="M3.5 9.5h17M8 3v4M16 3v4"></path>`;
const I_CLOCK = svg`<circle cx="12" cy="12" r="8.5"></circle><path d="M12 7.5V12l3 2"></path>`;
const I_REPEAT = svg`<path d="M4 11V9a3 3 0 0 1 3-3h12M16 3l3 3-3 3M20 13v2a3 3 0 0 1-3 3H5M8 21l-3-3 3-3"></path>`;
const I_BELL = svg`<path d="M6 16v-5a6 6 0 1 1 12 0v5l1.5 2h-15z"></path><path d="M10 20.5a2 2 0 0 0 4 0"></path>`;
const I_CHEV_R = svg`<path d="M9 6l6 6-6 6"></path>`;
const I_CHEV_L = svg`<path d="M15 6l-6 6 6 6"></path>`;
const I_UP = svg`<path d="M6 15l6-6 6 6"></path>`;
const I_DOWN = svg`<path d="M6 9l6 6 6-6"></path>`;
const I_X = svg`<path d="M7 7l10 10M17 7L7 17"></path>`;
const I_PLUS = svg`<path d="M12 5v14M5 12h14"></path>`;
const I_MINUS = svg`<path d="M6 12h12"></path>`;
const I_SLIDERS = svg`<path d="M4 7h10M18 7h2M4 17h4M12 17h8"></path><circle cx="16" cy="7" r="2"></circle><circle cx="10" cy="17" r="2"></circle>`;
const I_LINK = svg`<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"></path>`;
const I_SHIELD = svg`<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"></path>`;
const I_CHECK = svg`<circle cx="12" cy="12" r="8.5"></circle><path d="M8 12.5l2.5 2.5 5.5-6"></path>`;

function icon(body: SVGTemplateResult, extraClass = "") {
    return html`<svg class="ic ${extraClass}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
}

const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
];

// Monday-first, matching the backend's own weekday numbering (see models.ts).
const CALENDAR_WEEKDAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

const REPEAT_PRESETS: Record<"daily" | "weekly" | "monthly", {interval: number; unit: RepeatUnit}> = {
    daily: {interval: 1, unit: "days"},
    weekly: {interval: 1, unit: "weeks"},
    monthly: {interval: 1, unit: "months"},
};

const REPEAT_MODES: Array<[RepeatMode, string]> = [
    ["never", "Never"],
    ["daily", "Daily"],
    ["weekly", "Weekly"],
    ["monthly", "Monthly"],
    ["custom", "Custom"],
];

const SINGULAR_UNIT: Record<RepeatUnit, string> = {days: "day", weeks: "week", months: "month"};

type RepeatMode = "never" | "daily" | "weekly" | "monthly" | "custom";
type OpenRow = "date" | "time" | "repeat" | null;

// Wraps within [min, max] rather than clamping - used to keep clock time within one day.
function wrapValue(current: number, delta: number, min: number, max: number): number {
    const span = max - min + 1;
    return ((current - min + delta) % span + span) % span + min;
}

function digitsOnly(raw: string, maxLen: number): string {
    return raw.replace(/\D/g, "").slice(0, maxLen);
}

function parseTags(raw: string): string[] {
    return raw.split(",").map(tag => tag.trim()).filter(tag => tag.length > 0);
}

export interface TodoItemFormValue {
    title: string;
    quantity: string;
    // Comma-separated - the dialog edits it as chips, but the save pipeline
    // (todo-overlay-list.ts's onDialogSave) still splits this string.
    tags: string;
    description: string;
    // "YYYY-MM-DD", or "" for no due date.
    dueDate: string;
    // 24-hour "HH:MM", or "" for no time.
    dueTime: string;
    triggerOnDue: boolean;
    // "" means a normal item (unpinned).
    pinType: "" | PinType;
    // "" | "0".."6" (Monday..Sunday), only meaningful alongside pinType "day".
    dayWeekday: string;
    linked: boolean;
    // Only read when linked flips false -> true: uid or title of the parent
    // to file the new mirror under; "" uses the configured default.
    linkTarget: string;
    deleteProtected: boolean;
    // null/"" means "doesn't repeat". All-or-nothing, and needs a due date.
    repeatInterval: number | null;
    repeatUnit: "" | RepeatUnit;
    repeatFrom: "" | RepeatFrom;
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
    pinType: "",
    dayWeekday: "",
    linked: false,
    linkTarget: "",
    deleteProtected: false,
    repeatInterval: null,
    repeatUnit: "",
    repeatFrom: "",
};

// Everything here is plain buttons/inputs/selects, never ha-date-input/
// ha-time-input or a native date/time input: the HA ones aren't reliably
// registered in a third-party card's context (live-confirmed), and a native
// date input's display order follows the browser locale.
@customElement("todo-overlay-item-dialog")
export class TodoItemDialog extends LitElement {

    static styles = css`
        :host {
            --tov-fill: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.05);
            --tov-fill-strong: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.09);
            --tov-hover: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.06);
            --tov-accent-wash: rgba(var(--rgb-primary-color, 3, 169, 244), 0.14);
            --tov-on-accent: var(--text-primary-color, #fff);
            --tov-muted: var(--secondary-text-color);
            font-family: Roboto, "Noto Sans", sans-serif;
        }

        /* Widened only when there's a second column to fill - see .cols. */
        ha-dialog.wide {
            --ha-dialog-width-md: 760px;
        }

        .ic {
            width: 20px;
            height: 20px;
            fill: none;
            stroke: currentColor;
            stroke-width: 1.8;
            stroke-linecap: round;
            stroke-linejoin: round;
            flex: none;
        }

        .dialog-title {
            display: flex;
            align-items: center;
            gap: 10px;
            min-width: 0;
        }

        .typesel {
            position: relative;
            display: inline-flex;
            align-items: center;
        }

        .typesel select {
            appearance: none;
            font-family: inherit;
            font-size: 14px;
            font-weight: 500;
            color: var(--primary-text-color);
            background: var(--tov-fill);
            border: 1px solid var(--divider-color);
            border-radius: 16px;
            padding: 5px 28px 5px 12px;
            cursor: pointer;
        }

        .typesel .ic {
            position: absolute;
            right: 8px;
            width: 16px;
            height: 16px;
            pointer-events: none;
            color: var(--tov-muted);
        }

        .visually-hidden {
            position: absolute;
            width: 1px;
            height: 1px;
            overflow: hidden;
            clip: rect(0 0 0 0);
            white-space: nowrap;
        }

        /* Two columns once the dialog itself is wide enough, driven by its
           own width rather than the viewport, so a narrow phone or a split
           screen always gets the single stacked column. */
        .layout {
            container-type: inline-size;
        }

        .cols {
            display: flex;
            flex-direction: column;
        }

        @container (min-width: 600px) {
            /* The trailing 1fr row soaks up When's extra height, so the
               left column stays packed instead of spreading out. */
            .cols.two {
                display: grid;
                grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
                grid-template-rows: auto auto auto 1fr;
                column-gap: 24px;
                align-items: start;
            }

            .cols.two .area-item { grid-column: 1; grid-row: 1; }
            .cols.two .area-details { grid-column: 1; grid-row: 2; }
            .cols.two .area-options { grid-column: 1; grid-row: 3; }
            .cols.two .area-when { grid-column: 2; grid-row: 1 / span 4; }
            .cols.two .area-when > .sec:first-child { margin-top: 0; }
        }

        .sec {
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: var(--tov-muted);
            margin: 20px 0 8px;
        }

        .field {
            background: var(--tov-fill);
            border-radius: 6px 6px 0 0;
            border-bottom: 1px solid var(--divider-color);
            padding: 7px 12px;
            display: flex;
            flex-direction: column;
            gap: 2px;
            min-width: 0;
        }

        .field:focus-within {
            border-bottom: 2px solid var(--primary-color);
            padding-bottom: 6px;
        }

        .field label {
            font-size: 12px;
            color: var(--tov-muted);
        }

        .field input,
        .field textarea {
            all: unset;
            box-sizing: border-box;
            width: 100%;
            font-family: inherit;
            font-size: 16px;
            line-height: 22px;
            color: var(--primary-text-color);
        }

        .field textarea {
            min-height: 44px;
            white-space: pre-wrap;
        }

        .field input:disabled {
            color: var(--primary-text-color);
            opacity: 0.8;
        }

        .title-row {
            display: flex;
            gap: 12px;
        }

        .title-row .field.title {
            flex: 1;
        }

        .title-row .field.quantity {
            width: 100px;
            flex: none;
        }

        .group {
            background: var(--tov-fill);
            border-radius: 14px;
            overflow: hidden;
        }

        .row {
            all: unset;
            box-sizing: border-box;
            width: 100%;
            display: flex;
            align-items: center;
            gap: 14px;
            min-height: 52px;
            padding: 8px 14px 8px 16px;
            border-top: 1px solid var(--divider-color);
            cursor: pointer;
            color: var(--primary-text-color);
        }

        .group > :first-child {
            border-top: 0;
        }

        .row:hover:not(:disabled):not(.off) {
            background: var(--tov-hover);
        }

        .row .lbl {
            flex: 1;
            min-width: 0;
            display: flex;
            flex-direction: column;
            font-size: 15px;
        }

        .row .sub {
            font-size: 12px;
            color: var(--tov-muted);
            margin-top: 2px;
        }

        .row .val {
            font-size: 14px;
            color: var(--tov-muted);
            text-align: right;
        }

        .row .val.late {
            color: var(--error-color);
        }

        /* A one-line label with a summary that truncates, rather than the
           label wrapping to make room for the summary. */
        .row.summary .lbl {
            flex: none;
            white-space: nowrap;
        }

        .row.summary .val {
            flex: 1;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .row .ic {
            color: var(--tov-muted);
        }

        .row.open .val,
        .row.open .ic {
            color: var(--primary-color);
        }

        .row:disabled,
        .row.off {
            cursor: default;
            color: var(--disabled-text-color, var(--tov-muted));
        }

        .row:disabled .ic,
        .row.off .ic {
            opacity: 0.5;
        }

        .chev {
            transition: transform 0.15s;
        }

        .row.open .chev,
        .chev.down {
            transform: rotate(90deg);
        }

        .panel {
            padding: 4px 16px 16px;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        input.switch {
            appearance: none;
            width: 36px;
            height: 20px;
            border-radius: 10px;
            background: var(--tov-fill-strong);
            box-shadow: inset 0 0 0 1px var(--divider-color);
            position: relative;
            margin: 0;
            cursor: pointer;
            flex: none;
        }

        input.switch::after {
            content: "";
            position: absolute;
            top: 3px;
            left: 3px;
            width: 14px;
            height: 14px;
            border-radius: 50%;
            background: var(--tov-muted);
            transition: left 0.15s;
        }

        input.switch:checked {
            background: var(--primary-color);
            box-shadow: none;
        }

        input.switch:checked::after {
            left: 19px;
            background: var(--tov-on-accent);
        }

        input.switch:disabled {
            cursor: default;
            opacity: 0.5;
        }

        .pill {
            all: unset;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            height: 34px;
            padding: 0 14px;
            border-radius: 17px;
            background: var(--tov-fill-strong);
            font-size: 14px;
            color: var(--primary-text-color);
            cursor: pointer;
        }

        .pill.small {
            height: 32px;
            padding: 0 12px;
            font-size: 13px;
        }

        .pill.on {
            background: var(--tov-accent-wash);
            color: var(--primary-color);
            box-shadow: inset 0 0 0 1px var(--primary-color);
        }

        .pills {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        }

        .cal-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-size: 14px;
            font-weight: 500;
        }

        .iconbtn {
            all: unset;
            width: 36px;
            height: 36px;
            border-radius: 50%;
            display: grid;
            place-items: center;
            color: var(--tov-muted);
            cursor: pointer;
            flex: none;
        }

        .iconbtn:hover {
            background: var(--tov-hover);
        }

        .cal-grid {
            display: grid;
            grid-template-columns: repeat(7, minmax(0, 1fr));
            gap: 2px;
        }

        .cal-dow {
            font-size: 11px;
            color: var(--tov-muted);
            text-align: center;
            padding: 4px 0;
        }

        .cal-day {
            all: unset;
            height: 34px;
            display: grid;
            place-items: center;
            font-size: 13px;
            border-radius: 17px;
            cursor: pointer;
            color: var(--primary-text-color);
        }

        .cal-day:hover {
            background: var(--tov-hover);
        }

        .cal-day.past {
            color: var(--tov-muted);
        }

        .cal-day.today {
            box-shadow: inset 0 0 0 1px var(--divider-color);
        }

        .cal-day.selected {
            background: var(--primary-color);
            color: var(--tov-on-accent);
            font-weight: 500;
            box-shadow: none;
        }

        .time-row {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
        }

        .spin {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 2px;
        }

        .spin button {
            all: unset;
            width: 76px;
            height: 28px;
            display: grid;
            place-items: center;
            color: var(--tov-muted);
            border-radius: 8px;
            cursor: pointer;
        }

        .spin button:hover {
            background: var(--tov-hover);
        }

        .spin input {
            all: unset;
            box-sizing: border-box;
            width: 76px;
            height: 58px;
            text-align: center;
            font-family: inherit;
            font-size: 36px;
            background: var(--tov-fill-strong);
            border-radius: 12px;
            color: var(--primary-text-color);
            font-variant-numeric: tabular-nums;
        }

        .time-colon {
            font-size: 36px;
            color: var(--tov-muted);
            padding-bottom: 4px;
        }

        .ampm {
            display: flex;
            flex-direction: column;
            background: var(--tov-fill-strong);
            border-radius: 12px;
            padding: 3px;
            gap: 2px;
            margin-inline-start: 6px;
        }

        .ampm button {
            all: unset;
            width: 50px;
            height: 26px;
            line-height: 26px;
            text-align: center;
            font-size: 13px;
            font-weight: 500;
            color: var(--tov-muted);
            border-radius: 9px;
            cursor: pointer;
        }

        .ampm button.on {
            background: var(--primary-color);
            color: var(--tov-on-accent);
        }

        .panel-foot {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            font-size: 12px;
            color: var(--tov-muted);
        }

        .seg {
            display: flex;
            background: var(--tov-fill-strong);
            border-radius: 20px;
            padding: 3px;
            gap: 2px;
        }

        .seg button {
            all: unset;
            flex: 1;
            text-align: center;
            font-size: 13px;
            font-weight: 500;
            color: var(--tov-muted);
            padding: 8px 2px;
            border-radius: 17px;
            cursor: pointer;
        }

        .seg button.on {
            background: var(--primary-color);
            color: var(--tov-on-accent);
        }

        .custom-interval-row {
            display: flex;
            align-items: center;
            gap: 10px;
            font-size: 15px;
        }

        .stepper {
            display: flex;
            align-items: center;
            background: var(--tov-fill-strong);
            border-radius: 20px;
            padding: 3px;
        }

        .stepper button {
            all: unset;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            display: grid;
            place-items: center;
            color: var(--primary-text-color);
            cursor: pointer;
        }

        .stepper input {
            all: unset;
            width: 36px;
            text-align: center;
            font-family: inherit;
            font-size: 16px;
            font-weight: 500;
            color: var(--primary-text-color);
            font-variant-numeric: tabular-nums;
        }

        .selwrap {
            position: relative;
            display: inline-flex;
            align-items: center;
        }

        .selwrap select {
            appearance: none;
            font-family: inherit;
            font-size: 15px;
            color: var(--primary-text-color);
            background: var(--tov-fill-strong);
            border: 0;
            border-radius: 20px;
            padding: 9px 34px 9px 16px;
            cursor: pointer;
        }

        .selwrap .ic {
            position: absolute;
            right: 10px;
            width: 16px;
            height: 16px;
            color: var(--tov-muted);
            pointer-events: none;
        }

        .next-label {
            font-size: 12px;
            color: var(--tov-muted);
        }

        .next-options {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 8px;
        }

        .next-option {
            all: unset;
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
            gap: 3px;
            padding: 10px 12px;
            border-radius: 12px;
            background: var(--tov-fill-strong);
            cursor: pointer;
        }

        .next-option.on {
            background: var(--tov-accent-wash);
            box-shadow: inset 0 0 0 1.5px var(--primary-color);
        }

        .next-option .kind {
            font-size: 13px;
            font-weight: 500;
            color: var(--primary-text-color);
        }

        .next-option .date {
            font-size: 17px;
            font-weight: 500;
            color: var(--primary-text-color);
        }

        .next-option.on .date {
            color: var(--primary-color);
        }

        .next-option .why {
            font-size: 12px;
            line-height: 16px;
            color: var(--tov-muted);
        }

        .day-card {
            padding: 14px 16px;
            border-radius: 14px;
            background: var(--tov-fill);
            font-size: 13px;
            line-height: 19px;
            color: var(--tov-muted);
            display: flex;
            gap: 12px;
        }

        .day-card .ic {
            color: var(--primary-color);
        }

        .day-card b {
            color: var(--primary-text-color);
            font-weight: 500;
        }

        .details {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .chips {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 8px;
        }

        .chip {
            display: inline-flex;
            align-items: center;
            gap: 2px;
            height: 32px;
            padding: 0 4px 0 12px;
            border: 1px solid var(--divider-color);
            border-radius: 8px;
            font-size: 14px;
            color: var(--primary-text-color);
        }

        .chip button {
            all: unset;
            width: 24px;
            height: 24px;
            display: grid;
            place-items: center;
            color: var(--tov-muted);
            border-radius: 50%;
            cursor: pointer;
        }

        .chip .ic {
            width: 16px;
            height: 16px;
        }

        .tag-input {
            all: unset;
            box-sizing: border-box;
            height: 32px;
            min-width: 110px;
            flex: 1;
            padding: 0 10px;
            border: 1px dashed var(--divider-color);
            border-radius: 8px;
            font-family: inherit;
            font-size: 14px;
            color: var(--primary-text-color);
        }

        .actions {
            display: flex;
            align-items: center;
            gap: 8px;
            width: 100%;
        }

        .actions .spacer {
            flex: 1;
        }

        button.text-btn {
            all: unset;
            font-family: inherit;
            font-size: 14px;
            font-weight: 500;
            padding: 10px 14px;
            border-radius: 20px;
            color: var(--primary-color);
            cursor: pointer;
            white-space: nowrap;
        }

        button.text-btn.small {
            padding: 6px 10px;
        }

        button.text-btn.destructive {
            color: var(--error-color);
        }

        button.filled-btn {
            all: unset;
            font-family: inherit;
            font-size: 14px;
            font-weight: 500;
            padding: 10px 22px;
            border-radius: 20px;
            background: var(--primary-color);
            color: var(--tov-on-accent);
            cursor: pointer;
        }

        button.text-btn:disabled,
        button.filled-btn:disabled {
            opacity: 0.4;
            cursor: default;
        }

        .confirm-delete {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 8px;
            width: 100%;
            font-size: 14px;
            color: var(--primary-text-color);
        }

        .confirm-delete span {
            flex: 1 1 100%;
            min-width: 0;
        }

        button:focus-visible,
        input:focus-visible,
        select:focus-visible,
        textarea:focus-visible {
            outline: 2px solid var(--primary-color);
            outline-offset: 2px;
        }
    `;

    // "Edit"/"New" - rendered beside the Show as chip in ha-dialog's title.
    @property({attribute: false})
    heading = "Edit";

    // What the parent last handed in - read ONLY by willUpdate() to seed
    // draftValue exactly once.
    private _seedValue: TodoItemFormValue = EMPTY_FORM_VALUE;

    // The dialog's own working copy, seeded once and never resynced: the
    // parent re-renders for unrelated reasons (sync notifications, banners)
    // and lit-html always recommits a non-primitive property, which used to
    // clobber unsaved edits (live-reproduced).
    @state()
    private draftValue: TodoItemFormValue = EMPTY_FORM_VALUE;

    // hasChanged forced true: Lit's default would compare against the getter
    // (draftValue), never register the change, and never reseed.
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

    // True when this item's own list already IS the cross-instance linked
    // list - linking an item there could only mirror it onto itself.
    @property({type: Boolean})
    entityIsLinked = false;

    // Only for an item whose row hides its checkbox (hide_complete_for_parents).
    @property({type: Boolean})
    showCompleteToggle = false;

    @property({type: Boolean})
    completed = false;

    @property({type: Boolean})
    confirmDelete = true;

    @state()
    private confirmingDelete = false;

    @state()
    private openRow: OpenRow = null;

    @state()
    private optionsOpen = false;

    @state()
    private calendarYear = 0;

    @state()
    private calendarMonth = 0;

    // 12-hour clock state, kept separately from draftValue.dueTime ("HH:MM",
    // 24h) so a half-typed value isn't reformatted under the cursor.
    @state()
    private dueHour12 = "";

    @state()
    private dueMinute = "";

    @state()
    private dueAmPm: "AM" | "PM" = "AM";

    @state()
    private tagDraft = "";

    @state()
    private intervalDraft: string | null = null;

    // Custom is sticky once picked: otherwise stepping it down to 1 day
    // would match the Daily preset and the Custom controls would vanish
    // mid-edit.
    @state()
    private repeatCustom = false;

    private seeded = false;

    // Captured when the dialog opens: the destination field only makes sense
    // while creating a new link, not for an item that was already linked.
    private originallyLinked = false;

    protected willUpdate(changed: Map<string, unknown>): void {
        if (!changed.has("value") || this.seeded) {
            return;
        }

        this.seeded = true;
        this.draftValue = this._seedValue;
        this.originallyLinked = this._seedValue.linked;

        const [hour24Str, minute] = this._seedValue.dueTime ? this._seedValue.dueTime.split(":") : ["", ""];
        this.dueMinute = minute ?? "";

        if (hour24Str) {
            const hour24 = Number(hour24Str);
            this.dueHour12 = String(hour24 % 12 || 12).padStart(2, "0");
            this.dueAmPm = hour24 >= 12 ? "PM" : "AM";
        } else {
            this.dueHour12 = "";
            this.dueAmPm = "AM";
        }

        this.showCalendarMonthOf(parseIsoDate(this._seedValue.dueDate) ?? new Date());
        this.repeatCustom = this.repeatMode === "custom";
    }

    private get today(): Date {
        return startOfDay(new Date());
    }

    private get isDayPin(): boolean {
        return this.draftValue.pinType === "day";
    }

    private get showDue(): boolean {
        return this.fieldSupport.dueDate || this.fieldSupport.dueDateTime;
    }

    private get hasDate(): boolean {
        return this.draftValue.dueDate !== "";
    }

    private get hasTime(): boolean {
        return this.draftValue.dueTime !== "";
    }

    private patch(changes: Partial<TodoItemFormValue>) {
        this.draftValue = {...this.draftValue, ...changes};
    }

    private close() {
        this.dispatchEvent(new CustomEvent("dialog-close", {bubbles: true, composed: true}));
    }

    private save() {
        if (this.saveBlocked) {
            return;
        }

        this.dispatchEvent(
            new CustomEvent("dialog-save", {
                // effectiveTitle: a "day" pin's title is always its weekday's name.
                detail: {...this.draftValue, title: this.effectiveTitle},
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

        this.dispatchEvent(new CustomEvent("dialog-delete", {bubbles: true, composed: true}));
    }

    private confirmDeleteNow() {
        this.confirmingDelete = false;
        this.dispatchEvent(new CustomEvent("dialog-delete", {bubbles: true, composed: true}));
    }

    private toggleComplete() {
        this.dispatchEvent(new CustomEvent("dialog-toggle-complete", {bubbles: true, composed: true}));
    }

    private get effectiveTitle(): string {
        if (!this.isDayPin) {
            return this.draftValue.title;
        }

        const index = Number(this.draftValue.dayWeekday);

        return this.draftValue.dayWeekday !== "" && index >= 0 && index < WEEKDAY_NAMES.length
            ? WEEKDAY_NAMES[index]
            : "";
    }

    // --- When: row accordion -----------------------------------------------

    private toggleRow(row: Exclude<OpenRow, null>) {
        if (this.openRow === row) {
            this.openRow = null;
            return;
        }

        if (row === "date") {
            this.showCalendarMonthOf(parseIsoDate(this.draftValue.dueDate) ?? this.today);
        }

        // Opening Time on an item with none starts it at 9:00 AM rather than
        // showing empty steppers with nothing to nudge from.
        if (row === "time" && !this.hasTime) {
            this.dueHour12 = "09";
            this.dueMinute = "00";
            this.dueAmPm = "AM";
            this.syncDueTime();
        }

        this.openRow = row;
    }

    // --- Due date ------------------------------------------------------------

    private showCalendarMonthOf(date: Date) {
        this.calendarYear = date.getFullYear();
        this.calendarMonth = date.getMonth();
    }

    private shiftCalendarMonth(delta: number) {
        this.showCalendarMonthOf(new Date(this.calendarYear, this.calendarMonth + delta, 1));
    }

    private pickDate(date: Date) {
        this.patch({dueDate: toIsoDate(date)});
        this.openRow = null;
    }

    // Time, repeat and the automation trigger all depend on a date, so they go with it.
    private clearDate() {
        this.dueHour12 = "";
        this.dueMinute = "";
        this.dueAmPm = "AM";
        this.patch({
            dueDate: "",
            dueTime: "",
            triggerOnDue: false,
            repeatInterval: null,
            repeatUnit: "",
            repeatFrom: "",
        });
        this.openRow = null;
    }

    // --- Due time ------------------------------------------------------------

    private syncDueTime() {
        if (this.dueHour12 && this.dueMinute) {
            const hour12 = Number(this.dueHour12) % 12;
            const hour24 = this.dueAmPm === "PM" ? hour12 + 12 : hour12;
            this.patch({dueTime: `${String(hour24).padStart(2, "0")}:${this.dueMinute.padStart(2, "0")}`});
        } else {
            this.patch({dueTime: ""});
        }
    }

    private updateDueHour12(raw: string) {
        this.dueHour12 = digitsOnly(raw, 2);
        this.syncDueTime();
    }

    private updateDueMinute(raw: string) {
        this.dueMinute = digitsOnly(raw, 2);
        this.syncDueTime();
    }

    // Arrows move the whole time like a real clock: minutes carry into the
    // hour, and AM/PM flips crossing noon or midnight (11 AM -> 12 PM,
    // 11:45 PM -> 12:00 AM), rather than each part wrapping on its own.
    private stepDueTime(deltaMinutes: number) {
        const hour12 = Number(this.dueHour12) || 12;
        const minute = Number(this.dueMinute) || 0;
        const hour24 = (hour12 % 12) + (this.dueAmPm === "PM" ? 12 : 0);
        const total = wrapValue(hour24 * 60 + minute + deltaMinutes, 0, 0, 24 * 60 - 1);
        const nextHour24 = Math.floor(total / 60);

        this.dueHour12 = String(nextHour24 % 12 || 12).padStart(2, "0");
        this.dueMinute = String(total % 60).padStart(2, "0");
        this.dueAmPm = nextHour24 >= 12 ? "PM" : "AM";
        this.syncDueTime();
    }

    private setDueAmPm(period: "AM" | "PM") {
        this.dueAmPm = period;
        this.syncDueTime();
    }

    private removeTime() {
        this.dueHour12 = "";
        this.dueMinute = "";
        this.dueAmPm = "AM";
        this.patch({dueTime: "", triggerOnDue: false});
        this.openRow = null;
    }

    private get timeLabel(): string {
        if (!this.hasTime) {
            return "";
        }

        return `${Number(this.dueHour12)}:${this.dueMinute.padStart(2, "0")} ${this.dueAmPm}`;
    }

    // --- Repeats -------------------------------------------------------------

    private get repeatMode(): RepeatMode {
        const {repeatInterval, repeatUnit} = this.draftValue;

        if (repeatInterval === null || repeatUnit === "") {
            return "never";
        }

        if (this.repeatCustom) {
            return "custom";
        }

        for (const [mode, preset] of Object.entries(REPEAT_PRESETS)) {
            if (repeatInterval === preset.interval && repeatUnit === preset.unit) {
                return mode as RepeatMode;
            }
        }

        return "custom";
    }

    private setRepeatMode(mode: RepeatMode) {
        this.repeatCustom = mode === "custom";

        if (mode === "never") {
            this.patch({repeatInterval: null, repeatUnit: "", repeatFrom: ""});
            return;
        }

        // A first pick needs a repeatFrom too (all-or-nothing); an existing
        // choice is kept when switching between presets.
        const repeatFrom = this.draftValue.repeatFrom || "due";

        if (mode === "custom") {
            // 2 days, never 1 - {1, days} IS the Daily preset, so Custom
            // would otherwise render as Daily the moment it's picked.
            this.patch({
                repeatInterval: this.repeatMode === "never" ? 2 : this.draftValue.repeatInterval === 1 ? 2 : this.draftValue.repeatInterval,
                repeatUnit: this.draftValue.repeatUnit || "days",
                repeatFrom,
            });
            return;
        }

        const preset = REPEAT_PRESETS[mode];
        this.patch({repeatInterval: preset.interval, repeatUnit: preset.unit, repeatFrom});
    }

    // Typed text is held separately until it's a valid number - committing
    // "" straight to repeatInterval would read as "doesn't repeat" and
    // collapse the Custom row mid-edit.
    private onRepeatIntervalInput(raw: string) {
        const digits = digitsOnly(raw, 3);
        this.intervalDraft = digits;

        if (Number(digits) >= 1) {
            this.patch({repeatInterval: Math.min(365, Number(digits))});
        }
    }

    private stepRepeatInterval(delta: number) {
        const current = this.draftValue.repeatInterval ?? 1;
        this.intervalDraft = null;
        this.patch({repeatInterval: Math.min(365, Math.max(1, current + delta))});
    }

    private get repeatLabel(): string {
        const {repeatInterval, repeatUnit} = this.draftValue;

        switch (this.repeatMode) {
            case "never":
                return "Never";
            case "custom":
                return repeatUnit === ""
                    ? "Custom"
                    : `Every ${repeatInterval} ${repeatInterval === 1 ? SINGULAR_UNIT[repeatUnit] : repeatUnit}`;
            default:
                return REPEAT_MODES.find(([mode]) => mode === this.repeatMode)![1];
        }
    }

    // What ticking it off today would produce under each repeat_from choice.
    private get nextOccurrences(): {due: Date; completion: Date} | null {
        const due = parseIsoDate(this.draftValue.dueDate);
        const {repeatInterval, repeatUnit} = this.draftValue;

        if (!due || repeatInterval === null || repeatInterval < 1 || repeatUnit === "") {
            return null;
        }

        const today = this.today;

        return {
            due: nextOccurrence(due, repeatInterval, repeatUnit, "due", today),
            completion: nextOccurrence(due, repeatInterval, repeatUnit, "completion", today),
        };
    }

    // --- Automation ----------------------------------------------------------

    private onTriggerOnDueChanged(e: Event) {
        this.patch({triggerOnDue: (e.target as HTMLInputElement).checked});
    }

    private get automationHint(): string {
        if (!this.hasDate) {
            return "Needs a due date and time";
        }

        if (!this.hasTime) {
            return "Needs a due time";
        }

        if (this.repeatMode !== "never") {
            return `Fires at ${this.timeLabel} each time it comes due`;
        }

        return `Fires ${formatShortDate(parseIsoDate(this.draftValue.dueDate)!, this.today)}, ${this.timeLabel}`;
    }

    // --- Tags ----------------------------------------------------------------

    private get tagList(): string[] {
        return parseTags(this.draftValue.tags);
    }

    private commitTagDraft() {
        const additions = parseTags(this.tagDraft).filter(tag => !this.tagList.includes(tag));

        if (additions.length > 0) {
            this.patch({tags: [...this.tagList, ...additions].join(", ")});
        }

        this.tagDraft = "";
    }

    private onTagKeydown(e: KeyboardEvent) {
        if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            this.commitTagDraft();
        } else if (e.key === "Backspace" && this.tagDraft === "" && this.tagList.length > 0) {
            this.removeTag(this.tagList[this.tagList.length - 1]);
        }
    }

    private removeTag(tag: string) {
        this.patch({tags: this.tagList.filter(existing => existing !== tag).join(", ")});
    }

    // --- Save gating ---------------------------------------------------------

    private get triggerOnDueBlocked(): boolean {
        return this.draftValue.triggerOnDue && !(this.hasDate && this.hasTime);
    }

    private get dayPinMissingWeekday(): boolean {
        return this.isDayPin && this.draftValue.dayWeekday === "";
    }

    private get repeatBlocked(): boolean {
        const {repeatInterval, repeatUnit, repeatFrom} = this.draftValue;

        if (repeatInterval === null) {
            return false;
        }

        return !this.hasDate || repeatUnit === "" || repeatFrom === "" || repeatInterval < 1;
    }

    private get titleMissing(): boolean {
        return !this.isDayPin && this.draftValue.title.trim() === "";
    }

    private get saveBlocked(): boolean {
        return this.triggerOnDueBlocked || this.dayPinMissingWeekday || this.repeatBlocked || this.titleMissing;
    }

    // --- Render --------------------------------------------------------------

    private renderTitleArea() {
        if (this.isDayPin) {
            return html`
                <div class="field">
                    <label for="todo-item-title">Title</label>
                    <input id="todo-item-title" type="text" .value=${this.effectiveTitle} placeholder="Pick a day below" disabled />
                </div>
                <div class="pills" role="group" aria-label="Day of week" style="margin-top: 10px">
                    ${WEEKDAY_NAMES.map((name, index) => {
                        const selected = this.draftValue.dayWeekday === String(index);

                        return html`
                            <button
                                type="button"
                                class=${classMap({pill: true, small: true, on: selected})}
                                aria-pressed=${selected ? "true" : "false"}
                                aria-label=${name}
                                @click=${() => this.patch({dayWeekday: String(index)})}
                            >${name.slice(0, 3)}</button>
                        `;
                    })}
                </div>
            `;
        }

        const pinType = this.draftValue.pinType;
        const titleLabel = pinType === "category" ? "Category name" : pinType === "person" ? "Name" : "Title";

        return html`
            <div class="title-row">
                <div class="field title">
                    <label for="todo-item-title">${titleLabel}</label>
                    <input
                        id="todo-item-title"
                        type="text"
                        .value=${this.draftValue.title}
                        @input=${(e: InputEvent) => this.patch({title: (e.target as HTMLInputElement).value})}
                    />
                </div>
                ${
                    pinType === ""
                        ? html`
                            <div class="field quantity">
                                <label for="todo-item-quantity">Quantity</label>
                                <input
                                    id="todo-item-quantity"
                                    type="text"
                                    placeholder="e.g. 2"
                                    .value=${this.draftValue.quantity}
                                    @input=${(e: InputEvent) => this.patch({quantity: (e.target as HTMLInputElement).value})}
                                />
                            </div>
                        `
                        : nothing
                }
            </div>
            ${
                this.showCompleteToggle
                    ? html`
                        <div class="group" style="margin-top: 12px">
                            <label class="row">
                                ${icon(I_CHECK)}
                                <span class="lbl">Completed</span>
                                <input
                                    id="todo-item-completed"
                                    type="checkbox"
                                    class="switch"
                                    .checked=${this.completed}
                                    @change=${this.toggleComplete}
                                />
                            </label>
                        </div>
                    `
                    : nothing
            }
        `;
    }

    private renderWhenArea() {
        if (this.isDayPin) {
            return html`
                <h3 class="sec">When</h3>
                <div class="day-card">
                    ${icon(I_REPEAT)}
                    <span>Day pins schedule themselves. On its day it moves to the top and reads <b>Today</b>, the day
                    before <b>Tomorrow</b>. Anything left unticked under it moves to <b>Overdue</b> the next morning.</span>
                </div>
            `;
        }

        const due = parseIsoDate(this.draftValue.dueDate);
        const overdue = due !== null && due < this.today;

        return html`
            <h3 class="sec">When</h3>
            <div class="group">
                <button
                    type="button"
                    id="todo-item-due-date-row"
                    class=${classMap({row: true, open: this.openRow === "date"})}
                    aria-expanded=${this.openRow === "date" ? "true" : "false"}
                    @click=${() => this.toggleRow("date")}
                >
                    ${icon(I_CAL)}
                    <span class="lbl">Due date</span>
                    <span class=${classMap({val: true, late: overdue})}>
                        ${due ? `${formatShortDate(due, this.today)}${overdue ? " · overdue" : ""}` : "None"}
                    </span>
                    ${icon(I_CHEV_R, "chev")}
                </button>
                ${this.openRow === "date" ? this.renderDatePanel(due) : nothing}

                ${
                    this.fieldSupport.dueDateTime
                        ? html`
                            <button
                                type="button"
                                id="todo-item-due-time-row"
                                class=${classMap({row: true, open: this.openRow === "time"})}
                                ?disabled=${!this.hasDate}
                                aria-expanded=${this.openRow === "time" ? "true" : "false"}
                                @click=${() => this.toggleRow("time")}
                            >
                                ${icon(I_CLOCK)}
                                <span class="lbl">Time${this.hasDate ? nothing : html`<span class="sub">Set a date first</span>`}</span>
                                <span class="val">${this.hasDate ? (this.hasTime ? this.timeLabel : "Any time") : ""}</span>
                                ${icon(I_CHEV_R, "chev")}
                            </button>
                            ${this.openRow === "time" ? this.renderTimePanel() : nothing}
                        `
                        : nothing
                }

                <button
                    type="button"
                    id="todo-item-repeat-row"
                    class=${classMap({row: true, open: this.openRow === "repeat"})}
                    ?disabled=${!this.hasDate}
                    aria-expanded=${this.openRow === "repeat" ? "true" : "false"}
                    @click=${() => this.toggleRow("repeat")}
                >
                    ${icon(I_REPEAT)}
                    <span class="lbl">Repeats${this.hasDate ? nothing : html`<span class="sub">Set a date first</span>`}</span>
                    <span class="val">${this.hasDate ? this.repeatLabel : ""}</span>
                    ${icon(I_CHEV_R, "chev")}
                </button>
                ${this.openRow === "repeat" ? this.renderRepeatPanel() : nothing}

                ${
                    this.fieldSupport.dueDateTime
                        ? html`
                            <label class=${classMap({row: true, off: !this.hasTime})}>
                                ${icon(I_BELL)}
                                <span class="lbl">
                                    Run automation when due
                                    <span class="sub">${this.automationHint}</span>
                                </span>
                                <input
                                    id="todo-item-trigger-on-due"
                                    type="checkbox"
                                    class="switch"
                                    .checked=${this.draftValue.triggerOnDue && this.hasTime}
                                    ?disabled=${!this.hasTime}
                                    @change=${this.onTriggerOnDueChanged}
                                />
                            </label>
                        `
                        : nothing
                }
            </div>
        `;
    }

    private renderDatePanel(selected: Date | null) {
        const year = this.calendarYear;
        const month = this.calendarMonth;
        const leadingBlanks = (new Date(year, month, 1).getDay() + 6) % 7;
        const totalDays = new Date(year, month + 1, 0).getDate();
        const today = this.today;
        const quickPicks: Array<[string, Date]> = [
            ["Today", today],
            ["Tomorrow", addDays(today, 1)],
            ["Next week", addDays(today, 7)],
        ];

        return html`
            <div class="panel date-panel">
                <div class="pills">
                    ${quickPicks.map(([label, date]) => html`
                        <button
                            type="button"
                            class=${classMap({pill: true, on: selected !== null && toIsoDate(selected) === toIsoDate(date)})}
                            @click=${() => this.pickDate(date)}
                        >${label}</button>
                    `)}
                </div>
                <div>
                    <div class="cal-head">
                        <button type="button" class="iconbtn" aria-label="Previous month" @click=${() => this.shiftCalendarMonth(-1)}>
                            ${icon(I_CHEV_L)}
                        </button>
                        <span>${MONTH_NAMES[month]} ${year}</span>
                        <button type="button" class="iconbtn" aria-label="Next month" @click=${() => this.shiftCalendarMonth(1)}>
                            ${icon(I_CHEV_R)}
                        </button>
                    </div>
                    <div class="cal-grid">
                        ${CALENDAR_WEEKDAY_LABELS.map(label => html`<span class="cal-dow" aria-hidden="true">${label}</span>`)}
                        ${Array.from({length: leadingBlanks}, () => html`<span></span>`)}
                        ${Array.from({length: totalDays}, (_, i) => {
                            const date = new Date(year, month, i + 1);

                            return html`
                                <button
                                    type="button"
                                    class=${classMap({
                                        "cal-day": true,
                                        past: date < today,
                                        today: toIsoDate(date) === toIsoDate(today),
                                        selected: selected !== null && toIsoDate(date) === toIsoDate(selected),
                                    })}
                                    aria-label=${date.toDateString()}
                                    @click=${() => this.pickDate(date)}
                                >${i + 1}</button>
                            `;
                        })}
                    </div>
                </div>
                ${
                    this.hasDate
                        ? html`
                            <div class="panel-foot" style="justify-content: flex-end">
                                <button type="button" class="text-btn small" @click=${this.clearDate}>Clear date</button>
                            </div>
                        `
                        : nothing
                }
            </div>
        `;
    }

    private renderTimePanel() {
        return html`
            <div class="panel">
                <div class="time-row">
                    <div class="spin">
                        <button type="button" aria-label="Increase hour" @click=${() => this.stepDueTime(60)}>${icon(I_UP)}</button>
                        <input
                            type="text"
                            inputmode="numeric"
                            maxlength="2"
                            aria-label="Hour"
                            .value=${this.dueHour12}
                            @input=${(e: InputEvent) => this.updateDueHour12((e.target as HTMLInputElement).value)}
                        />
                        <button type="button" aria-label="Decrease hour" @click=${() => this.stepDueTime(-60)}>${icon(I_DOWN)}</button>
                    </div>
                    <span class="time-colon" aria-hidden="true">:</span>
                    <div class="spin">
                        <button type="button" aria-label="Increase minute" @click=${() => this.stepDueTime(15)}>${icon(I_UP)}</button>
                        <input
                            type="text"
                            inputmode="numeric"
                            maxlength="2"
                            aria-label="Minute"
                            .value=${this.dueMinute}
                            @input=${(e: InputEvent) => this.updateDueMinute((e.target as HTMLInputElement).value)}
                        />
                        <button type="button" aria-label="Decrease minute" @click=${() => this.stepDueTime(-15)}>${icon(I_DOWN)}</button>
                    </div>
                    <div class="ampm" role="group" aria-label="AM or PM">
                        <button
                            type="button"
                            class=${classMap({on: this.dueAmPm === "AM"})}
                            aria-pressed=${this.dueAmPm === "AM" ? "true" : "false"}
                            @click=${() => this.setDueAmPm("AM")}
                        >AM</button>
                        <button
                            type="button"
                            class=${classMap({on: this.dueAmPm === "PM"})}
                            aria-pressed=${this.dueAmPm === "PM" ? "true" : "false"}
                            @click=${() => this.setDueAmPm("PM")}
                        >PM</button>
                    </div>
                </div>
                <div class="panel-foot">
                    <span>Arrows step 15 min · tap a number to type</span>
                    <button type="button" class="text-btn small" @click=${this.removeTime}>Remove time</button>
                </div>
            </div>
        `;
    }

    private renderRepeatPanel() {
        const mode = this.repeatMode;
        const next = this.nextOccurrences;
        const today = this.today;

        return html`
            <div class="panel">
                <div class="seg" role="group" aria-label="Repeat">
                    ${REPEAT_MODES.map(([value, label]) => html`
                        <button
                            type="button"
                            class=${classMap({on: mode === value})}
                            aria-pressed=${mode === value ? "true" : "false"}
                            @click=${() => this.setRepeatMode(value)}
                        >${label}</button>
                    `)}
                </div>

                ${
                    mode === "custom"
                        ? html`
                            <div class="custom-interval-row">
                                <span>Every</span>
                                <div class="stepper">
                                    <button type="button" aria-label="Decrease repeat interval" @click=${() => this.stepRepeatInterval(-1)}>
                                        ${icon(I_MINUS)}
                                    </button>
                                    <input
                                        class="interval"
                                        type="text"
                                        inputmode="numeric"
                                        maxlength="3"
                                        aria-label="Repeat interval"
                                        .value=${this.intervalDraft ?? String(this.draftValue.repeatInterval ?? "")}
                                        @input=${(e: InputEvent) => this.onRepeatIntervalInput((e.target as HTMLInputElement).value)}
                                        @blur=${() => {
                                            this.intervalDraft = null;
                                        }}
                                    />
                                    <button type="button" aria-label="Increase repeat interval" @click=${() => this.stepRepeatInterval(1)}>
                                        ${icon(I_PLUS)}
                                    </button>
                                </div>
                                <span class="selwrap">
                                    <select
                                        class="unit-select"
                                        aria-label="Repeat unit"
                                        .value=${this.draftValue.repeatUnit}
                                        @change=${(e: Event) => this.patch({repeatUnit: (e.target as HTMLSelectElement).value as RepeatUnit})}
                                    >
                                        <option value="days">days</option>
                                        <option value="weeks">weeks</option>
                                        <option value="months">months</option>
                                    </select>
                                    ${icon(I_DOWN)}
                                </span>
                            </div>
                        `
                        : nothing
                }

                ${
                    next
                        ? html`
                            <span class="next-label">Tick it off today and the next one is due</span>
                            <div class="next-options" role="group" aria-label="Next one counts from">
                                <button
                                    type="button"
                                    class=${classMap({"next-option": true, on: this.draftValue.repeatFrom === "due"})}
                                    aria-pressed=${this.draftValue.repeatFrom === "due" ? "true" : "false"}
                                    data-from="due"
                                    @click=${() => this.patch({repeatFrom: "due"})}
                                >
                                    <span class="kind">On its schedule</span>
                                    <span class="date">${formatShortDate(next.due, today)}</span>
                                    <span class="why">Counts from the due date. Missed ones are skipped.</span>
                                </button>
                                <button
                                    type="button"
                                    class=${classMap({"next-option": true, on: this.draftValue.repeatFrom === "completion"})}
                                    aria-pressed=${this.draftValue.repeatFrom === "completion" ? "true" : "false"}
                                    data-from="completion"
                                    @click=${() => this.patch({repeatFrom: "completion"})}
                                >
                                    <span class="kind">After I finish</span>
                                    <span class="date">${formatShortDate(next.completion, today)}</span>
                                    <span class="why">Counts from the day it's ticked off.</span>
                                </button>
                            </div>
                        `
                        : nothing
                }
            </div>
        `;
    }

    private renderDetailsArea() {
        return html`
            <h3 class="sec">Details</h3>
            <div class="details">
                ${
                    this.fieldSupport.description
                        ? html`
                            <div class="field">
                                <label for="todo-item-description">Description</label>
                                <textarea
                                    id="todo-item-description"
                                    rows="2"
                                    placeholder="Add notes"
                                    .value=${this.draftValue.description}
                                    @input=${(e: InputEvent) => this.patch({description: (e.target as HTMLTextAreaElement).value})}
                                ></textarea>
                            </div>
                        `
                        : nothing
                }
                <div class="chips" role="group" aria-label="Tags">
                    ${this.tagList.map(tag => html`
                        <span class="chip">
                            ${tag}
                            <button type="button" aria-label="Remove tag ${tag}" @click=${() => this.removeTag(tag)}>${icon(I_X)}</button>
                        </span>
                    `)}
                    <input
                        id="todo-item-tags"
                        class="tag-input"
                        type="text"
                        aria-label="Add tag"
                        placeholder="+ Add tag"
                        .value=${this.tagDraft}
                        @input=${(e: InputEvent) => {
                            this.tagDraft = (e.target as HTMLInputElement).value;
                        }}
                        @keydown=${this.onTagKeydown}
                        @blur=${this.commitTagDraft}
                    />
                </div>
            </div>
        `;
    }

    private renderOptionsArea() {
        const showLink = !this.entityIsLinked || this.draftValue.linked;
        // Names only what's switched on - "Not linked · Deletable" was too
        // long to fit beside the label and said nothing when truncated.
        const summary = [
            this.draftValue.linked ? "Linked" : null,
            this.draftValue.deleteProtected ? "Protected" : null,
        ].filter(Boolean).join(" · ") || "Off";

        return html`
            <h3 class="sec">Options</h3>
            <div class="group">
                <button
                    type="button"
                    id="todo-item-options-row"
                    class="row summary"
                    aria-expanded=${this.optionsOpen ? "true" : "false"}
                    @click=${() => {
                        this.optionsOpen = !this.optionsOpen;
                    }}
                >
                    ${icon(I_SLIDERS)}
                    <span class="lbl">Sharing &amp; safety</span>
                    <span class="val">${summary}</span>
                    ${icon(I_CHEV_R, this.optionsOpen ? "chev down" : "chev")}
                </button>
                ${
                    this.optionsOpen
                        ? html`
                            ${
                                showLink
                                    ? html`
                                        <label class="row">
                                            ${icon(I_LINK)}
                                            <span class="lbl">
                                                Link to shared list
                                                <span class="sub">${
                                                    this.draftValue.linked && this.originallyLinked
                                                        ? "Turning this off only unlinks - the item stays"
                                                        : "Keeps a synced copy on your shared list"
                                                }</span>
                                            </span>
                                            <input
                                                id="todo-item-linked"
                                                type="checkbox"
                                                class="switch"
                                                .checked=${this.draftValue.linked}
                                                @change=${(e: Event) => this.patch({linked: (e.target as HTMLInputElement).checked})}
                                            />
                                        </label>
                                        ${
                                            this.draftValue.linked && !this.originallyLinked
                                                ? html`
                                                    <div class="panel">
                                                        <div class="field">
                                                            <label for="todo-item-link-target">Put it under (optional)</label>
                                                            <input
                                                                id="todo-item-link-target"
                                                                type="text"
                                                                placeholder="e.g. Brodie"
                                                                .value=${this.draftValue.linkTarget}
                                                                @input=${(e: InputEvent) => this.patch({linkTarget: (e.target as HTMLInputElement).value})}
                                                            />
                                                        </div>
                                                    </div>
                                                `
                                                : nothing
                                        }
                                    `
                                    : nothing
                            }
                            <label class="row">
                                ${icon(I_SHIELD)}
                                <span class="lbl">
                                    Prevent deletion
                                    <span class="sub">Blocks delete, swipe and clear</span>
                                </span>
                                <input
                                    id="todo-item-delete-protected"
                                    type="checkbox"
                                    class="switch"
                                    .checked=${this.draftValue.deleteProtected}
                                    @change=${(e: Event) => this.patch({deleteProtected: (e.target as HTMLInputElement).checked})}
                                />
                            </label>
                        `
                        : nothing
                }
            </div>
        `;
    }

    private renderFooter() {
        if (this.confirmingDelete) {
            return html`
                <div class="confirm-delete">
                    <span>Delete this item?</span>
                    <button type="button" class="text-btn" @click=${() => {
                        this.confirmingDelete = false;
                    }}>Cancel</button>
                    <button type="button" class="text-btn destructive" @click=${this.confirmDeleteNow}>Delete</button>
                </div>
            `;
        }

        return html`
            ${
                this.showDelete
                    ? html`
                        <button
                            type="button"
                            class="text-btn destructive"
                            ?disabled=${this.draftValue.deleteProtected}
                            title=${this.draftValue.deleteProtected ? "Turn off Prevent deletion to delete this item" : ""}
                            @click=${this.requestDelete}
                        >Delete</button>
                    `
                    : nothing
            }
            <span class="spacer"></span>
            <button type="button" class="text-btn" @click=${this.close}>Cancel</button>
            <button type="button" class="filled-btn" ?disabled=${this.saveBlocked} @click=${this.save}>Save</button>
        `;
    }

    render() {
        const twoColumns = this.showDue || this.isDayPin;

        // ha-dialog here is HA's web-awesome-based dialog: the title goes in
        // the "headerTitle" slot (the old .heading property is ignored), it
        // supplies its own close button, and actions go in slot="footer".
        return html`
            <ha-dialog
                open
                class=${classMap({wide: twoColumns})}
                .accessibleLabel=${`${this.heading} item`}
                @closed=${this.close}
            >
                <span slot="headerTitle" class="dialog-title">
                    <span>${this.heading}</span>
                    <label class="typesel">
                        <span class="visually-hidden">Show as</span>
                        <select
                            id="todo-item-pin-type"
                            .value=${this.draftValue.pinType}
                            @change=${(e: Event) => this.patch({pinType: (e.target as HTMLSelectElement).value as "" | PinType})}
                        >
                            <option value="">Item</option>
                            <option value="category">Category</option>
                            <option value="person">Person</option>
                            <option value="day">Day of week</option>
                        </select>
                        ${icon(I_DOWN)}
                    </label>
                </span>

                <div class="layout">
                    <div class=${classMap({cols: true, two: twoColumns})}>
                        <div class="area-item">${this.renderTitleArea()}</div>
                        ${this.showDue || this.isDayPin ? html`<div class="area-when">${this.renderWhenArea()}</div>` : nothing}
                        <div class="area-details">${this.renderDetailsArea()}</div>
                        <div class="area-options">${this.renderOptionsArea()}</div>
                    </div>
                </div>

                <div class="actions" slot="footer">${this.renderFooter()}</div>
            </ha-dialog>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        "todo-overlay-item-dialog": TodoItemDialog;
    }
}
