import type {RepeatFrom, RepeatUnit} from "./models";

function pad(n: number): string {
    return String(n).padStart(2, "0");
}

export function parseIsoDate(value: string): Date | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

    return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}

export function toIsoDate(date: Date): string {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function startOfDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

// Calendar months, clamped to the target month's last day (Jan 31 + 1 -> Feb 28/29),
// matching dateutil.relativedelta on the backend.
export function addMonths(date: Date, months: number): Date {
    const first = new Date(date.getFullYear(), date.getMonth() + months, 1);
    const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();

    return new Date(first.getFullYear(), first.getMonth(), Math.min(date.getDate(), lastDay));
}

export function advance(date: Date, interval: number, unit: RepeatUnit): Date {
    if (unit === "months") {
        return addMonths(date, interval);
    }

    return addDays(date, unit === "weeks" ? interval * 7 : interval);
}

// Mirrors manager_recurrence.py's _compute_next_occurrence, so the dialog's
// preview is exactly what completing the item will actually produce.
export function nextOccurrence(
    due: Date,
    interval: number,
    unit: RepeatUnit,
    from: RepeatFrom,
    today: Date,
): Date {
    const base = startOfDay(today);

    if (from === "completion") {
        return advance(base, interval, unit);
    }

    let next = advance(due, interval, unit);

    while (next <= base) {
        next = advance(next, interval, unit);
    }

    return next;
}

export function formatShortDate(date: Date, today: Date): string {
    const base = startOfDay(today);
    const diffDays = Math.round((startOfDay(date).getTime() - base.getTime()) / 86_400_000);

    if (diffDays === 0) {
        return "Today";
    }

    if (diffDays === 1) {
        return "Tomorrow";
    }

    if (diffDays === -1) {
        return "Yesterday";
    }

    return date.toLocaleDateString(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: date.getFullYear() !== base.getFullYear() ? "numeric" : undefined,
    });
}
