import {afterEach, describe, expect, it, vi} from "vitest";

import "../src/components/todo-overlay-list";
import type {TodoOverlayList} from "../src/components/todo-overlay-list";
import {LONG_PRESS_MS, type TodoItem, type TodoList} from "../src/models";
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
        pin_type: null,
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

    it("submitting quick add calls todo_overlay/create_item (not the native todo.add_item service) and reloads the list", async () => {
        // Live-diagnosed bug: this used to call the native todo.add_item
        // service directly, which never fires EVENT_ITEM_CHANGED (only
        // TodoManager.create_item does) - an item added via quick-add
        // could never sync to a linked list, with no error anywhere.
        const {el, hass} = await renderList({entity_id: ENTITY_ID, items: []}, {showQuickAdd: true});
        hass.connection.responses["todo_overlay/create_item"] = {id: "new-id"};

        (el.shadowRoot?.querySelector("button[aria-label='Add item']") as HTMLElement).click();
        await el.updateComplete;

        const input = el.shadowRoot?.querySelector(".quick-add-row input") as HTMLInputElement;
        input.value = "New item";
        input.dispatchEvent(new Event("input"));
        await el.updateComplete;

        const sentBefore = hass.connection.sent.length;
        (el.shadowRoot?.querySelector(".quick-add-row button") as HTMLElement).click();
        await flushAsync();

        expect(hass.connection.sent).toContainEqual(expect.objectContaining({
            type: "todo_overlay/create_item",
            entity_id: ENTITY_ID,
            title: "New item",
        }));
        expect(hass.serviceCalls).not.toContainEqual(expect.objectContaining({domain: "todo", service: "add_item"}));
        // Reloads afterwards - at least one more get_list call than before submitting.
        expect(hass.connection.sent.filter(m => m.type === "todo_overlay/get_list").length)
            .toBeGreaterThan(hass.connection.sent.slice(0, sentBefore)
                .filter(m => m.type === "todo_overlay/get_list").length);
    });
});

