import {describe, expect, it} from "vitest";

import {
    OTHER_BUCKET_THRESHOLD,
    groupSiblingsForDisplay,
    isStructural,
    otherGroupId,
} from "../src/grouping";
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
        delete_protected: false,
        weekday: null,
        day_label: null,
        children: [],
        ...overrides,
    };
}

describe("isStructural", () => {
    it("is true for an item with real children", () => {
        expect(isStructural(makeItem({children: [makeItem({id: "2"})]}))).toBe(true);
    });

    it("is true for a pinned item with no children at all", () => {
        expect(isStructural(makeItem({pin_type: "person"}))).toBe(true);
        expect(isStructural(makeItem({pin_type: "category"}))).toBe(true);
    });

    it("is false for a plain leaf", () => {
        expect(isStructural(makeItem())).toBe(false);
    });
});

describe("groupSiblingsForDisplay", () => {
    it("returns the exact same array reference below the threshold (a single structural item)", () => {
        const items = [
            makeItem({id: "recipes", children: [makeItem({id: "lasagna"})]}),
            makeItem({id: "milk"}),
            makeItem({id: "eggs"}),
        ];

        expect(groupSiblingsForDisplay(items, undefined)).toBe(items);
    });

    it("returns the same reference for an entirely flat list (nothing structural at all)", () => {
        const items = [makeItem({id: "milk"}), makeItem({id: "eggs"})];

        expect(groupSiblingsForDisplay(items, undefined)).toBe(items);
    });

    it("returns the same reference when every item is already structural (nothing plain to bucket)", () => {
        const items = [
            makeItem({id: "brodie", pin_type: "person"}),
            makeItem({id: "anna", pin_type: "person"}),
        ];

        expect(groupSiblingsForDisplay(items, undefined)).toBe(items);
    });

    it("sweeps plain siblings into a trailing Other once two siblings are structural", () => {
        const recipes = makeItem({id: "recipes", children: [makeItem({id: "lasagna"})]});
        const snacks = makeItem({id: "snacks", children: [makeItem({id: "chips"})]});
        const milk = makeItem({id: "milk"});
        const eggs = makeItem({id: "eggs"});

        const result = groupSiblingsForDisplay([recipes, milk, snacks, eggs], undefined);

        // Structural items keep their own original relative order;
        // Other is always last.
        expect(result.map(item => item.id)).toEqual(["recipes", "snacks", otherGroupId(undefined)]);

        const other = result[2];
        expect(other.synthetic).toBe(true);
        expect(other.title).toBe("Other");
        expect(other.children.map(item => item.id)).toEqual(["milk", "eggs"]);
    });

    it("a pinned (childless) item counts toward the threshold same as a real parent", () => {
        const anna = makeItem({id: "anna", pin_type: "person"});
        const groceries = makeItem({id: "groceries", children: [makeItem({id: "milk"})]});
        const bins = makeItem({id: "bins"});

        const result = groupSiblingsForDisplay([anna, groceries, bins], undefined);

        expect(result.map(item => item.id)).toEqual(["anna", "groceries", otherGroupId(undefined)]);
        expect((result[2].children).map(item => item.id)).toEqual(["bins"]);
    });

    it("Other's own completed state is true only when every swept-up item is complete", () => {
        const a = makeItem({id: "a", children: [makeItem({id: "a1"})]});
        const b = makeItem({id: "b", children: [makeItem({id: "b1"})]});
        const done = makeItem({id: "done", completed: true});
        const notDone = makeItem({id: "not-done", completed: false});

        const allDone = groupSiblingsForDisplay([a, b, done], undefined);
        expect(allDone[allDone.length - 1].completed).toBe(true);

        const mixed = groupSiblingsForDisplay([a, b, done, notDone], undefined);
        expect(mixed[mixed.length - 1].completed).toBe(false);
    });

    it("uses a distinct Other id per nesting level, scoped by parentId", () => {
        expect(otherGroupId(undefined)).not.toBe(otherGroupId("brodie"));
        expect(otherGroupId("brodie")).not.toBe(otherGroupId("anna"));
    });

    it("OTHER_BUCKET_THRESHOLD is 2 - the exact number this whole test file is written against", () => {
        expect(OTHER_BUCKET_THRESHOLD).toBe(2);
    });

    describe("weekdayAnchor interaction with the Other bucket", () => {
        it("defaults to Other trailing the day-pin block, same as the ordinary case", () => {
            const wed = makeItem({id: "wed", pin_type: "day", weekday: 2});
            const thu = makeItem({id: "thu", pin_type: "day", weekday: 3});
            const milk = makeItem({id: "milk"});

            const result = groupSiblingsForDisplay([wed, thu, milk], undefined);

            expect(result.map(item => item.id)).toEqual(["wed", "thu", otherGroupId(undefined)]);
        });

        it("weekdayAnchor='bottom' puts Other BEFORE the day-pin block", () => {
            const wed = makeItem({id: "wed", pin_type: "day", weekday: 2});
            const thu = makeItem({id: "thu", pin_type: "day", weekday: 3});
            const milk = makeItem({id: "milk"});

            const result = groupSiblingsForDisplay([wed, thu, milk], undefined, "bottom");

            expect(result.map(item => item.id)).toEqual([otherGroupId(undefined), "wed", "thu"]);
            expect((result[0].children).map(item => item.id)).toEqual(["milk"]);
        });

        it("weekdayAnchor='bottom' does NOT affect an ordinary (non-day) structural level", () => {
            // The override is scoped specifically to levels with "day"
            // pins - an incidental category/person level keeps Other
            // trailing regardless of this setting, so existing lists
            // that have nothing to do with the weekday feature see no
            // behavior change at all.
            const recipes = makeItem({id: "recipes", children: [makeItem({id: "lasagna"})]});
            const snacks = makeItem({id: "snacks", children: [makeItem({id: "chips"})]});
            const milk = makeItem({id: "milk"});

            const result = groupSiblingsForDisplay([recipes, milk, snacks], undefined, "bottom");

            expect(result.map(item => item.id)).toEqual(["recipes", "snacks", otherGroupId(undefined)]);
        });
    });
});
