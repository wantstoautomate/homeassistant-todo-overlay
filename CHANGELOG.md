# Changelog

All notable changes to this project are documented here. Versions follow the
integration's `manifest.json`/card's `package.json` (kept in lockstep).

## 1.6.1

**Fixed: creating a new day-of-week pin from the "+" dialog failed outright with a websocket error** ("value must be one of category, person"). 1.6.0's day-of-week pins only ever got wired through the item dialog's *edit* path (`set_pin_type`) - creating a brand new item as a day pin went through a completely separate `create_item` call whose own schema was never updated to allow `"day"` at all, and never sent the picked weekday even where it was allowed. Both are now fixed; editing an existing item into a day pin was never affected.

- **Fixed: the visual card editor had no control for the new `weekday_anchor` option at all** - it was only reachable by hand-editing the card's YAML. Added alongside the other Advanced-section options.

## 1.6.0

**New: day-of-week pins - a section header that always represents a specific
day, sorts itself to the nearest upcoming occurrence, and labels itself
"Today"/"Tomorrow" automatically.** Pick "Day of week" in the item dialog's
"Show as" field, choose a weekday, and the item is renamed to that day's own
name ("Wednesday") and kept there - no more manually dragging a recurring
"Bins day" or "Gym" item back to the top of the list every week. Every "day"
pin at a level forms one contiguous block among its siblings; a new
`weekday_anchor` card option (default `top`) picks which end of the list that
block sits at. Also available via `todo_overlay.create_item`/
`todo_overlay.set_pin_type` (with a new `weekday` field), and synced across a
linked pair over MQTT like every other pin type.

**New: automatic day-rollover cleanup.** Once a "day" pin's own weekday stops
being "today", its children are swept: anything already checked off is
removed, and anything still open moves onto an auto-created "Overdue" header
with its due date set to the day that just passed - so yesterday's leftovers
surface instead of silently sitting under a pin that's already moved on to
next week. Runs automatically on every read, catching up regardless of how
long it's been since the list was last opened.

**New: the open-items sensor now exposes each item's direct parent** (`parent_id`/
`parent_title`, `null` for a top-level item) - lets a template condition ask
"is there anything open under 'Work'" (`items | selectattr('parent_title',
'eq', 'Work') | list`) with no extra service call.

- **Fixed: linking an item onto another list ("Link to shared list") didn't
  carry its delete-protected flag over, and never kept it in sync
  afterwards.** Protecting an item on one side left its mirror on the other
  side silently unprotected - now mirrored at link creation and kept in sync
  both ways from then on, same as every other linked field.

## 1.5.0

**New: delete protection - stop inadvertently deleting an anchor item.** A
"Prevent deletion" checkbox in the item dialog (default unchecked) blocks
an item from being deleted everywhere: the desktop delete button
(disabled, with an explanatory tooltip), the mobile swipe-to-delete
gesture (the row simply doesn't move leftward at all, rather than
revealing and then silently refusing), "clear completed"/"clear all"
(skipped, but the protected item's own children are still swept
normally), and the backend itself (`delete_item` raises an error if
bypassed some other way, e.g. a service call or automation). Synced
across a linked pair over MQTT, unlike most overlay-only fields - "don't
delete this" is a property of the item itself, so both sides of a shared
list need to agree on it for the protection to actually hold. Live use
case: a "person" pin like "Brodie" or "Anna" that a shared list's own
organization depends on, one careless swipe or "clear completed" tap
away from being gone.

- **Fixed: the desktop "clear completed" (trash) button did nothing when
  the only completed items were nested under a still-incomplete parent.**
  It only ever checked whether a whole top-level item was itself
  complete (every descendant too) - something checked off under
  "Brodie" while other things under him were still open was never
  swept. Now recurses into every level: a fully-complete subtree is
  still removed whole, anything short of that recurses into its own
  children individually instead of stopping there.

## 1.4.2

**Changed: the swipe-armed haptic pulse (1.4.1) now uses HA's own sanctioned mechanism instead of the raw Web Vibration API.** 1.4.1 called `navigator.vibrate()` directly, which worked on Android but was never going to reach iOS at all - WKWebView (what the Companion App uses there) has no Vibration API whatsoever, no web-exposed workaround either. Switched to dispatching HA's own `"haptic"` event on `window` instead - the same mechanism `home-assistant/frontend`'s own `forwardHaptic()` uses, which both Companion Apps are actually built to listen for and translate into a real native haptic call through their own bridge. No other behavior changed - same threshold-crossing trigger as 1.4.1, just resolved through the sanctioned path this time, and now working on both platforms.

## 1.4.1

Two small UX fixes to the mobile swipe/quick-add gestures, following live
use of 1.4.0.

- **New: a short haptic pulse when a swipe crosses into "release now
  commits" territory.** Live-reported: the visual reveal alone didn't
  make it obvious exactly when a left/right swipe had crossed the
  threshold where releasing would actually delete or open the add-child
  field. Fires once on crossing (not once per frame while held past it),
  and again if the swipe backs out and re-crosses in the same gesture -
  same feel as a native iOS/Android swipe-to-delete row. Best-effort:
  the Vibration API has no iOS Safari/WKWebView support at all (which is
  what the HA Companion App uses on iOS), so this is silently a no-op
  there - there's no web-exposed alternative to reach for instead.
- **Fixed: the inline "Add item" field that opens under a row (swipe
  right, or its desktop toggle) didn't visually line up with where the
  new item's own title would actually appear once created.** It was
  indented to the right DEPTH, but not accounting for the row's own
  internal padding or its leading collapse-toggle/checkbox column - so
  the input's text sat well left of a sibling row's title. It now
  reserves the same spacer width a real leaf child's row would (checkbox
  slot included, exactly when `showCheckboxes` would show one for it),
  rather than a guessed pixel value.