// Feature: only root-level items could be quick-added before - every
// parent row now gets its own "+" (see todo-tree-item.ts) to add a
// child directly under it, positioned right below the parent's own row
// and above its existing children.
describe("todo-overlay-list per-parent quick add", () => {
    function childQuickAddToggle(el: TodoOverlayList, parentId: string): HTMLElement {
        const row = deepQueryAll(el.shadowRoot!, "todo-overlay-tree-item")
            .find(r => (r as unknown as {item?: {id: string}}).item?.id === parentId) as Element & {shadowRoot: ShadowRoot};

        return row.shadowRoot.querySelector(".child-quick-add-toggle") as HTMLElement;
    }

    function findRow(el: TodoOverlayList, id: string): Element & {shadowRoot: ShadowRoot} {
        return deepQueryAll(el.shadowRoot!, "todo-overlay-tree-item")
            .find(r => (r as unknown as {item?: {id: string}}).item?.id === id) as Element & {shadowRoot: ShadowRoot};
    }

    // Add-mode - the per-row "+" toggle only exists once this is active
    // (see todo-overlay-list.ts's own addModeActive) - entered the same
    // way a real user would, via the toolbar's own "+".
    async function enterAddMode(el: TodoOverlayList): Promise<void> {
        (el.shadowRoot?.querySelector("button[aria-label='Add item']") as HTMLElement).click();
        await settle(el);
    }

    it("opens that parent's own inline field when its plus icon is clicked, leaving others untouched", async () => {
        const {el} = await renderList({
            entity_id: ENTITY_ID,
            items: [
                makeItem({id: "parent", title: "Home Assistant", children: [makeItem({id: "child", title: "Firewall"})]}),
                makeItem({id: "other", title: "Groceries"}),
            ],
        });
        await enterAddMode(el);

        childQuickAddToggle(el, "parent").click();
        await settle(el);

        expect(findRow(el, "parent").shadowRoot.querySelector(".child-quick-add-row")).not.toBeNull();
        expect(findRow(el, "other").shadowRoot.querySelector(".child-quick-add-row")).toBeNull();
    });

    it("shows the add-child toggle on a LEAF item too, once add-mode is active - not just existing parents", async () => {
        // Live-reported: an earlier version only ever showed a per-row
        // "+" on items that ALREADY had children - nothing that wasn't
        // already a parent had any way to become one.
        const {el} = await renderList({
            entity_id: ENTITY_ID,
            items: [makeItem({id: "leaf", title: "Groceries"})],
        });
        await enterAddMode(el);

        expect(childQuickAddToggle(el, "leaf")).not.toBeNull();
    });

    it("adding under a parent whose only existing child is 'Firewall' positions the new item before it", async () => {
        const {el, hass} = await renderList({
            entity_id: ENTITY_ID,
            items: [makeItem({id: "parent", title: "Home Assistant", children: [makeItem({id: "child", title: "Firewall"})]})],
        });
        await enterAddMode(el);

        childQuickAddToggle(el, "parent").click();
        await settle(el);

        const input = findRow(el, "parent").shadowRoot.querySelector(".child-quick-add-row input") as HTMLInputElement;
        input.value = "VPN";
        input.dispatchEvent(new Event("input"));

        const addButton = [...findRow(el, "parent").shadowRoot.querySelectorAll(".child-quick-add-row button")]
            .find(b => b.textContent?.trim() === "Add") as HTMLButtonElement;
        addButton.click();
        await flushAsync();

        // Directly below the parent's own row, above its EXISTING
        // children - "before" the current first child, not "inside" the
        // parent (which would append past it instead).
        expect(hass.connection.sent).toContainEqual(expect.objectContaining({
            type: "todo_overlay/create_item",
            title: "VPN",
            reference_id: "child",
            placement: "before",
        }));
    });

    it("adding a first child under a LEAF item positions it 'inside' that item directly", async () => {
        const {el, hass} = await renderList({
            entity_id: ENTITY_ID,
            items: [makeItem({id: "leaf", title: "Groceries"})],
        });
        await enterAddMode(el);

        childQuickAddToggle(el, "leaf").click();
        await settle(el);

        const input = findRow(el, "leaf").shadowRoot.querySelector(".child-quick-add-row input") as HTMLInputElement;
        input.value = "Milk";
        input.dispatchEvent(new Event("input"));
        input.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true, composed: true}));
        await flushAsync();

        expect(hass.connection.sent).toContainEqual(expect.objectContaining({
            type: "todo_overlay/create_item",
            title: "Milk",
            reference_id: "leaf",
            placement: "inside",
        }));
    });

    it("auto-expands a collapsed parent when its quick-add field is opened", async () => {
        const {el} = await renderList({
            entity_id: ENTITY_ID,
            items: [makeItem({id: "parent", title: "Home Assistant", children: [makeItem({id: "child", title: "Firewall"})]})],
        });

        (el as unknown as {collapsedIds: Set<string>}).collapsedIds = new Set(["parent"]);
        await settle(el);
        expect(summaryTexts(el)).toEqual(["Home Assistant"]);

        await enterAddMode(el);
        childQuickAddToggle(el, "parent").click();
        await settle(el);

        expect(summaryTexts(el)).toEqual(["Home Assistant", "Firewall"]);
    });

    it("closing the root quick add (add-mode) also closes every open per-parent field", async () => {
        const {el} = await renderList({
            entity_id: ENTITY_ID,
            items: [makeItem({id: "parent", title: "Home Assistant", children: [makeItem({id: "child", title: "Firewall"})]})],
        });
        await enterAddMode(el);

        childQuickAddToggle(el, "parent").click();
        await settle(el);
        expect(findRow(el, "parent").shadowRoot.querySelector(".child-quick-add-row")).not.toBeNull();

        // Close add-mode itself - the "close everything" action.
        await enterAddMode(el); // toggling again closes it

        expect(findRow(el, "parent").shadowRoot.querySelector(".child-quick-add-row")).toBeNull();
        expect(findRow(el, "parent").shadowRoot.querySelector(".child-quick-add-toggle")).toBeNull();
    });

    it("clicking a parent's own toggle again closes just that one field", async () => {
        const {el} = await renderList({
            entity_id: ENTITY_ID,
            items: [makeItem({id: "parent", title: "Home Assistant", children: [makeItem({id: "child", title: "Firewall"})]})],
        });
        await enterAddMode(el);

        childQuickAddToggle(el, "parent").click();
        await settle(el);
        expect(childQuickAddToggle(el, "parent").classList.contains("active")).toBe(true);

        childQuickAddToggle(el, "parent").click();
        await settle(el);

        expect(findRow(el, "parent").shadowRoot.querySelector(".child-quick-add-row")).toBeNull();
    });

    it("add-mode, delete-mode, and reorder-mode are mutually exclusive", async () => {
        const {el} = await renderList(
            {entity_id: ENTITY_ID, items: [makeItem({id: "1", title: "Milk", completed: false})]},
            {showReorderToggle: true},
        );

        await enterAddMode(el);
        expect((el as unknown as {addModeActive: boolean}).addModeActive).toBe(true);

        (el.shadowRoot?.querySelector("button[aria-label='Reorder items']") as HTMLElement).click();
        await settle(el);

        expect((el as unknown as {addModeActive: boolean}).addModeActive).toBe(false);
        expect((el as unknown as {reorderModeActive: boolean}).reorderModeActive).toBe(true);
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

// Live-reported: because touch can only ever start a drag from the
// reorder-mode handle (at the row's far-right edge), a natural thumb
// drag curving even slightly left dragged the ghost along with it -
// findDropTarget only ever reads the vertical coordinate, so that
// horizontal movement had zero effect on WHERE anything would drop,
// only on how the ghost itself (mis)behaved on screen.
describe("todo-overlay-list reorder-mode ghost - vertical-only movement", () => {
    it("freezes the ghost's horizontal position for a reorder-mode (touch) drag - only vertical movement moves it", async () => {
        const {el} = await renderList({
            entity_id: ENTITY_ID,
            items: [makeItem({id: "1", title: "Milk"}), makeItem({id: "2", title: "Bread"})],
        });

        const draggable = el as unknown as DraggableList & {reorderModeActive: boolean};
        draggable.reorderModeActive = true;
        draggable.draggedId = "1";
        draggable.onDragStart(new CustomEvent("tree-drag-start", {
            detail: {rect: undefined, pointerX: 300, pointerY: 50, grabOffsetX: 0, grabOffsetY: 0, pointerType: "touch"},
        }));

        draggable.onGlobalPointerMove(new PointerEvent("pointermove", {clientX: 20, clientY: 90, pointerType: "touch"}));
        await el.updateComplete;

        const ghost = el.shadowRoot?.querySelector(".drag-ghost") as HTMLElement;
        // clientX drifted from 300 down to 20 - the ghost's left must
        // still reflect the ORIGINAL 300, not the drifted 20.
        expect(ghost.style.left).toBe("300px");
        expect(ghost.style.top).toBe("90px");

        await draggable.onGlobalPointerUp();
    });

    it("still tracks full 2D pointer movement for a mouse drag (never reorder-mode)", async () => {
        const {el} = await renderList({
            entity_id: ENTITY_ID,
            items: [makeItem({id: "1", title: "Milk"}), makeItem({id: "2", title: "Bread"})],
        });

        const draggable = el as unknown as DraggableList;
        draggable.draggedId = "1";
        draggable.onDragStart(new CustomEvent("tree-drag-start", {
            detail: {rect: undefined, pointerX: 300, pointerY: 50, grabOffsetX: 0, grabOffsetY: 0, pointerType: "mouse"},
        }));

        draggable.onGlobalPointerMove(new PointerEvent("pointermove", {clientX: 20, clientY: 90, pointerType: "mouse"}));
        await el.updateComplete;

        const ghost = el.shadowRoot?.querySelector(".drag-ghost") as HTMLElement;
        expect(ghost.style.left).toBe("20px");
        expect(ghost.style.top).toBe("90px");

        await draggable.onGlobalPointerUp();
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

// Live-reported bug: "there's an orange highlight when about to drag
// something to a parent... sometimes items can be dragged over this
// and the box won't necessarily show but the item is created as a
// child anyway." Root cause: resolvePlacement decided whether hovering
// a row's body meant "become its first child" using the row's raw DATA
// children (item.children), not what's actually rendered - so hovering
// a COLLAPSED parent's own row (its <ul> of child rows removed from the
// DOM entirely - see todo-tree-item.ts's render()) silently retargeted
// to "before its (invisible) first child", a row nothing on screen ever
// matches, so no highlight could ever appear - yet the drop still went
// through and the item became a child of that collapsed parent.
describe("todo-overlay-list dragging onto a collapsed parent", () => {
    it("targets the collapsed parent itself (a real, visible 'inside' zone), not its invisible first child", async () => {
        const {el, hass} = await renderList({
            entity_id: ENTITY_ID,
            items: [
                makeItem({id: "1", title: "Parent", children: [makeItem({id: "1a", title: "Child"})]}),
                makeItem({id: "2", title: "Other"}),
            ],
        });

        (el as unknown as {collapsedIds: Set<string>}).collapsedIds = new Set(["1"]);
        await settle(el);

        // Only two rows are actually rendered - the collapsed parent and
        // the sibling - "1a" has no row in the DOM at all right now.
        const rows = deepQueryAll(el.shadowRoot!, "todo-overlay-tree-item") as (Element & {shadowRoot: ShadowRoot})[];
        expect(rows).toHaveLength(2);
        mockRect(rows[0].shadowRoot.querySelector(".row")!, {top: 0, bottom: 40, height: 40});
        mockRect(rows[1].shadowRoot.querySelector(".row")!, {top: 40, bottom: 80, height: 40});

        const draggable = el as unknown as DraggableList & {hoverId?: string; hoverPlacement?: string};

        draggable.draggedId = "2";
        draggable.onDragStart(new CustomEvent("tree-drag-start", {
            detail: {rect: undefined, pointerX: 20, pointerY: 60, grabOffsetX: 0, grabOffsetY: 0},
        }));

        // Squarely in the middle 40% of the collapsed parent's own row -
        // clientX held equal to the drag's own start X so horizontal
        // drag-to-nest (see applyHorizontalNesting) has nothing to adjust
        // here; that's covered by its own dedicated tests below.
        draggable.onGlobalPointerMove(new PointerEvent("pointermove", {clientX: 20, clientY: 20}));

        expect(draggable.hoverId).toBe("1");
        expect(draggable.hoverPlacement).toBe("inside");
        await settle(el);

        // The visible highlight (drop-inside) lands on the parent's own
        // row - the one actually under the pointer.
        expect(rows[0].shadowRoot.querySelector(".row")?.classList.contains("drop-inside")).toBe(true);

        await draggable.onGlobalPointerUp();

        expect(hass.connection.sent).toContainEqual(expect.objectContaining({
            type: "todo_overlay/move_item",
            child_id: "2",
            reference_id: "1",
            placement: "inside",
        }));
    });
});

// The synthetic Other row (see grouping.ts) has no real item behind it at
// all, so it must never be offered as a drop target itself - collectAllRows
// skips its own row entry while still collecting its real children
// completely normally (see collectAllRows' own comment).
describe("todo-overlay-list drag hit-testing skips the synthetic Other row", () => {
    it("never resolves Other's own header as a target - the nearest REAL row wins instead", async () => {
        const {el, hass} = await renderList({
            entity_id: ENTITY_ID,
            items: [
                makeItem({id: "brodie", title: "Brodie", pin_type: "person"}),
                makeItem({id: "anna", title: "Anna", pin_type: "person"}),
                makeItem({id: "bins", title: "Take out bins"}),
            ],
        });

        const rows = deepQueryAll(el.shadowRoot!, "todo-overlay-tree-item") as (Element & {
            shadowRoot: ShadowRoot;
            item: {id: string};
        })[];

        const annaRow = rows.find(r => r.item.id === "anna")!;
        const otherRow = rows.find(r => r.item.id.startsWith("__other__"))!;
        const binsRow = rows.find(r => r.item.id === "bins")!;
        expect(otherRow, "Other should actually be swept together here for this test to mean anything").toBeDefined();
        expect(binsRow, "Other's own real child should still be in the DOM, just nested under it").toBeDefined();

        mockRect(rows.find(r => r.item.id === "brodie")!.shadowRoot.querySelector(".row")!, {top: 0, bottom: 40, height: 40});
        mockRect(annaRow.shadowRoot.querySelector(".row")!, {top: 40, bottom: 80, height: 40});
        // Other's own header sits right here visually - mocked purely so
        // a bug that DIDN'T exclude it would have something to wrongly
        // land on; the real hit-testing has nothing of its own here at
        // all once excluded.
        mockRect(otherRow.shadowRoot.querySelector(".row")!, {top: 80, bottom: 120, height: 40});
        mockRect(binsRow.shadowRoot.querySelector(".row")!, {top: 120, bottom: 160, height: 40});

        const draggable = el as unknown as DraggableList & {hoverId?: string};

        draggable.draggedId = "brodie";
        draggable.onDragStart(new CustomEvent("tree-drag-start", {
            detail: {rect: undefined, pointerX: 20, pointerY: 20, grabOffsetX: 0, grabOffsetY: 0},
        }));

        // Well inside Other's own (mocked) header rect, close to its
        // bottom edge - clearly nearer to bins (its real child, sitting
        // right below it) than to anna, so there's no ambiguity about
        // which real row "nearest" should resolve to once Other itself
        // is out of the running.
        draggable.onGlobalPointerMove(new PointerEvent("pointermove", {clientX: 20, clientY: 115}));

        expect(draggable.hoverId).toBe("bins");
        await settle(el);

        // Never a highlight on Other's own row - it isn't a valid target
        // to highlight in the first place.
        expect(otherRow.shadowRoot.querySelector(".row")?.classList.contains("drop-inside")).toBe(false);

        await draggable.onGlobalPointerUp();

        expect(hass.connection.sent).toContainEqual(expect.objectContaining({
            type: "todo_overlay/move_item",
            child_id: "brodie",
            reference_id: "bins",
        }));
        expect(
            hass.connection.sent.some(m => typeof m.reference_id === "string" && m.reference_id.startsWith("__other__")),
        ).toBe(false);
    });
});

// Live-reported: dragging a child that's directly below its own parent
// - i.e. the parent's own first VISIBLE child - up toward roughly its
// original position glitched a lot, and hovering the parent's own row
// showed no orange box at all (harmless in itself, since dropping a
// child back onto its own parent is a no-op, but the glitchiness
// between there and the position just below it was not). Root cause:
// snapshotRows() excludes the dragged item as a standalone ROW, but
// never scrubbed it from other rows' own `children` field - so a
// parent whose dragged item is its first visible child kept "offering"
// that item as resolvePlacement's before-target, which then gets
// invalidated right back out (hit.id === draggedId), leaving no
// fallback target at all right in that ambiguous zone.
describe("todo-overlay-list dragging a child that's its own parent's first visible sibling", () => {
    it("still resolves a valid 'inside' target on the parent when the dragged child was its only one", async () => {
        const {el, hass} = await renderList({
            entity_id: ENTITY_ID,
            items: [
                makeItem({id: "parent", title: "Parent", children: [makeItem({id: "child", title: "Child"})]}),
            ],
        });

        const rows = deepQueryAll(el.shadowRoot!, "todo-overlay-tree-item") as (Element & {shadowRoot: ShadowRoot})[];
        mockRect(rows[0].shadowRoot.querySelector(".row")!, {top: 0, bottom: 40, height: 40});

        const draggable = el as unknown as DraggableList & {hoverId?: string; hoverPlacement?: string};

        draggable.draggedId = "child";
        draggable.onDragStart(new CustomEvent("tree-drag-start", {
            detail: {rect: undefined, pointerX: 20, pointerY: 100, grabOffsetX: 0, grabOffsetY: 0},
        }));

        // Middle of the parent's row - with "child" correctly scrubbed
        // from the parent's own children list, this resolves the same
        // way it would for any genuinely childless row: "inside parent".
        draggable.onGlobalPointerMove(new PointerEvent("pointermove", {clientX: 20, clientY: 20}));

        expect(draggable.hoverId).toBe("parent");
        expect(draggable.hoverPlacement).toBe("inside");

        await draggable.onGlobalPointerUp();

        expect(hass.connection.sent).toContainEqual(expect.objectContaining({
            type: "todo_overlay/move_item",
            child_id: "child",
            reference_id: "parent",
            placement: "inside",
        }));
    });

    it("targets the next real sibling, not the dragged child, when the parent has more than one", async () => {
        const {el, hass} = await renderList({
            entity_id: ENTITY_ID,
            items: [
                makeItem({
                    id: "parent", title: "Parent",
                    children: [makeItem({id: "dragged-child", title: "First"}), makeItem({id: "other-child", title: "Second"})],
                }),
            ],
        });

        const rows = deepQueryAll(el.shadowRoot!, "todo-overlay-tree-item") as (Element & {shadowRoot: ShadowRoot})[];
        mockRect(rows[0].shadowRoot.querySelector(".row")!, {top: 0, bottom: 40, height: 40});

        const draggable = el as unknown as DraggableList & {hoverId?: string; hoverPlacement?: string};

        draggable.draggedId = "dragged-child";
        draggable.onDragStart(new CustomEvent("tree-drag-start", {
            detail: {rect: undefined, pointerX: 20, pointerY: 100, grabOffsetX: 0, grabOffsetY: 0},
        }));

        // Bottom 70% of the parent's row - with "dragged-child" scrubbed
        // from the parent's children list, "other-child" is correctly
        // offered as the real first (surviving) child instead.
        draggable.onGlobalPointerMove(new PointerEvent("pointermove", {clientX: 20, clientY: 30}));

        expect(draggable.hoverId).toBe("other-child");
        expect(draggable.hoverPlacement).toBe("before");
    });
});

// Reported: horizontal drag-to-nest (an earlier iteration on the
// reorder-intuitiveness feedback) was cumbersome in practice - removed.
// Becoming a child is back to "drag the item onto the parent's own
// row" the way it always worked; the visual distinction is what
// changed - see the two describe blocks below.
describe("todo-overlay-list drop visuals: reorder vs. become-a-child", () => {
    it("reordering (before/after) shows a shadow box in the gap the list opens, not a bounding box", async () => {
        const {el} = await renderList({
            entity_id: ENTITY_ID,
            items: [makeItem({id: "1", title: "First"}), makeItem({id: "2", title: "Second"})],
        });

        const rows = deepQueryAll(el.shadowRoot!, "todo-overlay-tree-item") as (Element & {shadowRoot: ShadowRoot})[];
        mockRect(rows[0].shadowRoot.querySelector(".row")!, {top: 0, bottom: 40, height: 40});
        mockRect(rows[1].shadowRoot.querySelector(".row")!, {top: 40, bottom: 80, height: 40});

        const draggable = el as unknown as DraggableList;

        draggable.draggedId = "2";
        draggable.onDragStart(new CustomEvent("tree-drag-start", {
            detail: {rect: undefined, pointerX: 20, pointerY: 100, grabOffsetX: 0, grabOffsetY: 0},
        }));

        // Top 30% of row "1" - "before 1".
        draggable.onGlobalPointerMove(new PointerEvent("pointermove", {clientY: 5}));
        await settle(el);

        const row = rows[0].shadowRoot.querySelector(".row")!;
        expect(row.classList.contains("gap-before"), "the list should reflow (margin push) around the drop point").toBe(true);
        expect(row.classList.contains("drop-inside")).toBe(false);

        const shadowBox = rows[0].shadowRoot.querySelector(".drop-shadow-box") as HTMLElement;
        expect(shadowBox, "row 1 should show the shadow box").not.toBeNull();
        expect(shadowBox.classList.contains("above")).toBe(true);
    });

    it("becoming a child ('inside') draws a bounding box around the parent's own row, with no shadow box and no reflow", async () => {
        const {el} = await renderList({
            entity_id: ENTITY_ID,
            items: [makeItem({id: "1", title: "First"}), makeItem({id: "2", title: "Second"})],
        });

        const rows = deepQueryAll(el.shadowRoot!, "todo-overlay-tree-item") as (Element & {shadowRoot: ShadowRoot})[];
        mockRect(rows[0].shadowRoot.querySelector(".row")!, {top: 0, bottom: 40, height: 40});
        mockRect(rows[1].shadowRoot.querySelector(".row")!, {top: 40, bottom: 80, height: 40});

        const draggable = el as unknown as DraggableList & {hoverId?: string; hoverPlacement?: string};

        draggable.draggedId = "2";
        draggable.onDragStart(new CustomEvent("tree-drag-start", {
            detail: {rect: undefined, pointerX: 20, pointerY: 100, grabOffsetX: 0, grabOffsetY: 0},
        }));

        // Squarely in the middle 40% of row "1" - "inside 1".
        draggable.onGlobalPointerMove(new PointerEvent("pointermove", {clientY: 20}));
        expect(draggable.hoverId).toBe("1");
        expect(draggable.hoverPlacement).toBe("inside");
        await settle(el);

        const row = rows[0].shadowRoot.querySelector(".row")!;
        expect(row.classList.contains("drop-inside"), "the parent row itself should be outlined").toBe(true);
        expect(row.classList.contains("gap-before")).toBe(false);
        expect(row.classList.contains("gap-after")).toBe(false);

        expect(rows[0].shadowRoot.querySelector(".drop-shadow-box")).toBeNull();
    });
});

// Reported alongside the intuitiveness feedback above: a boundary
// sitting right under a slightly jittery finger could flip the target
// back and forth. The currently-resolved zone is now "sticky" - it
// takes a bit more movement to LEAVE a zone than it took to enter it.
describe("todo-overlay-list zone hysteresis", () => {
    it("keeps the 'inside' target once resolved, even after crossing back over the default 30% boundary", async () => {
        const {el} = await renderList({
            entity_id: ENTITY_ID,
            items: [makeItem({id: "1", title: "Only"}), makeItem({id: "2", title: "Other"})],
        });

        const rows = deepQueryAll(el.shadowRoot!, "todo-overlay-tree-item") as (Element & {shadowRoot: ShadowRoot})[];
        mockRect(rows[0].shadowRoot.querySelector(".row")!, {top: 0, bottom: 40, height: 40});
        mockRect(rows[1].shadowRoot.querySelector(".row")!, {top: 40, bottom: 80, height: 40});

        const draggable = el as unknown as DraggableList & {hoverId?: string; hoverPlacement?: string};

        draggable.draggedId = "2";
        draggable.onDragStart(new CustomEvent("tree-drag-start", {
            detail: {rect: undefined, pointerX: 20, pointerY: 60, grabOffsetX: 0, grabOffsetY: 0},
        }));

        // relativeY = 0.5 - squarely "inside".
        draggable.onGlobalPointerMove(new PointerEvent("pointermove", {clientX: 20, clientY: 20}));
        expect(draggable.hoverPlacement).toBe("inside");

        // relativeY = 0.32 - past the UN-hysteresised 0.3 boundary, but
        // within the widened sticky one (0.25) - stays "inside".
        draggable.onGlobalPointerMove(new PointerEvent("pointermove", {clientX: 20, clientY: 12.8}));
        expect(draggable.hoverPlacement).toBe("inside");

        // relativeY = 0.20 - now past even the widened boundary.
        draggable.onGlobalPointerMove(new PointerEvent("pointermove", {clientX: 20, clientY: 8}));
        expect(draggable.hoverPlacement).toBe("before");
    });
});

// Live-reported: "the orange hitbox should be the same as the grey hit
// box [the browser's own :hover] - the orange hitbox seems fractionally
// high", and separately: moving only slightly further into what still
// looked like the same drop-shadow-box could flip the target again.
// Root cause: rowSnapshot is a deliberately frozen snapshot (see
// findDropTarget's own comment on why), but a reorder's gap-before/
// gap-after opens a REAL CSS margin that reflows every row at or after
// the target - so the frozen rect for any such row silently goes stale
// (reports a position higher than where it actually now sits) for the
// rest of the drag. applyGapCorrection corrects for this analytically -
// instantly, with no re-measurement or timing dependency at all - since
// the gap's exact size (DROP_GAP_PX) and which row has it open (the
// previous frame's own resolved target) are both already known.
describe("todo-overlay-list gap correction keeps hit-testing in sync with the open gap", () => {
    it("resolves correctly against a row's post-gap position without any re-measurement or delay", async () => {
        const {el} = await renderList({
            entity_id: ENTITY_ID,
            items: [makeItem({id: "1", title: "Only"}), makeItem({id: "2", title: "Dragged"})],
        });

        const rows = deepQueryAll(el.shadowRoot!, "todo-overlay-tree-item") as (Element & {shadowRoot: ShadowRoot})[];
        mockRect(rows[0].shadowRoot.querySelector(".row")!, {top: 0, bottom: 40, height: 40});

        const draggable = el as unknown as DraggableList & {hoverId?: string; hoverPlacement?: string};

        draggable.draggedId = "2";
        draggable.onDragStart(new CustomEvent("tree-drag-start", {
            detail: {rect: undefined, pointerX: 20, pointerY: 100, grabOffsetX: 0, grabOffsetY: 0},
        }));

        // Top zone of row "1"'s ORIGINAL position (0-40) - "before 1",
        // opening a gap-before on it. No correction needed yet - this is
        // the very first resolution, nothing was open before it.
        draggable.onGlobalPointerMove(new PointerEvent("pointermove", {clientX: 20, clientY: 5}));
        expect(draggable.hoverId).toBe("1");
        expect(draggable.hoverPlacement).toBe("before");

        // Row "1"'s mocked rect is deliberately left untouched at 0-40 -
        // the point of this test is that the correction is computed
        // (shifting it to an effective 52-92 for hit-testing purposes),
        // not re-measured from a DOM that, in this test, never actually
        // moves. y=72 is squarely "inside" that corrected 52-92 range.
        draggable.onGlobalPointerMove(new PointerEvent("pointermove", {clientX: 20, clientY: 72}));
        expect(draggable.hoverId).toBe("1");
        expect(draggable.hoverPlacement).toBe("inside");
    });

    it("does not apply any correction for 'inside', which opens no gap at all", async () => {
        const {el} = await renderList({
            entity_id: ENTITY_ID,
            items: [
                makeItem({id: "1", title: "First"}),
                makeItem({id: "2", title: "Second"}),
                makeItem({id: "3", title: "Dragged"}),
            ],
        });

        const rows = deepQueryAll(el.shadowRoot!, "todo-overlay-tree-item") as (Element & {shadowRoot: ShadowRoot})[];
        mockRect(rows[0].shadowRoot.querySelector(".row")!, {top: 0, bottom: 40, height: 40});
        mockRect(rows[1].shadowRoot.querySelector(".row")!, {top: 40, bottom: 80, height: 40});

        const draggable = el as unknown as DraggableList & {hoverId?: string; hoverPlacement?: string};

        draggable.draggedId = "3";
        draggable.onDragStart(new CustomEvent("tree-drag-start", {
            detail: {rect: undefined, pointerX: 20, pointerY: 200, grabOffsetX: 0, grabOffsetY: 0},
        }));

        // Middle of row "1" - "inside 1", which opens no gap.
        draggable.onGlobalPointerMove(new PointerEvent("pointermove", {clientX: 20, clientY: 20}));
        expect(draggable.hoverId).toBe("1");
        expect(draggable.hoverPlacement).toBe("inside");

        // Row "2" is exactly where it always was (40-80) - no correction
        // should have been applied on its account. Middle of row "2".
        draggable.onGlobalPointerMove(new PointerEvent("pointermove", {clientX: 20, clientY: 60}));
        expect(draggable.hoverId).toBe("2");
        expect(draggable.hoverPlacement).toBe("inside");
    });
});

// Live-reported: dragging near a nested boundary (a grandchild toward the
// gap between its parent's row and its parent's own parent's row) made
// surrounding rows visibly jump up/down repeatedly for barely-moving
// pointer input. The exact geometry that reproduces it: applyGapCorrection
// opens a DROP_GAP_PX-tall visual gap wherever the current target's own
// "before"/"after" placement sits - and the midpoint of that gap is
// exactly equidistant between the row above it and the row below, since
// DROP_GAP_PX (52) is comfortably wider than a typical row. A pointer
// resting anywhere near that midpoint is one px away from a dead-even tie
// in findDropTarget's own nearest-row search, which - unprotected - the
// smallest jitter flips back and forth, each flip re-triggering
// applyGapCorrection's shift on a DIFFERENT row (opening/closing a
// different gap), which is the visible up/down jump. ROW_SWITCH_HYSTERESIS_PX
// fixes this the same way ZONE_HYSTERESIS already protects a single row's
// own before/inside/after boundary - once a row has won the nearest-row
// search, a competing row has to be decisively closer, not just
// marginally so, before it can take over.
describe("todo-overlay-list drag hit-testing near an open reorder gap's own midpoint", () => {
    it("does not flip to the row on the other side of the gap on a 1px jitter past its exact midpoint", async () => {
        const {el} = await renderList({
            entity_id: ENTITY_ID,
            items: [
                makeItem({id: "a", title: "First"}),
                makeItem({id: "b", title: "Second"}),
                makeItem({id: "dragged", title: "Dragged"}),
            ],
        });

        const rows = deepQueryAll(el.shadowRoot!, "todo-overlay-tree-item") as (Element & {
            shadowRoot: ShadowRoot; item: {id: string};
        })[];
        // "a" and "b" sit directly adjacent (0-40, 40-80) - once "a/after"
        // becomes the target, applyGapCorrection shifts "b" (and
        // everything below it) down by DROP_GAP_PX, opening a 40-92 gap
        // whose exact midpoint (66) is equidistant from both.
        mockRect(rows.find(r => r.item.id === "a")!.shadowRoot.querySelector(".row")!, {top: 0, bottom: 40, height: 40});
        mockRect(rows.find(r => r.item.id === "b")!.shadowRoot.querySelector(".row")!, {top: 40, bottom: 80, height: 40});

        const draggable = el as unknown as DraggableList & {hoverId?: string; hoverPlacement?: string};

        draggable.draggedId = "dragged";
        draggable.onDragStart(new CustomEvent("tree-drag-start", {
            detail: {rect: undefined, pointerX: 20, pointerY: 200, grabOffsetX: 0, grabOffsetY: 0},
        }));

        // Deep in "a"'s own after-zone first, to lock in "a/after" (and
        // its gap) the normal way.
        draggable.onGlobalPointerMove(new PointerEvent("pointermove", {clientX: 20, clientY: 35}));
        expect(draggable.hoverId).toBe("a");
        expect(draggable.hoverPlacement).toBe("after");

        // The gap's own exact midpoint - still a dead-even tie between
        // "a" (below it) and "b" (shifted down, above it), resolved by
        // array order alone, but consistent with "a/after" either way.
        draggable.onGlobalPointerMove(new PointerEvent("pointermove", {clientX: 20, clientY: 66}));
        expect(draggable.hoverId).toBe("a");
        expect(draggable.hoverPlacement).toBe("after");

        // One px PAST the midpoint, now genuinely nearer "b" than "a" by
        // raw distance alone (25px vs 27px) - without hysteresis this
        // flips straight to "before b". The still-current "a/after"
        // target must hold instead.
        draggable.onGlobalPointerMove(new PointerEvent("pointermove", {clientX: 20, clientY: 67}));
        expect(draggable.hoverId).toBe("a");
        expect(draggable.hoverPlacement).toBe("after");

        // A little jitter around that same 1px-past-midpoint spot -
        // never budges.
        for (const y of [68, 67, 69, 66, 67]) {
            draggable.onGlobalPointerMove(new PointerEvent("pointermove", {clientX: 20, clientY: y}));
            expect(draggable.hoverId, `hoverId flipped at y=${y}`).toBe("a");
            expect(draggable.hoverPlacement, `hoverPlacement flipped at y=${y}`).toBe("after");
        }
    });
});

// Reported alongside the intuitiveness feedback above: a physical
// confirmation that doesn't depend on catching a visual highlight
// mid-gesture - particularly useful on mobile, where the finger itself
// obscures the row being hovered.
describe("todo-overlay-list haptic feedback on target change", () => {
    it("vibrates when the resolved target changes during a touch drag", async () => {
        const {el} = await renderList({
            entity_id: ENTITY_ID,
            items: [makeItem({id: "1", title: "First"}), makeItem({id: "2", title: "Second"})],
        });

        const rows = deepQueryAll(el.shadowRoot!, "todo-overlay-tree-item") as (Element & {shadowRoot: ShadowRoot})[];
        mockRect(rows[0].shadowRoot.querySelector(".row")!, {top: 0, bottom: 40, height: 40});
        mockRect(rows[1].shadowRoot.querySelector(".row")!, {top: 40, bottom: 80, height: 40});

        const vibrate = vi.fn();
        Object.assign(navigator, {vibrate});

        const draggable = el as unknown as DraggableList;

        draggable.draggedId = "2";
        draggable.onDragStart(new CustomEvent("tree-drag-start", {
            detail: {rect: undefined, pointerX: 20, pointerY: 20, grabOffsetX: 0, grabOffsetY: 0},
        }));

        // Well past the dead zone (see HOVER_DEAD_ZONE_PX), squarely
        // "inside" row "2" - a genuinely new target, so this ticks once.
        draggable.onGlobalPointerMove(new PointerEvent("pointermove", {clientX: 20, clientY: 60, pointerType: "touch"}));
        expect(vibrate).toHaveBeenCalledTimes(1);

        // A tiny move that resolves to the exact same target - no new
        // tick for a no-op move.
        draggable.onGlobalPointerMove(new PointerEvent("pointermove", {clientX: 20, clientY: 61, pointerType: "touch"}));
        expect(vibrate).toHaveBeenCalledTimes(1);
    });

    it("does not vibrate for a mouse drag", async () => {
        const {el} = await renderList({
            entity_id: ENTITY_ID,
            items: [makeItem({id: "1", title: "First"}), makeItem({id: "2", title: "Second"})],
        });

        const rows = deepQueryAll(el.shadowRoot!, "todo-overlay-tree-item") as (Element & {shadowRoot: ShadowRoot})[];
        mockRect(rows[0].shadowRoot.querySelector(".row")!, {top: 0, bottom: 40, height: 40});
        mockRect(rows[1].shadowRoot.querySelector(".row")!, {top: 40, bottom: 80, height: 40});

        const vibrate = vi.fn();
        Object.assign(navigator, {vibrate});

        const draggable = el as unknown as DraggableList;

        draggable.draggedId = "2";
        draggable.onDragStart(new CustomEvent("tree-drag-start", {
            detail: {rect: undefined, pointerX: 20, pointerY: 20, grabOffsetX: 0, grabOffsetY: 0},
        }));

        draggable.onGlobalPointerMove(new PointerEvent("pointermove", {clientX: 20, clientY: 60, pointerType: "mouse"}));

        expect(vibrate).not.toHaveBeenCalled();
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

        // Must go through todo_overlay/delete_item (TodoManager), not the
        // native todo.remove_item service directly - live-diagnosed bug:
        // the native call never fired EVENT_ITEM_CHANGED, so a deletion
        // here could never propagate to a linked list at all.
        expect(hass.connection.sent).toContainEqual(expect.objectContaining({
            type: "todo_overlay/delete_item",
            entity_id: ENTITY_ID,
            item_id: "1",
        }));
        expect(hass.serviceCalls).not.toContainEqual(expect.objectContaining({domain: "todo", service: "remove_item"}));
    });

    it("saving an edit goes through todo_overlay/update_item, not the native todo.update_item service", async () => {
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

        dialog!.dispatchEvent(new CustomEvent("dialog-save", {
            detail: {
                title: "Oat milk", quantity: "", tags: "", description: "",
                dueDate: "", dueTime: "", triggerOnDue: false,
            },
            bubbles: true, composed: true,
        }));
        await flushAsync();

        // Must go through todo_overlay/update_item (TodoManager), not the
        // native todo.update_item service directly - live-diagnosed bug:
        // the native call never fired EVENT_ITEM_CHANGED, so an edit
        // here could never sync to a linked list or refresh another
        // open card.
        expect(hass.connection.sent).toContainEqual(expect.objectContaining({
            type: "todo_overlay/update_item",
            entity_id: ENTITY_ID,
            item_id: "1",
            title: "Oat milk",
        }));
        expect(hass.serviceCalls).not.toContainEqual(expect.objectContaining({domain: "todo", service: "update_item"}));
    });

    it("saving an edit with a pin type sends todo_overlay/set_pin_type", async () => {
        const {el, hass} = await renderList({
            entity_id: ENTITY_ID,
            items: [makeItem({id: "1", title: "Brodie"})],
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

        dialog!.dispatchEvent(new CustomEvent("dialog-save", {
            detail: {
                title: "Brodie", quantity: "", tags: "", description: "",
                dueDate: "", dueTime: "", triggerOnDue: false, pinType: "person",
            },
            bubbles: true, composed: true,
        }));
        await flushAsync();

        expect(hass.connection.sent).toContainEqual(expect.objectContaining({
            type: "todo_overlay/set_pin_type",
            entity_id: ENTITY_ID,
            item_id: "1",
            pin_type: "person",
        }));
    });

    // quantity/tags/triggerOnDue/pinType all batch into one Promise.all
    // now (see onDialogSave's own comment) - but update_item has to
    // fully precede that batch, not join it: setTriggerOnDue's backend
    // validation requires the item's due_datetime to already be
    // persisted (see DueTimeRequiredError), which is exactly what
    // update_item's own dueDate/dueTime fields just wrote. Racing them
    // would risk setTriggerOnDue's message being processed before that
    // write lands. FakeConnection.sendMessagePromise pushes onto `sent`
    // synchronously, before its own internal await - so message ORDER
    // here directly reflects call order, making this a meaningful check,
    // not just a coincidence of both happening to appear somewhere in
    // the array.
    it("sends update_item (with the due date/time) strictly before set_trigger_on_due, even though the other fields now batch", async () => {
        const {el, hass} = await renderList({
            entity_id: ENTITY_ID,
            items: [makeItem({id: "1", title: "Renew passport"})],
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

        dialog!.dispatchEvent(new CustomEvent("dialog-save", {
            detail: {
                title: "Renew passport", quantity: "", tags: "", description: "",
                dueDate: "2026-06-01", dueTime: "09:00", triggerOnDue: true,
            },
            bubbles: true, composed: true,
        }));
        await flushAsync();

        const updateItemIndex = hass.connection.sent.findIndex(m => m.type === "todo_overlay/update_item");
        const setTriggerIndex = hass.connection.sent.findIndex(m => m.type === "todo_overlay/set_trigger_on_due");

        expect(updateItemIndex).toBeGreaterThanOrEqual(0);
        expect(setTriggerIndex).toBeGreaterThan(updateItemIndex);
    });

    it("creating an item with a pin type sends it as part of todo_overlay/create_item", async () => {
        const {el, hass} = await renderList(
            {entity_id: ENTITY_ID, items: []},
            {showQuickAdd: false},
        );

        (el.shadowRoot?.querySelector("button[aria-label='Add item']") as HTMLElement).click();
        await settle(el);

        const dialog = el.shadowRoot?.querySelector("todo-overlay-item-dialog");
        expect(dialog, "create dialog should be open").not.toBeNull();

        dialog!.dispatchEvent(new CustomEvent("dialog-save", {
            detail: {
                title: "Anna", quantity: "", tags: "", description: "",
                dueDate: "", dueTime: "", triggerOnDue: false, pinType: "person",
            },
            bubbles: true, composed: true,
        }));
        await flushAsync();

        expect(hass.connection.sent).toContainEqual(expect.objectContaining({
            type: "todo_overlay/create_item",
            entity_id: ENTITY_ID,
            title: "Anna",
            pin_type: "person",
        }));
    });

    it("does not clobber an in-progress unsaved edit when a live-sync reload fires while the dialog is open", async () => {
        // Live-reproduced bug: dialogValue() used to be recomputed fresh
        // from the frozen dialogItem snapshot on every parent re-render,
        // so a reload triggered by ANY reactive change while the dialog
        // was open (here, a todo_overlay_item_event for this same
        // entity - exactly what a linked list's incoming sync fires
        // after this session's live-refresh fix) silently reset whatever
        // the user had already typed back to the value the dialog opened
        // with.
        const {el, hass} = await renderList({
            entity_id: ENTITY_ID,
            items: [makeItem({id: "1", title: "Milk", quantity: "2L"})],
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

        const quantityInput = dialog?.shadowRoot?.querySelector("#todo-item-quantity") as HTMLInputElement;
        quantityInput.value = "5L";
        quantityInput.dispatchEvent(new InputEvent("input", {bubbles: true, composed: true}));
        await (dialog as unknown as {updateComplete: Promise<unknown>}).updateComplete;

        expect(quantityInput.value).toBe("5L");

        // A reload for this same entity arrives (e.g. an incoming linked
        // change to some other item, or any other reactive re-render)
        // while the dialog is still open, unsaved.
        hass.connection.responses["todo_overlay/get_list"] = {
            entity_id: ENTITY_ID,
            items: [makeItem({id: "1", title: "Milk", quantity: "2L"})],
        };
        hass.connection.fireEvent("todo_overlay_item_event", {entity_id: ENTITY_ID, action: "synced"});
        await settle(el);
        await (dialog as unknown as {updateComplete: Promise<unknown>}).updateComplete;

        expect(quantityInput.value).toBe("5L");
    });
});

describe("todo-overlay-list save-load dialog", () => {
    it("does not clobber an in-progress unsaved save-list name when a live-sync reload fires while it's open", async () => {
        // Live-reported bug, same root cause as the edit-dialog one
        // above: "typing a name to save the list in the mobile browser
        // wipes it occasionally." The save/load dialog had the exact
        // same .value-recomputed-every-render pattern the edit dialog
        // did.
        const {el, hass} = await renderList({
            entity_id: ENTITY_ID,
            items: [makeItem({id: "1", title: "Milk"})],
        });
        hass.connection.responses["todo_overlay/list_saved"] = {names: []};

        const saveButton = el.shadowRoot?.querySelector(
            "button[aria-label='Save list']",
        ) as HTMLButtonElement;
        expect(saveButton, "save-list toolbar button should be present").toBeDefined();
        saveButton.click();
        await settle(el);

        const dialog = el.shadowRoot?.querySelector("todo-overlay-save-load-dialog");
        expect(dialog, "save-load dialog should be open").not.toBeNull();

        const nameInput = dialog?.shadowRoot?.querySelector("#save-load-name") as HTMLInputElement;
        nameInput.value = "weekly_groceries";
        nameInput.dispatchEvent(new InputEvent("input", {bubbles: true, composed: true}));
        await (dialog as unknown as {updateComplete: Promise<unknown>}).updateComplete;

        expect(nameInput.value).toBe("weekly_groceries");

        // A live-sync reload fires for this same entity (e.g. a linked
        // list's incoming change) while the save dialog is still open,
        // unsaved.
        hass.connection.fireEvent("todo_overlay_item_event", {entity_id: ENTITY_ID, action: "synced"});
        await settle(el);
        await (dialog as unknown as {updateComplete: Promise<unknown>}).updateComplete;

        expect(nameInput.value).toBe("weekly_groceries");
    });

    // Live use case: loading a saved template AS THE CHILDREN of an
    // existing parent ("To buy") rather than as new root-level siblings.
    describe("load-into target picker", () => {
        it("passes the list's own real item tree down to the dialog's breadcrumb picker", async () => {
            const {el, hass} = await renderList({
                entity_id: ENTITY_ID,
                items: [
                    makeItem({id: "1", title: "To buy", children: [
                        makeItem({id: "2", title: "Milk"}),
                    ]}),
                    makeItem({id: "3", title: "Errands"}),
                ],
            });
            hass.connection.responses["todo_overlay/list_saved"] = {names: []};

            (el.shadowRoot?.querySelector("button[aria-label='Load list']") as HTMLElement).click();
            await settle(el);

            const dialog = el.shadowRoot?.querySelector("todo-overlay-save-load-dialog") as Element & {
                shadowRoot: ShadowRoot;
            };
            (dialog.shadowRoot.querySelector(".target-summary") as HTMLElement).click();
            await (dialog as unknown as {updateComplete: Promise<unknown>}).updateComplete;

            const rootTitles = [...dialog.shadowRoot.querySelectorAll(".picker-row .title-btn")]
                .map(b => b.textContent?.trim());
            expect(rootTitles).toEqual(["To buy", "Errands"]);

            // Step into "To buy" - its real child "Milk" should show,
            // proving the whole tree (not just the root) made it down.
            const rows = [...dialog.shadowRoot.querySelectorAll(".picker-row")];
            (rows.find(r => r.textContent?.includes("To buy"))!.querySelector(".enter-btn") as HTMLElement).click();
            await (dialog as unknown as {updateComplete: Promise<unknown>}).updateComplete;

            expect([...dialog.shadowRoot.querySelectorAll(".picker-row .title-btn")].map(b => b.textContent?.trim()))
                .toEqual(["Milk"]);
        });

        it("sends the chosen target's id as target_item when loading", async () => {
            const {el, hass} = await renderList({
                entity_id: ENTITY_ID,
                items: [makeItem({id: "1", title: "To buy"})],
            });
            hass.connection.responses["todo_overlay/list_saved"] = {names: ["template"]};

            (el.shadowRoot?.querySelector("button[aria-label='Load list']") as HTMLElement).click();
            await settle(el);

            const dialog = el.shadowRoot?.querySelector("todo-overlay-save-load-dialog") as Element & {
                shadowRoot: ShadowRoot;
            };

            const nameSelect = dialog.shadowRoot.querySelector("#save-load-select") as HTMLSelectElement;
            nameSelect.value = "template";
            nameSelect.dispatchEvent(new Event("change"));
            await (dialog as unknown as {updateComplete: Promise<unknown>}).updateComplete;

            (dialog.shadowRoot.querySelector(".target-summary") as HTMLElement).click();
            await (dialog as unknown as {updateComplete: Promise<unknown>}).updateComplete;
            (dialog.shadowRoot.querySelector(".picker-row .title-btn") as HTMLElement).click();
            await (dialog as unknown as {updateComplete: Promise<unknown>}).updateComplete;

            const buttons = [...dialog.shadowRoot.querySelectorAll("button")] as HTMLButtonElement[];
            buttons.find(b => b.textContent?.trim() === "Load")!.click();
            await flushAsync();

            expect(hass.connection.sent).toContainEqual(expect.objectContaining({
                type: "todo_overlay/load_list",
                name: "template",
                target_item: "1",
            }));
        });

        it("sends no target_item at all when 'Top level' (the default) is left chosen", async () => {
            const {el, hass} = await renderList({
                entity_id: ENTITY_ID,
                items: [makeItem({id: "1", title: "To buy"})],
            });
            hass.connection.responses["todo_overlay/list_saved"] = {names: ["template"]};

            (el.shadowRoot?.querySelector("button[aria-label='Load list']") as HTMLElement).click();
            await settle(el);

            const dialog = el.shadowRoot?.querySelector("todo-overlay-save-load-dialog") as Element & {
                shadowRoot: ShadowRoot;
            };

            const nameSelect = dialog.shadowRoot.querySelector("#save-load-select") as HTMLSelectElement;
            nameSelect.value = "template";
            nameSelect.dispatchEvent(new Event("change"));
            await (dialog as unknown as {updateComplete: Promise<unknown>}).updateComplete;

            const buttons = [...dialog.shadowRoot.querySelectorAll("button")] as HTMLButtonElement[];
            buttons.find(b => b.textContent?.trim() === "Load")!.click();
            await flushAsync();

            const sentLoad = hass.connection.sent.find(m => m.type === "todo_overlay/load_list");
            expect(sentLoad?.target_item).toBeUndefined();
        });
    });
});

// A plain tap on the clear-completed (trash) toolbar button keeps doing
// exactly what it always did; holding it past the long-press threshold
// and releasing offers the much more destructive "delete literally
// everything" instead, gated behind a confirm dialog.
describe("todo-overlay-list clear-all (hold the clear-completed button)", () => {
    function clearButton(el: TodoOverlayList): HTMLElement {
        return el.shadowRoot?.querySelector("button[aria-label='Clear completed']") as HTMLElement;
    }

    it("a quick tap still just clears completed items, with no confirm dialog", async () => {
        const {el, hass} = await renderList({
            entity_id: ENTITY_ID,
            items: [makeItem({id: "1", title: "Milk", completed: true})],
        });

        const button = clearButton(el);
        button.dispatchEvent(new PointerEvent("pointerdown"));
        button.dispatchEvent(new PointerEvent("pointerup"));
        await flushAsync();

        expect(hass.connection.sent).toContainEqual(expect.objectContaining({
            type: "todo_overlay/clear_completed",
            entity_id: ENTITY_ID,
        }));
        expect(hass.connection.sent).not.toContainEqual(expect.objectContaining({type: "todo_overlay/clear_all"}));
        expect(el.shadowRoot?.querySelector("todo-overlay-confirm-dialog")).toBeNull();
    });

    it("shows a ripple as soon as the button is pressed, only marked active once held long enough to trigger", async () => {
        vi.useFakeTimers({shouldAdvanceTime: true});

        try {
            const {el} = await renderList({
                entity_id: ENTITY_ID,
                items: [makeItem({id: "1", title: "Milk"})],
            });

            const button = clearButton(el);
            button.dispatchEvent(new PointerEvent("pointerdown"));
            await el.updateComplete;

            let ripple = button.querySelector(".hold-ripple");
            expect(ripple, "ripple should appear as soon as the button is pressed").not.toBeNull();
            expect(ripple?.classList.contains("active"), "not yet held long enough to be active").toBe(false);

            // The row's own hold-ripple pattern schedules a requestUpdate()
            // for the exact moment the threshold is crossed (see
            // clearButtonHoldTimer) - advancing past it and letting that
            // fire is what flips the ripple to active, not the release.
            await vi.advanceTimersByTimeAsync(LONG_PRESS_MS + 50);

            ripple = button.querySelector(".hold-ripple");
            expect(ripple?.classList.contains("active"), "held long enough - ripple should now read as active").toBe(true);

            button.dispatchEvent(new PointerEvent("pointerup"));
            await el.updateComplete;

            expect(button.querySelector(".hold-ripple"), "ripple should clear on release").toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it("holding past the long-press threshold, then releasing, opens the confirm dialog instead of clearing anything", async () => {
        vi.useFakeTimers({shouldAdvanceTime: true});

        try {
            const {el, hass} = await renderList({
                entity_id: ENTITY_ID,
                items: [makeItem({id: "1", title: "Milk"})],
            });

            const button = clearButton(el);
            button.dispatchEvent(new PointerEvent("pointerdown"));
            vi.advanceTimersByTime(600);
            button.dispatchEvent(new PointerEvent("pointerup"));
            await el.updateComplete;

            const dialog = el.shadowRoot?.querySelector("todo-overlay-confirm-dialog");
            expect(dialog, "confirm dialog should be open").not.toBeNull();

            // Regression check: these three used to be set via plain HTML
            // attributes (heading="...") rather than Lit property bindings
            // (.heading=${...}) - silently inert, since the component
            // declares them with attribute: false. Reading the actual
            // properties here (not just checking the dialog is present)
            // is what would have caught that - the dialog "opened" either
            // way, just with an empty message and generic defaults.
            const dialogProps = dialog as unknown as {heading: string; message: string; confirmLabel: string};
            expect(dialogProps.heading).toBe("Delete all items?");
            expect(dialogProps.message).not.toBe("");
            expect(dialogProps.confirmLabel).toBe("Delete all");

            expect(hass.connection.sent).not.toContainEqual(expect.objectContaining({type: "todo_overlay/clear_completed"}));
            expect(hass.connection.sent).not.toContainEqual(expect.objectContaining({type: "todo_overlay/clear_all"}));
        } finally {
            vi.useRealTimers();
        }
    });

    it("confirming the dialog deletes every item, completed or not, and reloads", async () => {
        vi.useFakeTimers({shouldAdvanceTime: true});

        try {
            const {el, hass} = await renderList({
                entity_id: ENTITY_ID,
                items: [
                    makeItem({id: "1", title: "Milk", completed: false}),
                    makeItem({id: "2", title: "Bread", completed: true}),
                ],
            });

            const button = clearButton(el);
            button.dispatchEvent(new PointerEvent("pointerdown"));
            vi.advanceTimersByTime(600);
            button.dispatchEvent(new PointerEvent("pointerup"));
            await el.updateComplete;

            const dialog = el.shadowRoot?.querySelector("todo-overlay-confirm-dialog")!;
            dialog.dispatchEvent(new CustomEvent("dialog-confirm", {bubbles: true, composed: true}));
            await vi.advanceTimersByTimeAsync(0);

            expect(hass.connection.sent).toContainEqual(expect.objectContaining({
                type: "todo_overlay/clear_all",
                entity_id: ENTITY_ID,
            }));
            expect(el.shadowRoot?.querySelector("todo-overlay-confirm-dialog")).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it("cancelling the dialog deletes nothing", async () => {
        vi.useFakeTimers({shouldAdvanceTime: true});

        try {
            const {el, hass} = await renderList({
                entity_id: ENTITY_ID,
                items: [makeItem({id: "1", title: "Milk"})],
            });

            const button = clearButton(el);
            button.dispatchEvent(new PointerEvent("pointerdown"));
            vi.advanceTimersByTime(600);
            button.dispatchEvent(new PointerEvent("pointerup"));
            await el.updateComplete;

            const dialog = el.shadowRoot?.querySelector("todo-overlay-confirm-dialog")!;
            dialog.dispatchEvent(new CustomEvent("dialog-close", {bubbles: true, composed: true}));
            await el.updateComplete;

            expect(hass.connection.sent).not.toContainEqual(expect.objectContaining({type: "todo_overlay/clear_all"}));
            expect(el.shadowRoot?.querySelector("todo-overlay-confirm-dialog")).toBeNull();
        } finally {
            vi.useRealTimers();
        }
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

        expect(hass.connection.sent).toContainEqual(expect.objectContaining({
            type: "todo_overlay/delete_item",
            entity_id: ENTITY_ID,
            item_id: "1",
        }));
        expect(hass.serviceCalls).not.toContainEqual(expect.objectContaining({domain: "todo", service: "remove_item"}));
        expect(hass.connection.sent.filter(m => m.type === "todo_overlay/get_list").length)
            .toBeGreaterThan(hass.connection.sent.slice(0, sentBefore)
                .filter(m => m.type === "todo_overlay/get_list").length);
    });
});

// Live-reported: an earlier version lifted the drag ghost clear of the
// pointer entirely (to keep a touch drag's target row visible under
// it), and it looked visually disconnected from what was actually
// being dragged - on both touch AND mouse. Replaced with three opt-in,
// A/B-testable treatments (see DragGhostStyle in models.ts) that only
// ever change the ghost's own size/opacity, or add a separate satellite
// element near it - never its position, which always stays pinned
// exactly to the pointer regardless of which (if any) style is active.
describe("todo-overlay-list drag ghost styles", () => {
    function setDragState(el: TodoOverlayList, overrides: Record<string, unknown>) {
        Object.assign(el as unknown as Record<string, unknown>, overrides);
    }

    async function renderHoveringParent(dragGhostStyle?: "none" | "label" | "shrink" | "translucent") {
        const {el} = await renderList(
            {
                entity_id: ENTITY_ID,
                items: [
                    makeItem({id: "parent", title: "Home Assistant", children: []}),
                    makeItem({id: "leaf", title: "Groceries"}),
                ],
            },
            dragGhostStyle ? {dragGhostStyle} : {},
        );

        setDragState(el, {
            draggedId: "leaf",
            ghostPosition: {x: 100, y: 200},
            dragGhostOffset: {x: 10, y: 15},
            dragGhostSize: {width: 300, height: 40},
            hoverId: "parent",
            hoverPlacement: "inside",
        });
        await settle(el);

        return el;
    }

    it("keeps the ghost's own position pinned exactly to the pointer minus the grab offset, regardless of style", async () => {
        const el = await renderHoveringParent("shrink");

        const ghost = el.shadowRoot?.querySelector(".drag-ghost") as HTMLElement;
        expect(ghost.style.left).toBe("90px");
        expect(ghost.style.top).toBe("185px");
    });

    it("applies no special treatment at all while style is 'none', even hovering a parent", async () => {
        const el = await renderHoveringParent("none");

        const ghost = el.shadowRoot?.querySelector(".drag-ghost") as HTMLElement;
        expect(ghost.classList.contains("shrink")).toBe(false);
        expect(ghost.classList.contains("translucent")).toBe(false);
        expect(ghost.style.width).toBe("300px");
        expect(el.shadowRoot?.querySelector(".drag-ghost-label")).toBeNull();
    });

    it("'shrink' collapses the ghost's width only while hovering a valid parent ('inside')", async () => {
        const el = await renderHoveringParent("shrink");

        const ghost = el.shadowRoot?.querySelector(".drag-ghost") as HTMLElement;
        expect(ghost.classList.contains("shrink")).toBe(true);
        expect(parseInt(ghost.style.width, 10)).toBeLessThan(100);

        // Switching to a before/after (reorder) target is NOT a
        // reparent - the ghost never obscures anything a shadow-box gap
        // doesn't already show elsewhere, so no treatment applies.
        setDragState(el, {hoverPlacement: "before"});
        await settle(el);

        expect(el.shadowRoot?.querySelector(".drag-ghost")?.classList.contains("shrink")).toBe(false);
    });

    it("'translucent' fades the ghost only while hovering a valid parent", async () => {
        const el = await renderHoveringParent("translucent");

        expect(el.shadowRoot?.querySelector(".drag-ghost")?.classList.contains("translucent")).toBe(true);
    });

    it("'label' renders a floating pill naming the parent, directly under the ghost - not near the raw pointer", async () => {
        const el = await renderHoveringParent("label");

        const label = el.shadowRoot?.querySelector(".drag-ghost-label") as HTMLElement;
        expect(label).not.toBeNull();
        expect(label.textContent?.trim()).toBe("Add to: Home Assistant");

        // Same left edge as the ghost itself (90 = 100 - 10 grab
        // offset), directly beneath it (185 ghost-top + 40 ghost height
        // + 8 gap) - anchored to the GHOST's own box, not the raw
        // pointer, so it always reads as attached to what's being
        // dragged regardless of where on the row it was grabbed.
        expect(label.style.left).toBe("90px");
        expect(label.style.top).toBe("233px");
    });

    it("shows no label while hovering a before/after target, even with 'label' selected", async () => {
        const {el} = await renderList(
            {
                entity_id: ENTITY_ID,
                items: [
                    makeItem({id: "parent", title: "Home Assistant", children: [makeItem({id: "child", title: "Firewall"})]}),
                    makeItem({id: "leaf", title: "Groceries"}),
                ],
            },
            {dragGhostStyle: "label"},
        );

        setDragState(el, {
            draggedId: "leaf",
            ghostPosition: {x: 100, y: 200},
            dragGhostOffset: {x: 0, y: 0},
            hoverId: "child",
            hoverPlacement: "before",
        });
        await settle(el);

        expect(el.shadowRoot?.querySelector(".drag-ghost-label")).toBeNull();
    });

    // Live-reported on a real phone: touch can only ever start a drag
    // from the reorder handle, which sits at the row's far-right edge -
    // so the grab offset baked into the ghost's position ends up close
    // to the row's ENTIRE width. A natural thumb drag curving even
    // slightly left off that edge (ordinary ergonomics, not user error)
    // then amplified into the ghost - and the "label" style's pill
    // anchored under it - jumping far to the left, often off-screen.
    describe("touch grab-offset cap and viewport clamp", () => {
        it("caps a TOUCH drag's horizontal grab offset so the ghost stays close to the pointer, regardless of where on the row it was grabbed", async () => {
            const {el} = await renderList({
                entity_id: ENTITY_ID,
                items: [makeItem({id: "1", title: "Milk"})],
            });

            const draggable = el as unknown as DraggableList;
            draggable.draggedId = "1";
            draggable.onDragStart(new CustomEvent("tree-drag-start", {
                detail: {
                    rect: {x: 0, y: 0, width: 300, height: 40},
                    pointerX: 300,
                    pointerY: 100,
                    grabOffsetX: 280,
                    grabOffsetY: 20,
                    pointerType: "touch",
                },
            }));
            await settle(el);

            const ghost = el.shadowRoot?.querySelector(".drag-ghost") as HTMLElement;
            // Uncapped this would be 300 - 280 = 20px - the whole point
            // is that it ISN'T that, and stays much closer to the
            // pointer (300) instead.
            expect(parseInt(ghost.style.left, 10)).toBeGreaterThan(200);
        });

        it("does not cap a MOUSE drag's horizontal grab offset - a cursor has no equivalent edge-anchoring problem", async () => {
            const {el} = await renderList({
                entity_id: ENTITY_ID,
                items: [makeItem({id: "1", title: "Milk"})],
            });

            const draggable = el as unknown as DraggableList;
            draggable.draggedId = "1";
            draggable.onDragStart(new CustomEvent("tree-drag-start", {
                detail: {
                    rect: {x: 0, y: 0, width: 300, height: 40},
                    pointerX: 300,
                    pointerY: 100,
                    grabOffsetX: 280,
                    grabOffsetY: 20,
                    pointerType: "mouse",
                },
            }));
            await settle(el);

            const ghost = el.shadowRoot?.querySelector(".drag-ghost") as HTMLElement;
            expect(ghost.style.left).toBe("20px");
        });

        it("clamps the ghost to stay fully on-screen even from a wildly off-screen raw position", async () => {
            const el = await renderHoveringParent("shrink");

            setDragState(el, {ghostPosition: {x: -5000, y: -5000}, dragGhostOffset: {x: 0, y: 0}});
            await settle(el);

            const ghost = el.shadowRoot?.querySelector(".drag-ghost") as HTMLElement;
            expect(parseInt(ghost.style.left, 10)).toBeGreaterThanOrEqual(0);
            expect(parseInt(ghost.style.top, 10)).toBeGreaterThanOrEqual(0);
        });

        it("clamps the 'label' style's pill to stay on-screen too, even from a wildly off-screen raw position", async () => {
            const el = await renderHoveringParent("label");

            setDragState(el, {ghostPosition: {x: 100000, y: 100000}, dragGhostOffset: {x: 0, y: 0}});
            await settle(el);

            const label = el.shadowRoot?.querySelector(".drag-ghost-label") as HTMLElement;
            expect(label).not.toBeNull();
            expect(parseInt(label.style.left, 10)).toBeLessThan(100000);
            expect(parseInt(label.style.top, 10)).toBeLessThan(100000);
        });
    });
});
