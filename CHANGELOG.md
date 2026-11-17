# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- A category is now one rounded rectangle filled with a light tint of its
  accent (the band and its glyph carry the colour), replacing the left colour
  strip. Its workspaces and sessions hang below on an indent guide, so the
  hierarchy reads category → workspace → session without nested chrome.
- Session rows lost their leading status dot. A session title now starts on the
  same left edge as its workspace title.
- Added **All / Recent / Categories** filter tabs; `view.mode` became
  `view.tab`.
- The Unassigned bucket is demoted to a collapsible footer entry, since it is a
  catch-all rather than a peer of the user’s own categories.
- Category glyphs render at 18px and category names at 14px.

### Removed

- The **Recently used** chip strip above the tabs. The Recent tab still lists
  recently used workspaces.

### Fixed

- **Reverted the priority removal from the previous commit. It took the plugin
  off the sidebar.** I had read DSH's `guard.ts` and concluded the facade
  overwrites any package-supplied `priority`, then removed ours. The live slot
  ledger reports `-1000` back verbatim, which proves that code path is not the
  one this package registers through: the literal value is applied. With no
  explicit priority the entry no longer undercut the shipped browser's implicit
  0, the built-in browser took the seat, and the sidebar looked uninstalled.
- A seated extension's failure is now contained by a React error boundary.
  `renderSlot` returns a node that renders later, inside reconciliation, so the
  try/catch around the call could not reach a throw inside the extension — and
  such a throw propagates up through this component, abdicating the slot exactly
  like the priority bug. The boundary is also built behind a `typeof
  React.Component` guard, because a class expression at module scope throws if
  the seeded React lacks it, which would take the plugin down before first render.

- **Compatibility:** this package replaces the whole browsing region, which
  silently evicted every extension seated inside a session row. It now forwards
  `sidebar.session.row.leading`, `sidebar.session.row.trailing` and
  `sidebar.workspaces.session.row.action` with the same props the shipped
  browser passes, so those extensions keep rendering. Empty seats add no DOM and
  a throwing seat is skipped instead of taking the sidebar down.
- The `priority: -1000` on the registration was dead weight: DSH's browser-half
  facade allocates every non-chain slot's shadowing priority itself and
  overwrites whatever a package passes. It is removed rather than left in place
  implying control over precedence that does not exist.

- The running-session spinner had **no CSS at all**. The row emitted a
  `.wsx-spinner` element but no `.wsx-spinner` rule and no `@keyframes`
  existed, so it rendered with zero size and zero colour — invisible. Both are
  now present, with a reduced-motion fallback that shows a static ring.
  `tools/test-layout.cjs` gains assertions for the spinner's size, ring,
  animation, keyframes, and reduced-motion rule, which is the check that was
  missing when it shipped broken.
- The section label was secondary ink; it now uses primary ink.
- The section label now shares one inline edge variable with the search field,
  so its left end lines up with the search box's rounded edge.
- The section label still read low at 13px with a -0.5px lift, so the optical
  nudge is now -2px. The font size stays at 13px; only the label moves.
- The section label read bottom-heavy next to the icons at 15px; a CJK glyph's
  ink mass sits under the middle of its em box, and the larger the glyph the
  more the offset shows. The label is now 13px — close to the 16px glyphs beside
  it — and its optical lift is `-0.5px` rather than `-1px`, since a smaller
  glyph has a smaller offset.
- The section label still sat a hair below the icon centres after the header
  was geometrically centred. A CJK glyph's ink mass sits under the middle of its
  em box, so the label now carries its own `--wsx-header-label-nudge`
  (`translateY(-1px)`), independent of the icon column's hook. Neither nudge
  changes the row height.
- The three header controls sat immediately after the label instead of on the
  sidebar's right edge: the label was declared `flex: 0 1 auto`, so it shrank to
  its text width and left the free space unclaimed. It now grows
  (`flex: 1 1 auto`), pushing the controls to the right edge.
- The running-session spinner never appeared. The row read only
  `statuses.get(id)?.running`, but the status map carries no entry until a
  baseline or event establishes one. It now falls back to the summary's own
  `running` flag, matching how the shipped tree resolves it
  (`status?.running ?? summary.running`).
