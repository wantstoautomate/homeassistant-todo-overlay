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

// Native hass.states-based reloading only fires for changes that touch
// the native entity itself - a same-list reorder (and, separately, a
// tag/quantity change) is purely overlay metadata and never does (see
// manager_position.py's move_item). Without this subscription, another
// open card (a different browser/device/tab) would have no way to know
// any of that happened at all.
describe("todo-overlay-list live-sync via EVENT_ITEM_CHANGED", () => {
    it("reloads when a matching event arrives for this entity", async () => {
        const {el, hass} = await renderList({entity_id: ENTITY_ID, items: []});

        expect(hass.connection.sent.filter(m => m.type === "todo_overlay/get_list")).toHaveLength(1);

        hass.connection.fireEvent("todo_overlay_item_event", {entity_id: ENTITY_ID, action: "moved"});
        await settle(el);

        expect(hass.connection.sent.filter(m => m.type === "todo_overlay/get_list")).toHaveLength(2);
    });

    it("ignores an event for a different entity", async () => {
        const {el, hass} = await renderList({entity_id: ENTITY_ID, items: []});

        hass.connection.fireEvent("todo_overlay_item_event", {entity_id: "todo.other", action: "moved"});
        await settle(el);

        expect(hass.connection.sent.filter(m => m.type === "todo_overlay/get_list")).toHaveLength(1);
    });

    it("stops reloading once removed from the DOM", async () => {
        const {el, hass} = await renderList({entity_id: ENTITY_ID, items: []});

        document.body.removeChild(el);

        hass.connection.fireEvent("todo_overlay_item_event", {entity_id: ENTITY_ID, action: "moved"});
        await flushAsync();

        expect(hass.connection.sent.filter(m => m.type === "todo_overlay/get_list")).toHaveLength(1);
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
            {showQuickAdd: false, showFilterMenu: false, showSaveLoadButtons: false, showClearButton: false, showReorderToggle: false},
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

describe("todo-overlay-list header row (title level with the toolbar)", () => {
    it("renders the title and the toolbar as siblings inside one header row", async () => {
        const {el} = await renderList(
            {entity_id: ENTITY_ID, items: []},
            {headerTitle: "Groceries", showQuickAdd: true, showSaveLoadButtons: true},
        );

        const row = el.shadowRoot?.querySelector(".list-header-row");
        expect(row).not.toBeNull();

        const title = row?.querySelector(".list-title");
        expect(title?.textContent).toBe("Groceries");

        const toolbar = row?.querySelector(".toolbar");
        expect(toolbar).not.toBeNull();

        // The title sits in its own group (alongside the link badge, when
        // linked), and that group plus the toolbar are direct children of
        // the same row - genuinely on one line together rather than the
        // toolbar being nested under the title or living in some other
        // ancestor.
        const titleGroup = row?.querySelector(".list-title-group");
        expect(title?.parentElement).toBe(titleGroup);
        expect(titleGroup?.parentElement).toBe(row);
        expect(toolbar?.parentElement).toBe(row);
    });

    it("still shows the title-only row when every toolbar flag is off", async () => {
        const {el} = await renderList(
            {entity_id: ENTITY_ID, items: []},
            {
                headerTitle: "Groceries",
                showQuickAdd: false,
                showFilterMenu: false,
                showSaveLoadButtons: false,
                showClearButton: false,
                showReorderToggle: false,
            },
        );

        expect(el.shadowRoot?.querySelector(".list-title")?.textContent).toBe("Groceries");
        expect(el.shadowRoot?.querySelector(".toolbar")).toBeNull();
    });

    it("renders no header row at all when there's no title and no toolbar", async () => {
        const {el} = await renderList(
            {entity_id: ENTITY_ID, items: []},
            {
                headerTitle: undefined,
                showQuickAdd: false,
                showFilterMenu: false,
                showSaveLoadButtons: false,
                showClearButton: false,
                showReorderToggle: false,
            },
        );

        expect(el.shadowRoot?.querySelector(".list-header-row")).toBeNull();
    });

    it("shows a link badge next to the title when the list is linked", async () => {
        const {el} = await renderList(
            {entity_id: ENTITY_ID, items: [], link_id: "abc123"} as TodoList,
            {headerTitle: "Groceries"},
        );

        const titleGroup = el.shadowRoot?.querySelector(".list-title-group");
        expect(titleGroup?.querySelector(".link-badge")).not.toBeNull();
    });

    it("shows no link badge when the list is not linked", async () => {
        const {el} = await renderList(
            {entity_id: ENTITY_ID, items: [], link_id: null} as TodoList,
            {headerTitle: "Groceries"},
        );

        const titleGroup = el.shadowRoot?.querySelector(".list-title-group");
        expect(titleGroup?.querySelector(".link-badge")).toBeNull();
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

// Live-reported bug: drag-to-reorder didn't work at all on a real
// touchscreen (HA Companion App) - see todo-tree-item.test.ts's matching
// describe block for the engagement-moment half of the fix. This is the
// other half: nothing continued to suppress native scrolling for the
// rest of an already-engaged drag, so the page could still get yanked
// out from under an in-progress touch drag.
describe("todo-overlay-list onGlobalPointerMove vs. native scroll", () => {
    it("calls preventDefault on every move of an active touch drag", () => {
        const el = document.createElement("todo-overlay-list") as unknown as DraggableList;
        document.body.appendChild(el);

        el.draggedId = "1";
        el.onDragStart(new CustomEvent("tree-drag-start", {
            detail: {rect: undefined, pointerX: 0, pointerY: 0, grabOffsetX: 0, grabOffsetY: 0},
        }));

        const moveEvent = new PointerEvent("pointermove", {clientY: 20, pointerType: "touch"});
        const preventDefaultSpy = vi.spyOn(moveEvent, "preventDefault");

        el.onGlobalPointerMove(moveEvent);

        expect(preventDefaultSpy).toHaveBeenCalled();

        document.body.removeChild(el);
    });

    it("does not call preventDefault for a mouse drag", () => {
        const el = document.createElement("todo-overlay-list") as unknown as DraggableList;
        document.body.appendChild(el);

        el.draggedId = "1";
        el.onDragStart(new CustomEvent("tree-drag-start", {
            detail: {rect: undefined, pointerX: 0, pointerY: 0, grabOffsetX: 0, grabOffsetY: 0},
        }));

        const moveEvent = new PointerEvent("pointermove", {clientY: 20, pointerType: "mouse"});
        const preventDefaultSpy = vi.spyOn(moveEvent, "preventDefault");

        el.onGlobalPointerMove(moveEvent);

        expect(preventDefaultSpy).not.toHaveBeenCalled();

        document.body.removeChild(el);
    });
});

// Live-reported bug: on mobile, the moment an item was picked up, the
// highlight seemed to jump onto the NEXT row instead of staying on the
// dragged item - before any intentional movement at all. Root cause: the
// dragged row disappears (.lifted) and rows below it slide up to close
// the gap the instant a drag engages, so the very first hit-test right
// after engaging - still at essentially the pickup point - lands on
// whichever row just slid into the dragged item's old on-screen slot.
describe("todo-overlay-list hover dead zone right after drag engages", () => {
    it("does not set a hover target for movement still within the dead zone", async () => {
        const {el} = await renderList({
            entity_id: ENTITY_ID,
            items: [makeItem({id: "1", title: "Milk"}), makeItem({id: "2", title: "Bread"})],
        });

        const rows = deepQueryAll(el.shadowRoot!, "todo-overlay-tree-item") as (Element & {shadowRoot: ShadowRoot})[];
        mockRect(rows[0].shadowRoot.querySelector(".row")!, {top: 0, bottom: 40, height: 40});
        mockRect(rows[1].shadowRoot.querySelector(".row")!, {top: 40, bottom: 80, height: 40});

        const draggable = el as unknown as DraggableList & {hoverId?: string};

        draggable.draggedId = "1";
        draggable.onDragStart(new CustomEvent("tree-drag-start", {
            detail: {rect: undefined, pointerX: 20, pointerY: 20, grabOffsetX: 0, grabOffsetY: 0},
        }));

        // Row 1 just vanished (lifted) and row 2 slid up into its old
        // 0-40 slot - squarely inside it, but only 5px from the drag's
        // actual start position (20,20 -> 20,25).
        draggable.onGlobalPointerMove(new PointerEvent("pointermove", {clientX: 20, clientY: 25}));

        expect(draggable.hoverId).toBeUndefined();

        await draggable.onGlobalPointerUp();
    });

    it("resolves a hover target normally once past the dead zone", async () => {
        const {el, hass} = await renderList({
            entity_id: ENTITY_ID,
            items: [makeItem({id: "1", title: "Milk"}), makeItem({id: "2", title: "Bread"})],
        });

        const rows = deepQueryAll(el.shadowRoot!, "todo-overlay-tree-item") as (Element & {shadowRoot: ShadowRoot})[];
        mockRect(rows[0].shadowRoot.querySelector(".row")!, {top: 0, bottom: 40, height: 40});
        mockRect(rows[1].shadowRoot.querySelector(".row")!, {top: 40, bottom: 80, height: 40});

        const draggable = el as unknown as DraggableList;

        draggable.draggedId = "1";
        draggable.onDragStart(new CustomEvent("tree-drag-start", {
            detail: {rect: undefined, pointerX: 20, pointerY: 20, grabOffsetX: 0, grabOffsetY: 0},
        }));

        // Genuinely moved onto row 2 - well past the dead zone.
        draggable.onGlobalPointerMove(new PointerEvent("pointermove", {clientX: 20, clientY: 60}));
        await draggable.onGlobalPointerUp();

        expect(hass.connection.sent).toContainEqual(expect.objectContaining({
            type: "todo_overlay/move_item",
            child_id: "1",
        }));
    });
});

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

    // Live-reported bug: dragging an item into a completely empty list
    // (e.g. a fresh Shopping List with nothing on it yet) silently did
    // nothing - there was no existing row anywhere in that section for
    // the card's own hit-testing to land on, so it could never resolve
    // as a valid drop target at all.
    it("calls transferItem with no reference_id when dropped on an empty target list's own placeholder", async () => {
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
            items: [],
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
        const emptyZoneB = deepQueryAll(elB.shadowRoot!, "[data-empty-drop-zone]")[0] as HTMLElement;
        expect(emptyZoneB, "list B should render its empty-state placeholder").toBeDefined();

        mockRect(rowA.shadowRoot.querySelector(".row")!, {top: 0, bottom: 40, height: 40});
        mockRect(emptyZoneB, {top: 100, bottom: 140, height: 40});

        const draggableA = elA as unknown as DraggableList;

        draggableA.draggedId = "1";
        draggableA.onDragStart(new CustomEvent("tree-drag-start", {
            detail: {rect: undefined, pointerX: 0, pointerY: 0, grabOffsetX: 0, grabOffsetY: 0},
        }));

        draggableA.onGlobalPointerMove(new PointerEvent("pointermove", {clientY: 120}));
        await draggableA.onGlobalPointerUp();

        expect(hassA.connection.sent).toContainEqual(expect.objectContaining({
            type: "todo_overlay/transfer_item",
            source_entity_id: "todo.a",
            item_id: "1",
            target_entity_id: "todo.b",
            reference_id: undefined,
        }));
    });

    // Real-browser-caught bug: draggedId/hoverId/hoverEntityId are only
    // ever populated on the ONE instance a drag actually started from -
    // an empty list's own placeholder belongs to a DIFFERENT instance
    // (the entity being dragged FROM can't simultaneously be empty), so
    // without cross-instance broadcasting, that placeholder could never
    // find out it was the current hover target at all. The transfer
    // itself already worked regardless (previous test) - this is
    // specifically about the "Drop here" highlight actually appearing.
    it("highlights list B's own empty placeholder while list A's drag hovers it, and clears it after drop", async () => {
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
            items: [],
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
        const emptyZoneB = deepQueryAll(elB.shadowRoot!, "[data-empty-drop-zone]")[0] as HTMLElement;

        expect(emptyZoneB.classList.contains("drop-target")).toBe(false);
        expect(emptyZoneB.textContent?.trim()).toBe("No items");

        mockRect(rowA.shadowRoot.querySelector(".row")!, {top: 0, bottom: 40, height: 40});
        mockRect(emptyZoneB, {top: 100, bottom: 140, height: 40});

        const draggableA = elA as unknown as DraggableList;

        draggableA.draggedId = "1";
        draggableA.onDragStart(new CustomEvent("tree-drag-start", {
            detail: {rect: undefined, pointerX: 0, pointerY: 0, grabOffsetX: 0, grabOffsetY: 0},
        }));

        draggableA.onGlobalPointerMove(new PointerEvent("pointermove", {clientY: 120}));
        await elB.updateComplete;

        const emptyZoneBAfterHover = deepQueryAll(elB.shadowRoot!, "[data-empty-drop-zone]")[0] as HTMLElement;
        expect(emptyZoneBAfterHover.classList.contains("drop-target")).toBe(true);
        expect(emptyZoneBAfterHover.textContent?.trim()).toBe("Drop here");

        await draggableA.onGlobalPointerUp();
        await elB.updateComplete;

        // The drag has ended - the placeholder must not stay highlighted
        // forever (list B's own mocked hass never reloads its item list
        // here, so the placeholder itself is still present; what matters
        // is that it's no longer marked as the active drop target).
        const emptyZoneBAfterDrop = deepQueryAll(elB.shadowRoot!, "[data-empty-drop-zone]")[0] as HTMLElement;
        expect(emptyZoneBAfterDrop.classList.contains("drop-target")).toBe(false);
        expect(emptyZoneBAfterDrop.textContent?.trim()).toBe("No items");
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

// Dragging a parent item never hides its children (see todo-tree-item.ts -
// only the dragged row's own content collapses, its child <ul> keeps
// rendering exactly where it always did). Reproduced the reported "move a
// parent to the top level" crash: with the parent as the topmost item,
// pulling it further up leaves its own first child as the nearest rendered
// row - the backend then rejects reparenting it under its own child as a
// cycle, and (before the render() fix in the same change) that error used
// to blank out the whole list until a manual page refresh.
describe("todo-overlay-list dragging a parent never targets its own descendants", () => {
    it("skips a dragged parent's own child row when it's the nearest one, landing on the next real sibling instead", async () => {
        const {el, hass} = await renderList({
            entity_id: ENTITY_ID,
            items: [
                makeItem({
                    id: "parent", title: "Groceries",
                    children: [makeItem({id: "child", title: "Milk"})],
                }),
                makeItem({id: "other", title: "Chores"}),
            ],
        });

        const rows = deepQueryAll(el.shadowRoot!, "todo-overlay-tree-item") as (Element & {shadowRoot: ShadowRoot})[];
        // DOM order: parent, its child (nested), then the sibling.
        mockRect(rows[0].shadowRoot.querySelector(".row")!, {top: 0, bottom: 40, height: 40});
        mockRect(rows[1].shadowRoot.querySelector(".row")!, {top: 40, bottom: 80, height: 40});
        mockRect(rows[2].shadowRoot.querySelector(".row")!, {top: 80, bottom: 120, height: 40});

        const draggableA = el as unknown as DraggableList;

        draggableA.draggedId = "parent";
        draggableA.onDragStart(new CustomEvent("tree-drag-start", {
            detail: {rect: undefined, pointerX: 0, pointerY: 0, grabOffsetX: 0, grabOffsetY: 0},
        }));

        // Squarely inside the CHILD's rect (40-80) - before the fix, the
        // child row was still a live hit-test target and would have been
        // picked as the drop reference despite belonging to the item
        // being dragged.
        draggableA.onGlobalPointerMove(new PointerEvent("pointermove", {clientY: 45}));
        await draggableA.onGlobalPointerUp();

        expect(hass.connection.sent).toContainEqual(expect.objectContaining({
            type: "todo_overlay/move_item",
            child_id: "parent",
            reference_id: "other",
        }));
        expect(hass.connection.sent.some(m => (
            m.type === "todo_overlay/move_item" && (m as {reference_id?: string}).reference_id === "child"
        ))).toBe(false);

        // No crash, no error banner, nothing disappears.
        expect(el.shadowRoot?.querySelector(".error-banner")).toBeNull();
        expect(summaryTexts(el)).toEqual(["Groceries", "Milk", "Chores"]);
    });

    it("finds no drop target at all (and sends nothing) when a dragged parent has no siblings to fall back to", async () => {
        const {el, hass} = await renderList({
            entity_id: ENTITY_ID,
            items: [
                makeItem({
                    id: "parent", title: "Groceries",
                    children: [makeItem({id: "child", title: "Milk"})],
                }),
            ],
        });

        const rows = deepQueryAll(el.shadowRoot!, "todo-overlay-tree-item") as (Element & {shadowRoot: ShadowRoot})[];
        mockRect(rows[0].shadowRoot.querySelector(".row")!, {top: 0, bottom: 10, height: 10});
        mockRect(rows[1].shadowRoot.querySelector(".row")!, {top: 10, bottom: 50, height: 40});

        const draggableA = el as unknown as DraggableList;

        draggableA.draggedId = "parent";
        draggableA.onDragStart(new CustomEvent("tree-drag-start", {
            detail: {rect: undefined, pointerX: 0, pointerY: 0, grabOffsetX: 0, grabOffsetY: 0},
        }));

        draggableA.onGlobalPointerMove(new PointerEvent("pointermove", {clientY: 20}));
        await draggableA.onGlobalPointerUp();

        expect(hass.connection.sent.some(m => m.type === "todo_overlay/move_item")).toBe(false);
        expect(el.shadowRoot?.querySelector(".error-banner")).toBeNull();
        expect(summaryTexts(el)).toEqual(["Groceries", "Milk"]);
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

    it("shows the same friendly message (not the raw exception) when an action fails, "
        + "WITHOUT hiding the already-loaded list", async () => {
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

        const errorText = el.shadowRoot?.querySelector(".error-banner span")?.textContent?.trim();
        expect(errorText).toBe("Something went wrong. Check the browser console for details.");
        expect(errorText).not.toContain("ValueError");

        // A failed action used to make the ENTIRE render() branch on
        // this.error and hide the list until a browser refresh - the
        // whole point of the banner is that the items the user already
        // sees never disappear just because one action didn't go through.
        expect(summaryTexts(el)).toEqual(["Milk"]);

        consoleError.mockRestore();
    });

    it("dismisses the error banner without touching the list when its close button is clicked", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

        const {el, hass} = await renderList({
            entity_id: ENTITY_ID,
            items: [makeItem({id: "1", title: "Milk"})],
        });

        hass.connection.errors["todo_overlay/set_completed"] = new Error("boom");

        const treeItem = deepQueryAll(el.shadowRoot!, "todo-overlay-tree-item")[0];
        treeItem.dispatchEvent(new CustomEvent("tree-pointer-down", {
            detail: {id: "1"}, bubbles: true, composed: true,
        }));
        treeItem.dispatchEvent(new CustomEvent("tree-pointer-up", {
            detail: {id: "1", pressDurationMs: 100, moved: false}, bubbles: true, composed: true,
        }));
        await flushAsync();
        await el.updateComplete;

        expect(el.shadowRoot?.querySelector(".error-banner")).not.toBeNull();

        (el.shadowRoot?.querySelector(".error-banner button") as HTMLElement).click();
        await el.updateComplete;

        expect(el.shadowRoot?.querySelector(".error-banner")).toBeNull();
        expect(summaryTexts(el)).toEqual(["Milk"]);

        consoleError.mockRestore();
    });

    it("auto-dismisses the error banner after a timeout, same as the undo snackbar", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

        const {el, hass} = await renderList({
            entity_id: ENTITY_ID,
            items: [makeItem({id: "1", title: "Milk"})],
        });

        hass.connection.errors["todo_overlay/set_completed"] = new Error("boom");

        // shouldAdvanceTime keeps flushAsync's own setTimeout(0) resolving
        // in real time (nothing else here reaches for fake timers), while
        // still letting the assertion below fast-forward the 8s dismiss
        // delay instead of actually waiting for it.
        vi.useFakeTimers({shouldAdvanceTime: true});

        try {
            const treeItem = deepQueryAll(el.shadowRoot!, "todo-overlay-tree-item")[0];
            treeItem.dispatchEvent(new CustomEvent("tree-pointer-down", {
                detail: {id: "1"}, bubbles: true, composed: true,
            }));
            treeItem.dispatchEvent(new CustomEvent("tree-pointer-up", {
                detail: {id: "1", pressDurationMs: 100, moved: false}, bubbles: true, composed: true,
            }));
            await flushAsync();
            await el.updateComplete;

            expect(el.shadowRoot?.querySelector(".error-banner")).not.toBeNull();

            await vi.advanceTimersByTimeAsync(10_000);
            await el.updateComplete;

            expect(el.shadowRoot?.querySelector(".error-banner")).toBeNull();
        } finally {
            vi.useRealTimers();
            consoleError.mockRestore();
        }
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
