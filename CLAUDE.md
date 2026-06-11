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
- **`tree.js`** — internal tree support, not exported publicly. `initTable` delegates here when data is tree-shaped (`isTreeData`: a root wrapper object, or items containing arrays of objects) or `levels` is passed. Children are detected per item: every array-of-objects property is a child group (e.g. a country with both `states` and `timezones`). Expanding a row creates one nested table per group via `initTable` — a single group starts expanded, multiple groups start as collapsed disclosure toolbars (`collapsed: true`), whose table builds lazily on first expand (handled in controller.js). Row toggles use a delegated click listener on the container and a `WeakMap` for toggle metadata without touching the DOM. Tree-specific code must stay in this file.
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
| `exportFilename` | string or `false` | derived | The File menu (Open…, Export CSV, Export JSON) is shown by default. Export filename defaults to the slugified title, or `data.csv` when there is no title. Pass a string to set it explicitly, `false` to hide the menu. Open reads a CSV/TSV/JSON file and rebuilds the table in place with columns re-inferred. |
| `buttons` | `Array<{label, onClick}>` | `[]` | Extra toolbar buttons; `onClick(visibleItems, btn)` |
| `nested` | boolean | `false` | Suppresses toolbar/wrapper creation for child tables |
| `title` | string | auto | Toolbar title. Auto-derived: root object key, else URL filename without extension (uppercased), else blank. Pass explicitly to override. |
| `dataKey` | string | first array property | Key on a root wrapper object holding the items array |
| `levels` | `Array<{childrenKeys?, childrenKey?, nameKey?}>` or `false` | auto-detected | Tree-mode per-depth overrides: `childrenKeys` restricts which arrays count as children at that depth, `nameKey` picks the first column (default `'name'`); array length caps expansion depth. `false` forces a flat table. |
| `collapsed` | boolean | `false` | Start with only the toolbar disclosure line visible; the table body build (header, rows, filter wiring) is deferred to the first expand. Used internally for tree child groups; requires a toolbar. |
| `showToolbar` | boolean | `true` | `false` skips toolbar creation entirely (no title, export, settings) |
| `searchInputEl` | HTMLInputElement | — | External search input for nested tables |
| `striped` | boolean | `false` | |
| `bordered` | boolean | `false` | |
| `rowNumbers` | boolean | `false` | |
| `stickyHeaders` | boolean | `true` | |
| `showFilterRow` | boolean | `true` | |
| `badgeAlwaysShow` | boolean | `false` | |
| `searchDebounce` | boolean or number | `true` (150ms) | `false` = no debounce |

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
- Every toolbar is a disclosure header line (`.aj-toggle` arrow + `.atv-title` + `.atv-count-badge` inside the clickable `.atv-title-wrap`) that collapses/expands its `.atv-table-container` (which wraps toolbar + table for every table, nested or not). Regular tables start expanded; tree child groups under an item with multiple groups start collapsed (`collapsed: true`), deferring the whole table build to first expand — this is how tree laziness works. An item with a single child group starts expanded (one click to reach the table). All nested tables get the full toolbar (File, Settings) behind the `⋯` overflow. Child tables live inside a single `aj-children-row` sibling `<tr>`; subsequent row toggles just show/hide it.
- Nested (child) table toolbars are collapsible: only title + count badge show by default, with everything else (export, extra buttons, settings) inside `.atv-toolbar-more`, revealed by an ellipsis overflow button (`.atv-more-btn`): fade-in on hover of `.atv-more-wrap`, click to pin (state in `aria-expanded`, visibility via CSS sibling selector). New toolbar items should be appended to the `btnHost` container in `buildToolbar` so they collapse automatically.
- All dropdowns are nested in their trigger's DOM (filter dropdowns inside the `<th>`, array dropdowns inside the `<td>`, File/settings dropdowns in the toolbar) — never portalled to `<body>`. The native Popover API (`popover="auto"`) renders them in the top layer when open, and DOM nesting means File > Open can rebuild a table by replacing its container without leaking dropdowns. `attachPopover` (view.js) wires invoker buttons and keeps their `aria-expanded` in sync; with `{ hover: true }` (File/settings buttons and column-filter `<th>`s) the dropdown also opens on pointer-over and closes after a grace delay once the pointer leaves both invoker and dropdown (unless a text input inside is focused); moving onto a different column header closes it immediately. Column filter dropdowns have no trigger button: the `<th>` itself is the invoker — hover opens the filter, click sorts.
- `.aj-rotate` is the reusable indicator-rotation utility: any element with the class spins its `::before`/`::after` arrow while `aria-expanded="true"` (angle via `--aj-rotate-angle`, default 180deg). Used by tree row toggles (`.aj-toggle`, 90deg); apply it to future toggling UI rather than writing new transitions.
- Row visibility is toggled via `.hidden` CSS class (not `display` style), and striped row numbers use CSS counters so they recount visible rows automatically.
