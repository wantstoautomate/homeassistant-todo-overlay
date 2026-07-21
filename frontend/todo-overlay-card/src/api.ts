import type { TodoList } from "./models";

export async function getList(
    hass: any,
    entityId: string,
): Promise<TodoList> {

    return await hass.connection.sendMessagePromise({
        type: "todo_overlay/get_list",
        entity_id: entityId,
    });

}

export async function setParent(
    hass: any,
    entityId: string,
    childId: string,
    parentId: string | null,
): Promise<void> {

    await hass.connection.sendMessagePromise({
        type: "todo_overlay/set_parent",
        entity_id: entityId,
        child_id: childId,
        parent_id: parentId,
    });

}
