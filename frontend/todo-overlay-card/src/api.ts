import type { HassLike } from "./hass";
import type { LoadMode, PinType, Placement, TodoList } from "./models";

export async function getList(
    hass: HassLike,
    entityId: string,
    groupCompleted: boolean,
): Promise<TodoList> {

    return await hass.connection.sendMessagePromise<TodoList>({
        type: "todo_overlay/get_list",
        entity_id: entityId,
        group_completed: groupCompleted,
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

export async function transferItem(
    hass: HassLike,
    sourceEntityId: string,
    itemId: string,
    targetEntityId: string,
    // Undefined when the target entity has no items at all to position
    // relative to (dragging into a wholly empty list) - omitted from the
    // message entirely in that case, matching the websocket schema's
    // vol.Optional("reference_id").
    referenceId: string | undefined,
    placement: Placement,
): Promise<string> {

    const result = await hass.connection.sendMessagePromise<{id: string}>({
        type: "todo_overlay/transfer_item",
        source_entity_id: sourceEntityId,
        item_id: itemId,
        target_entity_id: targetEntityId,
        reference_id: referenceId,
        placement,
    });

    return result.id;

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
    reposition: boolean,
): Promise<CompletionChange[]> {

    const result = await hass.connection.sendMessagePromise<{changed: CompletionChange[]}>({
        type: "todo_overlay/set_completed",
        entity_id: entityId,
        item_id: itemId,
        completed,
        reposition,
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
    triggerOnDue?: boolean;
    // Positions the new item relative to an existing one (same
    // before/after/inside semantics as moveItem) instead of wherever
    // the native adapter's own add_item happens to put it - used by
    // the per-parent quick add to insert directly below a specific
    // parent's own row, above its existing children.
    referenceId?: string;
    placement?: Placement;
    pinType?: PinType;
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
        trigger_on_due: fields.triggerOnDue,
        reference_id: fields.referenceId,
        placement: fields.placement,
        pin_type: fields.pinType,
    });

    return result.id;

}

export interface UpdateItemFields {
    title?: string;
    description?: string;
    dueDate?: string;
    dueDatetime?: string;
}

export async function updateItem(
    hass: HassLike,
    entityId: string,
    itemId: string,
    fields: UpdateItemFields,
): Promise<void> {

    await hass.connection.sendMessagePromise<void>({
        type: "todo_overlay/update_item",
        entity_id: entityId,
        item_id: itemId,
        title: fields.title,
        description: fields.description,
        due_date: fields.dueDate,
        due_datetime: fields.dueDatetime,
    });

}

export async function deleteItem(
    hass: HassLike,
    entityId: string,
    itemId: string,
): Promise<void> {

    await hass.connection.sendMessagePromise<void>({
        type: "todo_overlay/delete_item",
        entity_id: entityId,
        item_id: itemId,
    });

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

export async function setTriggerOnDue(
    hass: HassLike,
    entityId: string,
    itemId: string,
    enabled: boolean,
): Promise<void> {

    await hass.connection.sendMessagePromise<void>({
        type: "todo_overlay/set_trigger_on_due",
        entity_id: entityId,
        item_id: itemId,
        enabled,
    });

}

export async function setPinType(
    hass: HassLike,
    entityId: string,
    itemId: string,
    pinType: PinType | undefined,
): Promise<void> {

    await hass.connection.sendMessagePromise<void>({
        type: "todo_overlay/set_pin_type",
        entity_id: entityId,
        item_id: itemId,
        pin_type: pinType,
    });

}

// entityId/itemId are the SOURCE item being linked - targetParentId
// (uid or title, same convention as every other "item" field) is the
// one thing the item dialog's own override control ever chooses; the
// target LIST itself is always auto-resolved server-side (see
// item_links.py's own link_item), never picked here.
export async function linkItem(
    hass: HassLike,
    entityId: string,
    itemId: string,
    targetParentId: string | undefined,
): Promise<void> {

    await hass.connection.sendMessagePromise<{id: string}>({
        type: "todo_overlay/link_item",
        entity_id: entityId,
        item_id: itemId,
        target_parent_id: targetParentId,
    });

}

export async function unlinkItem(
    hass: HassLike,
    entityId: string,
    itemId: string,
): Promise<void> {

    await hass.connection.sendMessagePromise<void>({
        type: "todo_overlay/unlink_item",
        entity_id: entityId,
        item_id: itemId,
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

export async function clearAll(
    hass: HassLike,
    entityId: string,
): Promise<string[]> {

    const result = await hass.connection.sendMessagePromise<{removed: string[]}>({
        type: "todo_overlay/clear_all",
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
    targetItem?: string,
): Promise<void> {

    await hass.connection.sendMessagePromise<void>({
        type: "todo_overlay/load_list",
        entity_id: entityId,
        name,
        mode,
        target_item: targetItem,
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
