# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Testing / demo environment

The demo lives in `demo/`: a single landing page (`index.html` / `app.js`) showing a flat table and a tree table, both zero-config. Data comes from `demo/data/flat.json` (array of objects) and `demo/data/tree.json` (root wrapper object). The demo imports `../src/index.js` directly — no build step.

To serve it locally (required — ES modules and `fetch` need HTTP):
```
python3 -m http.server 8000
# then open http://localhost:8000/demo/
```

`../brewbar/docs/` (a sibling repo) is a real-world consumer, useful as a second test bed. Its pages import from `docs/amazejs.js`, a re-export shim — swap the commented line there to switch between the local library (`../../amazejs/src/index.js`, serve from the common parent dir) and the CDN (jsDelivr, pinned to a git tag).

## What this is

amazejs is a zero-dependency vanilla JS ES module library for interactive data tables. The `src/` files are plain `.js`/`.css` consumed directly by a browser via `<script type="module">` — this is the dev path (the demo imports `../src/index.js` raw, no build).

For CDN consumers there is **one** build: `bun run build` bundles `build/entry.js` into `dist/amazejs.js` — a single self-contained, minified ESM file with `amazejs.css` inlined as a `<style>`. Consumers pin `cdn.jsdelivr.net/gh/amazebb/amazejs@latest/dist/amazejs.js`; after tagging a release, regenerate `dist/`, commit it, and purge that one jsDelivr path. There is no lint or test command.

## Architecture

The library lives in `src/` and follows a strict MVC split across four files:

