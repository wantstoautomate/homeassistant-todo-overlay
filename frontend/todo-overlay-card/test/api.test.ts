import {describe, expect, it} from "vitest";

import {
    clearCompleted,
    createItem,
    deleteSavedList,
    getList,
    linkItem,
    listSaved,
    loadList,
    moveItem,
    restoreCompleted,
    saveList,
    setCompleted,
    setPinType,
    setQuantity,
    setTags,
    setTriggerOnDue,
    transferItem,
    unlinkItem,
} from "../src/api";
import {makeFakeHass} from "./fakes";

describe("api", () => {
    it("getList sends entity_id and group_completed", async () => {
        const hass = makeFakeHass();
        hass.connection.responses["todo_overlay/get_list"] = {entity_id: "todo.a", items: []};

        const result = await getList(hass, "todo.a", true);

        expect(hass.connection.sent).toEqual([
            {type: "todo_overlay/get_list", entity_id: "todo.a", group_completed: true},
        ]);
        expect(result).toEqual({entity_id: "todo.a", items: []});
    });

    it("moveItem sends child/reference/placement", async () => {
        const hass = makeFakeHass();

        await moveItem(hass, "todo.a", "child-1", "ref-1", "inside");

        expect(hass.connection.sent).toEqual([{
            type: "todo_overlay/move_item",
            entity_id: "todo.a",
            child_id: "child-1",
            reference_id: "ref-1",
            placement: "inside",
        }]);
    });

    it("transferItem sends source/target entity ids and returns the new id", async () => {
        const hass = makeFakeHass();
        hass.connection.responses["todo_overlay/transfer_item"] = {id: "new-1"};

        const result = await transferItem(hass, "todo.a", "child-1", "todo.b", "ref-1", "after");

        expect(hass.connection.sent).toEqual([{
            type: "todo_overlay/transfer_item",
            source_entity_id: "todo.a",
            item_id: "child-1",
            target_entity_id: "todo.b",
            reference_id: "ref-1",
            placement: "after",
        }]);
        expect(result).toBe("new-1");
    });

    it("setCompleted sends reposition and returns the changed list", async () => {
        const hass = makeFakeHass();
        hass.connection.responses["todo_overlay/set_completed"] = {
            changed: [{id: "1", completed: false}],
        };

        const result = await setCompleted(hass, "todo.a", "1", true, false);

        expect(hass.connection.sent).toEqual([{
            type: "todo_overlay/set_completed",
            entity_id: "todo.a",
            item_id: "1",
            completed: true,
            reposition: false,
        }]);
        expect(result).toEqual([{id: "1", completed: false}]);
    });

    it("restoreCompleted sends the changes list", async () => {
        const hass = makeFakeHass();
        const changes = [{id: "1", completed: true}];

        await restoreCompleted(hass, "todo.a", changes);

        expect(hass.connection.sent).toEqual([{
            type: "todo_overlay/restore_completed", entity_id: "todo.a", changes,
        }]);
    });

    it("createItem maps camelCase fields to the snake_case wire format and returns the new id", async () => {
        const hass = makeFakeHass();
        hass.connection.responses["todo_overlay/create_item"] = {id: "new-1"};

        const result = await createItem(hass, "todo.a", {
            title: "Salami",
            description: "deli meat",
            dueDate: "2026-01-01",
            dueDatetime: "2026-01-01T09:00:00",
            quantity: "150g",
            tags: ["urgent"],
            triggerOnDue: true,
        });

        expect(hass.connection.sent).toEqual([{
            type: "todo_overlay/create_item",
            entity_id: "todo.a",
            title: "Salami",
            description: "deli meat",
            due_date: "2026-01-01",
            due_datetime: "2026-01-01T09:00:00",
            quantity: "150g",
            tags: ["urgent"],
            trigger_on_due: true,
        }]);
        expect(result).toBe("new-1");
    });

    it("setQuantity sends item_id and quantity", async () => {
        const hass = makeFakeHass();

        await setQuantity(hass, "todo.a", "1", "2kg");

        expect(hass.connection.sent).toEqual([{
            type: "todo_overlay/set_quantity", entity_id: "todo.a", item_id: "1", quantity: "2kg",
        }]);
    });

    it("setPinType sends item_id and pin_type", async () => {
        const hass = makeFakeHass();

        await setPinType(hass, "todo.a", "1", "person");

        expect(hass.connection.sent).toEqual([{
            type: "todo_overlay/set_pin_type", entity_id: "todo.a", item_id: "1", pin_type: "person",
        }]);
    });

    it("setPinType sends undefined pin_type to clear it", async () => {
        const hass = makeFakeHass();

        await setPinType(hass, "todo.a", "1", undefined);

        expect(hass.connection.sent).toEqual([{
            type: "todo_overlay/set_pin_type", entity_id: "todo.a", item_id: "1", pin_type: undefined,
        }]);
    });

    it("linkItem sends item_id and the target_parent_id override", async () => {
        const hass = makeFakeHass();

        await linkItem(hass, "todo.a", "1", "Brodie");

        expect(hass.connection.sent).toEqual([{
            type: "todo_overlay/link_item", entity_id: "todo.a", item_id: "1", target_parent_id: "Brodie",
        }]);
    });

    it("linkItem sends undefined target_parent_id to use the configured default", async () => {
        const hass = makeFakeHass();

        await linkItem(hass, "todo.a", "1", undefined);

        expect(hass.connection.sent).toEqual([{
            type: "todo_overlay/link_item", entity_id: "todo.a", item_id: "1", target_parent_id: undefined,
        }]);
    });

    it("unlinkItem sends entity_id and item_id", async () => {
        const hass = makeFakeHass();

        await unlinkItem(hass, "todo.a", "1");

        expect(hass.connection.sent).toEqual([{
            type: "todo_overlay/unlink_item", entity_id: "todo.a", item_id: "1",
        }]);
    });

    it("setTriggerOnDue sends item_id and enabled", async () => {
        const hass = makeFakeHass();

        await setTriggerOnDue(hass, "todo.a", "1", true);

        expect(hass.connection.sent).toEqual([{
            type: "todo_overlay/set_trigger_on_due", entity_id: "todo.a", item_id: "1", enabled: true,
        }]);
    });

    it("setTags sends the full replacement tag list", async () => {
        const hass = makeFakeHass();

        await setTags(hass, "todo.a", "1", ["a", "b"]);

        expect(hass.connection.sent).toEqual([{
            type: "todo_overlay/set_tags", entity_id: "todo.a", item_id: "1", tags: ["a", "b"],
        }]);
    });

    it("clearCompleted returns the removed id list", async () => {
        const hass = makeFakeHass();
        hass.connection.responses["todo_overlay/clear_completed"] = {removed: ["1", "2"]};

        const result = await clearCompleted(hass, "todo.a");

        expect(hass.connection.sent).toEqual([{type: "todo_overlay/clear_completed", entity_id: "todo.a"}]);
        expect(result).toEqual(["1", "2"]);
    });

    it("saveList sends persist_states", async () => {
        const hass = makeFakeHass();

        await saveList(hass, "todo.a", "template", true);

        expect(hass.connection.sent).toEqual([{
            type: "todo_overlay/save_list", entity_id: "todo.a", name: "template", persist_states: true,
        }]);
    });

    it("loadList sends the load mode", async () => {
        const hass = makeFakeHass();

        await loadList(hass, "todo.a", "template", "full_merge");

        expect(hass.connection.sent).toEqual([{
            type: "todo_overlay/load_list", entity_id: "todo.a", name: "template", mode: "full_merge",
        }]);
    });

    it("loadList sends target_item when given - loads the snapshot as that item's children", async () => {
        const hass = makeFakeHass();

        await loadList(hass, "todo.a", "template", "merge", "parent-1");

        expect(hass.connection.sent).toEqual([{
            type: "todo_overlay/load_list", entity_id: "todo.a", name: "template", mode: "merge",
            target_item: "parent-1",
        }]);
    });

    it("listSaved returns the saved names", async () => {
        const hass = makeFakeHass();
        hass.connection.responses["todo_overlay/list_saved"] = {names: ["a", "b"]};

        const result = await listSaved(hass);

        expect(hass.connection.sent).toEqual([{type: "todo_overlay/list_saved"}]);
        expect(result).toEqual(["a", "b"]);
    });

    it("deleteSavedList sends the name", async () => {
        const hass = makeFakeHass();

        await deleteSavedList(hass, "template");

        expect(hass.connection.sent).toEqual([{type: "todo_overlay/delete_saved_list", name: "template"}]);
    });
});
