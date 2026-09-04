// Pure data functions — no DOM dependencies.

import { DATE_FORMATTERS, isDateFormat, toTimestamp } from './dates.js';

export { isDateFormat, toTimestamp, toDateInput, fromDateInput } from './dates.js';

// The shapes the whole library passes around. They live here because model.js is what
// every other file imports; the option-by-option prose is in CLAUDE.md.

/**
 * A display format: one of the four built-in date renderings, or a function that
 * turns the raw value into text. Display-only — sorting keeps the raw value.
 * @typedef {'date' | 'datetime' | 'time' | 'relative' | ((value: any, item: any) => string)} Format
 */

/**
 * @typedef {object} Column
 * @property {string} key           Field name, or a path ('versions.stable', 'installed[*].time').
 * @property {string} [label]       Header text; derived from the key when absent.
 * @property {'category' | 'text' | 'range' | false} [filter] false is sortable-only; the data can still overrule this (filterFor).
 * @property {(item: any) => Node | string} [render]
 * @property {boolean} [numeric]
 * @property {boolean} [separator]  false drops the locale thousands separator (years, IDs, zips).
 * @property {Format} [format]
 * @property {'summary' | 'lines' | 'table'} [objectCell]
 * @property {'left' | 'right'} [objectAlign]
 */

// True when data is the [url, fallbackUrl?] form accepted by initTable.
export function isUrlData(data) {
    return Array.isArray(data) && typeof data[0] === 'string';
}

// Derives a display title from a data URL: filename without extension, uppercased.
export function titleFromUrl(url) {
    return url.split('/').pop().replace(/\.[^.]+$/, '').toUpperCase();
}

// The text each parsed data set came from, so the raw-source view knows the file
// as it was imported rather than a re-serialization of the parse. Keyed by the parsed
// value, so it is dropped with the data and no copy of a large file is held alive.
export const sourceText = new WeakMap();

// Remembers text against the data parsed out of it, and returns the data.
export function rememberSource(data, text) {
    if (data && typeof data === 'object') sourceText.set(data, text);
    return data;
}

// Media types that are never a table, whatever the name says. Checked before the
// content, since a declared type is the one thing that can't be a false positive.
// application/octet-stream is not on the list: servers hand it out for anything they
// don't recognise, .tsv included, so those are left to the content check.
const BINARY_MIME = /^(image|audio|video|font|model)\/|^application\/(pdf|zip|gzip|x-gzip|x-tar|x-7z|wasm|.*\+zip)$/;

// Bytes no delimited or JSON table holds: the C0 controls other than tab, newline and
// carriage return, DEL, and U+FFFD — what a decoder leaves behind when the bytes were
// never UTF-8. A prefix is enough; a binary format declares itself in its first bytes.
const SNIFF = 4096;
const BINARY_BYTES = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\uFFFD]/;

// Why this content can't be tabled, or null when it can. One rule for both readers,
// so a fetch and File > Open refuse the same files in the same words.
export function unreadableReason(name, mimeType, text) {
    const type = (mimeType || '').split(';')[0].trim().toLowerCase();
    if (BINARY_MIME.test(type)) return `${name} is ${type}, which is not a table`;
    if (BINARY_BYTES.test(text.slice(0, SNIFF))) return `${name} is not a text file`;
    return null;
}

// Media types that name a table format. text/plain is deliberately absent: servers
// hand it out for CSV and TSV alike, so it settles nothing and the content decides.
/** @type {[RegExp, string][]} */
const TEXT_MIME = [
    [/^application\/(json|.*\+json)$/, 'json'],
    [/^(text|application)\/csv$/, 'csv'],
    [/^text\/tab-separated-values$/, 'tsv'],
];

// Which parser the text asks for, read from the text itself. JSON announces itself in
// its first character; between the delimited formats, the one the header row holds more
// of wins. Ties and neither go to TSV, the long-standing default.
function sniffFormat(text) {
    const head = text.trimStart();
    if (head[0] === '{' || head[0] === '[') return 'json';
    const line = head.split('\n', 1)[0];
    const tabs = (line.match(/\t/g) || []).length;
    const commas = (line.match(/,/g) || []).length;
    return commas > tabs ? 'csv' : 'tsv';
}

