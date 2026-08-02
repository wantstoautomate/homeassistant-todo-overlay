import type {HassLike} from "../src/hass";

// Records every websocket message sent, and can be pre-loaded with canned
// responses per message "type" - mirrors the backend's tests/fakes.py
// approach of hand-rolled fakes rather than a full framework.
export class FakeConnection {
    sent: Record<string, unknown>[] = [];
    responses: Record<string, unknown> = {};
    errors: Record<string, Error> = {};
    // eventType -> every callback subscribeEvents() was given for it, so
    // a test can drive one by calling fireEvent() below.
    eventSubscriptions: Record<string, ((event: {data: unknown}) => void)[]> = {};

    async sendMessagePromise<T>(message: Record<string, unknown>): Promise<T> {
        this.sent.push(message);

        const type = message.type as string;

        if (type in this.errors) {
            throw this.errors[type];
        }

        if (type in this.responses) {
            return this.responses[type] as T;
        }

        return undefined as T;
    }

    async subscribeEvents<T>(callback: (event: {data: T}) => void, eventType: string): Promise<() => void> {
        const callbacks = this.eventSubscriptions[eventType] ??= [];
        callbacks.push(callback as (event: {data: unknown}) => void);

        return () => {
            const index = callbacks.indexOf(callback as (event: {data: unknown}) => void);
            if (index !== -1) {
                callbacks.splice(index, 1);
            }
        };
    }

    fireEvent(eventType: string, data: unknown): void {
        for (const callback of this.eventSubscriptions[eventType] ?? []) {
            callback({data});
        }
    }
}

export interface FakeHass extends HassLike {
    connection: FakeConnection;
    serviceCalls: {domain: string; service: string; data?: Record<string, unknown>}[];
}

export function makeFakeHass(states: HassLike["states"] = {}): FakeHass {
    const connection = new FakeConnection();
    const serviceCalls: FakeHass["serviceCalls"] = [];

    return {
        connection,
        callService: async (domain: string, service: string, serviceData?: Record<string, unknown>) => {
            serviceCalls.push({domain, service, data: serviceData});
        },
        states,
        serviceCalls,
    };
}
