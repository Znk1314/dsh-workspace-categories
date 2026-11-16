# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Workspace folding: the triangle at the left of a workspace row (or
  *Collapse workspace* in its menu) hides just that workspace's sessions,
  remembered per workspace. A search re-opens folded workspaces and categories
  so a match is never hidden.

### Fixed

- Equal treatment of folding: categories could be collapsed while workspaces
  could not.
- Session rows were indented by a hand-tuned 16 px, which put the status dot
  well left of the folder icon above it. Both nesting levels now derive their
  columns from shared custom properties, so a session's dot is centred on its
  workspace's folder icon and its title starts on the workspace title.

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