// The parser a data file gets: its extension when that names a format, else the served
// media type, else the content. Extension first because it is the author's own label
// and the one thing a redirect or a proxy can't restate; but a name is often no help —
// an API path ('/v1/datasets/42'), a query-string export ('?format=csv'), or an
// extension describing the server rather than the body ('report.php') all used to fall
// through to TSV and build a one-column table of whole CSV lines, with no error.
export function formatFor(name, mimeType, text) {
    const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
    if (ext === 'json' || ext === 'csv' || ext === 'tsv') return ext;
    const type = (mimeType || '').split(';')[0].trim().toLowerCase();
    const declared = TEXT_MIME.find(([re]) => re.test(type));
    return declared ? declared[1] : sniffFormat(text);
}

// Parses fetched text into rows. A response that isn't text at all is refused here
// rather than parsed into nonsense: a JSON file throws on its own, but every byte is a
// valid CSV field.
export function parseByUrl(url, text, mimeType) {
    const path = url.split(/[?#]/)[0];
    const name = path.split('/').pop() || path;
    const reason = unreadableReason(name, mimeType, text);
    if (reason) throw new Error(reason);
    return rememberSource(parseAs(formatFor(name, mimeType, text), text), text);
}

// One format name to one parser, so both readers turn text into rows the same way.
export function parseAs(format, text) {
    return format === 'json' ? JSON.parse(text)
        : format === 'csv' ? parseCsv(text)
            : parseTsv(text);
}

// A response carrying a body. Status 0 is not a failure: custom schemes — an Electrobun
// views:// bundle, a Tauri or Capacitor asset — answer with a bare response that has no
// HTTP status, so res.ok is false while the body is intact. A request that truly failed
// rejects instead of arriving here.
function delivered(res) {
    return res.ok || res.status === 0;
}

/**
 * Fetches data from url, falling back to fallbackUrl if the first request fails.
 * @param {string} url
 * @param {string} [fallbackUrl]
 */
export async function fetchData(url, fallbackUrl) {
    const res = await fetch(url);
    if (delivered(res)) return parseByUrl(url, await res.text(), res.headers.get('content-type'));
    if (!fallbackUrl) throw new Error(`Failed to load data from ${url}`);
    const fallbackRes = await fetch(fallbackUrl);
    if (!delivered(fallbackRes)) throw new Error(`Failed to load data from ${url} and ${fallbackUrl}`);
    return parseByUrl(fallbackUrl, await fallbackRes.text(), fallbackRes.headers.get('content-type'));
}

/**
 * Parses a TSV string into an array of objects keyed by the first-row headers.
 * @param {string} text
 */
export function parseTsv(text) {
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) return [];
    const headers = lines[0].split('\t').map(h => h.trim());
    return lines.slice(1).map(line => {
        const parts = line.split('\t');
        /** @type {Record<string, string>} */
        const obj = {};
        headers.forEach((h, i) => { obj[h] = (parts[i] || '').trim(); });
        return obj;
    });
}

// Parses a CSV string (quoted fields, "" escapes, CRLF) into an array of
// objects keyed by the first-row headers. Round-trips the CSV we export.
export function parseCsv(text) {
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c !== '"') field += c;
            else if (text[i + 1] === '"') { field += '"'; i++; }
            else inQuotes = false;
        } else if (c === '"') {
            inQuotes = true;
        } else if (c === ',') {
            row.push(field); field = '';
        } else if (c === '\n' || c === '\r') {
            if (c === '\r' && text[i + 1] === '\n') i++;
            row.push(field); field = '';
            rows.push(row); row = [];
        } else {
            field += c;
        }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }

    const records = rows.filter(r => r.length > 1 || r[0] !== '');
    const headers = records.shift();
    if (!headers) return [];
    return records.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
}