- **`model.js`** — pure functions only, no DOM. Handles data fetching (`fetchData`, `parseTsv`), column inference (`inferColumns`), filtering (`getVisible`, `computeCounts`), and sorting (`sortItems`).
- **`view.js`** — DOM construction only, no business logic or mutable state. Injects `amazejs.css` lazily and once on the first `initTable()` (`ensureStyles`): raw/dev use loads the sibling file via `import.meta.url` `<link>`; the bundle calls `setStyles()` at import time with the inlined CSS, injected as a `<style>`. Exports all DOM builders and mutators used by the controller.
- **`controller.js`** — wires model + view; owns all mutable state (filter sets, sort state, visible set). The main entry point is `initTable(config)`.
- **`tree.js`** — internal tree support, not exported publicly. `initTable` delegates here when data is tree-shaped (`isTreeData`: a root wrapper object, or items containing arrays of objects) or `levels` is passed. Groups work the same at both ends. At the root, `getRootGroups` returns every array-of-objects property of the wrapper object (or the single array when `dataKey` is set, or a bare array); more than one means one full, non-nested table per group, stacked in a host `<div>` that replaces the original `<table>`, each collapsed on first render. Per item, every array-of-objects property is a child group (e.g. a country with both `states` and `timezones`). Groups are never merged — shared keys can hold different types across groups (`all.json`'s `installed` is an array of objects in `formulae` and a string in `casks`), so each group infers its own columns. Expanding a row creates one nested table per group via `initTable` — a single group starts expanded, multiple groups start as collapsed disclosure toolbars (`collapsed: true`), whose table builds lazily on first expand (handled in controller.js). Row toggles use a delegated click listener on the container and a `WeakMap` for toggle metadata without touching the DOM. Tree-specific code must stay in this file.
- **`index.js`** — barrel re-export: `initTable`, `fetchData`, `parseTsv`, `linkCell`.

## Public API

### `initTable(config)`

The single entry point for both flat and tree tables. Tree mode engages automatically when the resolved data is a root wrapper object (e.g. `{ countries: [...] }`) or items contain arrays of objects — unless explicit `columns` are passed or `levels` is `false`.

| Option | Type | Default | Notes |
|---|---|---|---|
| `data` | `Array`, root object, or `[url, fallbackUrl?]` | required | If a string array, fetched via `fetchData`; each URL is parsed by extension (`.json`, `.csv`, else TSV), the second used only if the first request fails |
| `tableId` | string | auto-generated | ID of the `<table>` element, or use `table` directly |
| `table` | HTMLTableElement | — | Direct element reference (for nested use) |
| `columns` | `Array<{key, label?, filter?, render?, numeric?, separator?, format?}>` | inferred | `filter: 'category'` → checkbox dropdown; `filter: 'text'` → text dropdown; `filter: 'range'` → numeric Min/Max dropdown (auto-applied to inferred numeric columns); `false` → sortable only. Numeric columns display with locale thousands separators by default; set `separator: false` to disable (years, IDs, zips). Formatting is display-only — sort/filter use the raw values. `key` may be a path — see below. |
| `searchKeys` | string[] | `[]` | Fields included in the global search |
| `exportFilename` | string or `false` | derived | The File menu (Open…, Export CSV, Export JSON) is shown by default. Export filename defaults to the slugified title, or `data.csv` when there is no title. Pass a string to set it explicitly, `false` to hide the menu. Open reads a CSV/TSV/JSON file and rebuilds the table in place with columns re-inferred. |
| `buttons` | `Array<{label, onClick}>` | `[]` | Extra toolbar buttons; `onClick(visibleItems, btn)` |
| `nested` | boolean | `false` | Suppresses toolbar/wrapper creation for child tables |
| `title` | string | auto | Toolbar title. Auto-derived: root object key, else URL filename without extension (uppercased), else blank. Pass explicitly to override. |
| `dataKey` | string | every array of objects | Which array on a root wrapper object to table. Left unset, a root holding several arrays of objects (`all.json`'s `formulae` + `casks`) renders one table per array — see below. |
| `levels` | `Array<{childrenKeys?, childrenKey?, nameKey?}>` or `false` | auto-detected | Tree-mode per-depth overrides: `childrenKeys` restricts which arrays count as children at that depth, `nameKey` picks the first column (default `'name'`); array length caps expansion depth. `false` forces a flat table. |
| `collapsed` | boolean | `false` | Start with only the toolbar disclosure line visible; the table body build (header, rows, filter wiring) is deferred to the first expand. Used internally for tree child groups; requires a toolbar. |
| `showToolbar` | boolean | `true` | `false` skips toolbar creation entirely (no title, export, settings) |
| `searchInputEl` | HTMLInputElement | — | External search input for nested tables |
| `striped` | boolean | `false` | |
| `bordered` | boolean | `false` | |
| `rowNumbers` | boolean | `false` | |
| `stickyHeaders` | boolean | `true` | Freezes the toolbar at the top of the scroller and pins the table's header row directly beneath it (offset by `--aj-toolbar-h`, the toolbar's measured height). Toggled at runtime from the Settings menu. |
| `showFilterRow` | boolean | `true` | |
| `formats` | `{ [key]: format }` | — | Display formats by column key (a path), applied by `inferColumns` to every column however it arrives — including ones added from the Columns picker, which carry no config of their own. A format is `'date'`, `'datetime'`, `'time'`, `'relative'`, or a function `(value, item) => string`. Epoch numbers are read as seconds below `1e11` and milliseconds above. A format applies to the cell, CSV export, and the text/category filters and search (so the screen text is what you search), while sorting and the Min/Max range keep the raw value — a date column stays chronological. It overrides the numeric thousands separator, wins over the array/object cell renderers, and falls back to the plain text when the value can't be formatted. Per-column equivalent: `col.format`. |
| `labelStyle` | `'upper'` or unset | unset | The table's one labelling rule, applied by `inferColumns` to every column without an explicit `label`. `tree.js` passes `'upper'`; flat tables leave it unset and get `labelFor`'s capitalized default. Nothing else derives labels, so any path that adds a column later (the Columns picker, a rebuild) matches automatically. |
| `lockWidths` | boolean | `true` | Freezes the column widths the auto layout computes from the full data set (measured once, right after the rows are built) and switches the table to `table-layout: fixed`, so filtering to a few rows no longer re-fits every column. `false` keeps the native auto layout. |
| `objectCell` | `'summary'`, `'lines'`, or `'table'` | `'summary'` | How a plain-object cell value (a nested record like `{stable, head}`) renders. `'summary'`: first pair inline + a `+N` badge opening a popover of all pairs; `'lines'`: one `key: value` per line; `'table'`: a bare striped key/value table in the cell. Per-column override via `col.objectCell`. Search, filters, sort and CSV export all use the flattened `"k: v, k: v"` text (`cellText`). |
| `objectAlign` | `'left'` or `'right'` | `'left'` | Text alignment of the value column in `'summary'` and `'table'` object cells. Per-column override via `col.objectAlign`. |
| `badgeAlwaysShow` | boolean | `false` | |
| `badgePosition` | `'left'`, `'right'`, or `'none'` | `'left'` | `'left'` keeps the count badge in the title line; `'right'` moves it to the far end of the toolbar, after all buttons; `'none'` hides it. Cycled at runtime via the Settings menu button (Count on Left → Count on Right → Count None). |
| `searchDebounce` | boolean or number | `true` (150ms) | `false` = no debounce |

### Which columns show on first load

With no explicit `columns`, the visible set is derived from the data, and three rules
decide it — worth knowing, because a field can be present in the data yet absent from
the table:

1. **Keys come from a sample, not the whole set.** `sampleKeys` (model.js) unions the
   keys of the first `SAMPLE_SIZE` (50) items, in first-seen order — records vary, so
   the first item alone misses fields. `inferColumns` and tree mode's `getColumns`
   both use it, and `discoverPaths` samples the same 50.
   **Caveat: a field that first appears after item 50 is in neither the table nor the
   Columns picker.** Raise `SAMPLE_SIZE`, or pass explicit `columns`, for data whose
   shape varies that late.
2. **Arrays of objects become child groups, not columns** (tree mode) — that is the
   expandable nested table. A key counts as a group if *any* sampled item holds an
   array of objects for it, so an empty array in the first item can't demote it.
   Arrays of scalars (`oldnames`, `aliases`) are ordinary columns rendering as a
   value list.
3. **Everything else is a column**, in sampled-key order with `nameKey` pulled first.

Anything left out is still one tick away in the Columns menu, which lists containers
as well as leaves — provided it was in the sample.

### Columns menu

Non-nested tables get a **Columns** toolbar menu (next to File and Settings, behind
the `⋯` overflow) listing every path `discoverPaths` finds in the data — leaves and
their containers (an object or array of objects is a column too, reported with
`distinct: Infinity` so it never gets a checkbox filter) — walked over the first
`SAMPLE_SIZE` items, 4 levels deep, capped at 400 paths, with the dropdown's search
box for the rest. Ticked rows are the columns on screen; ticking another adds
it as an ordinary column keyed by its path and rebuilds the table in place
(`rebuildColumns`, the same swap File > Open uses, reusing the existing column objects
so a tree's first column keeps its render and its row toggles). A path with
`distinct <= CATEGORY_MAX` (25) values in the sample gets `filter: 'category'`, so
booleans and enums arrive as checkboxes instead of a text box. Columns are re-sorted
into the dropdown's own (discovery) order on every change, so re-ticking one puts it
back where it was rather than at the far end — except a tree's first column, which is
pinned first because it carries the row-toggle render. Added columns carry no label of their
own — `inferColumns` derives every missing one on the rebuild, so they match whatever
the rest of the table uses. After the rebuild `focusColumn` scrolls the new column
into view (`th[data-col]`) and flashes its header with `.aj-flash`, since on a wide
table it can land off-screen. A rebuild resets the
current filters, and the picked columns don't persist across a reload. Show All /
Clear All are stripped from that dropdown — on deep data they would mean "add 400
columns".

### Path keys

Any key naming a field — `col.key`, `searchKeys`, `linkCell`'s two keys — may be a
path into nested data, so a deep field becomes an ordinary column with ordinary
sorting and filters:

```js
columns: [
    { key: 'name' },
    { key: 'versions.stable', label: 'Stable' },
    { key: 'installed[0].time', numeric: true },
    { key: 'installed[*].installed_on_request', label: 'Requested', filter: 'category' },
]
```

Segments are dotted names, numeric indices, and `[*]`, which maps over an array and
yields every match (so a category/text filter on it means "any element matches").
Resolution is `getValue(item, key)` in `model.js`, paired with `cellText` as
`cellValue(item, key)` — the single accessor behind cells, filters, counts, search,
sort and CSV export; a plain key still takes a direct property lookup first, so
keys containing dots keep working. Inferred labels use the path's last named
segment. Header/dropdown element ids are keyed by column index, since path
characters (`[`, `*`, `.`) break `#id` selectors.

### `linkCell(textKey, hrefKey, { wrap? })`

Returns a column `render` function that builds `<a>` elements, optionally wrapped in another tag (e.g. `'code'`).

## CSS theming

`amazejs.css` uses only CSS custom properties and ships a complete default theme (light + dark via `prefers-color-scheme`), declared in `:where(:root)` so it has **zero specificity**: any host rule on `:root` outranks the defaults regardless of stylesheet load order. Tables must look right on a bare page with no host CSS — the component scopes its own `box-sizing`, font (`--font`, system stack default), text color, and button/input font inheritance to `.atv-table-container`. Keep new variables in the `:where(:root)` block and new base styles scoped to the container.

Themeable variables:

```
--bg, --bg-subtle, --bg-hover
--text, --text-muted
--accent, --accent-subtle, --accent-border, --accent-shadow
--border, --border-muted
--row-hover
--dropdown-shadow
--radius
--font
```

## Key design constraints

- No DOM access in `model.js` — keep it that way.
- No business logic or state in `view.js` — it only builds/mutates DOM and returns references.
- Every toolbar is a disclosure header line (`.aj-toggle` arrow + `.atv-title` + `.atv-count-badge` inside the clickable `.atv-title-wrap`) that collapses/expands its `.atv-table-container` (which wraps toolbar + table for every table, nested or not). Regular tables start expanded; tree child groups under an item with multiple groups start collapsed (`collapsed: true`), deferring the whole table build to first expand — this is how tree laziness works. An item with a single child group starts expanded (one click to reach the table). Every table (flat or nested) gets the full toolbar (File, Columns, Settings) behind the `⋯` overflow. Child tables live inside a single `aj-children-row` sibling `<tr>`; subsequent row toggles just show/hide it.
- All table toolbars collapse the same way: only title + count badge show by default, with everything else (export, extra buttons, settings) inside `.atv-toolbar-more`. Revealed two ways: on hover devices, hovering `.atv-more-wrap` (the reserved space the hidden buttons occupy); on any device, clicking the `.atv-more-btn` ellipsis toggles `aria-expanded`. The `⋯` button sits *outside* `.atv-more-wrap` (but adjacent, for the `+ .atv-more-wrap` reveal selector) so hovering/clicking it never trips the hover-reveal — keeping the click a clean toggle that `:hover` can't fight. New toolbar items should be appended to the `btnHost` container in `buildToolbar` so they collapse automatically.
- All dropdowns are nested in their trigger's DOM (filter dropdowns inside the `<th>`, array dropdowns inside the `<td>`, File/settings dropdowns in the toolbar) — never portalled to `<body>`. The native Popover API (`popover="auto"`) renders them in the top layer when open, and DOM nesting means File > Open can rebuild a table by replacing its container without leaking dropdowns. `attachPopover` (view.js) wires invoker buttons and keeps their `aria-expanded` in sync; with `{ hover: true }` (File/settings buttons and column-filter `<th>`s) the dropdown also opens on pointer-over and closes after a grace delay once the pointer leaves both invoker and dropdown (unless a text input inside is focused); moving onto a different column header closes it immediately. Column filter dropdowns have no trigger button: the `<th>` itself is the invoker — hover opens the filter, click sorts.
- `.aj-rotate` is the reusable indicator-rotation utility: any element with the class spins its `::before`/`::after` arrow while `aria-expanded="true"` (angle via `--aj-rotate-angle`, default 180deg). Used by tree row toggles (`.aj-toggle`, 90deg); apply it to future toggling UI rather than writing new transitions.
- Row visibility is toggled via `.hidden` CSS class (not `display` style), and striped row numbers use CSS counters so they recount visible rows automatically.
