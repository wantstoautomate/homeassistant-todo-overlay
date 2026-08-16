import {afterEach, describe, expect, it, vi} from "vitest";

import "../src/components/todo-tree-item";
import type {TodoTreeItem} from "../src/components/todo-tree-item";
import {ROW_COLLAPSE_MS, SWIPE_ACTION_THRESHOLD_PX, SWIPE_AXIS_LOCK_PX, SWIPE_MAX_REVEAL_PX} from "../src/components/todo-tree-item";
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

afterEach(async () => {
    // A real (not faked) one-task wait, not just a microtask flush -
    // detachWindowListeners' own touch-tail cleanup is deliberately
    // deferred by one real task (see its own comment), so a test that
    // released a horizontal swipe without waiting for that to run yet
    // would otherwise leave a lingering window-level, capture-phase
    // listener attached past the end of its own test - not scoped to
    // its row at all, so it's able to affect a LATER, unrelated test's
    // own touchmove/touchend dispatch if that gap isn't closed here.
    await new Promise(r => setTimeout(r, 0));
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

// A confirmed delete no longer dispatches tree-delete-item
// synchronously - it plays a local collapse animation on the row's own
// <li> first (see dispatchDeleteAfterCollapse's own comment: an
// instant removal, while already scrolled to the bottom of a long
// list, forces the browser into an un-animatable scroll snap), then
// dispatches once that finishes. A generous margin over ROW_COLLAPSE_MS
// itself, since this is a real (not faked) timer.
function flushRowCollapse(): Promise<void> {
    return new Promise(r => setTimeout(r, ROW_COLLAPSE_MS + 50));
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

    // Live-reported bug: drag-to-reorder didn't work at all on a real
    // touchscreen (HA Companion App). First attempt (toggling
    // touch-action on the row itself, plus preventDefault, once a
    // whole-row hold reached its threshold) still didn't reliably work
    // on a real device - browsers don't consistently honor a
    // touch-action change made mid-gesture, only one set before the
    // gesture starts. Replaced with a dedicated drag-handle, always
    // touch-action: none from the very first touchstart, shown only in
    // reorder mode (see todo-overlay-list.ts's toolbar toggle - CSS
    // media-gated to touch/coarse-pointer devices, so mouse never sees
    // any of this). Mouse itself was never affected either way -
    // pointerIsMouse always skips the hold delay entirely.
    describe("touch drag via the reorder-mode handle", () => {
        it("renders no drag-handle when reorder mode is off", async () => {
            const el = await renderItem(makeItem({id: "1"}), {reorderModeActive: false});

            expect(el.shadowRoot?.querySelector(".drag-handle")).toBeNull();
        });

        it("renders a drag-handle (in place of the delete button) once reorder mode is on", async () => {
            const el = await renderItem(makeItem({id: "1"}), {reorderModeActive: true});

            expect(el.shadowRoot?.querySelector(".drag-handle")).not.toBeNull();
            expect(el.shadowRoot?.querySelector(".delete-button")).toBeNull();
        });

        it("renders a handle for a parent row too, unlike the (leaf-only) delete button", async () => {
            const el = await renderItem(
                makeItem({id: "parent", children: [makeItem({id: "child"})]}),
                {reorderModeActive: true},
            );

            expect(el.shadowRoot?.querySelector(".drag-handle")).not.toBeNull();
        });

        it("engages a drag immediately on the handle, on touch, with no hold wait", async () => {
            const el = document.createElement("todo-overlay-tree-item") as TodoTreeItem;
            el.item = makeItem({id: "1"});
            el.reorderModeActive = true;
            document.body.appendChild(el);
            await el.updateComplete;

            el.draggedId = "1";

            const handle = el.shadowRoot?.querySelector(".drag-handle") as HTMLElement;
            handle.dispatchEvent(
                new PointerEvent("pointerdown", {clientX: 0, clientY: 0, pointerType: "touch", bubbles: true}),
            );

            const draggable = el as unknown as {onWindowPointerMove: (e: PointerEvent) => void};
            const moveEvent = new PointerEvent("pointermove", {clientX: 0, clientY: 20, pointerType: "touch"});
            const preventDefaultSpy = vi.spyOn(moveEvent, "preventDefault");

            let dragStarted = false;
            el.addEventListener("tree-drag-start", () => {
                dragStarted = true;
            });

            // No fake-timer advance at all - if this needed to wait out
            // LONG_PRESS_MS like the old whole-row path did, this move
            // (issued immediately) wouldn't have engaged anything yet.
            draggable.onWindowPointerMove(moveEvent);

            expect(dragStarted).toBe(true);
            expect(preventDefaultSpy).toHaveBeenCalled();

            window.dispatchEvent(new PointerEvent("pointerup", {clientX: 0, clientY: 0, pointerType: "touch"}));
        });

        it("does not stop the row's own pointerdown from firing too - the handle stops propagation", async () => {
            const el = document.createElement("todo-overlay-tree-item") as TodoTreeItem;
            el.item = makeItem({id: "1"});
            el.reorderModeActive = true;
            document.body.appendChild(el);
            await el.updateComplete;

            let rowPointerDowns = 0;
            el.addEventListener("tree-pointer-down", () => {
                rowPointerDowns += 1;
            });

            const handle = el.shadowRoot?.querySelector(".drag-handle") as HTMLElement;
            handle.dispatchEvent(
                new PointerEvent("pointerdown", {clientX: 0, clientY: 0, pointerType: "touch", bubbles: true}),
            );

            // Exactly one - from handlePointerDown calling pointerDown()
            // itself, not from the row's own listener also seeing the
            // (unstopped) bubbled event.
            expect(rowPointerDowns).toBe(1);

            window.dispatchEvent(new PointerEvent("pointerup", {clientX: 0, clientY: 0, pointerType: "touch"}));
        });

        it("a touch hold-and-move on the row itself (not the handle) no longer engages a drag", async () => {
            const el = await renderItem(makeItem({id: "1"}));
            const row = el.shadowRoot?.querySelector(".row") as HTMLElement;
            const draggable = el as unknown as {onWindowPointerMove: (e: PointerEvent) => void};

            el.draggedId = "1";
            vi.useFakeTimers();

            try {
                row.dispatchEvent(
                    new PointerEvent("pointerdown", {clientX: 0, clientY: 0, pointerType: "touch", bubbles: true}),
                );
                vi.advanceTimersByTime(LONG_PRESS_MS);
                await el.updateComplete;

                let dragStarted = false;
                el.addEventListener("tree-drag-start", () => {
                    dragStarted = true;
                });

                draggable.onWindowPointerMove(new PointerEvent("pointermove", {clientX: 0, clientY: 20, pointerType: "touch"}));

                expect(dragStarted).toBe(false);
            } finally {
                window.dispatchEvent(new PointerEvent("pointerup", {clientX: 0, clientY: 0, pointerType: "touch"}));
                vi.useRealTimers();
            }
        });

        it("does not call preventDefault for a mouse drag - no competing native gesture to suppress", async () => {
            const el = await renderItem(makeItem({id: "1"}));
            const row = el.shadowRoot?.querySelector(".row") as HTMLElement;
            const draggable = el as unknown as {onWindowPointerMove: (e: PointerEvent) => void};

            row.dispatchEvent(
                new PointerEvent("pointerdown", {clientX: 0, clientY: 0, pointerType: "mouse", bubbles: true}),
            );

            const moveEvent = new PointerEvent("pointermove", {clientX: 0, clientY: 20, pointerType: "mouse"});
            const preventDefaultSpy = vi.spyOn(moveEvent, "preventDefault");

            draggable.onWindowPointerMove(moveEvent);

            expect(preventDefaultSpy).not.toHaveBeenCalled();

            window.dispatchEvent(new PointerEvent("pointerup", {clientX: 0, clientY: 0, pointerType: "mouse"}));
        });
    });

    // Touch-only, mobile replacement for the desktop-only per-row +/x
    // toggles (see the class's own @media (pointer: coarse) CSS) - a
    // plain press-and-drag on the row itself (never the reorder-mode
    // handle, and never while reorder mode is on - that's covered by
    // its own describe block above). Same onWindowPointerMove call
    // pattern as the drag tests above: a real pointerdown dispatched on
    // ".row" (to attach the window listeners for real), then the
    // private onWindowPointerMove called directly for precise control
    // over dx/dy, then a real window pointerup/pointercancel to release.
    describe("touch swipe on the plain row", () => {
        function touchPress(el: TodoTreeItem): void {
            (el.shadowRoot?.querySelector(".row") as HTMLElement).dispatchEvent(
                new PointerEvent("pointerdown", {clientX: 0, clientY: 0, pointerType: "touch", bubbles: true}),
            );
        }

        function move(el: TodoTreeItem, dx: number, dy: number): PointerEvent {
            const draggable = el as unknown as {onWindowPointerMove: (e: PointerEvent) => void};
            const e = new PointerEvent("pointermove", {clientX: dx, clientY: dy, pointerType: "touch"});

            draggable.onWindowPointerMove(e);

            return e;
        }

        function touchRelease(): void {
            window.dispatchEvent(new PointerEvent("pointerup", {clientX: 0, clientY: 0, pointerType: "touch"}));
        }

        it("reveals the delete panel, armed, once a leftward swipe clears the action threshold", async () => {
            const el = await renderItem(makeItem({id: "1"}));
            touchPress(el);

            move(el, -(SWIPE_ACTION_THRESHOLD_PX + 10), 0);
            await el.updateComplete;

            const panel = el.shadowRoot?.querySelector(".swipe-action") as HTMLElement;
            expect(panel).not.toBeNull();
            expect(panel.classList.contains("delete")).toBe(true);
            expect(panel.classList.contains("armed")).toBe(true);

            touchRelease();
        });

        it("dispatches tree-delete-item on release once a leftward swipe passed the action threshold", async () => {
            const el = await renderItem(makeItem({id: "1"}));

            let detail: {id: string} | undefined;
            el.addEventListener("tree-delete-item", (e) => {
                detail = (e as CustomEvent<{id: string}>).detail;
            });

            touchPress(el);
            move(el, -(SWIPE_ACTION_THRESHOLD_PX + 10), 0);
            touchRelease();
            await flushRowCollapse();

            expect(detail).toEqual({id: "1"});
        });

        it("dispatches tree-toggle-child-quick-add on release once a rightward swipe passed the action threshold", async () => {
            const el = await renderItem(makeItem({id: "1"}));

            let detail: {id: string} | undefined;
            el.addEventListener("tree-toggle-child-quick-add", (e) => {
                detail = (e as CustomEvent<{id: string}>).detail;
            });

            touchPress(el);
            move(el, SWIPE_ACTION_THRESHOLD_PX + 10, 0);
            touchRelease();

            expect(detail).toEqual({id: "1"});
        });

        it("springs back with no action when released short of the threshold", async () => {
            const el = await renderItem(makeItem({id: "1"}));

            let deleted = false;
            let toggled = false;
            el.addEventListener("tree-delete-item", () => { deleted = true; });
            el.addEventListener("tree-toggle-child-quick-add", () => { toggled = true; });

            touchPress(el);
            move(el, -(SWIPE_ACTION_THRESHOLD_PX - 20), 0);
            await el.updateComplete;
            expect(el.shadowRoot?.querySelector(".swipe-action")).not.toBeNull();

            touchRelease();
            await el.updateComplete;

            expect(deleted).toBe(false);
            expect(toggled).toBe(false);
            expect(el.shadowRoot?.querySelector(".swipe-action-layer")).toBeNull();
        });

        it("clamps the live offset to SWIPE_MAX_REVEAL_PX for a swipe far past the threshold", async () => {
            const el = await renderItem(makeItem({id: "1"}));
            touchPress(el);

            move(el, -(SWIPE_MAX_REVEAL_PX + 200), 0);
            await el.updateComplete;

            const row = el.shadowRoot?.querySelector(".row") as HTMLElement;
            expect(row.style.transform).toBe(`translateX(-${SWIPE_MAX_REVEAL_PX}px)`);

            touchRelease();
        });

        it("does not engage swipe at all for a mostly-vertical gesture - native scroll owns it", async () => {
            const el = await renderItem(makeItem({id: "1"}));
            touchPress(el);

            const e = move(el, 5, 60);
            const preventDefaultSpy = vi.spyOn(e, "preventDefault");
            await el.updateComplete;

            expect(el.shadowRoot?.querySelector(".swipe-action-layer")).toBeNull();
            expect(preventDefaultSpy).not.toHaveBeenCalled();

            touchRelease();
        });

        it("calls preventDefault once a horizontal swipe locks in", async () => {
            const el = await renderItem(makeItem({id: "1"}));
            touchPress(el);

            const draggable = el as unknown as {onWindowPointerMove: (e: PointerEvent) => void};
            const e = new PointerEvent("pointermove", {clientX: -40, clientY: 0, pointerType: "touch"});
            const preventDefaultSpy = vi.spyOn(e, "preventDefault");
            draggable.onWindowPointerMove(e);

            expect(preventDefaultSpy).toHaveBeenCalled();

            touchRelease();
        });

        it("is ignored entirely while reorder mode is active", async () => {
            const el = await renderItem(makeItem({id: "1"}), {reorderModeActive: true});

            let deleted = false;
            el.addEventListener("tree-delete-item", () => { deleted = true; });

            touchPress(el);
            move(el, -(SWIPE_ACTION_THRESHOLD_PX + 10), 0);
            await el.updateComplete;

            expect(el.shadowRoot?.querySelector(".swipe-action-layer")).toBeNull();

            touchRelease();

            expect(deleted).toBe(false);
        });

        it("never engages for a mouse pointer - mouse has its own hold-then-move drag instead", async () => {
            const el = await renderItem(makeItem({id: "1"}));
            (el.shadowRoot?.querySelector(".row") as HTMLElement).dispatchEvent(
                new PointerEvent("pointerdown", {clientX: 0, clientY: 0, pointerType: "mouse", bubbles: true}),
            );

            const draggable = el as unknown as {onWindowPointerMove: (e: PointerEvent) => void};
            // dragDisabled makes a mouse move fall to the same
            // "cancel-only" branch touch would otherwise reach, without
            // needing a live tree-drag-start to also be asserted here.
            (el as unknown as {dragDisabled: boolean}).dragDisabled = true;
            draggable.onWindowPointerMove(new PointerEvent("pointermove", {clientX: -100, clientY: 0, pointerType: "mouse"}));
            await el.updateComplete;

            expect(el.shadowRoot?.querySelector(".swipe-action-layer")).toBeNull();

            window.dispatchEvent(new PointerEvent("pointerup", {clientX: 0, clientY: 0, pointerType: "mouse"}));
        });

        it("swiping right on a row whose add-child field is already open closes it (toggle, not a second open)", async () => {
            const el = await renderItem(makeItem({id: "1"}), {childQuickAddParentIds: new Set(["1"])});

            let toggleCount = 0;
            el.addEventListener("tree-toggle-child-quick-add", () => { toggleCount += 1; });

            touchPress(el);
            move(el, SWIPE_ACTION_THRESHOLD_PX + 10, 0);
            touchRelease();

            // The list owns actually flipping childQuickAddParentIds
            // (see todo-overlay-list.ts's onToggleChildQuickAdd) - this
            // row only ever dispatches the same toggle event regardless
            // of current state, exactly once per qualifying swipe.
            expect(toggleCount).toBe(1);
        });

        // Live-reported: a page-level swipe-between-tabs add-on (HACS'
        // "Home Assistant Swipe Navigation") still navigated tabs on
        // release even while swiping a row. Confirmed via its own
        // source: it listens for raw touchmove/touchend on an ancestor
        // of every card, in the default BUBBLE phase - a completely
        // separate event stream from the pointermove events this
        // gesture is otherwise built on, so preventDefault() on THOSE
        // was never going to reach it. onWindowTouchTail's window-level
        // CAPTURE-phase listener runs before any such bubble listener
        // ever sees the event at all.
        describe("touch-tail propagation guard (page-level swipe-nav add-ons)", () => {
            // detachWindowListeners' own cleanup of these listeners is
            // deliberately deferred by one real task (see its own
            // comment - a same-gesture touchend can still arrive AFTER
            // pointerup has already been fully handled), so every test
            // here that releases must let that task actually run before
            // either asserting on it OR letting a later test start -
            // otherwise a still-pending previous row's listener (a
            // window-level, capture-phase one - not scoped to its own
            // row at all) can intercept an unrelated later test's own
            // dispatch, exactly the cross-test pollution a synchronous
            // "release then immediately assert" would hit.
            function flushDeferredCleanup(): Promise<void> {
                return new Promise(r => setTimeout(r, 0));
            }

            it("stops a locked-in horizontal swipe's touchmove from reaching a bubble-phase listener higher up the page", async () => {
                const el = await renderItem(makeItem({id: "1"}));
                touchPress(el);
                move(el, -(SWIPE_AXIS_LOCK_PX + 5), 0);
                await el.updateComplete;

                let sawItOnDocument = false;
                const onDocumentTouchMove = () => { sawItOnDocument = true; };
                document.addEventListener("touchmove", onDocumentTouchMove);

                try {
                    document.body.dispatchEvent(new Event("touchmove", {bubbles: true, cancelable: true}));
                    expect(sawItOnDocument).toBe(false);
                } finally {
                    document.removeEventListener("touchmove", onDocumentTouchMove);
                    touchRelease();
                    await flushDeferredCleanup();
                }
            });

            it("still intercepts this SAME gesture's own trailing touchend, even after pointerup has already fully run", async () => {
                // Live-reproduced via real Chrome touch simulation
                // (github.com/zanna-37/hass-swipe-navigation, whose own
                // touchend listener still fired once per real gesture
                // despite swipeAxis already reading "horizontal"
                // throughout) - pointerup and this same gesture's own
                // touchend are two independent events for one physical
                // release. A gate that reads swipeAxis directly (already
                // reset by resolveSwipe, itself called from pointerUp,
                // by the time this fires) would miss this entirely -
                // see touchTailArmed's own comment for why this uses a
                // separate flag instead.
                const el = await renderItem(makeItem({id: "1"}));
                touchPress(el);
                move(el, -(SWIPE_AXIS_LOCK_PX + 5), 0);
                await el.updateComplete;
                touchRelease();

                let sawItOnDocument = false;
                const onDocumentTouchEnd = () => { sawItOnDocument = true; };
                document.addEventListener("touchend", onDocumentTouchEnd);

                try {
                    document.body.dispatchEvent(new Event("touchend", {bubbles: true, cancelable: true}));
                    expect(sawItOnDocument).toBe(false);
                } finally {
                    document.removeEventListener("touchend", onDocumentTouchEnd);
                    await flushDeferredCleanup();
                }
            });

            it("leaves a vertical (non-swipe) touch gesture's touchmove alone - normal scrolling and page-level swipes elsewhere are unaffected", async () => {
                const el = await renderItem(makeItem({id: "1"}));
                touchPress(el);
                move(el, 2, SWIPE_AXIS_LOCK_PX + 20);
                await el.updateComplete;

                let sawItOnDocument = false;
                const onDocumentTouchMove = () => { sawItOnDocument = true; };
                document.addEventListener("touchmove", onDocumentTouchMove);

                try {
                    document.body.dispatchEvent(new Event("touchmove", {bubbles: true, cancelable: true}));
                    expect(sawItOnDocument).toBe(true);
                } finally {
                    document.removeEventListener("touchmove", onDocumentTouchMove);
                    touchRelease();
                    await flushDeferredCleanup();
                }
            });

            it("no longer intercepts touchmove once the gesture's own deferred cleanup has run", async () => {
                const el = await renderItem(makeItem({id: "1"}));
                touchPress(el);
                move(el, -(SWIPE_AXIS_LOCK_PX + 5), 0);
                await el.updateComplete;
                touchRelease();
                await flushDeferredCleanup();

                let sawItOnDocument = false;
                const onDocumentTouchMove = () => { sawItOnDocument = true; };
                document.addEventListener("touchmove", onDocumentTouchMove);

                try {
                    document.body.dispatchEvent(new Event("touchmove", {bubbles: true, cancelable: true}));
                    expect(sawItOnDocument).toBe(true);
                } finally {
                    document.removeEventListener("touchmove", onDocumentTouchMove);
                }
            });
        });
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
        it("shows a delete button on a leaf row while delete-mode is active", async () => {
            const el = await renderItem(makeItem(), {deleteModeActive: true});

            expect(el.shadowRoot?.querySelector(".delete-button")).not.toBeNull();
        });

        it("shows no delete button at all outside delete-mode", async () => {
            const el = await renderItem(makeItem());

            expect(el.shadowRoot?.querySelector(".delete-button")).toBeNull();
        });

        it("does not show a delete button on a parent row, even in delete-mode", async () => {
            const el = await renderItem(
                makeItem({children: [makeItem({id: "2"})]}),
                {deleteModeActive: true},
            );

            expect(el.shadowRoot?.querySelector(".delete-button")).toBeNull();
        });

        it("deletes immediately (one click) when confirmDelete is off", async () => {
            const el = await renderItem(makeItem(), {confirmDelete: false, deleteModeActive: true});

            let detail: {id: string} | undefined;
            el.addEventListener("tree-delete-item", (e) => {
                detail = (e as CustomEvent<{id: string}>).detail;
            });

            (el.shadowRoot?.querySelector(".delete-button") as HTMLElement).click();
            await flushRowCollapse();

            expect(detail).toEqual({id: "1"});
        });

        it("requires a second click to confirm when confirmDelete is on (the default)", async () => {
            const el = await renderItem(makeItem(), {deleteModeActive: true});

            let fired = false;
            el.addEventListener("tree-delete-item", () => { fired = true; });

            const button = el.shadowRoot?.querySelector(".delete-button") as HTMLElement;
            button.click();
            await el.updateComplete;

            expect(fired).toBe(false);
            expect(el.shadowRoot?.querySelector(".delete-button.confirming")).not.toBeNull();

            button.click();
            await flushRowCollapse();

            expect(fired).toBe(true);
        });

        it("disarms the confirm state after the confirm window elapses", async () => {
            vi.useFakeTimers();

            try {
                const el = await renderItem(makeItem(), {deleteModeActive: true});

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

// Live-reported: with the resolved drop target (orange highlight)
// already showing where an item will actually land, the browser's own
// :hover (grey) tracking the literal cursor position at the same time
// read as confusing - especially once hysteresis/gap-correction could
// legitimately make the two differ. Suppressed for the whole row for
// any active drag from this list, not just the row being dragged.
describe("todo-overlay-tree-item :hover suppressed while dragging", () => {
    it("marks every row drag-active once any item in the list is being dragged", async () => {
        const el = await renderItem(makeItem({id: "1"}), {draggedId: "some-other-item"});

        expect(el.shadowRoot?.querySelector(".row")?.classList.contains("drag-active")).toBe(true);
    });

    it("is not drag-active when nothing is being dragged", async () => {
        const el = await renderItem(makeItem({id: "1"}));

        expect(el.shadowRoot?.querySelector(".row")?.classList.contains("drag-active")).toBe(false);
    });
});

// Feature: every parent row gets its own "+" to quick-add a child
// directly under it, rather than only being able to add root-level
// items from the toolbar. Fills the exact slot the delete button
// leaves empty for a parent (see hasChildren in the template) - a leaf
// row is unaffected.
describe("todo-overlay-tree-item per-parent quick add", () => {
    it("shows the add-child toggle on a parent row while add-mode is active", async () => {
        const el = await renderItem(
            makeItem({id: "parent", children: [makeItem({id: "child"})]}),
            {addModeActive: true},
        );

        expect(el.shadowRoot?.querySelector(".child-quick-add-toggle")).not.toBeNull();
        expect(el.shadowRoot?.querySelector(".delete-button")).toBeNull();
    });

    it("shows the add-child toggle on a LEAF row too, while add-mode is active - not just existing parents", async () => {
        const el = await renderItem(makeItem({id: "leaf", children: []}), {addModeActive: true});

        expect(el.shadowRoot?.querySelector(".child-quick-add-toggle")).not.toBeNull();
    });

    it("shows no add-child toggle at all outside add-mode, on a leaf or a parent", async () => {
        const leaf = await renderItem(makeItem({id: "leaf", children: []}));
        const parent = await renderItem(makeItem({id: "parent", children: [makeItem({id: "child"})]}));

        expect(leaf.shadowRoot?.querySelector(".child-quick-add-toggle")).toBeNull();
        expect(parent.shadowRoot?.querySelector(".child-quick-add-toggle")).toBeNull();
    });

    it("dispatches tree-toggle-child-quick-add with this item's id when the toggle is clicked", async () => {
        const el = await renderItem(
            makeItem({id: "parent", children: [makeItem({id: "child"})]}),
            {addModeActive: true},
        );

        let detail: {id: string} | undefined;
        el.addEventListener("tree-toggle-child-quick-add", (e) => {
            detail = (e as CustomEvent<{id: string}>).detail;
        });

        (el.shadowRoot?.querySelector(".child-quick-add-toggle") as HTMLElement).click();

        expect(detail).toEqual({id: "parent"});
    });

    it("shows the inline quick-add field, indented, directly below the row and above its children, once open", async () => {
        const el = await renderItem(
            makeItem({id: "parent", children: [makeItem({id: "child", title: "Child"})]}),
            {addModeActive: true, childQuickAddParentIds: new Set(["parent"])},
        );

        const toggle = el.shadowRoot?.querySelector(".child-quick-add-toggle");
        expect(toggle?.classList.contains("active"), "toggle should read as active/open").toBe(true);

        const field = el.shadowRoot?.querySelector(".child-quick-add-row");
        expect(field, "the inline quick-add field should be visible").not.toBeNull();

        // "Directly below the row and above its children" - the field
        // and the <ul> of children are siblings in the light DOM, in
        // that order.
        const li = el.shadowRoot?.querySelector("li");
        const children = [...(li?.children ?? [])];
        const fieldIndex = children.findIndex(c => c.classList.contains("child-quick-add-row"));
        const ulIndex = children.findIndex(c => c.tagName === "UL");
        expect(fieldIndex).toBeGreaterThan(-1);
        expect(ulIndex).toBeGreaterThan(fieldIndex);
    });

    it("submits the typed title via tree-quick-add-child on Enter, then clears the field", async () => {
        const el = await renderItem(
            makeItem({id: "parent", children: [makeItem({id: "child"})]}),
            {childQuickAddParentIds: new Set(["parent"])},
        );

        let detail: {parentId: string; title: string} | undefined;
        el.addEventListener("tree-quick-add-child", (e) => {
            detail = (e as CustomEvent<{parentId: string; title: string}>).detail;
        });

        const input = el.shadowRoot?.querySelector(".child-quick-add-row input") as HTMLInputElement;
        input.value = "VPN";
        input.dispatchEvent(new Event("input"));
        input.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter"}));
        await el.updateComplete;

        expect(detail).toEqual({parentId: "parent", title: "VPN"});
        // Reads the component's own internal state, not the DOM value -
        // Lit's dirty-checking compares against what IT last committed,
        // which this test's own manual `input.value = "VPN"` line never
        // went through, so re-querying the raw DOM value here would be
        // checking Lit's (inapplicable) bookkeeping, not this component's
        // actual behavior.
        expect((el as unknown as {childQuickAddValue: string}).childQuickAddValue).toBe("");
    });

    it("submits via the Add button too", async () => {
        const el = await renderItem(
            makeItem({id: "parent", children: [makeItem({id: "child"})]}),
            {childQuickAddParentIds: new Set(["parent"])},
        );

        let detail: {parentId: string; title: string} | undefined;
        el.addEventListener("tree-quick-add-child", (e) => {
            detail = (e as CustomEvent<{parentId: string; title: string}>).detail;
        });

        const input = el.shadowRoot?.querySelector(".child-quick-add-row input") as HTMLInputElement;
        input.value = "VPN";
        input.dispatchEvent(new Event("input"));

        const addButton = [...(el.shadowRoot?.querySelectorAll(".child-quick-add-row button") ?? [])]
            .find(b => b.textContent?.trim() === "Add") as HTMLButtonElement;
        addButton.click();

        expect(detail).toEqual({parentId: "parent", title: "VPN"});
    });

    it("does not submit a blank or whitespace-only title", async () => {
        const el = await renderItem(
            makeItem({id: "parent", children: [makeItem({id: "child"})]}),
            {childQuickAddParentIds: new Set(["parent"])},
        );

        let fired = false;
        el.addEventListener("tree-quick-add-child", () => { fired = true; });

        const input = el.shadowRoot?.querySelector(".child-quick-add-row input") as HTMLInputElement;
        input.value = "   ";
        input.dispatchEvent(new Event("input"));
        input.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter"}));

        expect(fired).toBe(false);
    });

    it("reorder mode wins over add-mode for the trailing icon slot, even if both were somehow true at once", async () => {
        const el = await renderItem(
            makeItem({id: "parent", children: [makeItem({id: "child"})]}),
            {reorderModeActive: true, addModeActive: true},
        );

        expect(el.shadowRoot?.querySelector(".child-quick-add-toggle")).toBeNull();
        expect(el.shadowRoot?.querySelector(".drag-handle")).not.toBeNull();
    });
});