// Column keys are paths: a plain key, or dotted segments with array indices and
// [*] wildcards — 'versions.stable', 'installed[0].time',
// 'installed[*].installed_on_request'. Parsed once per key and cached, since
// every filter, sort and render pass resolves the same handful of keys.
const _paths = new Map();
function parsePath(key) {
    let segs = _paths.get(key);
    if (!segs) {
        segs = key.split(/\.|\[(.*?)\]/).filter(s => s !== undefined && s !== '');
        _paths.set(key, segs);
    }
    return segs;
}

// Resolves a column key against an item. A [*] segment maps over the array and
// returns every matched value, so 'installed[*].installed_on_request' is "the
// values from all installs" — which filters and search then treat as any-match.
export function getValue(item, key) {
    if (item == null) return undefined;
    if (key in Object(item)) return item[key]; // plain key, including keys with dots
    return walkPath(item, parsePath(key), 0);
}

function walkPath(value, segs, i) {
    for (; i < segs.length; i++) {
        if (value == null) return undefined;
        if (segs[i] === '*') {
            if (!Array.isArray(value)) return undefined;
            return value
                .map(v => walkPath(v, segs, i + 1))
                .filter(v => v !== undefined);
        }
        value = value[segs[i]];
    }
    return value;
}

// How many items the key/path scans read. Records in JSON vary, so the first item
// alone misses fields (all.json's head_dependencies); a sample catches them without
// walking thousands of rows before the first paint.
export const SAMPLE_SIZE = 50;

// Every key seen across a sample of the items, in first-seen order.
export function sampleKeys(items, sample = SAMPLE_SIZE) {
    const keys = new Set();
    items.slice(0, sample).forEach(item => {
        if (isPlainObject(item)) Object.keys(item).forEach(k => keys.add(k));
    });
    return [...keys];
}

// Resolves column definitions, merging config with numeric-detection defaults.
// Labels are derived here and nowhere else: every column that doesn't carry an
// explicit one gets labelFor(key), uppercased when labelStyle is 'upper' (tree
// tables). One rule, so any path that adds a column later matches the rest.
export function inferColumns(data, configCols, labelStyle, formats) {
    const base = configCols || sampleKeys(data).map(key => ({ key }));
    return base.map(col => {
        const isNumeric = data.every(item => {
            const v = getValue(item, col.key);
            return !v || !isNaN(Number(v));
        });
        const label = labelStyle === 'upper' ? labelFor(col.key).toUpperCase() : labelFor(col.key);
        // The formats map is keyed by path, so a column added later (the Columns
        // picker) picks up its format without being listed in `columns`.
        const format = formats?.[col.key];
        // A column formatted as a date filters as one, whatever its raw values are:
        // epoch numbers would otherwise get a numeric Min/Max, and ISO strings a text
        // box, neither of which is the column the reader is looking at.
        const dated = isDateFormat(format ?? col.format);
        const filter = dated || isNumeric ? 'range' : 'text';
        return { filter, numeric: isNumeric, label, format, ...col };
    });
}

// True for a plain object value — a nested record rendered as key/value pairs,
// as opposed to an array (a child group) or a scalar.
export function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

// Flattens any cell value to text for searching, filtering and sorting: objects
// become "key: value" pairs, arrays a comma list, scalars themselves.
export function cellText(value) {
    if (value == null) return '';
    if (Array.isArray(value)) return value.map(cellText).join(', ');
    if (isPlainObject(value)) return Object.entries(value).map(([k, v]) => `${k}: ${cellText(v)}`).join(', ');
    return String(value);
}

// A path with this few distinct values in the sample is worth a checkbox filter
// rather than a text box — booleans, enums, taps.
export const CATEGORY_MAX = 25;

