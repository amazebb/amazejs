# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Testing / demo environment

The demo app lives in `../brewbar/docs/` (a sibling repo). It has two pages:
- `index.html` / `app.js` — flat table of Homebrew packages
- `tree.html` / `tree-app.js` — nested tree table of countries

To serve it locally (required — ES modules and `fetch` need HTTP), run the server from the common parent so the `../../amazejs/` relative path resolves:
```
cd .. && python3 -m http.server 8000
# then open http://localhost:8000/brewbar/docs/
```

**Switching between local and CDN**: edit one line in `docs/amazejs.js` — it's a re-export shim that all pages import from. Swap the commented line to point at the local library instead of the CDN.

## What this is

amazejs is a zero-dependency vanilla JS ES module library for interactive data tables. It has no build system, no package manager, and no test runner — all files are plain `.js`/`.css` consumed directly by a browser via `<script type="module">`.

There are no build, lint, or test commands.

## Architecture

The library follows a strict MVC split across four files:

- **`model.js`** — pure functions only, no DOM. Handles data fetching (`fetchData`, `parseTsv`), column inference (`inferColumns`), filtering (`getVisible`, `computeCounts`), and sorting (`sortItems`).
- **`view.js`** — DOM construction only, no business logic or mutable state. Auto-injects `amazejs.css` via `import.meta.url` on module load. Exports all DOM builders and mutators used by the controller.
- **`controller.js`** — wires model + view; owns all mutable state (filter sets, sort state, visible set). The main entry point is `initTable(config)`.
- **`tree.js`** — internal tree support, not exported publicly. `initTable` delegates here when data is tree-shaped (`isTreeData`: a root wrapper object, or items containing arrays of objects) or `levels` is passed. Children are detected per item: every array-of-objects property is a child group (e.g. a country with both `states` and `timezones`); an item with multiple groups expands into expandable group header lines, each revealing its own child table. Child tables are rendered lazily on first expand using a delegated click listener on the container. Uses a `WeakMap` to store toggle button metadata without touching the DOM. Tree-specific code must stay in this file.
- **`index.js`** — barrel re-export: `initTable`, `fetchData`, `parseTsv`, `linkCell`.

## Public API

### `initTable(config)`

The single entry point for both flat and tree tables. Tree mode engages automatically when the resolved data is a root wrapper object (e.g. `{ countries: [...] }`) or items contain arrays of objects — unless explicit `columns` are passed or `levels` is `false`.

| Option | Type | Default | Notes |
|---|---|---|---|
| `data` | `Array`, root object, or `[jsonUrl, tsvUrl]` | required | If a two-element string array, fetched via `fetchData` |
| `tableId` | string | auto-generated | ID of the `<table>` element, or use `table` directly |
| `table` | HTMLTableElement | — | Direct element reference (for nested use) |
| `columns` | `Array<{key, label?, filter?, render?, numeric?}>` | inferred | `filter: 'category'` → checkbox dropdown; `filter: 'text'` → text dropdown; `false` → sortable only |
| `searchKeys` | string[] | `[]` | Fields included in the global search |
| `exportFilename` | string | — | Enables CSV/JSON export button when set |
| `buttons` | `Array<{label, onClick}>` | `[]` | Extra toolbar buttons; `onClick(visibleItems, btn)` |
| `nested` | boolean | `false` | Suppresses toolbar/wrapper creation for child tables |
| `title` | string | auto | Toolbar title. Auto-derived: root object key, else URL filename without extension (uppercased), else blank. Pass explicitly to override. |
| `dataKey` | string | first array property | Key on a root wrapper object holding the items array |
| `levels` | `Array<{childrenKeys?, childrenKey?, nameKey?}>` or `false` | auto-detected | Tree-mode per-depth overrides: `childrenKeys` restricts which arrays count as children at that depth, `nameKey` picks the first column (default `'name'`); array length caps expansion depth. `false` forces a flat table. |
| `childFilterRow` | boolean | `false` | Tree mode: show the toolbar (title, count badge, export, settings) on child tables under group header lines. Hidden entirely by default — the count badge sits on the header line instead. |
| `showToolbar` | boolean | `true` | `false` skips toolbar creation entirely (no title, export, settings) |
| `countBadgeEl` | HTMLElement | — | External count badge element updated on refresh (used internally by tree group header lines) |
| `searchInputEl` | HTMLInputElement | — | External search input for nested tables |
| `striped` | boolean | `false` | |
| `bordered` | boolean | `false` | |
| `rowNumbers` | boolean | `false` | |
| `stickyHeaders` | boolean | `true` | |
| `showFilterRow` | boolean | `true` | |
| `badgeAlwaysShow` | boolean | `false` | |
| `searchDebounce` | boolean or number | `true` (150ms) | `false` = no debounce |

Column `filter` can also be set via `data-col-<key>` attributes on the `<table>` element, e.g. `data-col-status="Status,category"`.

### `linkCell(textKey, hrefKey, { wrap? })`

Returns a column `render` function that builds `<a>` elements, optionally wrapped in another tag (e.g. `'code'`).

## CSS theming

`amazejs.css` uses only CSS custom properties. The host app **must** supply these variables (typically on `:root`):

```
--bg, --bg-subtle, --bg-hover
--text, --text-muted
--accent, --accent-subtle, --accent-border, --accent-shadow
--border, --border-muted
--row-hover
--dropdown-shadow
--radius
```

## Key design constraints

- No DOM access in `model.js` — keep it that way.
- No business logic or state in `view.js` — it only builds/mutates DOM and returns references.
- Child tables in tree view are built lazily (first expand only) inside a single `aj-children-row` sibling `<tr>`; subsequent toggles just show/hide. An item with one child group expands straight into its table; with multiple groups it first shows an expandable `aj-group` header line per group (TIMEZONES, STATES) carrying a live count badge, each building its table on first expand. Tables under header lines have no toolbar at all by default (`childFilterRow: false` → `showToolbar: false`).
- Filter dropdowns are portalled to `<body>` and positioned via JS; they use the native Popover API (`popover="auto"`).
- Row visibility is toggled via `.hidden` CSS class (not `display` style), and striped row numbers use CSS counters so they recount visible rows automatically.
