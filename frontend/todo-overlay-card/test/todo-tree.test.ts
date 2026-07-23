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

    it("renders nothing when items is empty", async () => {
        const el = document.createElement("todo-overlay-tree") as TodoTree;
        el.items = [];

        document.body.appendChild(el);
        await el.updateComplete;

        expect(el.shadowRoot?.querySelectorAll("todo-overlay-tree-item")).toHaveLength(0);
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
