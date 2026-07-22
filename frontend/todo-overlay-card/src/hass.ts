export interface HassLike {
    connection: {
        sendMessagePromise<T>(message: Record<string, unknown>): Promise<T>;
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
