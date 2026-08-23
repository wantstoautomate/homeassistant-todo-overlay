import {describe, expect, it} from "vitest";

import {sortTree} from "../src/sort";
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
        pin_type: null,
        linked: false,
        children: [],
        ...overrides,
    };
}

describe("sortTree", () => {
    it("returns the same array reference for manual mode, untouched", () => {
        const items = [makeItem({id: "1"}), makeItem({id: "2"})];

        expect(sortTree(items, "manual", "asc")).toBe(items);
    });

    it("sorts by title ascending", () => {
        const items = [
            makeItem({id: "1", title: "Banana"}),
            makeItem({id: "2", title: "Apple"}),
        ];

        expect(sortTree(items, "title", "asc").map(i => i.id)).toEqual(["2", "1"]);
    });

    it("sorts by title descending", () => {
        const items = [
            makeItem({id: "1", title: "Banana"}),
            makeItem({id: "2", title: "Apple"}),
        ];

        expect(sortTree(items, "title", "desc").map(i => i.id)).toEqual(["1", "2"]);
    });

    it("sorts by due_date ascending, undated items last", () => {
        const items = [
            makeItem({id: "no-date"}),
            makeItem({id: "later", due_date: "2026-06-01"}),
            makeItem({id: "sooner", due_date: "2026-01-01"}),
        ];

        expect(sortTree(items, "due_date", "asc").map(i => i.id)).toEqual([
            "sooner", "later", "no-date",
        ]);
    });

    it("recursively sorts children independently of their parent level", () => {
        const items = [
            makeItem({
                id: "parent",
                title: "Z-parent",
                children: [
                    makeItem({id: "child-b", title: "Banana"}),
                    makeItem({id: "child-a", title: "Apple"}),
                ],
            }),
        ];

        const sorted = sortTree(items, "title", "asc");

        expect(sorted[0].children.map(c => c.id)).toEqual(["child-a", "child-b"]);
    });

    it("does not mutate the original items when actively sorting", () => {
        const original = [makeItem({id: "1", title: "Banana"}), makeItem({id: "2", title: "Apple"})];
        const originalOrder = original.map(i => i.id);

        sortTree(original, "title", "asc");

        expect(original.map(i => i.id)).toEqual(originalOrder);
    });
});
