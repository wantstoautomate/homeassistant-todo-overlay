import {afterEach, describe, expect, it, vi} from "vitest";

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
    localStorage.clear();
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

    it("persists collapse state across a full reload of the card (e.g. a phone reconnecting)", async () => {
        const items = [makeItem({
            id: "parent", title: "Parent",
            children: [makeItem({id: "child", title: "Child"})],
        })];

        const {el: firstMount} = await renderList({entity_id: ENTITY_ID, items});
        expect(summaryTexts(firstMount)).toEqual(["Parent", "Child"]);

        firstMount.shadowRoot?.querySelector("todo-overlay-tree")?.dispatchEvent(
            new CustomEvent("tree-toggle-collapse", {detail: {id: "parent"}, bubbles: true, composed: true}),
        );
        await settle(firstMount);
        expect(summaryTexts(firstMount)).toEqual(["Parent"]);

        // A real reload tears down and recreates the whole element, not
        // just its properties - a fresh instance, same entity, is what
        // actually happens on a page refresh.
        document.body.innerHTML = "";
        const {el: secondMount} = await renderList({entity_id: ENTITY_ID, items});

        expect(summaryTexts(secondMount)).toEqual(["Parent"]);
    });

    it("keeps collapse state separate per entity", async () => {
        const items = [makeItem({
            id: "parent", title: "Parent",
            children: [makeItem({id: "child", title: "Child"})],
        })];

        const {el: entityA} = await renderList({entity_id: ENTITY_ID, items});
        entityA.shadowRoot?.querySelector("todo-overlay-tree")?.dispatchEvent(
            new CustomEvent("tree-toggle-collapse", {detail: {id: "parent"}, bubbles: true, composed: true}),
        );
        await settle(entityA);

        document.body.innerHTML = "";

        const {el: entityB} = await renderList({entity_id: "todo.other", items}, {entity: "todo.other"});
        expect(summaryTexts(entityB)).toEqual(["Parent", "Child"]);
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

function mockRect(el: Element, rect: {top: number; bottom: number; height: number}): void {
    (el as HTMLElement).getBoundingClientRect = () => ({
        top: rect.top,
        bottom: rect.bottom,
        height: rect.height,
        left: 0,
        right: 0,
        width: 0,
        x: 0,
        y: rect.top,
        toJSON() { return {}; },
    }) as DOMRect;
}

type DraggableList = TodoOverlayList & {
    draggedId?: string;
    onDragStart: (e: CustomEvent) => void;
    onGlobalPointerMove: (e: PointerEvent) => void;
    onGlobalPointerUp: () => Promise<void>;
};

describe("todo-overlay-list cross-entity drag", () => {
    it("calls transferItem (not moveItem) when dropped on a row belonging to a different entity", async () => {
        const hassA = makeFakeHass({
            "todo.a": {state: "0", last_updated: "2026-01-01T00:00:00Z", attributes: {supported_features: 127}},
        });
        hassA.connection.responses["todo_overlay/get_list"] = {
            entity_id: "todo.a",
            items: [makeItem({id: "1", title: "Milk"})],
        };

        const hassB = makeFakeHass({
            "todo.b": {state: "0", last_updated: "2026-01-01T00:00:00Z", attributes: {supported_features: 127}},
        });
        hassB.connection.responses["todo_overlay/get_list"] = {
            entity_id: "todo.b",
            items: [makeItem({id: "a", title: "Laundry"})],
        };

        const elA = document.createElement("todo-overlay-list") as TodoOverlayList;
        elA.entity = "todo.a";
        elA.hass = hassA;
        document.body.appendChild(elA);

        const elB = document.createElement("todo-overlay-list") as TodoOverlayList;
        elB.entity = "todo.b";
        elB.hass = hassB;
        document.body.appendChild(elB);

        await settle(elA);
        await settle(elB);

        const rowA = deepQueryAll(elA.shadowRoot!, "todo-overlay-tree-item")[0] as Element & {shadowRoot: ShadowRoot};
        const rowB = deepQueryAll(elB.shadowRoot!, "todo-overlay-tree-item")[0] as Element & {shadowRoot: ShadowRoot};

        mockRect(rowA.shadowRoot.querySelector(".row")!, {top: 0, bottom: 40, height: 40});
        mockRect(rowB.shadowRoot.querySelector(".row")!, {top: 100, bottom: 140, height: 40});

        // collectAllRows(document) walks the whole page, threading each row's
        // entity from the nearest enclosing todo-overlay-list - both lists
        // are light-DOM siblings under document.body here, same as two
        // sections of a real multi-entity dashboard.
        const draggableA = elA as unknown as DraggableList;

        draggableA.draggedId = "1";
        draggableA.onDragStart(new CustomEvent("tree-drag-start", {
            detail: {rect: undefined, pointerX: 0, pointerY: 0, grabOffsetX: 0, grabOffsetY: 0},
        }));

        // Drop squarely inside row B's mocked rect (100-140).
        draggableA.onGlobalPointerMove(new PointerEvent("pointermove", {clientY: 120}));
        await draggableA.onGlobalPointerUp();

        expect(hassA.connection.sent).toContainEqual(expect.objectContaining({
            type: "todo_overlay/transfer_item",
            source_entity_id: "todo.a",
            item_id: "1",
            target_entity_id: "todo.b",
        }));
        expect(hassA.connection.sent.some(m => m.type === "todo_overlay/move_item")).toBe(false);
    });

    it("calls moveItem (not transferItem) when dropped on a row belonging to the same entity", async () => {
        const hassA = makeFakeHass({
            "todo.a": {state: "0", last_updated: "2026-01-01T00:00:00Z", attributes: {supported_features: 127}},
        });
        hassA.connection.responses["todo_overlay/get_list"] = {
            entity_id: "todo.a",
            items: [
                makeItem({id: "1", title: "Milk"}),
                makeItem({id: "2", title: "Bread"}),
            ],
        };

        const elA = document.createElement("todo-overlay-list") as TodoOverlayList;
        elA.entity = "todo.a";
        elA.hass = hassA;
        document.body.appendChild(elA);

        await settle(elA);

        const rows = deepQueryAll(elA.shadowRoot!, "todo-overlay-tree-item") as (Element & {shadowRoot: ShadowRoot})[];
        mockRect(rows[0].shadowRoot.querySelector(".row")!, {top: 0, bottom: 40, height: 40});
        mockRect(rows[1].shadowRoot.querySelector(".row")!, {top: 100, bottom: 140, height: 40});

        const draggableA = elA as unknown as DraggableList;

        draggableA.draggedId = "1";
        draggableA.onDragStart(new CustomEvent("tree-drag-start", {
            detail: {rect: undefined, pointerX: 0, pointerY: 0, grabOffsetX: 0, grabOffsetY: 0},
        }));

        draggableA.onGlobalPointerMove(new PointerEvent("pointermove", {clientY: 120}));
        await draggableA.onGlobalPointerUp();

        expect(hassA.connection.sent).toContainEqual(expect.objectContaining({
            type: "todo_overlay/move_item",
            entity_id: "todo.a",
            child_id: "1",
        }));
        expect(hassA.connection.sent.some(m => m.type === "todo_overlay/transfer_item")).toBe(false);
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

describe("todo-overlay-list error handling", () => {
    it("shows a friendly generic message (not the raw exception) when loading fails, and logs the detail", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

        const hass = makeFakeHass({
            [ENTITY_ID]: {state: "0", last_updated: "2026-01-01T00:00:00Z", attributes: {supported_features: 127}},
        });
        hass.connection.errors["todo_overlay/get_list"] = new Error("KeyError: 'todo.shopping' not found");

        const el = document.createElement("todo-overlay-list") as TodoOverlayList;
        el.entity = ENTITY_ID;
        el.hass = hass;

        document.body.appendChild(el);
        await el.updateComplete;
        await flushAsync();
        await el.updateComplete;

        const errorText = el.shadowRoot?.querySelector("[style*='error-color']")?.textContent?.trim();
        expect(errorText).toBe("Something went wrong. Check the browser console for details.");
        expect(errorText).not.toContain("KeyError");

        expect(consoleError).toHaveBeenCalledWith(
            expect.stringContaining("loading the list"),
            expect.any(Error),
        );

        consoleError.mockRestore();
    });

    it("shows the same friendly message (not the raw exception) when an action fails", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

        const {el, hass} = await renderList({
            entity_id: ENTITY_ID,
            items: [makeItem({id: "1", title: "Milk"})],
        });

        hass.connection.errors["todo_overlay/set_completed"] = new Error("ValueError: item not found");

        const treeItem = deepQueryAll(el.shadowRoot!, "todo-overlay-tree-item")[0];
        treeItem.dispatchEvent(new CustomEvent("tree-pointer-down", {
            detail: {id: "1"}, bubbles: true, composed: true,
        }));
        treeItem.dispatchEvent(new CustomEvent("tree-pointer-up", {
            detail: {id: "1", pressDurationMs: 100, moved: false}, bubbles: true, composed: true,
        }));
        await flushAsync();
        await el.updateComplete;

        const errorText = el.shadowRoot?.querySelector("[style*='error-color']")?.textContent?.trim();
        expect(errorText).toBe("Something went wrong. Check the browser console for details.");
        expect(errorText).not.toContain("ValueError");

        consoleError.mockRestore();
    });
});

describe("todo-overlay-list edit-dialog delete (diagnostic)", () => {
    it("holding a row opens the edit dialog, and confirming Delete twice actually removes the item", async () => {
        const {el, hass} = await renderList({
            entity_id: ENTITY_ID,
            items: [makeItem({id: "1", title: "Milk"})],
        });

        const treeItem = deepQueryAll(el.shadowRoot!, "todo-overlay-tree-item")[0];
        treeItem.dispatchEvent(new CustomEvent("tree-pointer-down", {
            detail: {id: "1"}, bubbles: true, composed: true,
        }));
        treeItem.dispatchEvent(new CustomEvent("tree-pointer-up", {
            detail: {id: "1", pressDurationMs: 600, moved: false}, bubbles: true, composed: true,
        }));
        await el.updateComplete;

        const dialog = el.shadowRoot?.querySelector("todo-overlay-item-dialog");
        expect(dialog, "edit dialog should be open after a long press").not.toBeNull();

        const deleteButton = [...(dialog?.shadowRoot?.querySelectorAll("button") ?? [])]
            .find(b => b.textContent?.trim() === "Delete") as HTMLButtonElement;
        expect(deleteButton, "dialog should show a Delete button").toBeDefined();

        deleteButton.click();
        await (dialog as unknown as {updateComplete: Promise<unknown>}).updateComplete;

        const confirmButton = [...(dialog?.shadowRoot?.querySelectorAll(".confirm-delete button") ?? [])]
            .find(b => b.textContent?.trim() === "Delete") as HTMLButtonElement;
        expect(confirmButton, "confirm-delete step should render a second Delete button").toBeDefined();

        confirmButton.click();
        await flushAsync();

        expect(hass.serviceCalls).toContainEqual({
            domain: "todo",
            service: "remove_item",
            data: {entity_id: ENTITY_ID, item: "1"},
        });
    });
});

describe("todo-overlay-list row delete button", () => {
    it("a tree-delete-item event from a row removes that item and reloads", async () => {
        const {el, hass} = await renderList({
            entity_id: ENTITY_ID,
            items: [makeItem({id: "1", title: "Milk"}), makeItem({id: "2", title: "Bread"})],
        });

        const sentBefore = hass.connection.sent.length;

        const treeItem = deepQueryAll(el.shadowRoot!, "todo-overlay-tree-item")[0];
        treeItem.dispatchEvent(new CustomEvent("tree-delete-item", {
            detail: {id: "1"}, bubbles: true, composed: true,
        }));
        await flushAsync();

        expect(hass.serviceCalls).toContainEqual({
            domain: "todo",
            service: "remove_item",
            data: {entity_id: ENTITY_ID, item: "1"},
        });
        expect(hass.connection.sent.filter(m => m.type === "todo_overlay/get_list").length)
            .toBeGreaterThan(hass.connection.sent.slice(0, sentBefore)
                .filter(m => m.type === "todo_overlay/get_list").length);
    });
});
