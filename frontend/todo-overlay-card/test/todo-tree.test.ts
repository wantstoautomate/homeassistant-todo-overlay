import {afterEach, describe, expect, it} from "vitest";

import "../src/components/todo-tree";
import type {TodoTree} from "../src/components/todo-tree";
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
        children: [],
        ...overrides,
    };
}

afterEach(() => {
    document.body.innerHTML = "";
});

describe("todo-overlay-tree", () => {
    it("renders one todo-overlay-tree-item per top-level item", async () => {
        const el = document.createElement("todo-overlay-tree") as TodoTree;
        el.items = [makeItem({id: "1"}), makeItem({id: "2"}), makeItem({id: "3"})];

        document.body.appendChild(el);
        await el.updateComplete;

        expect(el.shadowRoot?.querySelectorAll("todo-overlay-tree-item")).toHaveLength(3);
    });

    it("renders no items when items is empty", async () => {
        const el = document.createElement("todo-overlay-tree") as TodoTree;
        el.items = [];

        document.body.appendChild(el);
        await el.updateComplete;

        expect(el.shadowRoot?.querySelectorAll("todo-overlay-tree-item")).toHaveLength(0);
    });

    describe("empty-list drop zone", () => {
        // Live-reported bug: dragging an item into a completely empty
        // list didn't work at all - an empty <ul> has zero height, so
        // there was nothing for the card's drag-and-drop hit-testing
        // (collectAllRows in todo-overlay-list.ts) to even find, let
        // alone hover over. This placeholder gives it something real to
        // hit-test against.

        it("renders a hit-testable placeholder (not just empty space) when items is empty", async () => {
            const el = document.createElement("todo-overlay-tree") as TodoTree;
            el.items = [];

            document.body.appendChild(el);
            await el.updateComplete;

            const zone = el.shadowRoot?.querySelector("[data-empty-drop-zone]");
            expect(zone).not.toBeNull();
            expect(zone?.textContent?.trim()).toBe("No items");
        });

        it("does not render the placeholder when there are items", async () => {
            const el = document.createElement("todo-overlay-tree") as TodoTree;
            el.items = [makeItem({id: "1"})];

            document.body.appendChild(el);
            await el.updateComplete;

            expect(el.shadowRoot?.querySelector("[data-empty-drop-zone]")).toBeNull();
        });

        it("shows a distinct 'Drop here' hover state when emptyDropHighlight is set", async () => {
            const el = document.createElement("todo-overlay-tree") as TodoTree;
            el.items = [];

            document.body.appendChild(el);
            await el.updateComplete;

            const zoneBefore = el.shadowRoot?.querySelector("[data-empty-drop-zone]");
            expect(zoneBefore?.classList.contains("drop-target")).toBe(false);
            expect(zoneBefore?.textContent?.trim()).toBe("No items");

            el.emptyDropHighlight = true;
            await el.updateComplete;

            const zoneAfter = el.shadowRoot?.querySelector("[data-empty-drop-zone]");
            expect(zoneAfter?.classList.contains("drop-target")).toBe(true);
            expect(zoneAfter?.textContent?.trim()).toBe("Drop here");
        });
    });

    it("threads hideCompleteForParents through to each child", async () => {
        const el = document.createElement("todo-overlay-tree") as TodoTree;
        el.items = [makeItem({id: "1"})];
        el.hideCompleteForParents = true;

        document.body.appendChild(el);
        await el.updateComplete;

        const child = el.shadowRoot?.querySelector("todo-overlay-tree-item") as HTMLElement & {
            hideCompleteForParents: boolean;
        };
        expect(child.hideCompleteForParents).toBe(true);
    });
});
