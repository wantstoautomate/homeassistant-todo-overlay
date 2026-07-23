import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {isOverdue, supportsFeature, TodoListEntityFeature} from "../src/models";
import type {TodoItem} from "../src/models";

function makeItem(overrides: Partial<TodoItem> = {}): TodoItem {
    return {
        id: "1",
        title: "Item",
        completed: false,
        description: null,
        due_date: null,
        due_datetime: null,
        quantity: null,
        tags: [],
        trigger_on_due: false,
        children: [],
        ...overrides,
    };
}

describe("supportsFeature", () => {
    it("returns true when the bit is set", () => {
        expect(supportsFeature(TodoListEntityFeature.SET_DUE_DATE_ON_ITEM, TodoListEntityFeature.SET_DUE_DATE_ON_ITEM)).toBe(true);
    });

    it("returns false when the bit is not set", () => {
        expect(supportsFeature(TodoListEntityFeature.CREATE_TODO_ITEM, TodoListEntityFeature.SET_DUE_DATE_ON_ITEM)).toBe(false);
    });

    it("returns false for a non-numeric value rather than throwing", () => {
        expect(supportsFeature(undefined, TodoListEntityFeature.SET_DUE_DATE_ON_ITEM)).toBe(false);
        expect(supportsFeature(null, TodoListEntityFeature.SET_DUE_DATE_ON_ITEM)).toBe(false);
        expect(supportsFeature("32", TodoListEntityFeature.SET_DUE_DATE_ON_ITEM)).toBe(false);
    });
});

describe("isOverdue", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-06-15T12:00:00"));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("is false for an item with no due date", () => {
        expect(isOverdue(makeItem())).toBe(false);
    });

    it("is false for an item due today", () => {
        expect(isOverdue(makeItem({due_date: "2026-06-15"}))).toBe(false);
    });

    it("is true for an item due yesterday", () => {
        expect(isOverdue(makeItem({due_date: "2026-06-14"}))).toBe(true);
    });

    it("is false for an item due tomorrow", () => {
        expect(isOverdue(makeItem({due_date: "2026-06-16"}))).toBe(false);
    });

    it("is false for a completed item, even if its due date has passed", () => {
        expect(isOverdue(makeItem({due_date: "2026-01-01", completed: true}))).toBe(false);
    });

    it("uses due_datetime over due_date when both would be present", () => {
        expect(isOverdue(makeItem({due_date: "2026-06-14", due_datetime: "2026-06-16T09:00:00"}))).toBe(false);
    });

    it("is day-level, not exact-time - overdue only starts the day after", () => {
        // Due earlier today (an hour ago) is not yet "overdue" - only the
        // day boundary matters, not the time of day.
        expect(isOverdue(makeItem({due_datetime: "2026-06-15T09:00:00"}))).toBe(false);
    });
});
