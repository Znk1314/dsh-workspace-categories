# Contributing

Thanks for looking at this project. It is a single-file DSH client plugin plus a
small Host half, so the loop is short.

## Layout

| Path | Purpose |
|---|---|
| `client.js` | Browser half: the categorised sidebar view. Plain browser JS, no JSX, no build step. |
| `index.js` | Host half: one authenticated route that persists the category document. |
| `cordis.patch.yml` | The bundle patch that inserts this plugin's row. |
| `locale/*.json` | Plugin Manager display metadata (English and Chinese). |
| `docs/` | The single feature image rendered by the plugin detail page. |
| `tools/` | Verification harness. Not shipped to users. |

## Ground rules

1. **No build step.** `client.js` runs as written. Do not add JSX, TypeScript, or
   a bundler: the browser evaluates this file directly through DSH's module
   loader.
2. **No imports of DSH client packages.** The browser half may only use `react`,
   `react-dom`, and the Cordis `ctx`. DSH client packages change shape between
   releases, and importing one blanks this plugin's slot entry when it moves.
   Copy the small patterns you need instead.
3. **Theme tokens only.** Use `--dsw-alias-*` and `--dsw-radius-*`; literal
   colours will break the opposite theme.
4. **Every drag-only action needs a menu path.** Pointer, keyboard, and touch
   users must all be able to file and re-order.
5. **No silent writes.** A gesture that changes nothing must not rewrite the
   document, and a failed save must be surfaced.
6. **Keep the icon vocabulary in step.** Adding a glyph means adding it to the
   browser `GLYPHS` table *and* the Host whitelist in `index.js`; a glyph the
   Host does not know is dropped on save.
7. **Derive indentation from the named columns.** `.wsx-workspace` defines
   `--wsx-icon-col` and `--wsx-title-col`, and both nesting levels use them, so a
   session's status dot stays centred under its workspace's folder icon. Do not
   reintroduce hand-tuned paddings.

## Running the checks

The harness needs a Node-compatible executable. Any of these work:

```sh
# a normal Node install
node tools/check-keys.js client.js
node tools/test-gestures.cjs client.js
node tools/test-folds.cjs client.js
node tools/test-icons.cjs client.js index.js
node tools/test-alignment.cjs client.js
node tools/test-regressions.cjs client.js
node tools/test-host.mjs

# or the DSH desktop executable as Node
ELECTRON_RUN_AS_NODE=1 "/path/to/DeepSeek Harness" tools/test-host.mjs
```

What each covers:

| Command | Covers |
|---|---|
| `check-keys.js` | Every `t('…')` key exists in both dictionaries, with no unused entries. |
| `test-gestures.cjs` | Assignment, re-ordering, pinned-group isolation, self-drop inertness, single-category membership. |
| `test-folds.cjs` | Category and workspace folding: stored folds normalise, the toggle flips one id, and a query overrides folds. |
| `test-icons.cjs` | Glyph well-formedness, browser/Host vocabulary parity, palette parity, and that the folder icon is the fold control. |
| `test-alignment.cjs` | Both nesting levels share one geometry: a session's status dot centres on its workspace's folder icon, and its title starts on the workspace title. |
| `test-regressions.cjs` | The submenu activation path, the long-press duration, and drop-seat resolution against a fake DOM. |
| `test-host.mjs` | Route registration, GET/PUT round-trip, on-disk bytes, hostile-input repair, bad JSON, concurrent writes. |

All seven must pass before a pull request is ready.

## Installing a local checkout

```text
Settings → Plugins → Add plugin → select this directory
```

Because a local install is a link, replacing JavaScript requires removing and
re-adding the plugin; DSH does not hot-swap an already loaded module.

## Adding a locale

1. Add the strings to the `zh` and `en` objects in `client.js` (escape non-ASCII
   as `\uXXXX` so the file stays safe through any editor or shell).
2. Add the display metadata to `locale/<lang>.json`.
3. Run `node tools/check-keys.js client.js` and make sure every key resolves.
