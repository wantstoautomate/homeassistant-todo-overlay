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

        // The title isn't ha-card's own header slot in single-entity mode -
        // it's handed to todo-overlay-list so the title and the +/icons
        // toolbar can share one row (see todo-overlay-list.ts's
        // list-header-row). ha-card itself gets no header at all here.
        const card = el.shadowRoot?.querySelector("ha-card");
        expect(card?.getAttribute("header")).toBeNull();
        const lists = el.shadowRoot?.querySelectorAll("todo-overlay-list");
        expect(lists).toHaveLength(1);
        expect((lists?.[0] as HTMLElement & {headerTitle?: string}).headerTitle).toBe("Todo Overlay");
    });

    it("passes each entity's friendly name as headerTitle in multi-entity mode", async () => {
        const el = document.createElement("todo-overlay-card") as TodoOverlayCard;
        el.hass = makeFakeHass({
            "todo.shopping": {state: "0", last_updated: "", attributes: {friendly_name: "Shopping"}},
            "todo.travel": {state: "0", last_updated: "", attributes: {friendly_name: "Travel"}},
        });
        el.setConfig({entities: ["todo.shopping", "todo.travel"]});

        document.body.appendChild(el);
        await el.updateComplete;

        const lists = [...(el.shadowRoot?.querySelectorAll("todo-overlay-list") ?? [])] as (HTMLElement & {
            headerTitle?: string;
        })[];
        expect(lists.map(l => l.headerTitle)).toEqual(["Shopping", "Travel"]);
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