// Walks a sample of the items and returns every path worth offering as a column,
// as { path, distinct }, in discovery order so top-level fields come first. That is
// every leaf — ending at a scalar or an array of scalars — plus the containers
// themselves, since an object or array of objects is a column too (it renders as an
// object cell or a child table); containers report Infinity distinct values so they
// never get a checkbox filter. Nested objects extend the path with '.', arrays of
// objects with '[*]'. The caps keep deep data (all.json's bottle.files.*) from
// producing an unusable list; the picker's search box covers the rest.
export function discoverPaths(items, { sample = SAMPLE_SIZE, depth = 4, limit = 400 } = {}) {
    // path -> the values sampled for it, or null for a container
    const found = new Map();

    const add = (path, seen) => {
        if (!found.has(path) && found.size < limit) found.set(path, seen);
        return found.get(path);
    };

    const addLeaf = (path, value) => {
        const seen = add(path, new Set());
        if (seen && seen.size <= CATEGORY_MAX) seen.add(cellText(value));
    };

    const walk = (obj, prefix, level) => {
        Object.entries(obj).forEach(([k, v]) => {
            const path = prefix + k;
            if (isPlainObject(v)) {
                add(path, null);
                if (level < depth) walk(v, `${path}.`, level + 1);
            } else if (Array.isArray(v) && v.some(isPlainObject)) {
                add(path, null);
                if (level < depth) v.filter(isPlainObject).forEach(el => walk(el, `${path}[*].`, level + 1));
            } else {
                addLeaf(path, v);
            }
        });
    };

    items.slice(0, sample).forEach(item => { if (isPlainObject(item)) walk(item, '', 0); });
    return [...found].map(([path, seen]) => ({ path, distinct: seen ? seen.size : Infinity }));
}

// A cell's value as comparable text — the pairing of getValue and cellText that
// every filter, the search and the sort share, so a path key behaves exactly
// like a plain one everywhere.
export function cellValue(item, key) {
    return cellText(getValue(item, key));
}

// Applies a column's format — a DATE_FORMATTERS name or a function(value, item). An
// array maps through it, so a [*] path formats every match. Returns null when there is
// no format, no value, or the value can't be formatted, letting callers fall back to
// the plain text. Formatting is display-only: sorting and the range filter stay on the
// raw values, so a date column keeps chronological order.
export function applyFormat(value, format, item) {
    if (!format || value == null || value === '') return null;
    const fn = typeof format === 'function' ? format : DATE_FORMATTERS[format];
    if (!fn) return null;
    if (Array.isArray(value)) {
        const parts = value.map(v => fn(v, item)).filter(v => v != null);
        return parts.length ? parts.join(', ') : null;
    }
    return fn(value, item) ?? null;
}

// A cell's text as the reader sees it: the column's format when it has one and it
// applies, else the plain value text.
export function cellDisplay(item, col) {
    return applyFormat(getValue(item, col.key), col.format, item) ?? cellValue(item, col.key);
}

// Rows scanned before a variance check gives up. Only a column whose values never
// differ ever walks this far, so the cap costs nothing on ordinary data and bounds
// the degenerate case: many constant columns over a very large set.
export const VARIANCE_SCAN = 1000;

// The filter a column earns from its data, walking the rows once: none when the
// values never differ (nothing to narrow), checkboxes when the whole set is small
// enough to list, else the configured filter. The walk stops as soon as the answer
// is settled — a column with many values costs CATEGORY_MAX + 1 rows.
//
// Past the cap the scan is inconclusive: the unseen rows could hold any number of
// values, so neither "constant" nor "small enough to list" can be concluded, and
// the column keeps the filter it was configured with.
export function filterFor(items, col, cap = VARIANCE_SCAN) {
    if (!col.filter) return col.filter;
    if (items.length < 2) return false;

    const limit = Math.min(items.length, cap);
    const seen = new Set();
    for (let i = 0; i < limit && seen.size <= CATEGORY_MAX; i++) seen.add(cellDisplay(items[i], col));

    if (items.length > cap) return col.filter;
    if (seen.size < 2) return false;
    // Every filter is promoted on a small enough value set — 25 numbers or 25 days
    // are a list to tick, not a span to bound, and the checkboxes say which values
    // exist where a Min/Max only bounds them. An explicit 'category' is already what
    // it wants to be.
    return seen.size <= CATEGORY_MAX ? 'category' : col.filter;
}

// cellDisplay by key rather than by column, for the filter and search layers, which
// hold a formats map instead of column objects.
function displayText(item, key, formats) {
    return applyFormat(getValue(item, key), formats?.[key], item) ?? cellValue(item, key);
}

