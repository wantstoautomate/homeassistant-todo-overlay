// Collapse/expand state is a per-entity display preference, persisted so
// it survives a page reload - particularly common on a phone browser,
// where a flaky connection reloading the whole dashboard used to reset
// every group back to expanded. Keyed by entity id so a multi-entity
// card's sections don't share (or clobber) each other's collapse state.
const STORAGE_KEY_PREFIX = "todo-overlay-card:collapsed:";

// Purely a display preference, not data - if localStorage is unavailable
// (private browsing, quota exceeded) or holds something unexpected,
// falling back to "nothing collapsed" is always a safe, harmless default
// rather than something worth surfacing as an error.
export function loadCollapsedIds(entityId: string): Set<string> {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY_PREFIX + entityId);

        if (!raw) {
            return new Set();
        }

        const parsed: unknown = JSON.parse(raw);

        return Array.isArray(parsed)
            ? new Set(parsed.filter((id): id is string => typeof id === "string"))
            : new Set();
    } catch {
        return new Set();
    }
}

export function saveCollapsedIds(entityId: string, collapsedIds: Set<string>): void {
    try {
        window.localStorage.setItem(STORAGE_KEY_PREFIX + entityId, JSON.stringify([...collapsedIds]));
    } catch {
        // Best-effort only - a write failure just means this toggle
        // won't survive a reload, not something to interrupt the user over.
    }
}
