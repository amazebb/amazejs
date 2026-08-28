// Pure data functions — no DOM dependencies.

// True when data is the [url, fallbackUrl?] form accepted by initTable.
export function isUrlData(data) {
    return Array.isArray(data) && typeof data[0] === 'string';
}

// Derives a display title from a data URL: filename without extension, uppercased.
export function titleFromUrl(url) {
    return url.split('/').pop().replace(/\.[^.]+$/, '').toUpperCase();
}

// Parses fetched text by the URL's extension: .json → JSON, .csv → CSV, else TSV.
export function parseByUrl(url, text) {
    const ext = url.split(/[?#]/)[0].split('.').pop().toLowerCase();
    if (ext === 'json') return JSON.parse(text);
    if (ext === 'csv') return parseCsv(text);
    return parseTsv(text);
}

// Fetches data from url, falling back to fallbackUrl if the first request fails.
export async function fetchData(url, fallbackUrl) {
    const res = await fetch(url);
    if (res.ok) return parseByUrl(url, await res.text());
    if (!fallbackUrl) throw new Error(`Failed to load data from ${url}`);
    const fallbackRes = await fetch(fallbackUrl);
    if (!fallbackRes.ok) throw new Error(`Failed to load data from ${url} and ${fallbackUrl}`);
    return parseByUrl(fallbackUrl, await fallbackRes.text());
}

// Parses a TSV string into an array of objects keyed by the first-row headers.
export function parseTsv(text) {
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) return [];
    const headers = lines[0].split('\t').map(h => h.trim());
    return lines.slice(1).map(line => {
        const parts = line.split('\t');
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

// Resolves column definitions, merging config with numeric-detection defaults.
export function inferColumns(data, configCols) {
    const base = configCols || Object.keys(data[0] || {}).map(key => ({ key }));
    return base.map(col => {
        const isNumeric = data.every(item => {
            const v = getValue(item, col.key);
            return !v || !isNaN(Number(v));
        });
        return { filter: isNumeric ? 'range' : 'text', numeric: isNumeric, label: labelFor(col.key), ...col };
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

// A cell's value as comparable text — the pairing of getValue and cellText that
// every filter, the search and the sort share, so a path key behaves exactly
// like a plain one everywhere.
export function cellValue(item, key) {
    return cellText(getValue(item, key));
}

// True when the item passes every text filter and the (lowercased) search query.
function matchesTextAndSearch(item, textState, q, searchKeys) {
    const matchText = Object.entries(textState)
        .every(([key, val]) => !val || cellValue(item, key).toLowerCase().includes(val.toLowerCase()));
    const matchSearch = !q || searchKeys.some(k => cellValue(item, k).toLowerCase().includes(q));
    return matchText && matchSearch;
}

// True when the item's numeric value falls within every active [min, max] range.
// Each range bound is a number or null (unbounded); both null = inactive. Every
// numeric filter mode (Min/Max now, comparators/presets later) reduces to this
// predicate, so it never has to change as new range UIs are added.
function matchesRange(item, rangeState) {
    return Object.entries(rangeState).every(([key, { min, max }]) => {
        if (min == null && max == null) return true;
        const raw = getValue(item, key);
        const v = Number(raw);
        if (raw === '' || raw == null || Number.isNaN(v)) return false;
        return (min == null || v >= min) && (max == null || v <= max);
    });
}

// All non-category filters: text + search + numeric range. Shared by getVisible
// and computeCounts so category option counts reflect these filters too.
function matchesNonCategory(item, textState, rangeState, q, searchKeys) {
    return matchesTextAndSearch(item, textState, q, searchKeys) && matchesRange(item, rangeState);
}

// Returns the subset of data items that match all active filters and the search query.
export function getVisible(data, categoryState, textState, rangeState, query, searchKeys) {
    const q = query.toLowerCase();
    return data.filter(item =>
        Object.entries(categoryState).every(([key, selected]) => selected.has(cellValue(item, key)))
        && matchesNonCategory(item, textState, rangeState, q, searchKeys)
    );
}

// Returns per-filter value counts, where each filter is counted against all OTHER
// active filters + text filters + search (so the dropdown shows how many items each option would reveal).
export function computeCounts(data, categoryState, textState, rangeState, query, searchKeys) {
    const q = query.toLowerCase();
    const counts = {};
    Object.keys(categoryState).forEach(key => { counts[key] = {}; });

    data.forEach(item => {
        if (!matchesNonCategory(item, textState, rangeState, q, searchKeys)) return;

        Object.keys(categoryState).forEach(key => {
            const matchOthers = Object.entries(categoryState)
                .filter(([k]) => k !== key)
                .every(([k, selected]) => selected.has(cellValue(item, k)));
            if (matchOthers) {
                const val = cellValue(item, key);
                counts[key][val] = (counts[key][val] || 0) + 1;
            }
        });
    });

    return counts;
}

// Returns a new sorted array, leaving the original untouched.
export function sortItems(data, key, dir, numeric = false) {
    return [...data].sort((a, b) => {
        if (numeric) return (Number(getValue(a, key)) - Number(getValue(b, key))) * dir;
        const aVal = cellValue(a, key).toLowerCase();
        const bVal = cellValue(b, key).toLowerCase();
        if (aVal < bVal) return -dir;
        if (aVal > bVal) return dir;
        return 0;
    });
}

// Default label for a path key: its last named segment, so
// 'installed[*].installed_on_request' reads as "Installed_on_request".
function labelFor(key) {
    const named = parsePath(key).filter(s => s !== '*' && !/^\d+$/.test(s));
    return capitalize(named[named.length - 1] || key);
}

function capitalize(str) {
    return str ? str[0].toUpperCase() + str.slice(1) : '';
}
