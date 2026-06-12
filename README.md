# amazejs

Zero-dependency interactive data tables in vanilla JavaScript. One ES module, no build step, no package manager — import it straight from a CDN and call `initTable(config)`.

**[Live demo](https://amazebb.github.io/amazejs/)** — a flat table and a tree table, both zero-config.

## Table of contents

- [Features](#features)
- [Quick start](#quick-start)
  - [Explicit columns](#explicit-columns)
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
- **Settings** — per-table toggles for row numbers, column separators, and a frozen (sticky) toolbar.
- **Theming** — a default light/dark theme ships built in; override CSS custom properties to restyle.

## Quick start

```html
<table id="myTable"></table>

<script type="module">
    import { initTable } from 'https://cdn.jsdelivr.net/gh/amazebb/amazejs@v0.1.0/src/index.js';

    initTable({
        data: ['data/items.json'],   // or pass an array of objects directly
        tableId: 'myTable',
    });
</script>
```

Columns, title, and filters are inferred from the data. The component CSS — including a default light/dark theme — is injected automatically, so this works on a completely bare page.

### Explicit columns

```js
import { initTable, linkCell } from 'https://cdn.jsdelivr.net/gh/amazebb/amazejs@v0.1.0/src/index.js';

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
| `data` | required | Array of objects, a root wrapper object, or `[jsonUrl, tsvUrl]` to fetch |
| `tableId` / `table` | auto | Target `<table>` by id or element reference |
| `columns` | inferred | `{ key, label?, filter?, render?, numeric? }`; `filter: 'category'` or `'text'` |
| `title` | derived | Toolbar title (from data key or URL filename) |
| `searchKeys` | `[]` | Fields included in the global search |
| `exportFilename` | derived | Export name; `false` hides the File menu |
| `buttons` | `[]` | Extra toolbar buttons: `{ label, onClick(visibleItems, btn) }` |
| `striped`, `bordered`, `rowNumbers` | `false` | Appearance toggles |
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
