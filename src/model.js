// Pure data functions — no DOM dependencies.

// True when data is the [jsonUrl, tsvUrl?] form accepted by initTable.
export function isUrlData(data) {
    return Array.isArray(data) && typeof data[0] === 'string';
}

// Derives a display title from a data URL: filename without extension, uppercased.
export function titleFromUrl(url) {
    return url.split('/').pop().replace(/\.[^.]+$/, '').toUpperCase();
}

// Fetches data from jsonUrl, falling back to tsvUrl if the JSON request fails.
export async function fetchData(jsonUrl, tsvUrl) {
    const jsonRes = await fetch(jsonUrl);
    if (jsonRes.ok) return jsonRes.json();
    if (!tsvUrl) throw new Error(`Failed to load data from ${jsonUrl}`);
    const tsvRes = await fetch(tsvUrl);
    if (!tsvRes.ok) throw new Error(`Failed to load data from ${jsonUrl} and ${tsvUrl}`);
    return parseTsv(await tsvRes.text());
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

// Resolves column definitions, merging config with numeric-detection defaults.
export function inferColumns(data, configCols) {
    const base = configCols || Object.keys(data[0] || {}).map(key => ({ key }));
    return base.map(col => {
        const isNumeric = data.every(item => !item[col.key] || !isNaN(Number(item[col.key])));
        return { filter: isNumeric ? 'range' : 'text', numeric: isNumeric, label: capitalize(col.key), ...col };
    });
}

// True when the item passes every text filter and the (lowercased) search query.
function matchesTextAndSearch(item, textState, q, searchKeys) {
    const matchText = Object.entries(textState)
        .every(([key, val]) => !val || (item[key] || '').toLowerCase().includes(val.toLowerCase()));
    const matchSearch = !q || searchKeys.some(k => (item[k] || '').toLowerCase().includes(q));
    return matchText && matchSearch;
}

// True when the item's numeric value falls within every active [min, max] range.
// Each range bound is a number or null (unbounded); both null = inactive. Every
// numeric filter mode (Min/Max now, comparators/presets later) reduces to this
// predicate, so it never has to change as new range UIs are added.
function matchesRange(item, rangeState) {
    return Object.entries(rangeState).every(([key, { min, max }]) => {
        if (min == null && max == null) return true;
        const v = Number(item[key]);
        if (item[key] === '' || item[key] == null || Number.isNaN(v)) return false;
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
        Object.entries(categoryState).every(([key, selected]) => selected.has(item[key]))
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
                .every(([k, selected]) => selected.has(item[k]));
            if (matchOthers) {
                const val = item[key];
                counts[key][val] = (counts[key][val] || 0) + 1;
            }
        });
    });

    return counts;
}

// Returns a new sorted array, leaving the original untouched.
export function sortItems(data, key, dir, numeric = false) {
    return [...data].sort((a, b) => {
        if (numeric) return (Number(a[key]) - Number(b[key])) * dir;
        const aVal = (a[key] || '').toLowerCase();
        const bVal = (b[key] || '').toLowerCase();
        if (aVal < bVal) return -dir;
        if (aVal > bVal) return dir;
        return 0;
    });
}

function capitalize(str) {
    return str ? str[0].toUpperCase() + str.slice(1) : '';
}
