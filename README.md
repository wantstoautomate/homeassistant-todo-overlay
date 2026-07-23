# Todo Overlay

A Home Assistant custom integration and Lovelace card that overlays a parent/child hierarchy, quantities, tags, and due-date automation triggers on top of your existing `todo.*` entities - without replacing them. Everything is stored as overlay metadata alongside the native list, so the native todo card, voice assistants, and automations calling `todo.*` services all keep working exactly as before.

## Features

- **Hierarchy** - nest items under a parent, drag-and-drop to reorder or reparent, with collapsible rows and a completion counter on any row with children.
- **Quantities and tags** - overlay-only fields the native `todo.*` entity has no concept of, editable from the card or via services.
- **Due-date automation triggers** - opt in per item, and an automation fires the moment the due date/time arrives - no polling, no bespoke per-list automation needed.
- **Saved lists** - save a list's current structure as a reusable template, then load it back onto any `todo.*` entity (e.g. a recurring "Weekly shop" or "Pack for a trip" list).
- **Multi-entity cards** - combine several `todo.*` lists onto one card, each keeping its own hierarchy and drag-and-drop.
- **Filtering** - a compact toolbar with All/Active/Completed/Overdue filtering.
- **Configurable completion behavior** - by default, ticking an item just ticks it (no repositioning or splitting into separate sections); both are opt-in per card.

## Installation

### HACS (recommended)

1. In HACS, add this repository as a custom repository (Integrations category) if it isn't already in the default HACS store: `https://github.com/wantstoautomate/homeassistant-todo-overlay`.
2. Install "Todo Overlay" from HACS.
3. Restart Home Assistant.
4. Go to **Settings → Devices & Services → Add Integration**, search for "Todo Overlay", and add it. There's nothing to configure - it works against every `todo.*` entity you already have.

### Manual

Copy `custom_components/todo_overlay` into your Home Assistant `config/custom_components/` directory, restart Home Assistant, then add the integration via **Settings → Devices & Services → Add Integration** as above.

No YAML configuration is required or supported for setup - the integration is added entirely through the UI.

## Adding the card

Once the integration is set up, its Lovelace card registers itself automatically. Add a card to any dashboard with:

```yaml
type: custom:todo-overlay-card
entity: todo.your_list
```

or use the visual card editor from the dashboard's "Add Card" dialog, which also exposes every option below.

### Card configuration

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `entity` | string | — | A single `todo.*` entity. Required unless `entities` is set. |
| `entities` | list | — | Multiple `todo.*` entities, each rendered as its own independent section on one card. |
| `title` | string | `Todo Overlay` (single-entity only) | Card header text. |
| `hide_complete_for_parents` | boolean | `true` | Hides the completion checkbox on any row with children (completing a parent normally cascades to every descendant, which is easy to trigger by accident). Tapping such a row toggles collapse instead; completing it is available via the edit dialog's "Mark complete" toggle. |
| `move_completed_items` | boolean | `false` | When enabled, completing/uncompleting an item repositions it to the top/bottom of its sibling group and splits the list into separate Active/Completed sections. Off by default - a checkbox tap just flips the check. |
| `sort_by` | `manual` \| `title` \| `due_date` | `manual` | `manual` is drag-and-drop order. Any other value re-sorts the display without touching stored order; drag-to-reorder is disabled while active. |
| `sort_order` | `asc` \| `desc` | `asc` | Only relevant when `sort_by` isn't `manual`. |
| `confirm_delete` | boolean | `true` | Ask for confirmation before deleting an item. |
| `show_clear_completed_button` | boolean | `true` | Show the "clear completed" toolbar icon. |
| `show_save_load_buttons` | boolean | `true` | Show the save/load list toolbar icons. |
| `show_quick_add` | boolean | `true` | Show the quick-add ("+") toolbar icon. |
| `show_filter_menu` | boolean | `false` | Show the filter toolbar icon (All/Active/Completed/Overdue). |

## Services

| Service | Purpose |
| --- | --- |
| `todo_overlay.create_item` | Create an item, including quantity/tags/due-trigger fields the native `todo.add_item` has no concept of. |
| `todo_overlay.set_quantity` | Set or clear an item's quantity. |
| `todo_overlay.add_tag` / `todo_overlay.remove_tag` | Add or remove a tag from an item. |
| `todo_overlay.set_trigger_on_due` | Enable or disable the due-date automation trigger for an item (requires a due date and time already set). |
| `todo_overlay.save_list` | Save a list's current items/hierarchy as a named, reusable template. |
| `todo_overlay.load_list` | Recreate a saved template onto any `todo.*` entity. |
| `todo_overlay.delete_saved_list` | Delete a saved template. |

See each service's own description in the Home Assistant UI (**Developer Tools → Actions**) for its full field list.

## Automation trigger

The `todo_overlay` trigger platform fires whenever a meaningful change happens to an item:

```yaml
trigger:
  - platform: todo_overlay
    entity_id: todo.chores
    action: due   # created | completed | uncompleted | removed | tag_added | tag_removed | quantity_changed | due
```

`entity_id`, `action`, and `tag` (for `tag_added`/`tag_removed`) are all optional filters - omit any of them to match more broadly. The trigger provides `trigger.event.data` with the item's `entity_id`, `item_id`, `title`, `action`, and any action-specific fields (e.g. `due_datetime` for `due`).

## Development

This repository contains the custom integration (`custom_components/todo_overlay/`) and the frontend card (`frontend/todo-overlay-card/`), each with its own automated test suite:

- Backend: `uv run pytest` (and `uv run ruff check .` for linting).
- Frontend: from `frontend/todo-overlay-card/`, `npx tsc --noEmit` to type-check, `npm test` to run the Vitest suite, and `node build.mjs` to produce the bundle committed under `custom_components/todo_overlay/frontend_dist/`.

See `docker/` for a local Home Assistant dev environment, and [CHANGELOG.md](CHANGELOG.md) for release history.

## License

MIT - see [LICENSE](LICENSE).
