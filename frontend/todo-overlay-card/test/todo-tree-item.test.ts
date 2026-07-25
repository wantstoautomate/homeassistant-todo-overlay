import {afterEach, describe, expect, it, vi} from "vitest";

import "../src/components/todo-tree-item";
import type {TodoTreeItem} from "../src/components/todo-tree-item";
import {LONG_PRESS_MS, type TodoItem} from "../src/models";

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

// A real press/release cycle, not a synthesized "click" - drives the
// row's own pointerdown (bound directly on .row) and, since that
// attaches a window-level pointerup listener for the rest of the
// gesture (see pointerDown()), the matching release has to be
// dispatched on window too, exactly as a real browser would deliver it.
function press(el: TodoTreeItem): void {
    (el.shadowRoot?.querySelector(".row") as HTMLElement).dispatchEvent(
        new PointerEvent("pointerdown", {clientX: 0, clientY: 0, pointerType: "mouse", bubbles: true}),
    );
}

function release(): void {
    window.dispatchEvent(
        new PointerEvent("pointerup", {clientX: 0, clientY: 0, pointerType: "mouse", bubbles: true}),
    );
}

describe("todo-overlay-tree-item", () => {
    it("renders the item's title", async () => {
        const el = await renderItem(makeItem({title: "Buy milk"}));

        expect(el.shadowRoot?.querySelector(".summary")?.textContent).toBe("Buy milk");
    });

    it("hides the checkbox for a plain leaf item by default", async () => {
        const el = await renderItem(makeItem());

        expect(el.shadowRoot?.querySelector("ha-checkbox")).toBeNull();
    });

    it("renders a checkbox for a plain leaf item when showCheckboxes is on", async () => {
        const el = await renderItem(makeItem(), {showCheckboxes: true});

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

    it("drops the checkbox slot entirely for a parent when hideCompleteForParents is set, even with checkboxes on", async () => {
        const el = await renderItem(
            makeItem({children: [makeItem({id: "2"})]}),
            {hideCompleteForParents: true, showCheckboxes: true},
        );

        expect(el.shadowRoot?.querySelector(".checkbox-slot")).toBeNull();
    });

    it("still shows a leaf item's own checkbox even when hideCompleteForParents is set", async () => {
        const el = await renderItem(makeItem(), {hideCompleteForParents: true, showCheckboxes: true});

        expect(el.shadowRoot?.querySelector(".checkbox-slot ha-checkbox")).not.toBeNull();
    });

    it("still shows a parent's checkbox when hideCompleteForParents is off", async () => {
        const el = await renderItem(
            makeItem({children: [makeItem({id: "2"})]}),
            {hideCompleteForParents: false, showCheckboxes: true},
        );

        expect(el.shadowRoot?.querySelector(".checkbox-slot ha-checkbox")).not.toBeNull();
    });

    it("hides checkboxes everywhere when showCheckboxes is off, regardless of hideCompleteForParents", async () => {
        const leaf = await renderItem(makeItem(), {showCheckboxes: false, hideCompleteForParents: false});
        expect(leaf.shadowRoot?.querySelector(".checkbox-slot")).toBeNull();

        const parent = await renderItem(
            makeItem({children: [makeItem({id: "2"})]}),
            {showCheckboxes: false, hideCompleteForParents: false},
        );
        expect(parent.shadowRoot?.querySelector(".checkbox-slot")).toBeNull();
    });

    it("bolds a parent's title so it reads as distinct from a leaf/child row", async () => {
        const parent = await renderItem(makeItem({children: [makeItem({id: "2"})]}));
        expect(parent.shadowRoot?.querySelector(".summary")?.classList.contains("has-children")).toBe(true);

        const leaf = await renderItem(makeItem());
        expect(leaf.shadowRoot?.querySelector(".summary")?.classList.contains("has-children")).toBe(false);
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

    it("dims (never unmounts) a parent's whole subtree, at every depth, once its own drag actually "
        + "engages - the moving group reads as one unit without any layout shift", async () => {
        const el = await renderItem(
            makeItem({
                id: "parent",
                children: [makeItem({
                    id: "child", title: "Child",
                    children: [makeItem({id: "grandchild", title: "Grandchild"})],
                })],
            }),
        );

        const childEl = el.shadowRoot?.querySelector("todo-overlay-tree-item") as Element & {shadowRoot: ShadowRoot};
        const grandchildEl = childEl.shadowRoot?.querySelector("todo-overlay-tree-item") as Element & {shadowRoot: ShadowRoot};

        expect(childEl.shadowRoot.querySelector(".row")?.classList.contains("dimmed")).toBe(false);
        expect(grandchildEl.shadowRoot.querySelector(".row")?.classList.contains("dimmed")).toBe(false);

        const draggable = el as unknown as {
            draggedId?: string;
            onWindowPointerMove: (e: PointerEvent) => void;
        };

        el.draggedId = "parent";
        (el.shadowRoot?.querySelector(".row") as HTMLElement).dispatchEvent(
            new PointerEvent("pointerdown", {clientX: 0, clientY: 0, pointerType: "mouse"}),
        );

        // A mouse drag engages on the very first move past the jitter
        // threshold (see onWindowPointerMove's own doc comment) - no hold
        // delay to wait out first, unlike touch.
        draggable.onWindowPointerMove(new PointerEvent("pointermove", {clientX: 0, clientY: 20}));
        await el.updateComplete;
        await childEl.updateComplete;
        await grandchildEl.updateComplete;

        // Still fully mounted - dimmed in place, not collapsed/removed.
        expect(el.shadowRoot?.querySelector("ul")).not.toBeNull();
        expect(childEl.shadowRoot.querySelector(".row")?.classList.contains("dimmed")).toBe(true);
        expect(grandchildEl.shadowRoot.querySelector(".row")?.classList.contains("dimmed")).toBe(true);

        // The dragged row's OWN row must actually render as nothing (not
        // just carry a "lifted" class) - a real browser check caught a
        // regression here where "lifted" still rendered a visible grey
        // box that stayed behind at the original position for the whole
        // drag, disconnected from the floating ghost. getComputedStyle,
        // not classList, is what would have caught that.
        const draggedRow = el.shadowRoot?.querySelector(".row") as HTMLElement;
        expect(draggedRow.classList.contains("lifted")).toBe(true);
        expect(getComputedStyle(draggedRow).display).toBe("none");

        // Not persisted - dropping (draggedId no longer this row's id)
        // reverts every descendant back to normal.
        el.draggedId = undefined;
        await el.updateComplete;
        await childEl.updateComplete;

        expect(childEl.shadowRoot.querySelector(".row")?.classList.contains("dimmed")).toBe(false);
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

    describe("double-click / quick-tap gestures", () => {
        // Live-reproduced bug: two ordinary, otherwise-unremarkable clicks
        // sometimes never make the browser fire a native "dblclick" event
        // at all (confirmed via a real headless-Chrome CDP session, not
        // just theory) - relying on it left double-clicking to open the
        // edit dialog silently doing nothing. Detecting the second tap
        // via the row's own pending debounce timer (pointerUp) instead
        // doesn't depend on that browser event ever showing up.
        it("treats two quick taps as a double-click, opening the edit-dialog path exactly once", async () => {
            vi.useFakeTimers();

            try {
                const el = await renderItem(makeItem({id: "1"}));
                const events: {id: string; pressDurationMs: number; moved: boolean}[] = [];

                el.addEventListener("tree-pointer-up", e => {
                    events.push((e as CustomEvent).detail);
                });

                press(el);
                release();
                press(el);
                release();

                // Nothing left pending - a stray later firing would show
                // up as a second, unwanted event.
                vi.advanceTimersByTime(1000);

                expect(events).toEqual([{id: "1", pressDurationMs: LONG_PRESS_MS, moved: false}]);
            } finally {
                vi.useRealTimers();
            }
        });

        it("fires a single tap after the debounce window elapses when no second tap arrives", async () => {
            vi.useFakeTimers();

            try {
                const el = await renderItem(makeItem({id: "1"}));
                const events: {id: string; pressDurationMs: number; moved: boolean}[] = [];

                el.addEventListener("tree-pointer-up", e => {
                    events.push((e as CustomEvent).detail);
                });

                press(el);
                release();

                expect(events).toEqual([]);

                vi.advanceTimersByTime(300);

                expect(events).toHaveLength(1);
                expect(events[0].moved).toBe(false);
                expect(events[0].pressDurationMs).toBeLessThan(LONG_PRESS_MS);
            } finally {
                vi.useRealTimers();
            }
        });

        it("treats two taps spaced further apart than the debounce window as two separate single taps", async () => {
            vi.useFakeTimers();

            try {
                const el = await renderItem(makeItem({id: "1"}));
                const events: {id: string; pressDurationMs: number; moved: boolean}[] = [];

                el.addEventListener("tree-pointer-up", e => {
                    events.push((e as CustomEvent).detail);
                });

                press(el);
                release();
                vi.advanceTimersByTime(300);
                expect(events).toHaveLength(1);

                press(el);
                release();
                vi.advanceTimersByTime(300);
                expect(events).toHaveLength(2);

                expect(events.every(detail => detail.pressDurationMs < LONG_PRESS_MS)).toBe(true);
            } finally {
                vi.useRealTimers();
            }
        });
    });

    describe("delete button", () => {
        it("shows a delete button on a leaf row", async () => {
            const el = await renderItem(makeItem());

            expect(el.shadowRoot?.querySelector(".delete-button")).not.toBeNull();
        });

        it("does not show a delete button on a parent row", async () => {
            const el = await renderItem(makeItem({children: [makeItem({id: "2"})]}));

            expect(el.shadowRoot?.querySelector(".delete-button")).toBeNull();
        });

        it("deletes immediately (one click) when confirmDelete is off", async () => {
            const el = await renderItem(makeItem(), {confirmDelete: false});

            let detail: {id: string} | undefined;
            el.addEventListener("tree-delete-item", (e) => {
                detail = (e as CustomEvent<{id: string}>).detail;
            });

            (el.shadowRoot?.querySelector(".delete-button") as HTMLElement).click();

            expect(detail).toEqual({id: "1"});
        });

        it("requires a second click to confirm when confirmDelete is on (the default)", async () => {
            const el = await renderItem(makeItem());

            let fired = false;
            el.addEventListener("tree-delete-item", () => { fired = true; });

            const button = el.shadowRoot?.querySelector(".delete-button") as HTMLElement;
            button.click();
            await el.updateComplete;

            expect(fired).toBe(false);
            expect(el.shadowRoot?.querySelector(".delete-button.confirming")).not.toBeNull();

            button.click();

            expect(fired).toBe(true);
        });

        it("disarms the confirm state after the confirm window elapses", async () => {
            vi.useFakeTimers();

            try {
                const el = await renderItem(makeItem());

                let fired = false;
                el.addEventListener("tree-delete-item", () => { fired = true; });

                const button = el.shadowRoot?.querySelector(".delete-button") as HTMLElement;
                button.click();
                await el.updateComplete;

                expect(el.shadowRoot?.querySelector(".delete-button.confirming")).not.toBeNull();

                vi.advanceTimersByTime(3100);
                await el.updateComplete;

                expect(el.shadowRoot?.querySelector(".delete-button.confirming")).toBeNull();

                // A click now arms it again rather than deleting outright.
                button.click();
                expect(fired).toBe(false);
            } finally {
                vi.useRealTimers();
            }
        });
    });
});
