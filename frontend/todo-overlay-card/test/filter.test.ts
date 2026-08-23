import {describe, expect, it} from "vitest";

import {filterTree} from "../src/filter";
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

describe("filterTree", () => {
    it("keeps everything for mode 'all'", () => {
        const items = [
            makeItem({id: "1", completed: false}),
            makeItem({id: "2", completed: true}),
        ];

        expect(filterTree(items, "all").map(i => i.id)).toEqual(["1", "2"]);
    });

    it("keeps only incomplete items for mode 'active'", () => {
        const items = [
            makeItem({id: "1", completed: false}),
            makeItem({id: "2", completed: true}),
        ];

        expect(filterTree(items, "active").map(i => i.id)).toEqual(["1"]);
    });

    it("keeps only completed items for mode 'completed'", () => {
        const items = [
            makeItem({id: "1", completed: false}),
            makeItem({id: "2", completed: true}),
        ];

        expect(filterTree(items, "completed").map(i => i.id)).toEqual(["2"]);
    });

    it("keeps overdue items for mode 'overdue'", () => {
        const items = [
            makeItem({id: "1", completed: false, due_date: "2020-01-01"}),
            makeItem({id: "2", completed: false, due_date: "2999-01-01"}),
        ];

        expect(filterTree(items, "overdue").map(i => i.id)).toEqual(["1"]);
    });

    it("keeps a non-matching parent when it has a matching descendant, showing only the matching children", () => {
        const items = [
            makeItem({
                id: "parent",
                completed: false,
                children: [
                    makeItem({id: "child-active", completed: false}),
                    makeItem({id: "child-done", completed: true}),
                ],
            }),
        ];

        const result = filterTree(items, "completed");

        expect(result).toHaveLength(1);
        expect(result[0].id).toBe("parent");
        expect(result[0].children.map(c => c.id)).toEqual(["child-done"]);
    });

    it("drops a subtree entirely when neither it nor any descendant matches", () => {
        const items = [
            makeItem({
                id: "parent",
                completed: false,
                children: [makeItem({id: "child", completed: false})],
            }),
        ];

        expect(filterTree(items, "completed")).toEqual([]);
    });

    it("does not mutate the original items", () => {
        const original = makeItem({id: "1", completed: false});

        const result = filterTree([original], "all");

        expect(result[0]).not.toBe(original);
        expect(original.children).toEqual([]);
    });
});
