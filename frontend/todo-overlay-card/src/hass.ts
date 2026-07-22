export interface HassLike {
    connection: {
        sendMessagePromise<T>(message: Record<string, unknown>): Promise<T>;
    };
    callService(
        domain: string,
        service: string,
        serviceData?: Record<string, unknown>,
    ): Promise<unknown>;
}
