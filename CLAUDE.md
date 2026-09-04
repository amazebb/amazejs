# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Testing / demo environment

The demo lives in `docs/` (served as GitHub Pages): a single landing page (`index.html` / `app.js`) showing a flat table and a tree table, both zero-config. Data comes from `docs/data/flat.json` (array of objects) and `docs/data/tree.json` (root wrapper object). `docs/app.js` picks its library by hostname — the tagged CDN bundle only on `*.github.io`, `../dist/amazejs.js` everywhere else (localhost and any LAN address, so a phone or tablet pointed at the Mac's dev server gets the local build) — so **local testing runs the built bundle: `bun run build` before reloading**, or the page keeps the previous build.

To serve it locally (required — ES modules and `fetch` need HTTP):
```
python3 -m http.server 8000
# then open http://localhost:8000/docs/
```

Safari caches ES modules across a normal reload even with Disable Caches on — Develop > Empty Caches (⌥⌘E) when a change doesn't show.

`../brewbar/docs/` (a sibling repo) is a real-world consumer, useful as a second test bed. Its `app.js` switches the same way: `../../amazejs/dist/amazejs.js` off GitHub Pages (serve from the common parent dir), else the tagged CDN URL. Bump that pin on every amazejs release.

## What this is

amazejs is a zero-dependency vanilla JS ES module library for interactive data tables. The `src/` files are plain `.js`/`.css` consumed directly by a browser via `<script type="module">` — importing `src/index.js` raw needs no build.

For CDN consumers there is **one** build: `bun run build` bundles `build/entry.js` into `dist/amazejs.js` — a single self-contained, minified ESM file with `amazejs.css` inlined as a `<style>`. Consumers pin an exact tag — `cdn.jsdelivr.net/gh/amazebb/amazejs@v0.37.1/dist/amazejs.js` — never `@latest`, which browsers cache for 7 days and no purge can clear. A release is: `bun run build`, commit `dist/`, tag `vX.Y.Z` (feat bumps the minor, fix the patch), push the branch and the tag (lightweight tags need `git push origin <tag>`; `--follow-tags` skips them), then bump the pin in `docs/app.js`, in `README.md`'s three examples, and in `../brewbar/docs/app.js`. Each tag is a fresh immutable URL, so no purge is needed. There is no lint or test command.

**Type checking.** `tsc` (no arguments, from the repo root) checks `src/` against `tsconfig.json` and must exit 0. The source stays plain `.js` — a browser loads it raw, which a `.ts` port would end — so types are JSDoc: `Column` and `Format` in `model.js`, `Level` in `tree.js`, `TableConfig` above `initTable` in `controller.js`, shared with `/** @typedef {import('./model.js').Column} Column */`. `TableConfig` is the option table below in a shape an editor can offer, so a new option goes in both. `strict` is on bar two rules, each with its reason in the config.

## Architecture

The library lives in `src/` and follows a strict MVC split — `model.js`, `view.js` and `controller.js`, with `dates.js` and `tree.js` alongside them and `index.js` as the barrel:

- **`model.js`** — pure functions only, no DOM. Handles data fetching (`fetchData`, `parseTsv`), column inference (`inferColumns`), filtering (`getVisible`, `computeCounts`), and sorting (`sortItems`).

  **Reading only what can be a table** — `unreadableReason(name, mimeType, text)` returns the reason a file can't be tabled, or null. It is the one rule both readers use, so a fetched URL and File > Open refuse the same files in the same words. Two tests, in order: a declared media type that is never a table (`image/`, `audio/`, `video/`, `font/`, `model/`, and pdf/zip/gzip/tar/7z/wasm — but **not** `application/octet-stream`, which servers hand out for anything they don't recognise, `.tsv` included, so those fall through to the content), then the first 4KB of text for bytes no table holds: the C0 controls other than tab/CR/LF, DEL, and U+FFFD — what a decoder leaves behind when the bytes were never UTF-8. Both readers need it because only JSON fails on its own: **any** byte is a valid CSV field, so without the check a PNG named `.csv` becomes a table of mojibake. A refused fetch doesn't reject out of `initTable` — the reason takes the table's place (`buildLoadError`, an `.atv-load-error` block) and is logged with `console.warn`; File > Open keeps its `alert`.

  **Fetching from a webview's own scheme** — `fetchData` counts a response as delivered when `res.ok` **or `res.status === 0`** (`delivered`). Custom schemes — Electrobun's `views://`, Tauri's `tauri://`/`asset://`, Capacitor's assets — answer a bundled file with a bare response carrying no HTTP status, so `res.ok` is `false` while the body is intact, and without this those loads fell through to the fallback URL. It stays safe because a request that truly failed rejects out of `fetch` rather than arriving here. Those schemes also tend to send no `content-type`, which is the other reason `parseByUrl` goes by the extension.