- The section header aligned its label and three trailing icons by relying on a
  shared `line-height`, which left the text sitting slightly off the icons'
  optical centre. The label and every icon now occupy the same fixed 24px box,
  centred by flex `align-items`, with each SVG normalised to `display: block` so
  no inline baseline gap survives. One variable owns that box, and a
  `--wsx-header-icon-nudge` (`translateY`) is provided for sub-pixel optical
  correction without changing the row height.
- The "Workspaces" section title was 12px inside a 34px row while its three
  trailing buttons were 24px, so the label never lined up with the glyphs. The
  title is now 15px on the same 24px box the buttons occupy.
- A running session showed only its timestamp; it now shows a spinner in place
  of the timestamp, so live work is visible at a glance. The spinner respects
  `prefers-reduced-motion`.
- The category tint covered the whole block (its workspaces and sessions),
  not just the category row. The fill now belongs to the header row alone and
  the children sit on the plain sidebar surface.
- The appearance picker rendered every colour swatch black, and its icon grid
  ignored the chosen colour: both used `currentColor`, which stopped tracking
  the accent when the tone classes moved to a variable last round. They now
  read `--wsx-accent`, and the dialog root carries the draft tone so the grid
  previews it.
- The active filter tab was only bolder text; it is now a tinted rounded pill
  (light blue by default).
- The section title and its three trailing buttons had different row heights;
  they now share one 24px row.

- Picking a category colour tinted its name, every workspace title, and every
  session title: the tone class set `color` on the band, which inherited. Tone
  classes now declare a custom property only, and each title pins its own ink.
- Workspace titles and session titles did not share a left edge (40px vs 50px).
  Both now derive from one set of column variables.
- A render crash in an earlier rewrite (`draggingCategoryId` read but never
  declared) made the slot entry abdicate, silently falling back to the shipped
  browser. `tools/test-render.cjs` now renders every tab so this class of bug
  cannot ship again.

## [1.0.0] - 2026-11-16

### Added

- Sidebar workspace categories: each category is a rounded box holding an
  ordered set of workspaces and their sessions.
- Long-press drag (180 ms) to move a workspace into another category and to
  re-order workspaces freely inside one.
- Long-press drag on a category header to re-order categories, plus
  Move up / Move down rows in the category menu.
- Category pinning (pinned boxes always render first), seven accent colours,
  rename, collapse/expand, and delete with confirmation.
- Workspace menu: new session, move to category (with a checked list of the
  current category), remove from category, rename, delete.
- Search across session titles that auto-expands folded boxes and lifts the
  per-box row limit, archived-row filtering, and a flat "one list" view.
- An "Unassigned" box for workspaces that belong to no category and an
  "Other sessions" box for sessions that belong to no workspace, so nothing
  disappears from the sidebar.
- Durable storage through an authenticated Host route
  (`/api/workspace-categories.doc`) writing
  `<DSH_HOME>/plugin-data/dsh-workspace-categories/categories.json`, debounced
  and written serially via a temporary file plus rename.
- Visible save-failure notice with automatic retry every 5 seconds.
- English and Chinese locale metadata, an original icon, and a feature image
  for the plugin detail page.

### Fixed

- The "Move to category" submenu did not open: the popup closed itself before
  its own row-swap ran, so the swap saw a `null` menu and returned unchanged.
  Menu rows can now swap the popup's rows in place while keeping it open.
- Crossing categories silently did nothing: assignment reused a reorder helper
  that requires the item to be present, so a move had no effect.
- Dropping a row onto itself re-ordered it to the end of its box.
- Category re-ordering applied DOM display order to the stored order, so a drop
  across the pinned boundary was silently discarded.
- Session rows read the wrong identity field, which would have broken row
  clicks, status dots, pinning, and the shared context menu.
- Overlays were positioned relative to the sidebar (which is a containment
  context), so menus were offset and the dialog was clipped; they now portal to
  `document.body`.
- The primary dialog button used the theme's ink colour as a background, making
  it unreadable in the dark theme.
- Touch devices had no way to reach the workspace menu, so they could not file
  a workspace at all.
- Save failures were swallowed twice (`.catch(() => {})` and a non-throwing
  non-OK response), so unsaved categories were lost without notice.

[Unreleased]: https://github.com/Znk1314/dsh-workspace-categories/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Znk1314/dsh-workspace-categories/releases/tag/v1.0.0
