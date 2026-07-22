import type { HassLike } from "./hass";
import type { Placement, TodoList } from "./models";

export async function getList(
    hass: HassLike,
    entityId: string,
): Promise<TodoList> {

    return await hass.connection.sendMessagePromise<TodoList>({
        type: "todo_overlay/get_list",
        entity_id: entityId,
    });

}

export async function moveItem(
    hass: HassLike,
    entityId: string,
    childId: string,
    referenceId: string,
    placement: Placement,
): Promise<void> {

    await hass.connection.sendMessagePromise<void>({
        type: "todo_overlay/move_item",
        entity_id: entityId,
        child_id: childId,
        reference_id: referenceId,
        placement,
    });

}

export interface CompletionChange {
    id: string;
    completed: boolean;
}

export async function setCompleted(
    hass: HassLike,
    entityId: string,
    itemId: string,
    completed: boolean,
): Promise<CompletionChange[]> {

    const result = await hass.connection.sendMessagePromise<{changed: CompletionChange[]}>({
        type: "todo_overlay/set_completed",
        entity_id: entityId,
        item_id: itemId,
        completed,
    });

    return result.changed;

}

export async function restoreCompleted(
    hass: HassLike,
    entityId: string,
    changes: CompletionChange[],
): Promise<void> {

    await hass.connection.sendMessagePromise<void>({
        type: "todo_overlay/restore_completed",
        entity_id: entityId,
        changes,
    });

}

export async function clearCompleted(
    hass: HassLike,
    entityId: string,
): Promise<string[]> {

    const result = await hass.connection.sendMessagePromise<{removed: string[]}>({
        type: "todo_overlay/clear_completed",
        entity_id: entityId,
    });

    return result.removed;

}
