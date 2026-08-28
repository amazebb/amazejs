# amazejs

Zero-dependency interactive data tables in vanilla JavaScript. One ES module, no build step, no package manager — import it straight from a CDN and call `initTable(config)`.

**[Live demo](https://amazebb.github.io/amazejs/)** — a flat table and a tree table, both zero-config.

## Table of contents

- [Features](#features)
- [Quick start](#quick-start)
  - [Explicit columns](#explicit-columns)
  - [How columns are chosen](#how-columns-are-chosen)
  - [Picking columns in the browser](#picking-columns-in-the-browser)
  - [Deep fields](#deep-fields)
  - [Tree tables](#tree-tables)
- [Theming](#theming)
- [API](#api)
- [Development](#development)
- [License](#license)

## Features

- **Sorting** — click any column header; numeric-aware.
- **Filtering** — category (checkbox) and text filter dropdowns open on header hover; global search across configurable keys.
- **Tree tables** — nested JSON (e.g. countries → states / timezones) is auto-detected and rendered as expandable rows with lazily built child tables, each with its own toolbar, filters, and settings.
- **File menu** — open a local CSV/TSV/JSON file into the table, export the visible rows as CSV or JSON.
- **Columns menu** — every field found in the data, however deeply nested, one tick away from becoming a sortable, filterable column.
- **Settings** — per-table toggles for row numbers, column separators, and a frozen (sticky) toolbar.
- **Theming** — a default light/dark theme ships built in; override CSS custom properties to restyle.

## Quick start

```html
<table id="myTable"></table>

<script type="module">
    import { initTable } from 'https://cdn.jsdelivr.net/gh/amazebb/amazejs@latest/dist/amazejs.js';

    initTable({
        data: ['data/items.json'],   // or pass an array of objects directly
        tableId: 'myTable',
    });
</script>
```

Columns, title, and filters are inferred from the data. The component CSS — including a default light/dark theme — is injected automatically, so this works on a completely bare page.

### Explicit columns

```js
import { initTable, linkCell } from 'https://cdn.jsdelivr.net/gh/amazebb/amazejs@latest/dist/amazejs.js';

initTable({
    data: items,
    tableId: 'myTable',
    title: 'Packages',
    striped: true,
    columns: [
        { key: 'name', label: 'Name', render: linkCell('name', 'url', { wrap: 'code' }) },
        { key: 'type', label: 'Type', filter: 'category' },
        { key: 'desc', label: 'Description' },
    ],
    buttons: [
        { label: 'Copy names', onClick: (visibleItems, btn) => { /* ... */ } },
    ],
});
```

### How columns are chosen

Without explicit `columns`, the columns are read from the data itself:

- Keys are the **union of the first 50 items'** keys, in first-seen order.
- **Arrays of objects become expandable child tables**, not columns.
- Everything else is a column, arrays of scalars included (they render as a value
  list: first entry plus a `+N` popover).

#### Where sampling falls down: ragged JSON

Uniform data — a CSV or TSV, or a JSON array whose items all carry the same fields —
is picked up perfectly: every column is found, no matter how many rows there are.

The sample only matters for **ragged** data, where items don't share a shape. The
classic source is a tool that omits fields it has nothing to say about:

```
brew info --installed --json=v2 > all.json
```

Every formula there carries `name`, `desc` and `versions`, but `head_dependencies`
appears only on formulae that *have* a HEAD build, `oldnames` only on renamed ones,
and casks use a different field set entirely. Scanning one item would miss most of
that, which is why the scan reads 50 — but that is still a sample, and it has a hard
edge:

> **A field that first appears at item 51 or later is invisible** — not in the table,
> and not in the Columns menu either, since path discovery reads the same 50 items.

Three ways to deal with it, in order of effort:

1. **Pass `columns` explicitly** for the fields you care about. Path keys mean a rare
   deep field is one line whether it is top-level or buried:

   ```js
   import { initTable } from 'https://cdn.jsdelivr.net/gh/amazebb/amazejs@latest/dist/amazejs.js';

   initTable({
       data: ['all.json'],
       tableId: 'brewTable',
       dataKey: 'formulae',              // which array in the root object to table
       searchKeys: ['name', 'desc'],
       columns: [
           { key: 'name', label: 'Name' },
           { key: 'desc', label: 'Description' },
           { key: 'versions.stable', label: 'Stable' },                 // nested object
           { key: 'head_dependencies', label: 'HEAD deps' },            // rare, top-level
           { key: 'installed[0].time', label: 'Installed', numeric: true },
           { key: 'installed[*].installed_on_request',                  // rare, nested in an array
             label: 'Requested', filter: 'category' },
       ],
   });
   ```

   Every key is a path: `.` steps into an object, `[0]` picks an element, and `[*]`
   maps over the array so the filter means "any element matches". Listing a path
   explicitly bypasses discovery entirely, so it works no matter where in the file
   the field first appears. Note that passing `columns` also turns off automatic tree
   mode — you get a flat table with exactly these columns, not expandable child rows.
2. **Put a representative item first.** The scan is order-sensitive, so a data
   generator that emits the richest record early solves it for free.
3. **Raise the sample.** `SAMPLE_SIZE` in `src/model.js` is the single constant
   behind key scanning and path discovery; the cost is a slower first paint on large
   files.

A useful sanity check when a field seems missing: open the **Columns** menu and
search for it. If it isn't listed there either, it's outside the sample — not
mis-rendered.

### Picking columns in the browser

Every table's toolbar has a **Columns** menu (behind the `⋯` overflow) listing every
nested field found in the data. Search it, tick a path, and it becomes a column —
sortable and filterable like any other, with no config. Fields with few distinct
values arrive with checkbox filters, so a boolean like
`installed[*].installed_on_request` is ready to filter on the spot.

### Deep fields

A column key can be a path, so a nested field becomes a normal column — sortable,
filterable, searchable, exportable:

```js
columns: [
    { key: 'name' },
    { key: 'versions.stable', label: 'Stable' },
    { key: 'installed[0].time', numeric: true },
    { key: 'installed[*].installed_on_request', label: 'Requested', filter: 'category' },
]
```

`[*]` maps over an array and yields every match, so filtering on it means "any
element matches". Paths work anywhere a field is named, including `searchKeys` and
`linkCell`.

### Tree tables

Pass nested data — a root wrapper object or items containing arrays of objects — and tree mode engages automatically:

```js
initTable({ data: { countries: [/* each may hold states: [...], timezones: [...] */] }, tableId: 'worldTable' });
```

## Theming

A complete light/dark default theme is built in — no CSS required. The defaults have zero specificity, so anything you define on `:root` wins automatically. Override only what you want to change:

```css
:root {
    --accent: #8250df;       /* e.g. purple accent */
    --radius: 10px;
    --font: 'Inter', sans-serif;
}
```

Available variables: `--bg`, `--bg-subtle`, `--bg-hover`, `--text`, `--text-muted`, `--accent`, `--accent-subtle`, `--accent-border`, `--accent-shadow`, `--border`, `--border-muted`, `--row-hover`, `--dropdown-shadow`, `--radius`, `--font` (defaults are in [`src/amazejs.css`](src/amazejs.css)).

## API

`initTable(config)` is the single entry point. Commonly used options:

| Option | Default | Description |
|---|---|---|
| `data` | required | Array of objects, a root wrapper object, or `[url, fallbackUrl?]` to fetch (`.json`, `.csv` or `.tsv`) |
| `tableId` / `table` | auto | Target `<table>` by id or element reference |
| `columns` | inferred | `{ key, label?, filter?, render?, numeric? }`; `filter: 'category'` or `'text'` |
| `title` | derived | Toolbar title (from data key or URL filename) |
| `searchKeys` | `[]` | Fields included in the global search |
| `exportFilename` | derived | Export name; `false` hides the File menu |
| `buttons` | `[]` | Extra toolbar buttons: `{ label, onClick(visibleItems, btn) }` |
| `striped`, `bordered`, `rowNumbers` | `false` | Appearance toggles |
| `lockWidths` | `true` | Freeze column widths from the full data set so filtering doesn't reflow them |
| `objectCell` | `'summary'` | How nested-object values render: `'summary'`, `'lines'` or `'table'` |
| `objectAlign` | `'left'` | Alignment of object-cell values: `'left'` or `'right'` |
| `collapsed` | `false` | Start as a collapsed disclosure line; table builds on first expand |
| `levels` | auto | Tree-mode per-depth overrides, or `false` to force a flat table |

The full option reference lives in [CLAUDE.md](CLAUDE.md).

## Development

No build, no tests, no tooling — serve the repo over HTTP and open the demo:

```
python3 -m http.server 8000
# http://localhost:8000/docs/
```

The library source is in [`src/`](src/), split MVC-style: `model.js` (pure data logic), `view.js` (DOM construction), `controller.js` (state + wiring), `tree.js` (nested tables), `index.js` (exports).

## License

[MIT](LICENSE)

Demo data (`docs/data/tree.json`) by [Countries States Cities Database](https://github.com/dr5hn/countries-states-cities-database) | [ODbL v1.0](https://opendatacommons.org/licenses/odbl/1-0/)
