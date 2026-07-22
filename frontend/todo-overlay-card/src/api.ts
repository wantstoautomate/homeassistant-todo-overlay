import type { HassLike } from "./hass";
import type { TodoList } from "./models";

export async function getList(
    hass: HassLike,
    entityId: string,
): Promise<TodoList> {

    return await hass.connection.sendMessagePromise<TodoList>({
        type: "todo_overlay/get_list",
        entity_id: entityId,
    });

}

export async function setParent(
    hass: HassLike,
    entityId: string,
    childId: string,
    parentId: string | null,
): Promise<void> {

    await hass.connection.sendMessagePromise<void>({
        type: "todo_overlay/set_parent",
        entity_id: entityId,
        child_id: childId,
        parent_id: parentId,
    });

}