## 1.4.0

**New: item links - mirror an item onto a shared list.** Any item can now
be "linked" to a shared/cross-instance list without having to load it
into two lists separately. A "Link to shared list" checkbox in the item
dialog creates a matching item under a target parent (e.g. "Brodie" or
"Anna") on the linked entity, then keeps the two bidirectionally in
sync from then on - completing, uncompleting, editing, or deleting
either side applies to both. Deleting one deletes both. Which parent a
link lands under defaults to a once-off setting (`Settings > Todo
Overlay > Configure > Configure item links`), only offered when exactly
one cross-instance linked list is currently configured; the checkbox's
own override field can target a different parent for a one-off item
without touching the default. A saved template that included linked
items re-links automatically on load the same way - auto-resolving to
the single configured linked list if there is one, logging (not
blocking) if there isn't. New `todo_overlay/link_item` and
`todo_overlay/unlink_item` websocket commands; no HA service yet, this
is UI-driven for now.

- **Fixed: swiping a row could navigate the dashboard instead** on
  setups with the `hass-swipe-navigation` HACS add-on installed.
  1.1.0/1.1.1 already addressed this once, but the add-on's own
  rewrite (raw Touch Events on a specific layout element, not
  `window`) exposed a gap: the guard's arm/no-arm decision was being
  made off Pointer Events, a separate stream from the raw Touch Events
  it was actually trying to intercept, and the two aren't guaranteed to
  stay in lockstep on every device. The guard now decides off the raw
  touch stream directly, closing that gap regardless of how the two
  streams are timed relative to each other.

## 1.3.0

**New: load a saved template into an existing parent, not just at the
list's root.** Live use case: "To buy" already exists as a parent, and a
saved "Fruit & veg" template should load as ITS children, not as new
top-level siblings next to it. The load dialog's "Load into" field
offers every current item as a target (flattened, indented to show
nesting) - pick one, or leave it "Top level" for the original,
unscoped behavior. "Merge" mode matches existing children of the
target specifically (not root-level items that happen to share a
title); "Replace" mode, once a target is picked, only clears that
item's own existing subtree first - the rest of the list is
untouched, unlike the unscoped "Replace" which still clears
everything when no target is given. Also available from
`todo_overlay.load_list` (a new `target_item` field, id or title) and
the `todo_overlay/load_list` websocket command, for automations that
want to do the same thing.

## 1.2.1

CI-only fix, no functional change to the integration or card.

- **Fixed: frontend CI failed on `npm ci`.** 1.2.0's own `package-lock.json`
  regeneration ran under Node 24's bundled npm (v11) locally, but CI pins
  Node 22 (npm v10 - see `.github/workflows/test.yml`), whose own `npm ci`
  is stricter about the lockfile matching exactly what it expects - it
  rejected the v11-authored lockfile outright for several esbuild
  platform-optional-dependency entries v10 wants listed explicitly that
  v11 had pruned. Reproduced the actual CI failure locally first, then
  regenerated the lockfile under Node 22 specifically. The built
  `frontend_dist/todo-overlay.js` is byte-identical either way - only
  `package-lock.json` changes, so nothing about an existing install
  (HACS pulls the tagged file tree directly, not via `npm ci`) was ever
  affected.

## 1.2.0

A new feature (category/person pins) plus a scroll-jump fix, a real drag-
target instability fix, and a sweep of the pin work's own follow-on gaps.

- **New: category/person pins.** An item's edit dialog gained a "Show as"
  field - pick "Category" or "Person" to make it always render like a
  section header (bold/tracked title, no checkbox, collapsible), even
  before it has any children of its own. A Person pin additionally gets a
  small initial-letter avatar. Once a level has two or more of these
  (real parents count too), its other plain items automatically collect
  into a trailing "Other" group rather than sitting interspersed between
  them - a single incidental parent never triggers this on its own, only
  once a level has "genuinely become a set of categories." The
  synthetic Other row is purely a rendering choice, not real data: no
  backend call, nothing persisted, every interactive affordance
  suppressed except collapse/expand, and it can never itself become a
  drag target (its real children still can). A pinned-but-childless row
  gets a small static dash in the collapse-toggle slot rather than a
  real chevron - live-reported that the real one read as "there's
  something to expand" when there wasn't.
- **New: pins are usable from automations, not just the dialog.** A
  `todo_overlay.set_pin_type` service and a `todo_overlay.pin_type_changed`
  trigger were missing entirely from the initial cut - every other
  overlay-only field (quantity, tags, trigger_on_due) has both, so pins
  now do too. Pins also now round-trip through saved-list templates
  (`save_list`/`load_list`) and survive the existing same-titled-item
  merge, both of which silently dropped them before.
