import {afterEach, describe, expect, it} from "vitest";

import "../src/components/todo-tree-item";
import type {TodoTreeItem} from "../src/components/todo-tree-item";
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

async function renderItem(item: TodoItem, props: Partial<TodoTreeItem> = {}): Promise<TodoTreeItem> {
    const el = document.createElement("todo-overlay-tree-item") as TodoTreeItem;

    el.item = item;
    Object.assign(el, props);

    document.body.appendChild(el);
    await el.updateComplete;

    return el;
}

afterEach(() => {
    document.body.innerHTML = "";
});

describe("todo-overlay-tree-item", () => {
    it("renders the item's title", async () => {
        const el = await renderItem(makeItem({title: "Buy milk"}));

        expect(el.shadowRoot?.querySelector(".summary")?.textContent).toBe("Buy milk");
    });

    it("renders a checkbox for a plain leaf item", async () => {
        const el = await renderItem(makeItem());

        expect(el.shadowRoot?.querySelector("ha-checkbox")).not.toBeNull();
    });

    it("renders a collapse-toggle-spacer, not a chevron, for a leaf item", async () => {
        const el = await renderItem(makeItem({children: []}));

        expect(el.shadowRoot?.querySelector(".collapse-toggle")).toBeNull();
        expect(el.shadowRoot?.querySelector(".collapse-toggle-spacer")).not.toBeNull();
    });

    it("renders a chevron for an item with children", async () => {
        const el = await renderItem(makeItem({children: [makeItem({id: "2"})]}));

        expect(el.shadowRoot?.querySelector(".collapse-toggle")).not.toBeNull();
    });

    it("shows a completion status chip only for items with children", async () => {
        const leaf = await renderItem(makeItem());
        expect(leaf.shadowRoot?.querySelector(".status-chip")).toBeNull();

        const parent = await renderItem(makeItem({
            children: [makeItem({id: "2", completed: true}), makeItem({id: "3", completed: false})],
        }));
        expect(parent.shadowRoot?.querySelector(".status-chip")?.textContent?.trim()).toBe("1/2");
    });

    it("marks the status chip as all-done when every child is complete", async () => {
        const el = await renderItem(makeItem({
            children: [makeItem({id: "2", completed: true}), makeItem({id: "3", completed: true})],
        }));

        expect(el.shadowRoot?.querySelector(".status-chip.all-done")).not.toBeNull();
    });

    it("hides the checkbox slot's checkbox for a parent when hideCompleteForParents is set", async () => {
        const el = await renderItem(
            makeItem({children: [makeItem({id: "2"})]}),
            {hideCompleteForParents: true},
        );

        expect(el.shadowRoot?.querySelector(".checkbox-slot")).not.toBeNull();
        expect(el.shadowRoot?.querySelector(".checkbox-slot ha-checkbox")).toBeNull();
    });

    it("still shows a leaf item's own checkbox even when hideCompleteForParents is set", async () => {
        const el = await renderItem(makeItem(), {hideCompleteForParents: true});

        expect(el.shadowRoot?.querySelector(".checkbox-slot ha-checkbox")).not.toBeNull();
    });

    it("does not render children when collapsed", async () => {
        const el = await renderItem(
            makeItem({id: "parent", children: [makeItem({id: "child", title: "Child"})]}),
            {collapsedIds: new Set(["parent"])},
        );

        expect(el.shadowRoot?.querySelector("ul")).toBeNull();
    });

    it("renders children when not collapsed", async () => {
        const el = await renderItem(
            makeItem({id: "parent", children: [makeItem({id: "child", title: "Child"})]}),
        );

        expect(el.shadowRoot?.querySelector("ul")).not.toBeNull();
        expect(el.shadowRoot?.querySelector("todo-overlay-tree-item")).not.toBeNull();
    });

    it("dispatches tree-toggle-collapse with the item's id when the chevron is clicked", async () => {
        const el = await renderItem(makeItem({id: "parent", children: [makeItem({id: "child"})]}));

        let detail: {id: string} | undefined;
        el.addEventListener("tree-toggle-collapse", (e) => {
            detail = (e as CustomEvent<{id: string}>).detail;
        });

        (el.shadowRoot?.querySelector(".collapse-toggle") as HTMLElement).click();

        expect(detail).toEqual({id: "parent"});
    });

    it("shows the due chip with the armed-trigger icon only when trigger_on_due is set", async () => {
        const armed = await renderItem(makeItem({due_date: "2026-01-01", trigger_on_due: true}));
        expect(armed.shadowRoot?.querySelector(".due-chip .trigger-armed-icon")).not.toBeNull();

        const unarmed = await renderItem(makeItem({due_date: "2026-01-01", trigger_on_due: false}));
        expect(unarmed.shadowRoot?.querySelector(".due-chip .trigger-armed-icon")).toBeNull();
    });

    it("renders the quantity chip when set", async () => {
        const el = await renderItem(makeItem({quantity: "150g"}));

        expect(el.shadowRoot?.querySelector(".quantity-chip")?.textContent).toBe("150g");
    });

    it("renders tag chips for every tag", async () => {
        const el = await renderItem(makeItem({tags: ["urgent", "deli"]}));

        const chips = [...(el.shadowRoot?.querySelectorAll(".tag-chip") ?? [])];
        expect(chips.map(chip => chip.textContent)).toEqual(["urgent", "deli"]);
    });
});
