import {afterEach, describe, expect, it} from "vitest";

import "../src/todo-overlay";
import type {TodoOverlayCard, TodoOverlayCardConfig} from "../src/todo-overlay";
import {makeFakeHass} from "./fakes";

afterEach(() => {
    document.body.innerHTML = "";
});

describe("todo-overlay-card setConfig", () => {
    it("throws when neither entity nor entities is set", () => {
        const el = document.createElement("todo-overlay-card") as TodoOverlayCard;

        expect(() => el.setConfig({} as TodoOverlayCardConfig)).toThrow();
    });

    it("accepts a single entity", () => {
        const el = document.createElement("todo-overlay-card") as TodoOverlayCard;

        expect(() => el.setConfig({entity: "todo.shopping"})).not.toThrow();
    });

    it("accepts an entities list without a singular entity", () => {
        const el = document.createElement("todo-overlay-card") as TodoOverlayCard;

        expect(() => el.setConfig({entities: ["todo.a", "todo.b"]})).not.toThrow();
    });

    it("rejects an empty entities list with no entity fallback", () => {
        const el = document.createElement("todo-overlay-card") as TodoOverlayCard;

        expect(() => el.setConfig({entities: []})).toThrow();
    });
});

describe("todo-overlay-card getStubConfig", () => {
    const TodoOverlayCardCtor = customElements.get("todo-overlay-card") as typeof TodoOverlayCard;

    it("picks the first todo.* entity from hass.states when nothing else is provided", () => {
        const hass = makeFakeHass({
            "light.kitchen": {state: "on", last_updated: "", attributes: {}},
            "todo.shopping": {state: "0", last_updated: "", attributes: {}},
        });

        expect(TodoOverlayCardCtor.getStubConfig(hass)).toEqual({entity: "todo.shopping"});
    });

    it("prefers an explicitly passed candidate entity list over scanning hass.states", () => {
        const hass = makeFakeHass({"todo.other": {state: "0", last_updated: "", attributes: {}}});

        expect(TodoOverlayCardCtor.getStubConfig(hass, ["todo.preferred"])).toEqual({entity: "todo.preferred"});
    });

    it("falls back to an empty entity when nothing todo-like is available", () => {
        expect(TodoOverlayCardCtor.getStubConfig(undefined, [], [])).toEqual({entity: ""});
    });
});

describe("todo-overlay-card rendering", () => {
    it("renders a single todo-overlay-list for single-entity mode with the default header", async () => {
        const el = document.createElement("todo-overlay-card") as TodoOverlayCard;
        el.hass = makeFakeHass();
        el.setConfig({entity: "todo.shopping"});

        document.body.appendChild(el);
        await el.updateComplete;

        const card = el.shadowRoot?.querySelector("ha-card");
        expect(card?.getAttribute("header")).toBe("Todo Overlay");
        expect(el.shadowRoot?.querySelectorAll("todo-overlay-list")).toHaveLength(1);
        expect(el.shadowRoot?.querySelector(".entity-header")).toBeNull();
    });

    it("renders one section with a friendly-name heading per entity in multi-entity mode", async () => {
        const el = document.createElement("todo-overlay-card") as TodoOverlayCard;
        el.hass = makeFakeHass({
            "todo.shopping": {state: "0", last_updated: "", attributes: {friendly_name: "Shopping"}},
            "todo.travel": {state: "0", last_updated: "", attributes: {friendly_name: "Travel"}},
        });
        el.setConfig({entities: ["todo.shopping", "todo.travel"]});

        document.body.appendChild(el);
        await el.updateComplete;

        expect(el.shadowRoot?.querySelectorAll("todo-overlay-list")).toHaveLength(2);
        const headers = [...(el.shadowRoot?.querySelectorAll(".entity-header") ?? [])];
        expect(headers.map(h => h.textContent)).toEqual(["Shopping", "Travel"]);
    });

    it("defaults hideCompleteForParents to true when unset", async () => {
        const el = document.createElement("todo-overlay-card") as TodoOverlayCard;
        el.hass = makeFakeHass();
        el.setConfig({entity: "todo.shopping"});

        document.body.appendChild(el);
        await el.updateComplete;

        const list = el.shadowRoot?.querySelector("todo-overlay-list") as HTMLElement & {
            hideCompleteForParents: boolean;
        };
        expect(list.hideCompleteForParents).toBe(true);
    });

    it("passes through an explicit hide_complete_for_parents: false", async () => {
        const el = document.createElement("todo-overlay-card") as TodoOverlayCard;
        el.hass = makeFakeHass();
        el.setConfig({entity: "todo.shopping", hide_complete_for_parents: false});

        document.body.appendChild(el);
        await el.updateComplete;

        const list = el.shadowRoot?.querySelector("todo-overlay-list") as HTMLElement & {
            hideCompleteForParents: boolean;
        };
        expect(list.hideCompleteForParents).toBe(false);
    });
});
