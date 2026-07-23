import {afterEach, describe, expect, it} from "vitest";

import "../src/components/todo-overlay-list";
import type {TodoOverlayList} from "../src/components/todo-overlay-list";
import type {TodoItem, TodoList} from "../src/models";
import {makeFakeHass} from "./fakes";

const ENTITY_ID = "todo.shopping";

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

async function flushAsync(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 0));
}

// el.updateComplete only guarantees el's OWN render pass finished - a
// child custom element that just received new properties (e.g.
// todo-overlay-tree getting a new .items array) schedules its OWN
// update as a separate microtask, which updateComplete alone doesn't
// wait for. Settling flushes that too, so deepQueryAll sees the fully
// re-rendered nested tree, not a stale one.
async function settle(el: TodoOverlayList): Promise<void> {
    await el.updateComplete;
    await flushAsync();
    await el.updateComplete;
}

// querySelector(All) never pierces shadow boundaries, and the tree here
// is nested several custom elements deep (todo-overlay-list ->
// todo-overlay-tree -> todo-overlay-tree-item, recursively for
// children) - each with its own shadow root. Mirrors the same
// shadow-piercing walk todo-overlay-list.ts's own collectAllRows() does
// for real drag-and-drop hit-testing.
function deepQueryAll(root: Element | ShadowRoot, selector: string): Element[] {
    const results: Element[] = [...root.querySelectorAll(selector)];

    for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot) {
            results.push(...deepQueryAll(el.shadowRoot, selector));
        }
    }

    return results;
}

async function renderList(
    list: TodoList,
    props: Partial<TodoOverlayList> = {},
): Promise<{el: TodoOverlayList; hass: ReturnType<typeof makeFakeHass>}> {
    const hass = makeFakeHass({
        [ENTITY_ID]: {state: "0", last_updated: "2026-01-01T00:00:00Z", attributes: {supported_features: 127}},
    });
    hass.connection.responses["todo_overlay/get_list"] = list;

    const el = document.createElement("todo-overlay-list") as TodoOverlayList;
    el.entity = ENTITY_ID;
    Object.assign(el, props);
    el.hass = hass;

    document.body.appendChild(el);
    await el.updateComplete;
    await flushAsync();
    await el.updateComplete;

    return {el, hass};
}

afterEach(() => {
    document.body.innerHTML = "";
});

describe("todo-overlay-list loading", () => {
    it("loads the list for its entity on mount and renders the items", async () => {
        const {el, hass} = await renderList({
            entity_id: ENTITY_ID,
            items: [makeItem({id: "1", title: "Milk"}), makeItem({id: "2", title: "Bread"})],
        });

        expect(hass.connection.sent[0]).toMatchObject({type: "todo_overlay/get_list", entity_id: ENTITY_ID});

        const titles = deepQueryAll(el.shadowRoot!, ".summary").map(n => n.textContent);
        expect(titles).toEqual(["Milk", "Bread"]);
    });

    it("passes moveCompletedItems through to get_list as group_completed", async () => {
        const {hass} = await renderList(
            {entity_id: ENTITY_ID, items: []},
            {moveCompletedItems: true},
        );

        expect(hass.connection.sent[0]).toMatchObject({group_completed: true});
    });
});

describe("todo-overlay-list completed-item grouping", () => {
    const items = [
        makeItem({id: "1", title: "Active one", completed: false}),
        makeItem({id: "2", title: "Done one", completed: true}),
    ];

    it("renders a single flat tree with no section headers by default", async () => {
        const {el} = await renderList({entity_id: ENTITY_ID, items});

        expect(el.shadowRoot?.querySelectorAll(".section-header")).toHaveLength(0);
        expect(el.shadowRoot?.querySelectorAll("todo-overlay-tree")).toHaveLength(1);
    });

    it("splits into Active/Completed sections when moveCompletedItems is enabled", async () => {
        const {el} = await renderList({entity_id: ENTITY_ID, items}, {moveCompletedItems: true});

        const headers = [...(el.shadowRoot?.querySelectorAll(".section-header") ?? [])];
        expect(headers.map(h => h.textContent)).toEqual(["Active", "Completed"]);
        expect(el.shadowRoot?.querySelectorAll("todo-overlay-tree")).toHaveLength(2);
    });
});

describe("todo-overlay-list filtering", () => {
    it("hides non-matching items when a filter mode is set", async () => {
        const {el} = await renderList({
            entity_id: ENTITY_ID,
            items: [
                makeItem({id: "1", title: "Active one", completed: false}),
                makeItem({id: "2", title: "Done one", completed: true}),
            ],
        });

        (el as unknown as {filterMode: string}).filterMode = "completed";
        await settle(el);

        const titles = deepQueryAll(el.shadowRoot!, ".summary").map(n => n.textContent);
        expect(titles).toEqual(["Done one"]);
    });
});

function summaryTexts(el: TodoOverlayList): (string | null)[] {
    return deepQueryAll(el.shadowRoot!, ".summary").map(n => n.textContent);
}