- **Fixed: dragging near a nested boundary (e.g. a grandchild toward the
  gap between its parent's row and its parent's own parent's row) made
  surrounding rows visibly jump up/down repeatedly.** Root cause: the
  reorder gap's own open midpoint sits exactly equidistant between the
  row above and below it, since the gap itself is comfortably wider than
  a typical row - a dead-even tie in the drop-target search that the
  smallest jitter flipped back and forth, each flip re-opening the gap
  on a different row. Fixed with the same hysteresis the zone-boundary
  logic already used for a single row's own before/inside/after split,
  now extended to which row wins the search in the first place.
- **Fixed: deleting a row while scrolled to the bottom of a long list
  snapped the page instantly** rather than settling smoothly - the
  browser clamps `scrollY` the moment a delete shrinks the page below
  the current scroll position, and nothing about `scroll-behavior:
  smooth` covers that specific kind of forced, reflow-driven adjustment.
  The row's own height now collapses first, turning the same unavoidable
  scroll clamp into a gradual, visibly-explained settle.

<details>
<summary>Internal cleanup</summary>

A self-review after the pin work above turned up a few smaller gaps,
folded into this release rather than left for later:

- The edit dialog's quantity/tags/trigger-on-due/pin-type fields now save
  as one batched round trip instead of four sequential ones (the title/
  description/due-date update still runs first and alone - trigger-on-due
  validation depends on the due date/time it writes).
- The drag-and-drop hit-test's nearest-row search now does one pass over
  the visible rows instead of three.
- `package-lock.json` was badly stale (hadn't tracked `package.json`'s own
  version in a long time) - regenerated.

</details>

## 1.1.1

Three fixes to 1.1.0's own new behavior, driven by live mobile testing and a
real linked-list report.

- **Fixed: touch reorder drags could drift horizontally and vanish off
  screen.** Touch can only ever start a drag from the reorder-mode handle,
  which sits at the row's far-right edge - a natural thumb drag curving even
  slightly left off that screen edge (ordinary ergonomics, not user error)
  dragged the ghost along with it. `findDropTarget` only ever reads the
  vertical pointer coordinate, so horizontal movement during a reorder-mode
  drag has zero effect on where anything actually drops - it only drove the
  ghost's own visual position. The ghost is now frozen horizontally for the
  whole drag; mouse (never reorder-mode) is unaffected.
- **Fixed: swiping a row also navigated dashboard tabs**, for anyone running
  the HACS "Home Assistant Swipe Navigation" add-on alongside this card.
  Confirmed via the add-on's own real released build, run against our real
  card in an actual browser (not just code review): it listens for raw
  `touchmove`/`touchend` on an ancestor of every card, in the default bubble
  phase - a separate event stream from the `pointermove` events our own
  swipe gesture is built on, so nothing we did with pointer events could
  ever have reached it. A window-level, capture-phase touch listener now
  stops that propagation once a horizontal swipe locks in, verified with a
  negative control (temporarily disabling the fix reproduced the original
  conflict in the same test harness) - swipes that don't start on a row are
  completely unaffected. A second, subtler bug turned up in the course of
  proving this out with genuine touch input rather than synthetic test
  events: `pointerup` and this same gesture's own trailing `touchend` are
  two independent browser events, not one, and our cleanup was tearing down
  the interception before that `touchend` had even arrived - fixed with a
  dedicated flag that survives exactly as long as the interception itself
  needs to.
- **Fixed: reordering and reparenting an item in a linked list didn't sync
  to the other side at all.** Position/hierarchy sync had been deliberately
  out of scope in the original design - only item content (title,
  completed, description, etc.) synced across a link. A pure reorder or
  reparent changes no content field, so the existing echo-suppression check
  saw nothing different from what was already recorded and silently never
  published anything. Position now rides the same upsert message content
  already used, described as a reference to a sibling or parent (mirroring
  drag-and-drop's own before/after/inside model) that the other side
  translates back to its own item ids and applies directly - never through
  a path that could itself trigger another sync message, so it can't loop.

## 1.1.0

A full rework of how items get added and deleted, driven by a live-reported
design flaw: the old per-parent "+" only ever showed up on rows that
*already* had children, so a root-level or leaf item had no way to gain one.
Several approaches were tried and discarded along the way (lifting the drag
ghost clear of the pointer to keep a touch drop-target visible underneath
it) before landing on what's below - only the final, kept behavior is
described here.

- **Desktop: add-mode and delete-mode**, toggled from the toolbar. Tapping
  the "+" puts every row - parent or leaf - into add-mode, showing its own
  "+" that opens an inline, indented quick-add field for a child of that
  item. Tapping the trash button clears completed items if there are any;
  with nothing to clear, it enters delete-mode instead, showing an "x" on
  every leaf row (tap to arm, tap again to confirm). Add-mode, delete-mode,
  and reorder-mode are mutually exclusive - entering one turns the other two
  off. Holding the trash button and releasing still prompts to delete
  everything in the list, unchanged.
- **Mobile: swipe replaces the per-row crosses entirely.** Swipe left on a
  row to delete it - swiping reveals a red delete panel, and releasing past
  the reveal threshold confirms immediately, no separate confirm tap needed.
  Swipe right to open that row's own add-child field, indented to the child
  level exactly like the desktop version. Both gestures are ignored outright
  while reorder-mode is active (that mode's touch drag has its own dedicated
  handle), and don't interfere with normal vertical scrolling.
- **New: drop-target treatment while dragging onto a parent**, configurable
  from the card editor's Advanced section (`drag_ghost_style`). The dragged
  item's floating "ghost" always stays pinned exactly to the pointer - an
  earlier attempt that lifted it clear of the pointer to keep the target row
  visible underneath was live-reported as feeling visually disconnected from
  what was actually being dragged, on both touch and mouse. Instead, while
  hovering a valid reparent target: **"label"** (the default) shows a small
  pill directly under the ghost naming the parent ("Add to: X"); **"shrink"**
  collapses the ghost to a small chip so the target row is visible around
  it; **"translucent"** fades the ghost so the target shows through it.
  "none" keeps the ghost's original, untreated appearance. All four remain
  selectable for anyone who prefers a different one.
- **New: hold the clear-completed button and release to delete every item**
  in the list (parents and children, completed or not), with a confirmation
  prompt first - available on both desktop and mobile.
- **Fixed: the item-action confirm dialog** (used by delete-all, among
  others) rendered with no message and an oddly small/large size - a Lit
  property bound as a plain HTML attribute (`heading="..."`) instead of a
  property binding (`.heading=${...}`) never reached a component declared
  with `attribute: false`, so the value silently never arrived.

## 1.0.5

A round of drag-and-drop reorder refinements, driven entirely by real
back-and-forth testing on desktop against a local sandbox. Several
approaches were tried and discarded along the way (a horizontal-drag-
to-nest gesture, a thin depth-indicator rail) before landing on what's
below - only the final, kept behavior is described here.

- **Becoming a child vs. reordering now look and behave differently,
  on purpose.** Dragging an item onto an existing row to nest it as a
  child draws a bounding-box outline around that row - no reflow,
  since dropping *into* a container is a different gesture from
  reordering past a sibling. Dragging between two rows to reorder
  still opens a real gap (the row you're moving past visibly slides
  out of the way) with a dashed shadow box shown in the space that
  opened - showing exactly where the item will land.
- **Fixed: the drop-target highlight could drift out of sync with the
  cursor once any gap was open.** The hit-test snapshot is deliberately
  frozen for the duration of a drag (re-measuring live would reintroduce
  an old oscillation bug), but a reorder's own gap wasn't being
  accounted for - so the frozen rects silently went stale the moment
  a gap opened. Fixed with an exact, instant correction (the gap's
  size and which row has it open are both already known) rather than
  a delayed re-measurement - no timing window where it can be wrong.
- **Fixed: dragging a child that sits directly below its own parent
  (i.e. that parent's own first visible child) could glitch and/or
  show no highlight at all** when hovering near where it started.
  The dragged item was correctly excluded as its own drop target, but
  not scrubbed from its parent's own list of children used to decide
  placement - so the parent kept offering the dragged item itself as
  the target, which then got invalidated with no fallback. Now
  correctly falls back to treating the parent as childless (or offers
  the next real sibling, if there is one).
- **Zone boundaries (before/becoming-a-child/after) are now sticky** -
  once resolved, leaving a zone takes a bit more movement than it took
  to enter it, so a boundary sitting under a jittery cursor doesn't
  flip the target back and forth.
- **A light haptic tick (mobile)** fires whenever the resolved drop
  target actually changes - physical confirmation that doesn't depend
  on catching a visual highlight mid-gesture.
- **The browser's own hover highlight is suppressed for the whole list
  while a drag is active**, leaving only the drop-target highlighting
  visible - having both on screen at once, occasionally disagreeing
  now that zones are sticky, read as confusing rather than helpful.

Not yet tested on mobile/touch - worth a real pass there before
treating this as fully settled, though nothing here is touch-specific
in a way that should regress it.

## 1.0.4

Reported as: "there's an orange kind of highlight when you are about
to drag something to a parent... sometimes items can be dragged over
this and the box won't necessarily show but the item is created as a
child anyway... it's very likely correct that this occurs but the
hitbox is inconsistent."

- **Fixed: dragging an item onto a COLLAPSED parent's row could nest it
  there with zero visual feedback anywhere on screen.** `resolvePlacement`
  decided whether hovering a row's body meant "become its first child"
  using that row's raw *data* children (`item.children`), not what's
  actually rendered. A collapsed parent's `<ul>` of child rows is
  removed from the DOM entirely (see `todo-tree-item.ts`'s `render()`),
  but the hit-test snapshot still saw `children.length > 0` from the
  data - so hovering the parent's own row silently retargeted to
  "before its first child," a row that doesn't exist anywhere in the
  DOM right now. No rendered row could ever match that as the drop
  target, so no highlight ever appeared - yet the drop still went
  through and the item became a child of the collapsed parent. This
  was 100% reproducible whenever the target happened to be a collapsed
  parent, not a rare timing race - it just read as intermittent because
  it only showed up on that specific kind of row.
  Fixed by having the hit-test snapshot track only *visible* children
  per row (whether its `<ul>` is actually in the DOM), so a collapsed
  parent's body now goes through the same logic as a genuine leaf row:
  a real, visible "become a child" highlight on the parent's own row,
  never a phantom target on something off-screen. This directly
  restores the invariant asked for: no box, no child; box, then child.
- Broader reorder-intuitiveness ideas (horizontal drag-to-nest, always-
  visible nesting guides, hysteresis around zone boundaries, haptic
  feedback on mobile) were considered but deliberately not bundled into
  this release - noted separately for a follow-up discussion rather
  than rushed into the same fix as a confirmed, well-understood bug.

## 1.0.3

Same underlying bug class as 1.0.2's edit-dialog fix, found in a second
place: reported as "typing a name to save the list in the mobile
browser wipes it occasionally."

- **Fixed: the save/load dialog's name field (and mode/persist-states
  fields) could silently revert mid-type, same root cause as the edit
  dialog fixed in 1.0.2.** `todo-save-load-dialog.ts` had the exact
  same pattern: its `.value` was recomputed and re-passed by the parent
  card on every re-render, and since lit-html always recommits
  non-primitive property values regardless of whether the reference
  changed, any unrelated re-render while the dialog was open (a
  live-sync reload - including the very one just added in 1.0.2 - a
  hass poll tick, anything) silently reset the in-progress name back to
  whatever it was when the dialog opened. Mobile's slower/janker render
  cadence just made an existing race far easier to hit than on desktop.
  Fixed with the same seeded-once internal draft pattern now used by
  both dialogs.
- Audited every other text input across the card for the same pattern.
  The quick-add field and the card's config editor are unaffected -
  both bind directly to state each component owns itself (a primitive
  string in the first case, dirty-checked by value; a config object
  only ever reassigned in lockstep with what's typed in the second),
  never to an object handed down and blindly re-passed by a parent on
  every render. This bug class specifically requires an object-typed
  `@property` that a parent keeps re-supplying across renders it
  doesn't control - the two item/save-load dialogs were the only
  places that shape existed.
- This is a frontend-only fix - `link_sync.py` and the save/load
  backend (`manager_snapshots.py`) are untouched, so there's no change
  to linked-list sync behavior or any risk of the 0.16.9 echo-loop
  class recurring.

## 1.0.2

Two more bugs found during real two-instance testing of 1.0.1, both in
the same general area: what happens on the *receiving* side of a
linked-list sync.

- **Fixed: an open card on the receiving instance never refreshed after
  an incoming linked change, until the page was manually reloaded.**
  0.16.9's echo-loop fix correctly stopped `_apply_incoming` from ever
  calling through `TodoManager` - but `TodoManager` was also the only
  thing that fired `EVENT_ITEM_CHANGED`, which is what the frontend's
  live-sync subscription (added in 0.16.3) listens for. So applying an
  incoming create/update/delete now correctly avoids the echo loop, but
  also silently stopped telling any already-open card to reload at all.
  Fixed by firing the same event directly from `link_sync.py` after
  each successful apply - tagged with a distinguishing `"synced"`
  action so `link_sync`'s own listener ignores it rather than
  reprocessing it as a new local change (which would reopen the door
  to 0.16.9's bug).
- **Fixed: editing an item (e.g. changing its quantity) before hitting
  Save could silently revert to the original value while the dialog
  was still open, unsaved.** The edit dialog's `.value` was recomputed
  fresh and re-passed by the parent card on *every* re-render - not
  just when the dialog first opened, but for any unrelated reactive
  change (another item's edit elsewhere in the same list, an error
  banner timing out, and now also the live-refresh fix above). Because
  lit-html always recommits non-primitive property values regardless
  of whether the reference actually changed, every one of those
  re-renders silently reset the dialog's fields back to whatever they
  were when it opened, discarding anything typed in the meantime. Fixed
  by giving the dialog its own internal draft copy, seeded once from
  the parent's value and never resynced afterwards - the same pattern
  already used for the due-date/time segments, now covering the whole
  form.

## 1.0.1

- Fixed the one known limitation flagged in 1.0.0: the duplicate-title-
  merge reconciliation (`_merge_duplicate_titles` - combines two
  same-titled items when at least one has a quantity, e.g. two "Milk"
  entries) removed the losing duplicate silently, with no event fired -
  on a linked list, that removal never propagated to the peer. Now
  fires `"removed"` for the merged-away duplicate, same as every other
  deletion path.

## 1.0.0

Final audit pass before declaring this stable, prompted by being asked
directly "do you believe this is stable" after the intense run of real
two-instance bug-hunting in 0.16.5 through 0.16.9.

- Re-audited every line of `_apply_incoming` (the code that applies a
  remote change coming off the broker) to confirm the exact bug class
  that caused 0.16.9's echo loop is fully closed: every single call in
  both its create and update/delete branches now goes through
  `self._adapter`/`self._metadata_store` directly, never
  `self._manager` (`TodoManager`) - `self._manager` is no longer
  called anywhere in that file at all, only referenced in explanatory
  comments.
- Full suite re-run clean: 240 backend tests, 176 frontend tests,
  ruff, tsc, hassfest.
- One known, narrow limitation worth documenting rather than blocking
  on: the existing duplicate-title-merge reconciliation
  (`_merge_duplicate_titles`, matches quantity-shopping-list items that
  share a title) removes the losing duplicate silently, with no event
  fired - on a linked list, that specific combination (two same-titled
  items where at least one has a quantity) won't propagate its
  removal to the peer. This is structurally the same class of gap as
  0.16.9's bug, but far narrower - it requires that specific quantity-
  merge condition, not every plain duplicate title, and it shares its
  root cause with a separate, already-documented, pre-existing
  limitation (items removed through paths this integration doesn't
  control - the native card, voice assistants - were never fully
  tracked for sync purposes either).

Everything else added since 0.15.0 (linked lists, the open-items
sensor, touch reorder mode, cross-viewer live-sync) has been through
real two-instance/two-device testing, not just the test suite, and
every mutation path in the card now correctly participates in the
same event system linked lists, the sensor, and the trigger platform
all depend on.

## 0.16.9

- **Fixed a runaway echo loop in linked lists, live-reproduced during
  real two-instance testing: creating an item could spiral into an
  infinite chain of duplicate items on both sides.** Root cause:
  applying an incoming "created" message called
  `self._manager.create_item()` (the full `TodoManager` method) to
  create the local item - but that method unconditionally fires
  `EVENT_ITEM_CHANGED`, which `link_sync`'s own listener picks up as a
  new LOCAL change. A brand-new item has no sync mapping yet, so it
  couldn't be recognized as the echo it actually was, and got
  republished under a new `sync_id` - which the other side then applied
  the exact same way, creating another duplicate and republishing
  again, forever. Fixed by applying an incoming create through the
  adapter directly (`self._adapter.add_item()`), never through
  `TodoManager` - mirroring how applying an incoming *update* already
  correctly used `self._adapter.update_item()` for this exact reason;
  only the create path had the gap.
  **If you tested linked lists before this version, check both sides for
  duplicate items and delete them manually - this integration only ever
  creates/deletes items on request, so cleanup needs to happen through
  the UI, not automatically.**

## 0.16.8

Full audit of every item mutation in the card, prompted by the user
asking "does this work for delete/reorder/load too?" before testing
0.16.7 further - a good instinct, since it turned up several more
instances of the same underlying problem: an action correctly reaching
`TodoManager` isn't automatically enough, since `EVENT_ITEM_CHANGED`
still has to actually be fired for linked lists (and the open-items
sensor, and the automation trigger platform) to see it at all.

- **Delete** (both the edit dialog's Delete button and each row's own
  delete cross) called the native `todo.remove_item` service directly,
  same bypass as 0.16.7's quick-add bug - a deletion could never
  propagate to a linked peer, leaving a ghost item there forever.
  There was no `todo_overlay`-level delete at all to route through
  instead - added `TodoManager.delete_item()` and
  `todo_overlay/delete_item`, firing `"removed"`.
- **Editing an existing item's title/description/due date** (the edit
  dialog's Save) also called the native `todo.update_item` service
  directly, for the same reason - added `TodoManager.update_item()` and
  `todo_overlay/update_item`, firing `"updated"` (new action - doesn't
  match any of the 8 defined automation triggers, which is intentional;
  it exists for sync/the sensor, not as a new trigger type).
- **Replacing an item's tag list** (the dialog's tag field) already
  went through the correct `todo_overlay/set_tags` call - but
  `TodoManager.set_tags()` itself never fired any event at all. Now
  fires `"tags_replaced"`.
- **Loading a saved list** never fired `"created"` for any of the new
  items it creates - fixed in `_create_snapshot_nodes`.
- **Undoing a completion cascade** (`restore_completed`) never fired
  `"completed"`/`"uncompleted"` for the restored items - fixed.

Confirmed already correct and unaffected: creating an item (dialog and,
as of 0.16.7, quick-add), quantity changes, adding/removing individual
tags, completing/uncompleting, reordering (0.16.3), and cross-entity
drag-and-drop.

Full suites pass: 239 backend (7 new), 176 frontend (1 new, 2 rewritten
to assert the correct websocket command); tsc clean, hassfest clean.

## 0.16.7

- Found and fixed the actual bug behind linked lists not syncing,
  root-caused via the debug logging added in 0.16.5/0.16.6 across a
  real two-instance live test: the card's quick-add bar (the fast
  "+" → type → Enter path) called the native `todo.add_item` service
  directly, completely bypassing `TodoManager.create_item()` - the
  only thing that fires `EVENT_ITEM_CHANGED`, which linked lists (and
  the open-items sensor, and the `todo_overlay` trigger platform) all
  depend on entirely. An item added via quick-add never reached any of
  that code, silently - no error, nothing to log, since the bypass
  happened one level up from everything we'd instrumented. The item
  dialog's own "add" already went through the correct path; only the
  quick-add bar had this gap. Now calls `todo_overlay/create_item`
  (`TodoManager.create_item()`) like every other creation path in the
  card.

## 0.16.6

- Added a debug log at the very entry of `manager.py`'s `_fire_event`
  (before the `self._hass is None` guard), since 0.16.5's link_sync
  logging showed nothing at all when adding a test item on a real linked
  instance - not even the earliest possible point in the chain. This
  will show definitively whether `_fire_event` is even being called and
  whether `self._hass` is unexpectedly `None` on the shared manager
  instance. Investigation ongoing.

## 0.16.5

- Fixed a blocking-call warning HA logged live during the first real
  two-instance linked-list test ("Detected blocking call to
  load_default_certs ... inside the event loop"): `tls_set()` loads the
  system's default CA certs from disk, a genuinely blocking filesystem
  operation that was running directly in `PahoMqttTransport.__init__`
  (not async, with no way to hop to the executor on its own). Deferred
  to `async_connect()` instead, alongside the executor job the actual
  socket connect already uses.
- Added debug logging throughout `link_sync.py`'s local-change handling
  (`async_handle_local_change`, `_on_item_changed_event`) - added while
  live-diagnosing a real two-instance link where an item added on one
  side wasn't reaching the other at all, to see exactly which
  no-op branch (if any) was being hit. Investigation ongoing as of this
  release - see the next entry once resolved.

## 0.16.4

- Fixed the drag highlight visually jumping onto the next row the
  instant an item was picked up on mobile, before any real movement -
  reported live right after 0.16.3. Root cause: the dragged row
  disappears (`.lifted`) and every row below it slides up to close the
  gap the moment a drag engages, so the very first hit-test right after
  engaging - still at essentially the pickup point - lands on whichever
  row just slid into the dragged item's old on-screen slot, highlighting
  it as the drop target despite nothing having actually been dragged
  there. Mouse has this exact same race technically, but it's barely
  noticed in practice (a mouse drag usually has real travel before
  anyone's looking closely); a handle-initiated touch drag engages
  almost instantly with near-zero travel, and a finger physically covers
  the very row whose highlight just silently jumped, so it read as an
  obvious, disorienting glitch. Fixed by suppressing hit-testing until
  the pointer has moved a small, deliberate distance (12px) from where
  the drag actually started - comfortably below a real "move to the next
  slot" gesture, comfortably above incidental jitter.

## 0.16.3

- Fixed other open cards (a different browser/device/tab) never
  reflecting a reorder - reported live right after 0.16.2's touch-drag
  fix made reordering on mobile actually work, which is what surfaced
  this. Root cause: reordering is purely `todo_overlay`'s own overlay
  metadata, never touching the native `todo.*` entity's items or state
  at all - and the card's *only* live-refresh trigger was watching that
  native entity's `state_changed` (via `hass.states[entity].last_updated`
  changing). With nothing ever touching native state, no other open card
  had any signal at all that anything had changed.
  `move_item` now fires the same `EVENT_ITEM_CHANGED` event every other
  mutation already fires (action `"moved"`), and the card now subscribes
  to that event directly (`hass.connection.subscribeEvents`) instead of
  relying solely on native `state_changed` - reloading any time a
  matching event arrives for its entity. This closes the same gap for
  tag/quantity changes too, which shared the identical root cause: the
  backend already fired an event for them, but nothing on the frontend
  was ever listening for it.

## 0.16.2

- Replaced 0.16.1's fix for drag-to-reorder on touch (below) - confirmed
  live on a real device that it still didn't reliably work. Root cause of
  *that*: `touch-action` changes made mid-gesture (toggled once the
  hold-to-drag threshold was reached) aren't consistently honored by
  mobile browsers - by the 500ms mark, the browser has often already
  committed the touch to native scrolling, which is also why the drag
  ghost wasn't tracking in real time (a touch the browser has claimed for
  scrolling stops giving JS meaningful pointer data for it).
  Added a dedicated reorder mode instead: a new toolbar icon (only
  visible on touch/coarse-pointer devices - `show_reorder_toggle`,
  default on) toggles every row into showing a small drag-handle in place
  of its delete button. The handle is `touch-action: none` from the very
  first touchstart, never toggled - the actual reliable fix, since the
  browser never gets a chance to consider it scrollable in the first
  place, rather than having that decision taken back from it mid-gesture.
  Picking up the handle engages a drag immediately (no hold wait, like a
  mouse), since it has no "quick swipe should still scroll" ambiguity to
  protect against - only the handle drags; the rest of the row still
  scrolls the list normally, and tap-to-complete/edit are unaffected.
  Mouse users never see any of this (hold-anywhere-on-the-row already
  works reliably for them, unaffected by any of the above).

## 0.16.1 (superseded by 0.16.2 - see above)

- Fixed drag-to-reorder not working at all on a real touchscreen (reported
  live via the HA Companion App). Root cause: nothing ever called
  `preventDefault()` or restricted `touch-action`, so the browser's own
  scroll-gesture recognizer regularly won the race against the JS
  hold-then-move drag logic - a held finger is never perfectly still, and
  that alone was usually enough for the browser to commit to a native
  scroll before the drag ever got a chance to engage. Fixed at all three
  points that needed it: the row locks `touch-action: none` once the
  hold-to-drag threshold is reached (previously unrestricted the whole
  time), the move event that actually engages a drag calls
  `preventDefault()`, and every subsequent move for the rest of an
  already-engaged drag keeps calling it too - none of this affects mouse,
  which has no competing native gesture to suppress.

## 0.16.0

- Added an "open items" sensor, auto-created one per `todo.*` entity
  (`sensor.todo_overlay_<list>_open_items`) - state is the count of
  incomplete items (the same number native HA's own `todo.*` entity
  state already reports - kept here too for dashboard/history
  convenience), and an `items` attribute with full per-item detail
  (title, description, due date/time, quantity, tags, whether it's a
  top-level item) that native HA has no way to expose without an extra
  `todo.get_items` service call in every automation. Meant to be
  referenced directly in a template trigger/condition (e.g.
  tag-filtering via `items | selectattr('tags', 'contains', 'urgent')`)
  or a notification message listing what's still open.
  Reactive via the same `async_subscribe_updates()` mechanism
  due_scheduler.py already uses, and tracks todo.* entities being
  added/removed/renamed the same way due_scheduler does too.

## 0.15.2

Security review of the linked-lists feature, before the first real
install/PVT against a production broker:

- Fixed `join_link` accepting an arbitrary, unvalidated `link_id` string
  and splicing it directly into MQTT topic filters. A value containing
  `+`/`#` (MQTT wildcards) could widen a single link's subscription into
  every link's traffic on the broker - cross-link data leakage and
  forged writes into a real `todo.*` entity from an unrelated link
  sharing the same broker. `link_id` is now validated against the exact
  shape `create_link` generates (32 lowercase hex characters).
- The MQTT broker password field in **Configure MQTT link** was a plain
  text input (no password selector, unlike HA core's own `mqtt`
  integration) and re-displayed the real stored password as the form's
  default every time the step was reopened to change an unrelated field.
  Now uses a proper password selector, and a sentinel placeholder instead
  of the real value - matching core's own pattern for the identical
  problem.
- Incoming MQTT link messages had no schema/type validation before being
  applied to a real entity - a missing title raised an unhandled
  exception (log spam), and remote field values had no length cap.
  Malformed or oversized incoming fields are now sanitized and capped
  before being applied.

## 0.15.1

- Added MQTT-over-WSS support for the broker connection, so a linked-list
  broker can be reached through a reverse proxy's WSS (e.g. Nginx Proxy
  Manager terminating TLS with an existing wildcard cert) instead of
  needing a dedicated forwarded port for raw MQTT+TLS. New options-flow
  fields: connection type (`tcp`/`websockets`, default `tcp`) and
  websocket path (default `/mqtt`). Each instance's broker connection is
  independent, so this is opt-in per instance - a local instance can stay
  on plain `tcp://broker:1883` against the same broker a remote instance
  reaches via `wss://mqtt.example.com:443`.
- Verified against a real Mosquitto instance with both a plain and a
  websocket listener configured: the real transport connects,
  authenticates, and round-trips a message over the websocket listener
  specifically.

## 0.15.0

- Added linked lists: two independent Home Assistant instances (e.g. two
  households) can now keep one list in sync over MQTT. Designed with
  security explicitly in mind - no inbound port on either instance ever
  needs to open, credentials never touch the card/frontend, and the sync
  protocol is narrow and purpose-built rather than exposing general API
  access to either side.
- One MQTT broker connection per instance, configured once via a new
  Options flow (Configure MQTT link/Disable MQTT link) - entirely
  skippable, host/port/username/password/TLS, stored server-side in the
  config entry.
- Any number of independent, strictly two-party links, each created via
  services (`create_link`/`join_link`/`unlink`) rather than the config
  flow, since linking is a repeatable per-list action. A link is defined
  purely by a shared random link id - the two sides' entity IDs/names
  never need to match.
- Sync is deliberately scoped: only item content syncs (title/completed/
  description/due/quantity/tags), not position/hierarchy; conflicts
  resolve last-write-wins by wall-clock UTC timestamp; deletions are
  tombstoned for a bounded window so a late/reordered message can't
  resurrect an already-deleted item; a full retained snapshot is
  exchanged on (re)connect so an offline side reconciles immediately.
  Frontend gets a small read-only link badge on the list header (status
  only, no credentials).
- Verified at every layer: unit tests against a fake transport, a real
  local Mosquitto instance (TLS, no anonymous access, per-user ACLs), a
  real two-instance simulation over that broker, and live end-to-end
  against the real dev instance (pointed at a disposable test broker,
  never a production one) - the dev instance's actual todo items were
  never touched at any point.

## 0.14.1

- Added a local brand icon (`custom_components/todo_overlay/brand/
  icon.png`), the one genuine gap HACS' brands check found now that the
  repo is public - it looks for a local icon before falling back to the
  community brands repository.

## 0.14.0

- Fixed the GitHub Actions frontend job failing on a stale
  `package-lock.json` (npm 11 tolerated it locally; CI's npm 10 correctly
  refused it) and 3 hassfest errors (missing `iot_class`, missing
  `lovelace` in `dependencies`, no `triggers.yaml` for the trigger
  platform), plus a `CONFIG_SCHEMA` warning via `cv.empty_config_schema`.
- Made the `todo_overlay` trigger properly discoverable in the automation
  editor's "+ Add Trigger" picker - it always validated and attached fine
  standalone, but HA's picker reads a separate description system that
  only recognizes the newer class-based `Trigger` pattern. Split the
  single flat trigger into 8 distinct triggers (created/completed/
  uncompleted/removed/tag_added/tag_removed/quantity_changed/due), each
  with a standard target entity selector, matching how HA's own `todo`
  integration exposes its own item-change events.

## 0.13.0

- Fixed a crash ("Something went wrong") when dragging a nested item to
  the top level, plus the leftover grey-band placeholder after a drag.
- Fixed the trigger-on-due and mark-complete checkboxes silently
  cancelling out on a real click, due to a double-firing native click
  event; both now bind to `@change` and read the checkbox's own `.checked`
  value.
- Restored a 12h/AM-PM due-date selector with a calendar-style date
  picker popup, hand-rolled after confirming `ha-date-input`/
  `ha-time-input` aren't reliably registered as custom elements in a
  third-party card's context.
- Fixed dragging an item into a completely empty list, and a backend race
  where a stale trigger-on-due reconcile pass could clobber a
  just-scheduled trigger.
- Moved each list's title onto the same row as its toolbar icons, instead
  of stacked on two lines.

## 0.12.2

- Checkboxes are now an optional, off-by-default row element (`show_checkboxes`
  in the card config). Tapping a row still completes it exactly as before -
  the checkbox was always a visual affordance layered on top of that, never
  the actual tap target (it has `pointer-events: none`), so hiding it changes
  nothing about how completion works.
- Added a delete (✕) button to the right side of every leaf row, as a
  quicker path to removing a single item than opening its edit dialog. A
  first tap arms it (turns red); a second tap within 3 seconds confirms the
  delete, honoring the same `confirm_delete` setting as the dialog's own
  Delete button. Not shown on parent rows - deleting a whole subtree still
  goes through the edit dialog.
- Diagnosed a report that the edit dialog's Delete button "did nothing":
  added an end-to-end regression test driving the exact flow (long-press to
  open the dialog, click Delete, confirm) and confirmed the underlying logic
  and service call are correct. Hardened the confirm-delete row's CSS to
  wrap onto its own line on a narrow (phone) dialog instead of risking the
  Cancel/Delete buttons being pushed off-screen, the most likely real-world
  cause.
- Collapsed/expanded group state now persists per entity in `localStorage`,
  so a page reload - notably a phone browser's connection dropping and the
  dashboard reloading - no longer resets every group back to expanded.

## 0.12.1

Follow-up polish on the card row layout, reported live right after 0.12.0:

- A parent row (children hidden checkbox) no longer reserves an empty
  `.checkbox-slot` at all - it's dropped from the layout entirely rather
  than kept-but-invisible, which was the actual source of inconsistent
  spacing between parent rows (an empty slot and a real `<ha-checkbox>`
  never quite occupy their box the same way). Every parent row with its
  checkbox hidden now has an identical, simpler layout: chevron, bold
  title, done.
- Cut the dead space before a row's content roughly in half (row
  padding, the chevron/spacer column, and inter-element gaps are all
  tighter), and reduced per-level indentation - hierarchy now leans more
  on the parent row's bold (and very slightly larger) title than on deep
  indentation, closer to how the reference card distinguishes a child
  with no indentation at all.

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
