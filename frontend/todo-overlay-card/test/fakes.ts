import type {HassLike} from "../src/hass";

// Records every websocket message sent, and can be pre-loaded with canned
// responses per message "type" - mirrors the backend's tests/fakes.py
// approach of hand-rolled fakes rather than a full framework.
export class FakeConnection {
    sent: Record<string, unknown>[] = [];
    responses: Record<string, unknown> = {};

    async sendMessagePromise<T>(message: Record<string, unknown>): Promise<T> {
        this.sent.push(message);

        const type = message.type as string;

        if (type in this.responses) {
            return this.responses[type] as T;
        }

        return undefined as T;
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
