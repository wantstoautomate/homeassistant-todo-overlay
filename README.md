# Todo Overlay

A Home Assistant custom integration and Lovelace card that overlays a parent/child hierarchy, quantities, tags, and due-date automation triggers on top of your existing `todo.*` entities - without replacing them. Everything is stored as overlay metadata alongside the native list, so the native todo card, voice assistants, and automations calling `todo.*` services all keep working exactly as before.

## Features

- **Hierarchy** - nest items under a parent, drag-and-drop to reorder or reparent, with collapsible rows and a completion counter on any row with children.
- **Category/person/day-of-week pins** - mark an item as always rendering like a section header ("Groceries", "Brodie"), even before it has any children, via the item dialog's "Show as" field. Once a level has two or more of these, its other plain items automatically collect into a trailing "Other" group rather than getting lost between them. A "day" pin additionally picks a weekday - it's automatically titled with that day's own name, sorts to the front of its siblings as the nearest upcoming occurrence, and shows "Today"/"Tomorrow" right up until it rotates past, so a recurring "Bins day" or "Gym" item stays where it belongs with nothing to maintain by hand.
- **Automatic day-rollover cleanup** - once a "day" pin's own weekday stops being "today", anything still checked off under it is removed, and anything still open moves onto an auto-created "Overdue" header with its due date set to the day that just passed - so yesterday's leftovers surface instead of silently sitting under a pin that's already moved on to next week.
- **Quantities and tags** - overlay-only fields the native `todo.*` entity has no concept of, editable from the card or via services.
- **Due-date automation triggers** - opt in per item, and an automation fires the moment the due date/time arrives - no polling, no bespoke per-list automation needed.
- **Saved lists** - save a list's current structure as a reusable template, then load it back onto any `todo.*` entity (e.g. a recurring "Weekly shop" or "Pack for a trip" list).
- **Multi-entity cards** - combine several `todo.*` lists onto one card, each keeping its own hierarchy and drag-and-drop.
- **Filtering** - a compact toolbar with All/Active/Completed/Overdue filtering.
- **Configurable completion behavior** - by default, ticking an item just ticks it (no repositioning or splitting into separate sections); both are opt-in per card.
- **Linked lists** - sync a list across two Home Assistant instances (e.g. two households) over MQTT, so an item added, completed, or removed on one side shows up on the other. Optional - only relevant if you want a shared list between separate HA instances.
- **Open-items sensor** - an auto-created sensor per list exposing incomplete-item detail (titles, tags, due dates) for use in automation conditions and notification messages, without a `todo.get_items` service call in every automation.

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
| `show_reorder_toggle` | boolean | `true` | Show a toolbar icon that toggles reorder mode, revealing a dedicated drag handle on every row. Only visible on touch/coarse-pointer devices (CSS `@media (pointer: coarse)`) - mouse users never see it, since holding anywhere on a row already drags reliably for them. Touch has no reliable way to hold-and-drag from anywhere on a row (the browser's native scroll gesture wins that race almost every time), so this is how touch reorders instead. |
| `weekday_anchor` | `top` \| `bottom` | `top` | Which side of its siblings a level's "day" pins (see Features above) block together at. Irrelevant for a list with no day-of-week pins. |

## Services

| Service | Purpose |
| --- | --- |
| `todo_overlay.create_item` | Create an item, including quantity/tags/pin/due-trigger fields the native `todo.add_item` has no concept of. |
| `todo_overlay.set_quantity` | Set or clear an item's quantity. |
| `todo_overlay.set_pin_type` | Set or clear an item's pin ("category", "person", or "day") - see Features above. "day" requires a `weekday` field too. |
| `todo_overlay.add_tag` / `todo_overlay.remove_tag` | Add or remove a tag from an item. |
| `todo_overlay.set_trigger_on_due` | Enable or disable the due-date automation trigger for an item (requires a due date and time already set). |
| `todo_overlay.save_list` | Save a list's current items/hierarchy as a named, reusable template. |
| `todo_overlay.load_list` | Recreate a saved template onto any `todo.*` entity. |
| `todo_overlay.delete_saved_list` | Delete a saved template. |
| `todo_overlay.query_items` | Read items with server-side filtering (completed, tags, due dates, pin type, weekday, delete-protected, linked, quantity) and hierarchy lookups (direct children, or every descendant at any depth) - a response action, see below. |

See each service's own description in the Home Assistant UI (**Developer Tools → Actions**) for its full field list.

`query_items` is a response action - call it with a response variable set and reference `<variable>.items` afterwards, rather than a target/trigger. It returns every overlay field per item (unlike the native `todo.get_items` service, which knows nothing about them), and can answer hierarchy questions the open-items sensor's own single-level `parent_title` can't - e.g. everything under "Brodie" at any depth, not just his direct children:

```yaml
action: todo_overlay.query_items
data:
  entity_id: todo.household
  under_title: Brodie
  completed: false
response_variable: brodie_open_items
```

The result is always a flat list, one entry per matched item regardless of depth - the right shape for Jinja's own `selectattr`/`map`/`groupby`, which have no clean idiom for walking a nested tree. Each item also carries `child_ids` (not full duplicated child objects - just ids, since with `under_id`/`under_title` every descendant is already its own entry in the same flat list) and precomputed answers so a template never has to redo date math or its own recursive walk: `top_level`, `overdue`/`days_overdue`, and `has_open_descendants`/`has_overdue_descendants` (the last two look at every descendant, any depth - not just a direct child). `due_today` is also available as its own filter alongside `overdue`, for exactly-today rather than strictly-before-today.

## Automation triggers

Nine triggers are available - one per kind of change - each showing up in the automation editor's "+ Add Trigger" picker under "Custom to-do item created", "Custom to-do item completed", etc. (search for "Custom to-do"):

- `todo_overlay.created`
- `todo_overlay.completed`
- `todo_overlay.uncompleted`
- `todo_overlay.removed`
- `todo_overlay.tag_added`
- `todo_overlay.tag_removed`
- `todo_overlay.quantity_changed`
- `todo_overlay.pin_type_changed`
- `todo_overlay.due`

Each takes a standard target entity selector (defaults to any `todo.*` entity if left blank) and an optional `tag` field to only match items with that tag:

```yaml
trigger:
  - trigger: todo_overlay.due
    target:
      entity_id: todo.chores
    tag: urgent   # optional
```

The trigger provides `trigger.event.data` with the item's `entity_id`, `item_id`, `title`, and any action-specific fields (e.g. `due_datetime` for `due`).

## Linked lists

Two independent Home Assistant instances (e.g. two households) can keep one list in sync over MQTT - an item created, completed, uncompleted, or removed on one side is mirrored on the other. Only item content syncs (title, completed, description, due, quantity, tags, pin), not position/hierarchy; deletions and conflicts are resolved automatically. This is entirely optional - skip it for normal, non-linked use.

### Requirements

- An MQTT broker reachable from both instances. It does not need to be the same broker either instance already uses for other things - a dedicated broker (or a dedicated set of credentials/ACLs on a shared one) is recommended, since this integration's credentials only need publish/subscribe access to its own topic namespace.
- Each side connects independently, so one instance can reach the broker directly on your LAN (plain `tcp://`) while the other reaches it remotely over `wss://` through a reverse proxy (e.g. Nginx Proxy Manager terminating TLS) - no forwarded port for raw MQTT is required for the remote side.

### Setup

1. On **each** instance: **Settings → Devices & Services → Todo Overlay → Configure → Configure MQTT link**, and fill in the broker host/port/username/password, whether to use TLS, and the connection type (`tcp` for a direct/LAN broker, `websockets` for one reached through a reverse proxy's WSS).
2. On one side, call the `todo_overlay.create_link` service against the entity you want to share, which generates a link id.
3. On the other side, call `todo_overlay.join_link` against its own entity, passing that same link id.
4. Both entities now sync. Call `todo_overlay.unlink` on either side to stop.

The card shows a small link icon in a linked list's header (status only - no credentials or configuration exposed to the frontend).

## Open-items sensor

A sensor is auto-created for every `todo.*` entity - no configuration needed. Given `todo.shopping_list`, you get `sensor.todo_overlay_shopping_list_open_items`:

- **State** - the count of incomplete items (the same number native HA's own `todo.*` entity state already reports, kept here too for dashboard/history convenience).
- **`items` attribute** - a list of every incomplete item's detail: `title`, `description`, `due_date`, `due_datetime`, `quantity`, `tags`, and `top_level` (`false` for a child item nested under a parent).

Since HA has no way to expose per-item detail without a `todo.get_items` service call in every automation, this attribute is meant to be used directly in a template. A couple of examples:

```yaml
# Numeric trigger on the plain count (equivalent to using todo.shopping_list's own state directly)
trigger:
  - trigger: numeric_state
    entity_id: sensor.todo_overlay_shopping_list_open_items
    above: 0
```

```yaml
# Notify with the actual titles
action:
  - action: notify.mobile_app
    data:
      message: >-
        You have {{ states('sensor.todo_overlay_shopping_list_open_items') }} items open in Shopping List.
        They are {{ state_attr('sensor.todo_overlay_shopping_list_open_items', 'items') | map(attribute='title') | join(', ') }}.
```

```yaml
# Tag-filtered condition (only "urgent"-tagged items)
condition:
  - condition: template
    value_template: >-
      {{ state_attr('sensor.todo_overlay_shopping_list_open_items', 'items')
         | selectattr('tags', 'contains', 'urgent') | list | count > 0 }}
```

## Development

This repository contains the custom integration (`custom_components/todo_overlay/`) and the frontend card (`frontend/todo-overlay-card/`), each with its own automated test suite:

- Backend: `uv run pytest` (and `uv run ruff check .` for linting).
- Frontend: from `frontend/todo-overlay-card/`, `npx tsc --noEmit` to type-check, `npm test` to run the Vitest suite, and `node build.mjs` to produce the bundle committed under `custom_components/todo_overlay/frontend_dist/`.

See `docker/` for a local Home Assistant dev environment, and [CHANGELOG.md](CHANGELOG.md) for release history.

## License

MIT - see [LICENSE](LICENSE).