- **`dates.js`** — pure date handling, no DOM: `toDate` (epoch seconds/milliseconds, ISO strings, `Date`), `toTimestamp`, the `DATE_FORMATTERS` behind the `date`/`datetime`/`time`/`relative` formats, `isDateFormat`, and the two picker conversions `toDateInput` / `fromDateInput`. `model.js` re-exports what the rest of the library needs, so nothing else imports it directly except `view.js`'s date-input branch. Date work belongs here, not in `model.js`.
- **`view.js`** — DOM construction only, no business logic or mutable state. Injects `amazejs.css` lazily and once on the first `initTable()` (`ensureStyles`): raw/dev use loads the sibling file via `import.meta.url` `<link>`; the bundle calls `setStyles()` at import time with the inlined CSS, injected as a `<style>`. Exports all DOM builders and mutators used by the controller.
- **`controller.js`** — wires model + view; owns all mutable state (filter sets, sort state, visible set). The main entry point is `initTable(config)`.
- **`tree.js`** — internal tree support, not exported publicly. `initTable` delegates here when data is tree-shaped (`isTreeData`: a root wrapper object, or items containing arrays of objects) or `levels` is passed. Groups work the same at both ends. At the root, `getRootGroups` returns every array-of-objects property of the wrapper object (or the single array when `dataKey` is set, or a bare array). Failing that it falls back, in order, to the first plain array property, then to every property holding a **single record** — one group of one row each, carrying the property name as `name`, so `{ meta: {…}, tree: {…} }` (an AST, a profile: a tree whose root is one node, not a list) opens from that row through the ordinary child-group logic — and finally, for a root of nothing but scalars, to the root object itself as a single row. A root object therefore never renders as a blank page. More than one group means one full, non-nested table per group, stacked in a host `<div>` that replaces the original `<table>`, each collapsed on first render. Per item, every array-of-objects property is a child group (e.g. a country with both `states` and `timezones`). A tree can also nest **by name** rather than by array (solar-system's `Sun` holds `Earth` holds `Moon`), so a property holding a single record can be a child node too. That decision is made **per table, not per item** (`nodeKeysFor`, called once by `getColumns` and closed over by the toggle render), in two steps:

1. *Does this table nest by name at all?* — `nestsByName`: some row has two or more record properties with the **same shape** (identical key sets, of more than one field). Saturn's seven identically-shaped moons say yes; an AST node's lone `data`, a formula's `versions`, and the coincidence of `urls` and `bottle` both being a lone `{ stable }` say no.
2. *Which keys, then?* — in a table that nests, a record found under a key **no other row carries** is a child (its key is a name); a key every row repeats (`versions`, `data`) is a column. A one-row table — the wrapper the Sun arrives in — has no repeats to weigh, so step 1 decides alone.

Per-item tests were tried first and don't work: Saturn's moons share only `naif` with Saturn, so any "repeats N of its parent's fields" rule drops them into the columns. Named nodes merge into **one** group, so the Sun's row opens a table of eight planets rather than eight tables of one row, each carrying its property name as `name` (its own wins if it has one) so `getColumns` pulls it first and the toggle sits on the named cell. That group's key is the library's word (`children`), not the data's, so it renders with `showToolbar: false` — a CHILDREN header line would only repeat the row above it — unless it is one of several groups, where being collapsed leaves the toolbar as the only way to open it. Groups are never merged — shared keys can hold different types across groups (`all.json`'s `installed` is an array of objects in `formulae` and a string in `casks`), so each group infers its own columns. Expanding a row creates one nested table per group via `initTable` — a single group starts expanded, multiple groups start as collapsed disclosure toolbars (`collapsed: true`), whose table builds lazily on first expand (handled in controller.js). Row toggles use a delegated click listener on the container and a `WeakMap` for toggle metadata without touching the DOM. Tree-specific code must stay in this file.
- **`index.js`** — barrel re-export: `initTable`, `fetchData`, `parseTsv`, `parseCsv`, `linkCell`.

## Public API

### `initTable(config)`

The single entry point for both flat and tree tables. Tree mode engages automatically when the resolved data is a root wrapper object (e.g. `{ countries: [...] }`) or items contain arrays of objects — unless explicit `columns` are passed or `levels` is `false`.

| Option | Type | Default | Notes |
|---|---|---|---|
| `data` | `Array`, root object, or `[url, fallbackUrl?]` | required | If a string array, fetched via `fetchData`; each URL is parsed by extension (`.json`, `.csv`, else TSV), the second used only if the first request fails |
| `tableId` | string | auto-generated | ID of the `<table>` element, or use `table` directly |
| `table` | HTMLTableElement | — | Direct element reference (for nested use) |
| `columns` | `Array<{key, label?, filter?, render?, numeric?, separator?, format?}>` | inferred | `filter: 'category'` → checkbox dropdown; `filter: 'text'` → text dropdown; `filter: 'range'` → Min/Max dropdown (auto-applied to inferred numeric columns, and to any column with a date `format`, where it becomes two native date pickers — see below); `false` → sortable only. **The data has the final say** (`filterFor`, model.js): the header build walks each column's display text once and either drops the filter (every value the same — always true of a one-row table: no filter button, nothing on hover) or promotes **any** filter to checkboxes (at most `CATEGORY_MAX` distinct values, the rule the Columns picker already uses) — 25 numbers or 25 days are a list to tick, not a span to bound, and the checkboxes say which values exist where a Min/Max only bounds them. `filter: false` stays off. A promoted numeric or date column lists its options in *value* order, not text order: the option build keeps each display text's raw value beside it and ranks by `Number` or `toTimestamp`, since text order puts 10 before 2, thousands separators make a number's own display unparseable, and `'relative'` (or a function format) has no order in its text at all. The walk stops as soon as the answer is settled, and is capped at `VARIANCE_SCAN` (1000) rows: past the cap the scan proves nothing about the unseen rows, so the column keeps the filter it was configured with (40 columns over 200k rows: 3ms). It reads the displayed text, so a `format` that collapses values (timestamps to one day) is judged as the reader sees it. Column objects keep their configured `filter` — the build works on copies — so a rebuild on other data reconsiders from scratch. Numeric columns display with locale thousands separators by default; set `separator: false` to disable (years, IDs, zips). Formatting is display-only — sort/filter use the raw values. `key` may be a path — see below. |
| `searchKeys` | string[] | `[]` | Fields included in the global search |
| `exportFilename` | string or `false` | derived | The File menu (Open…, Export CSV, Export JSON) is shown by default. Export filename defaults to the slugified title, or `data.csv` when there is no title. Pass a string to set it explicitly, `false` to hide the menu. Open reads a CSV/TSV/JSON file and rebuilds the table in place with columns re-inferred — replacing the whole `.aj-tree-host` when the table is one group of a multi-group tree, since each group carries a File menu of its own and the others would otherwise stay on screen beside the newly opened data (`rebuildColumns` deliberately does not: re-picking columns is that one group's business) — refusing anything that isn't text (`unreadableReason`, model.js — see below) with an `alert` rather than parsing it. The raw-source view is not in this menu — it is `.atv-source-btn`, a toggle in the toolbar's `rest` wrapper ahead of the `⋯`, always out (it switches the view; it is not one of the menus the `⋯` hides). It names where the press goes — `RAW` at rest, `TABLE` while pressed — typed like `.atv-title` beside it, with `aria-pressed` carrying the state and the CSS switching the `::before`. It swaps the table for a `<pre>` of what the table is showing — the rows the filters and search left, in the shape the data arrived in: `toCsv` over the visible items when the import was delimited, `JSON.stringify(visible, null, 2)` when it was JSON (or when the data came in as an array, which never had a file). It follows the sort order and re-renders from `refresh()` while open, so it is the current view as text, not the untouched file. The import's own text is kept in `model.js`'s `sourceText` WeakMap, keyed by the parsed data (set by `parseByUrl` and by File > Open through `rememberSource`) — used to decide CSV vs JSON, and dropped with the data. |
| `buttons` | `Array<{label, onClick, menu?}>` | `[]` | Extra actions; `onClick(visibleItems, el)`. `menu: 'file'` appends the action to the bottom of the File menu (as an `aj-array-item`, below Export JSON), `menu: 'settings'` to the bottom of Settings (as an `atv-settings-btn` row); either closes its dropdown before the handler runs. An `.aj-menu-sep` rule goes in once per menu, before the first added action, so the host's items read as a group of their own. Without `menu` it is a toolbar button of its own, added by the controller *after* the Columns menu so extra buttons always follow every menu. |
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
| `stickyHeaders` | boolean | `true` | Freezes the toolbar at the top of the scroller and pins the table's header row directly beneath it (offset by `--aj-toolbar-h`, the toolbar's measured height). The toolbar also sticks to the container's **left** edge, so the title, the RAW toggle and the menus stay on screen while a table wider than the viewport scrolls sideways. **Three boxes, and each does one job** — the whole frozen layout is these, and the temptation is always to make one of them do two:

| box | width | what it does |
|---|---|---|
| `.atv-table-container.atv-sticky-head` | `fit-content`, `min-width: 100%` | grows to the table so the page (not `.table-wrap`) scrolls sideways; `box-sizing: content-box` + `padding-right: var(--aj-port-inset)` gives the trailing space |
| `.atv-toolbar.atv-sticky` | `100%` of that | the bar: `top: 0` and a background across the **whole** scrollable width, so no row is ever beside it |
| `.atv-toolbar-pin` | its contents | the controls: `left: 0`, so the title and menus stay on screen |

The bar and the pin have to be separate elements. An element that fills its containing block has nowhere to slide, so a full-width toolbar can never stick sideways — give the bar the sticky-left and the title scrolls away with the table; give the pin the full width and rows show beside it. The right-hand count badge appends to the **toolbar**, not the pin, since the bar is the only box wide enough for `right: 1ch` to keep it on screen.

`content-box` on the container is what makes the trailing padding unconditional: the padding is added outside the width, so a table that already fits keeps its full width (the padding lands in the host's own padding and scrolls nothing) while a too-wide one gets the space after it. Under `border-box` the same declaration bites into the width instead — that was the v0.35.4–5 bug, and the conditional `--aj-port-pad`/`overflowsHost` it needed is gone.

**The controller measures, the stylesheet lays out.** `syncToolbarBox` (re-run whenever the toolbar or its host resizes) publishes exactly two properties on the container — `TOOLBAR_VARS` — and touches nothing else: `--aj-port-inset` (how far the page insets the container, from `pageInset`, read against `sidewaysScroller`: the nearest ancestor with `overflow-x: auto|scroll`, else the page, which is the normal case; 0 for a nested table, which scrolls in its parent's cell and sits flush) and `--aj-toolbar-h` (the toolbar's height, which the header row pins under). A new number goes in as a property, not as an inline style — and if a rule wants the viewport's width, that is the signal the boxes are wrong, not that another measurement is needed.

To check a layout change, measure it rather than eyeballing: a probe page that runs `initTable` on generated data, reads `getBoundingClientRect()` at `scrollX: 0` and again scrolled fully right, and writes the numbers into a `<pre>`, dumped with `'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' --headless=new --window-size=1200,800 --virtual-time-budget=6000 --dump-dom <url>`. The things to assert are `gapLeft == gapRight`, `documentElement.scrollWidth == clientWidth` on a table that fits (no phantom scrollbar), and the pin's `left >= 0` while scrolled. Toggled at runtime from the Settings menu. |
| `showFilterRow` | boolean | `true` | |
| `showButtons` | boolean | `true` | Leaves the toolbar menus (File, Columns, Settings, extra buttons) permanently out and drops the `⋯` that would reveal them. Toggled at runtime from Settings > Show Toolbar Buttons. The resting visibility of `.atv-toolbar-more` reads inherited custom properties (`--aj-more-vis/-op/-x`) that `.atv-show-more` / `.atv-hide-more` set on a container, so the nearest container wins: a table left alone follows the one above it (a tree's child groups follow the root), and a nested table can still dissent. `false` restores the old toolbar, where everything hides behind the `⋯` until hovered or tapped. `tree.js` threads the option down to child tables in `childOpts`. |
| `formats` | `{ [key]: format }` | — | Display formats by column key (a path), applied by `inferColumns` to every column however it arrives — including ones added from the Columns picker, which carry no config of their own. A format is `'date'` (`2026-07-10`), `'datetime'` (`2026-07-10T17:46:53+10`, minutes appended only for zones that have them: `+0530`), `'time'` (`17:46:53`), `'relative'` (`2 months ago`), or a function `(value, item) => string`. The date formats are ISO 8601 in local time, 24-hour, with a numeric offset — unambiguous, and text that sorts and prefix-searches (`2026-07`) as the values order; locale rendering is a one-line function format. Epoch numbers are read as seconds below `1e11` and milliseconds above; anything else goes to `Date`, so ISO strings parse as themselves. A format applies to the cell, CSV export, and the text/category filters and search (so the screen text is what you search), while sorting keeps the raw value — a date column stays chronological. **A date format also decides the filter**: `inferColumns` gives such a column `filter: 'range'` whatever its raw values are (`filterFor` may still promote that to checkboxes when the column holds few enough distinct days — see `columns` above) (epoch numbers would get a numeric Min/Max, ISO strings a text box — neither is the column the reader sees), and the range is built from two `<input type="date">` pickers whose own `min`/`max` are the column's first and last day, so the calendar opens on the data's years. Both boxes also *start* on those days (a date input has no placeholder to show a span with), while the filter state stays empty until one is changed — so the column isn't marked as filtering just for showing its own extent. A browser's `min`/`max` only steer the calendar, and a *typed* date outside them is still accepted, so the value is clamped to the span: on `input` for what the filter sees, and on `change` (not `input`, which would rewrite a year mid-keystroke) for what the box shows. The state holds timestamps with `date: true` beside them, which is how `matchesRange` knows to read each value as an instant; the From box means the picked day's first millisecond and the To box its last, so From = To keeps that whole day. It overrides the numeric thousands separator, wins over the array/object cell renderers, and falls back to the plain text when the value can't be formatted. Per-column equivalent: `col.format`. In tree mode a key written from the parent's point of view still lands: on every descent into a group the prefix is stripped and the remainder added (`installed[*].time` → `time` inside the INSTALLED table), so one entry covers both the picked column on the root table and the nested table's own column. |
| `labelStyle` | `'upper'` or unset | unset | The table's one labelling rule, applied by `inferColumns` to every column without an explicit `label`. `tree.js` passes `'upper'`; flat tables leave it unset and get `labelFor`'s capitalized default. Nothing else derives labels, so any path that adds a column later (the Columns picker, a rebuild) matches automatically. |
| `lockWidths` | boolean | `true` | Freezes the column widths the auto layout computes from the full data set and switches the table to `table-layout: fixed`, so filtering to a few rows no longer re-fits every column. `false` keeps the native auto layout. Measured once, at the end of the build — every row still visible, and *after* the sort wiring has made filterable `<th>`s `.sortable`, since a width locked before their `::after` arrow exists is one the arrow overflows into the next column. Two things the measurement has to arrange for: the row-number column is unhidden for the pass and re-hidden in the same frame (measured `display: none` it locks at `0px`, and the Settings toggle then reveals a zero-width column), and the measured total is written to the table's `min-width` (a fixed table narrower than its columns shrinks all of them proportionally, so on a phone the locked widths squeeze and the nowrap header content spills — with the min-width the wrapper scrolls instead). Anything that appears in a header later must hold its space at measurement time: that is why `.atv-filter-btn` hides with `visibility`, not `display`. |
| `objectCell` | `'summary'`, `'lines'`, or `'table'` | `'summary'` | How a plain-object cell value (a nested record like `{stable, head}`) renders. `'summary'`: first pair inline + a `+N` badge opening a popover of all pairs; `'lines'`: one `key: value` per line; `'table'`: a bare striped key/value table in the cell. Per-column override via `col.objectCell`. Search, filters, sort and CSV export all use the flattened `"k: v, k: v"` text (`cellText`). |
| `objectAlign` | `'left'` or `'right'` | `'left'` | Text alignment of the value column in `'summary'` and `'table'` object cells. Per-column override via `col.objectAlign`. |
| `badgeAlwaysShow` | boolean | `false` | |
| `badgePosition` | `'left'`, `'right'`, or `'none'` | `'left'` | `'left'` keeps the count badge in the title line; `'right'` moves it to the far end of the toolbar, after all buttons, and sticks it a character's width in from the right edge of the screen (`position: sticky; right: 1ch`) so a table wider than the viewport can't carry it off — on the right it is appended to the **toolbar** rather than to `.atv-toolbar-pin` with the other controls, since the toolbar is the box that spans the whole scrollable width and so the only one a sticky badge has room to travel in; `'none'` hides it. Cycled at runtime via the Settings menu button (Count on Left → Count on Right → Count None). |
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

Every table with a toolbar gets a **Columns** menu (next to File and Settings, behind
the `⋯` overflow) — a tree's nested group tables included, each picking over its own
group's data — listing every path `discoverPaths` finds in the data — leaves and
their containers (an object or array of objects is a column too, reported with
`distinct: Infinity` so it never gets a checkbox filter) — walked over the first
`SAMPLE_SIZE` items, 4 levels deep, capped at 400 paths, with the dropdown's search
box for the rest. Ticked rows are the columns on screen; ticking another adds
it as an ordinary column keyed by its path and rebuilds the table in place
(`rebuildColumns`, the same swap File > Open uses, reusing the existing column objects
so a tree's first column keeps its render and its row toggles). A path with
`distinct <= CATEGORY_MAX` (25) values in the sample gets `filter: 'category'`, so
booleans and enums arrive as checkboxes instead of a text box. Ticking a column moves that column and nothing
else: it is inserted before the first column ranking after it, and the columns already
on screen keep the order they are in — a configured table's order is the host's, and the
picker never re-sorts it into the data's. The ranking is `columnOrder`: the table as it
first stood, then every other discovered path — the order the dropdown lists in as well,
so the picker reads as the table it is picking for — threaded through each rebuild (and cleared
by File > Open, whose data has a shape of its own), so a column ticked off and back on
returns to the slot it held rather than to wherever discovery would put it. Column definitions are kept the same way: `columnDefs`, a
key → column-object map threaded through each rebuild alongside `columnOrder`, so a
column ticked off and back on returns as the column it was — brewbar's
`{ key: 'name', label: 'Name', render: linkCell(...) }` keeps its link and its label.
Only a key the table has never shown gets a fresh definition, and that one carries no
label of its own — `inferColumns` derives every missing one on the rebuild, so it
matches whatever the rest of the table uses. After the rebuild `focusColumn` scrolls the new column
into view (`th[data-col]`) and flashes its header with `.aj-flash`, since on a wide
table it can land off-screen. A rebuild resets the
current filters, and the picked columns don't persist across a reload. The dropdown is
the full filter shell, built from the same pieces — search box, option rows with their
hover-revealed **Only** button (`makeOptionRow` in view.js builds a row for a column
filter and for this picker alike; only the callbacks differ), and the Show All /
Clear All footer with its `n/m` badge. Only means that column by itself — nothing is kept
alongside it, a tree's first column included, so its row toggles are gone until it is
ticked back on — reusing a column object already on screen so its render, label and
format survive. Both actions work on the rows the **search has left listed**, never
on all 400 paths: Show All adds every listed path not already shown, Clear All drops
every listed one, keeping the first column so there is still a table to tick columns
back onto.

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

`amazejs.css` uses only CSS custom properties and ships a complete default theme (light + dark via `prefers-color-scheme`), declared in `:where(:root)` so it has **zero specificity**: any host rule on `:root` outranks the defaults regardless of stylesheet load order. Tables must look right on a bare page with no host CSS — the component scopes its own `box-sizing`, font (`--font`, system stack default), text color, and button/input font inheritance to `.atv-table-container`. Keep new variables in the `:where(:root)` block and new base styles scoped to the container — the bare element selectors (`table`, `th`, `td`, `tr`) are nested inside `:where(.atv-table-container)`, whose zero specificity leaves every rule weighing exactly what it did unnested, so a host page's own tables are untouched. `--accent-shadow` is derived from `--accent` with `color-mix()`, so a host that sets only the accent gets a matching focus ring. The container also declares `color-scheme: light dark` (the one element outside it, `.atv-load-error`, declares its own) so the native controls the table owns — checkboxes, date pickers — follow the reader's scheme; the theme variables themselves stay in two `prefers-color-scheme` blocks rather than `light-dark()`, which the bundler downlevels to a var toggle that breaks for variables declared on `:root`.

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
- All dropdowns are nested in their trigger's DOM (filter dropdowns inside the `<th>`, array dropdowns inside the `<td>`, File/settings dropdowns in the toolbar) — never portalled to `<body>`. The native Popover API (`popover="auto"`) renders them in the top layer when open, and DOM nesting means File > Open can rebuild a table by replacing its container without leaking dropdowns. **Placement is CSS, not JS** (`.filter-dropdown`, amazejs.css): `attachPopover` gives the trigger an `anchor-name` and the dropdown a matching `position-anchor`, and `position-area: block-end span-inline-end` makes the room below the trigger the dropdown's containing block — so it opens under the trigger's left edge, `max-height: clamp(120px, calc(100% - margins), 360px)` caps it to the room on that side (the cap only shrinks; the floor keeps it from becoming a sliver), and `position-try-fallbacks` + `position-try-order: most-block-size` flip it to whichever side has more room. A popover is fixed and in the top layer, so what the viewport cuts off is gone, not scrolled to: without the flip a `translations` cell on the last row shows one pair of nineteen. Because the cap means it never overflows, `most-block-size` is what triggers the flip — and it flips toward the roomier side even when the dropdown would have fitted below. Nothing measures or repositions in JS. `attachPopover` (view.js) wires invoker buttons and keeps their `aria-expanded` in sync; with `{ hover: true }` (File/settings buttons and column-filter `<th>`s) the dropdown also opens on pointer-over and closes after a grace delay once the pointer leaves both invoker and dropdown (unless a text input inside is focused); moving onto a different column header closes it immediately. Column filter dropdowns have no trigger button: the `<th>` itself is the invoker — hover opens the filter, click sorts.
- A column that is currently filtering says so in one place, the `.atv-filter-btn`: on `.active` it becomes a `--filter-icon` funnel (outline, so it never reads as a filled sort arrow) in `--accent` on an `--accent-subtle` chip. No tint behind the header label — that reads as hover, and a tint can't say *which* column is filtering. The button is always in the layout (`visibility: hidden` until it shows, not `display: none`), so the space it takes is in the widths `lockColumnWidths` measures and it can never appear wider than its locked column. `.active` is set from the column's own state (a text/range value, or a category selection short of its full value set) and never from the visible option counts, which another column's filter can zero out.
- `.aj-rotate` is the reusable indicator-rotation utility: any element with the class spins its `::before`/`::after` arrow while `aria-expanded="true"` (angle via `--aj-rotate-angle`, default 180deg). Used by tree row toggles (`.aj-toggle`, 90deg); apply it to future toggling UI rather than writing new transitions.
- Row visibility is toggled via the `.hidden` CSS class (not a `display` style), and the row-number column uses CSS counters, so it recounts the visible rows on its own.
