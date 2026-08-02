export interface HassLike {
    connection: {
        sendMessagePromise<T>(message: Record<string, unknown>): Promise<T>;
        // Real HA event data always has these two fields at minimum, plus
        // whatever action-specific extras the event carries (see
        // todo-overlay-list.ts's own use of this for EVENT_ITEM_CHANGED).
        subscribeEvents<T extends {entity_id: string; action: string}>(
            callback: (event: {data: T}) => void,
            eventType: string,
        ): Promise<() => void>;
    };
    callService(
        domain: string,
        service: string,
        serviceData?: Record<string, unknown>,
    ): Promise<unknown>;
    states: Record<string, {
        state: string;
        last_updated: string;
        attributes: Record<string, unknown>;
    }>;
}
