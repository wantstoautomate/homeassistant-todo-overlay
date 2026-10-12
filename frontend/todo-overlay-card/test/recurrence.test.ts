import {describe, expect, it} from "vitest";

import {addMonths, formatShortDate, nextOccurrence, parseIsoDate, toIsoDate} from "../src/recurrence";

const TODAY = new Date(2026, 9, 12);

describe("recurrence", () => {
    it("round-trips ISO dates and rejects anything else", () => {
        expect(toIsoDate(parseIsoDate("2026-03-05")!)).toBe("2026-03-05");
        expect(parseIsoDate("")).toBeNull();
        expect(parseIsoDate("05/03/2026")).toBeNull();
    });

    it("adds calendar months, clamping to the target month's last day", () => {
        expect(toIsoDate(addMonths(new Date(2026, 0, 31), 1))).toBe("2026-02-28");
        expect(toIsoDate(addMonths(new Date(2028, 0, 31), 1))).toBe("2028-02-29");
        expect(toIsoDate(addMonths(new Date(2026, 10, 15), 3))).toBe("2027-02-15");
    });

    it("on schedule counts from the due date", () => {
        const next = nextOccurrence(new Date(2026, 9, 16), 1, "weeks", "due", TODAY);

        expect(toIsoDate(next)).toBe("2026-10-23");
    });

    it("on schedule skips missed occurrences, landing after today", () => {
        expect(toIsoDate(nextOccurrence(new Date(2026, 9, 1), 1, "weeks", "due", TODAY))).toBe("2026-10-15");
        // Exactly today isn't "after today" - matches the backend's `<=`.
        expect(toIsoDate(nextOccurrence(new Date(2026, 9, 5), 1, "weeks", "due", TODAY))).toBe("2026-10-19");
    });

    it("after finishing counts from today, ignoring the old due date", () => {
        const next = nextOccurrence(new Date(2026, 8, 1), 3, "months", "completion", TODAY);

        expect(toIsoDate(next)).toBe("2027-01-12");
    });

    it("labels today/tomorrow/yesterday in words", () => {
        expect(formatShortDate(new Date(2026, 9, 12, 18), TODAY)).toBe("Today");
        expect(formatShortDate(new Date(2026, 9, 13), TODAY)).toBe("Tomorrow");
        expect(formatShortDate(new Date(2026, 9, 11), TODAY)).toBe("Yesterday");
        expect(formatShortDate(new Date(2026, 9, 23), TODAY)).not.toMatch(/Today|Tomorrow/);
    });
});