// The non-category filters as they will actually be applied, resolved once per pass
// rather than per row: the entries walks, the lowercased needles, and — the part that
// pays — dropping the filters that aren't filtering, so an empty text box or an
// unbounded range costs nothing per row instead of a test on every one.
function prepare(textState, rangeState, query, searchKeys, formats) {
    return {
        text: Object.entries(textState).filter(([, v]) => v).map(([key, v]) => [key, v.toLowerCase()]),
        ranges: Object.entries(rangeState).filter(([, r]) => r.min != null || r.max != null),
        q: query.toLowerCase(),
        searchKeys, formats,
    };
}

// All non-category filters: text + search + range. Shared by getVisible and
// computeCounts so category option counts reflect these filters too. Text and search
// read the displayed text, so a formatted column filters as it reads; a range stays on
// the raw values, so a formatted date still filters chronologically.
function matchesNonCategory(item, { text, ranges, q, searchKeys, formats }) {
    for (const [key, needle] of text) {
        if (!displayText(item, key, formats).toLowerCase().includes(needle)) return false;
    }
    for (const [key, { min, max, date }] of ranges) {
        const raw = getValue(item, key);
        if (raw === '' || raw == null) return false;
        // A date range holds timestamps and reads the value as an instant; a numeric
        // one holds numbers. Either way both sides of the comparison are the same kind.
        const v = date ? toTimestamp(raw) : Number(raw);
        if (v == null || Number.isNaN(v)) return false;
        if ((min != null && v < min) || (max != null && v > max)) return false;
    }
    return !q || searchKeys.some(k => displayText(item, k, formats).toLowerCase().includes(q));
}

// Returns the subset of data items that match all active filters and the search query.
export function getVisible(data, categoryState, textState, rangeState, query, searchKeys, formats) {
    const active = prepare(textState, rangeState, query, searchKeys, formats);
    const cats = Object.entries(categoryState);
    return data.filter(item =>
        cats.every(([key, selected]) => selected.has(displayText(item, key, formats)))
        && matchesNonCategory(item, active)
    );
}

// Returns per-filter value counts, where each filter is counted against all OTHER
// active filters + text filters + search (so the dropdown shows how many items each option would reveal).
export function computeCounts(data, categoryState, textState, rangeState, query, searchKeys, formats) {
    const active = prepare(textState, rangeState, query, searchKeys, formats);
    const cats = Object.entries(categoryState);
    const counts = {};
    cats.forEach(([key]) => { counts[key] = {}; });

    // Each column's display text, and whether the column's own selection holds it,
    // once per row and shared across the columns: a count is "every OTHER column
    // matches", which tested per column walks the whole state again for each of them.
    // Two arrays reused down the rows — one row's working space, not one set per row.
    const texts = new Array(cats.length);
    const misses = new Array(cats.length);

    data.forEach(item => {
        if (!matchesNonCategory(item, active)) return;

        let missed = 0;
        cats.forEach(([key, selected], i) => {
            texts[i] = displayText(item, key, formats);
            misses[i] = selected.has(texts[i]) ? 0 : 1;
            missed += misses[i];
        });
        // Every other column matches exactly when this one accounts for every miss.
        cats.forEach(([key], i) => {
            if (missed === misses[i]) counts[key][texts[i]] = (counts[key][texts[i]] || 0) + 1;
        });
    });

    return counts;
}

// Returns a new sorted array, leaving the original untouched. Each row's sort key is
// resolved once and carried through the sort rather than recomputed on every
// comparison — getValue walks a path and cellValue flattens and lowercases, which is
// n log n of that work when the answer never changes for a row.
export function sortItems(data, key, dir, numeric = false) {
    const keyOf = numeric ? item => Number(getValue(item, key)) : item => cellValue(item, key).toLowerCase();
    return data.map(item => [keyOf(item), item])
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0) * dir)
        .map(([, item]) => item);
}

// Default label for a path key: its last named segment, so
// 'installed[*].installed_on_request' reads as "Installed_on_request".
function labelFor(key) {
    const named = parsePath(key).filter(s => s !== '*' && !/^\d+$/.test(s));
    return capitalize(named.at(-1) || key);
}

function capitalize(str) {
    return str ? str[0].toUpperCase() + str.slice(1) : '';
}
