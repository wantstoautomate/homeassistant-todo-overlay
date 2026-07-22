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
