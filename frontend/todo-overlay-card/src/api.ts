import type { HassLike } from "./hass";
import type { LoadMode, Placement, TodoList } from "./models";

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

export interface CreateItemFields {
    title: string;
    description?: string;
    dueDate?: string;
    dueDatetime?: string;
    quantity?: string;
    tags?: string[];
}

export async function createItem(
    hass: HassLike,
    entityId: string,
    fields: CreateItemFields,
): Promise<string> {

    const result = await hass.connection.sendMessagePromise<{id: string}>({
        type: "todo_overlay/create_item",
        entity_id: entityId,
        title: fields.title,
        description: fields.description,
        due_date: fields.dueDate,
        due_datetime: fields.dueDatetime,
        quantity: fields.quantity,
        tags: fields.tags,
    });

    return result.id;

}

export async function setQuantity(
    hass: HassLike,
    entityId: string,
    itemId: string,
    quantity: string | undefined,
): Promise<void> {

    await hass.connection.sendMessagePromise<void>({
        type: "todo_overlay/set_quantity",
        entity_id: entityId,
        item_id: itemId,
        quantity,
    });

}

export async function setTags(
    hass: HassLike,
    entityId: string,
    itemId: string,
    tags: string[],
): Promise<void> {

    await hass.connection.sendMessagePromise<void>({
        type: "todo_overlay/set_tags",
        entity_id: entityId,
        item_id: itemId,
        tags,
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

export async function saveList(
    hass: HassLike,
    entityId: string,
    name: string,
    persistStates: boolean,
): Promise<void> {

    await hass.connection.sendMessagePromise<void>({
        type: "todo_overlay/save_list",
        entity_id: entityId,
        name,
        persist_states: persistStates,
    });

}

export async function loadList(
    hass: HassLike,
    entityId: string,
    name: string,
    mode: LoadMode,
): Promise<void> {

    await hass.connection.sendMessagePromise<void>({
        type: "todo_overlay/load_list",
        entity_id: entityId,
        name,
        mode,
    });

}

export async function listSaved(
    hass: HassLike,
): Promise<string[]> {

    const result = await hass.connection.sendMessagePromise<{names: string[]}>({
        type: "todo_overlay/list_saved",
    });

    return result.names;

}

export async function deleteSavedList(
    hass: HassLike,
    name: string,
): Promise<void> {

    await hass.connection.sendMessagePromise<void>({
        type: "todo_overlay/delete_saved_list",
        name,
    });

}