describe("todo-overlay-list collapse", () => {
    it("hides a parent's children once its id is in collapsedIds", async () => {
        const {el} = await renderList({
            entity_id: ENTITY_ID,
            items: [makeItem({
                id: "parent", title: "Parent",
                children: [makeItem({id: "child", title: "Child"})],
            })],
        });

        expect(summaryTexts(el)).toEqual(["Parent", "Child"]);

        (el as unknown as {collapsedIds: Set<string>}).collapsedIds = new Set(["parent"]);
        await settle(el);

        expect(summaryTexts(el)).toEqual(["Parent"]);
    });

    it("toggles collapse in response to a tree-toggle-collapse event bubbling up", async () => {
        const {el} = await renderList({
            entity_id: ENTITY_ID,
            items: [makeItem({
                id: "parent", title: "Parent",
                children: [makeItem({id: "child", title: "Child"})],
            })],
        });

        expect(summaryTexts(el)).toEqual(["Parent", "Child"]);

        el.shadowRoot?.querySelector("todo-overlay-tree")?.dispatchEvent(
            new CustomEvent("tree-toggle-collapse", {detail: {id: "parent"}, bubbles: true, composed: true}),
        );
        await settle(el);

        expect(summaryTexts(el)).toEqual(["Parent"]);
    });
});

describe("todo-overlay-list toolbar visibility", () => {
    it("shows no toolbar at all when every toolbar flag is off", async () => {
        const {el} = await renderList(
            {entity_id: ENTITY_ID, items: []},
            {showQuickAdd: false, showFilterMenu: false, showSaveLoadButtons: false, showClearButton: false},
        );

        expect(el.shadowRoot?.querySelector(".toolbar")).toBeNull();
    });

    it("shows exactly the icons whose flags are enabled", async () => {
        const {el} = await renderList(
            {entity_id: ENTITY_ID, items: []},
            {showQuickAdd: true, showFilterMenu: true, showSaveLoadButtons: false, showClearButton: false},
        );

        const toolbar = el.shadowRoot?.querySelector(".toolbar");
        expect(toolbar).not.toBeNull();
        expect(toolbar?.querySelectorAll("button[aria-label='Add item']")).toHaveLength(1);
        expect(toolbar?.querySelector(".filter-select-wrapper")).not.toBeNull();
        expect(toolbar?.querySelector("button[aria-label='Save list']")).toBeNull();
        expect(toolbar?.querySelector("button[aria-label='Clear completed']")).toBeNull();
    });
});

describe("todo-overlay-list quick add", () => {
    it("expands the quick-add row when the plus icon is clicked", async () => {
        const {el} = await renderList({entity_id: ENTITY_ID, items: []}, {showQuickAdd: true});

        expect(el.shadowRoot?.querySelector(".quick-add-panel")).toBeNull();

        (el.shadowRoot?.querySelector("button[aria-label='Add item']") as HTMLElement).click();
        await el.updateComplete;

        expect(el.shadowRoot?.querySelector(".quick-add-panel")).not.toBeNull();
    });

    it("submitting quick add calls todo.add_item and reloads the list", async () => {
        const {el, hass} = await renderList({entity_id: ENTITY_ID, items: []}, {showQuickAdd: true});

        (el.shadowRoot?.querySelector("button[aria-label='Add item']") as HTMLElement).click();
        await el.updateComplete;

        const input = el.shadowRoot?.querySelector(".quick-add-row input") as HTMLInputElement;
        input.value = "New item";
        input.dispatchEvent(new Event("input"));
        await el.updateComplete;

        const sentBefore = hass.connection.sent.length;
        (el.shadowRoot?.querySelector(".quick-add-row button") as HTMLElement).click();
        await flushAsync();

        expect(hass.serviceCalls).toContainEqual({
            domain: "todo", service: "add_item",
            data: {entity_id: ENTITY_ID, item: "New item"},
        });
        // Reloads afterwards - at least one more get_list call than before submitting.
        expect(hass.connection.sent.filter(m => m.type === "todo_overlay/get_list").length)
            .toBeGreaterThan(hass.connection.sent.slice(0, sentBefore)
                .filter(m => m.type === "todo_overlay/get_list").length);
    });
});

describe("todo-overlay-list non-completable parent tap", () => {
    it("toggles collapse instead of completing when hideCompleteForParents hides the checkbox", async () => {
        const {el} = await renderList(
            {
                entity_id: ENTITY_ID,
                items: [makeItem({
                    id: "parent", title: "Parent",
                    children: [makeItem({id: "child", title: "Child"})],
                })],
            },
            {hideCompleteForParents: true},
        );

        expect(summaryTexts(el)).toEqual(["Parent", "Child"]);

        const treeItem = deepQueryAll(el.shadowRoot!, "todo-overlay-tree-item")[0];
        treeItem.dispatchEvent(new CustomEvent("tree-pointer-down", {
            detail: {id: "parent"}, bubbles: true, composed: true,
        }));
        treeItem.dispatchEvent(new CustomEvent("tree-pointer-up", {
            detail: {id: "parent", pressDurationMs: 100, moved: false}, bubbles: true, composed: true,
        }));
        await settle(el);

        expect(summaryTexts(el)).toEqual(["Parent"]);
    });
});
