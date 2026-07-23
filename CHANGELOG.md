# Changelog

All notable changes to this project are documented here. Versions follow the
integration's `manifest.json`/card's `package.json` (kept in lockstep).

## 0.12.0

Follow-up hardening pass after a four-persona review (HA engineer, the
author, "the wife", and a feature-hungry user): fixes real bugs the
review surfaced, plus the structural/UX cleanup that came out of it.

- Fixed a real bug: dragging an item onto a row belonging to a
  *different* todo.* entity (a separate card, or another section of a
  multi-entity card) previously either threw a raw Python error or
  silently wrote an invalid parent id. It now genuinely transfers the
  item - and its whole subtree, with all overlay metadata (quantity,
  tags, trigger_on_due) - onto the target entity, removing it from the
  source only once the copy has fully landed.
- Fixed the checkbox being visually clipped on the left edge - an
  earlier alignment fix accidentally cropped the real checkbox glyph,
  not just its invisible touch-target padding.
- Parent rows (ones with children) now render their title in bold, so
  they're visually distinguishable from leaf/child rows regardless of
  whether their own checkbox is hidden.
- Frontend errors now show a plain, friendly message instead of a raw
  backend exception - the actual detail still goes to the browser
  console for anyone debugging.
- Fixed a stale `trigger_on_due` cleanup bug: clearing N stale flags in
  one reconciliation pass used to re-enter the whole reconciliation
  process N times (once per stale item); it's now a single pass.
- Migrated from an unnamespaced `hass.data` dict to `entry.runtime_data`,
  the modern Home Assistant convention.
- Split the 1300+ line `manager.py` into one module per responsibility
  (tree reading, item/tag/quantity edits, due triggers, positioning and
  cross-entity transfer, completion, save/load snapshots) composed via
  mixins on a much smaller `TodoManager`.
- Added `translations/en.json` and a config flow test suite.
- Removed `iot_class` from the manifest - the integration registers no
  entities of its own, so there was nothing for the field to classify.
- The card editor now tucks the less-common toggles (move completed to
  bottom, confirm before delete, save/load buttons, filter icon) behind
  a collapsed "Advanced" section, so the default editor view is shorter.

## 0.11.0

Production-readiness pass: a full project review, a real frontend test
suite, and an extensive regression pass before wider distribution.

- Fixed a bug where `trigger_on_due` could go silently stale: if an
  item's due date was cleared through a path that bypasses the edit
  dialog's validation (native card, voice assistant, another automation
  calling `todo.update_item` directly), the flag stayed "on" while never
  actually able to fire again. The due-scheduler's own reconciliation
  pass now detects and clears this automatically.
- Added a small bell icon next to the due chip for any item with
  `trigger_on_due` enabled - previously the only way to tell was to open
  the item's edit dialog.
- Added a real frontend test suite (Vitest + happy-dom - real Lit
  component rendering, no browser dependency), covering every component
  and the API layer: 102 tests across 11 files.
- Added `CHANGELOG.md`, pinned a minimum Home Assistant version in
  `hacs.json`, and reviewed every project/admin file (manifest,
  `services.yaml`, `strings.json`, README, CI workflows) for accuracy.
- Ran a comprehensive regression pass: the full backend suite (146
  tests) plus a live end-to-end verification script against a real Home
  Assistant instance covering every websocket command, service, and
  error path.

## 0.10.0

- Added a config flow - the integration is now added entirely through
  **Settings → Devices & Services**, no YAML required. An existing
  `todo_overlay:` YAML entry is migrated to a config entry automatically on
  next restart.
- Added HACS distribution files: `hacs.json`, `LICENSE` (MIT), a proper
  README, and GitHub Actions workflows for hassfest/HACS validation and CI
  (backend pytest+ruff, frontend tsc+build+test).

## 0.9.0

- Completing/uncompleting an item no longer repositions it or splits the
  list into Active/Completed sections by default - a checkbox tap just
  flips the check. Both behaviors are now opt-in per card
  (`move_completed_items`).
- `hide_complete_for_parents` now defaults to `true`.

## 0.8.0 – 0.8.2

- Collapsible rows for any item with children, with a completion counter
  ("2/5") chip.
- A filter toolbar icon (All/Active/Completed/Overdue) using a native
  `<select>` pop-out rather than a persistent panel.
- Compressed the toolbar into icon buttons (add/filter/save/load/clear) on
  a single line; quick-add now pops out an inline row instead of always
  being visible.
- Fixed a row-alignment bug between parent and leaf items when
  `hide_complete_for_parents` is active, and tightened row spacing to
  match the native todo card's density.

## 0.7.0

- Added an opt-in "trigger on due" toggle per item: fires a `due`
  automation trigger event at the exact moment its due date/time arrives,
  via a scheduler using Home Assistant's own precise, non-polling
  scheduling primitive (the same one backing native time/calendar
  triggers) and a per-entity item-update subscription (catching due-date
  edits made through any path - the native card, voice assistants, other
  automations).
- New `todo_overlay.set_trigger_on_due` service and websocket command.

## 0.6.0 – 0.6.1

- Multi-entity cards: combine several `todo.*` lists on one card, each
  keeping its own hierarchy and drag-and-drop.
- Card configuration via the visual editor (`getConfigElement`/
  `getStubConfig`), sort modes (manual/title/due date), delete
  confirmation, and per-section visibility toggles.
- Fixed the entity picker being invisible in the card editor on a fresh
  dashboard session (switched to `<ha-selector>`).

## 0.5.0 – 0.5.1

- Backend hardening pass: per-entity concurrency locking, uniform
  websocket error codes, orphaned-metadata reconciliation, storage
  migration safety net.
- Full websocket and services layer test coverage.
- `hide_complete_for_parents` option (initially opt-in) and a UI config
  editor.

## 0.4.0 – 0.4.5

- Tags on items, via both a backend service and the item dialog.
- A `todo_overlay` automation trigger platform (created/completed/
  uncompleted/removed/tag_added/tag_removed/quantity_changed), with
  full-parity services for every mutation.
- Drag-and-drop responsiveness fixes: frozen row positions during a drag,
  a live-following drag ghost, top-of-list drop handling.

## 0.3.0 – 0.3.3

- Save/load lists as named, reusable snapshots (services and UI), with
  entity-agnostic loading (a list saved from one entity can be loaded onto
  a different one) and graceful degradation of unsupported fields.

## 0.2.0 – 0.2.9

- Quantity/UOM support, with merge-mode combining matching units on
  duplicate-titled items regardless of how they were added.
- Completed top-level items grouped into a "Completed" section with a
  clear-all action; live sync with the native entity.

## 0.1.0 – 0.1.7

- Initial working card: hierarchical drag-and-drop (before/inside/after
  with a live position indicator), an item add/edit dialog, and
  completion cascade with undo.

## 0.0.1

- Initial Todo Overlay domain model and architecture.
