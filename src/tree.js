import { initTable } from './controller.js';
import { isUrlData, titleFromUrl, sampleKeys, SAMPLE_SIZE } from './model.js';

const btnMeta = new WeakMap();

const isObjectArray = v => Array.isArray(v) && v.length > 0 && typeof v[0] === 'object';
const isRecord = v => !!v && typeof v === 'object' && !Array.isArray(v);

// A record's own key set, order-insensitive — its shape.
const signature = obj => Object.keys(obj).sort().join(' ');

// True when an item nests by name: two or more of its record properties have the
// same shape, of more than one field. One object property is a value (an AST node's
// data, a formula's versions); a set of matching ones is a list of children written
// as named properties, which is how Saturn holds its moons. The size floor keeps a
// coincidence like a formula's urls and bottle — each a lone { stable } — from
// reading as a pair.
function nestsByName(item) {
    const seen = new Set();
    for (const v of Object.values(item)) {
        if (!isRecord(v) || Object.keys(v).length < 2) continue;
        const sig = signature(v);
        if (seen.has(sig)) return true;
        seen.add(sig);
    }
    return false;
}

// The keys a table's rows nest under, decided once for the whole table rather than
// per item — the moons of Saturn are children whether or not Earth's lone Moon looks
// like them. A table nests by name when any of its rows does; in one that does, a
// record found under a key no other row carries is a child (its key is a name), while
// a key every row repeats (versions, data) is a column. A table of one row — the
// wrapper the Sun arrives in — has no repeats to weigh, so nestsByName decides alone.
function nodeKeysFor(items) {
    const sample = items.slice(0, SAMPLE_SIZE);
    if (!sample.some(nestsByName)) return new Set();
    const count = new Map();
    sample.forEach(item => Object.keys(item).forEach(k => count.set(k, (count.get(k) || 0) + 1)));
    const keys = new Set();
    sample.forEach(item => Object.keys(item).forEach(k => {
        if (isRecord(item[k]) && count.get(k) === 1) keys.add(k);
    }));
    return keys;
}

// True when resolved data needs tree handling: a root wrapper object
// (e.g. { countries: [...] }) or items containing arrays of objects.
export function isTreeData(data) {
    if (data && !Array.isArray(data)) return true;
    const first = data?.[0];
    return !!first && Object.values(first).some(isObjectArray);
}

// Called by initTable when tree handling applies; rawData is already fetched.
export async function initTree(config, rawData) {
    const rootGroups = getRootGroups(rawData, config.dataKey);
    if (!rootGroups.length) return;

    // Settings threaded down to every nested level via the toggle metadata.
    // childOpts carries the parent's presentational options so child tables —
    // built here, not via the spread path the root takes — match the flat table.
    const ctx = {
        levels: Array.isArray(config.levels) ? config.levels : null,
        childOpts: {
            striped:         config.striped,
            bordered:        config.bordered,
            rowNumbers:      config.rowNumbers,
            stickyHeaders:   config.stickyHeaders,
            showFilterRow:   config.showFilterRow,
            showButtons:     config.showButtons,
            badgeAlwaysShow: config.badgeAlwaysShow,
            badgePosition:   config.badgePosition,
            lockWidths:      config.lockWidths,
            formats:         config.formats,
            objectCell:      config.objectCell,
            objectAlign:     config.objectAlign,
            searchDebounce:  config.searchDebounce,
        },
    };
    ensureToggleListener();

    // A root object holding several arrays of objects (all.json's formulae + casks)
    // is the same shape as an item with several child groups, so it gets the same
    // treatment: one table per group, each with its own columns, filters and
    // toolbar, and — as for multiple child groups — each starts as a collapsed
    // disclosure line that builds on first expand. Merging them is not on: shared
    // keys can differ in type between groups (all.json's `installed` is a child
    // group in formulae and a plain string in casks).
    if (rootGroups.length > 1) {
        const anchor = config.table || document.getElementById(config.tableId);
        const host = document.createElement('div');
        // Named so File > Open can find it: opening a file replaces the whole tree,
        // not just the group whose menu was used (controller.js, rebuild).
        host.className = 'aj-tree-host';
        anchor.replaceWith(host);
        for (const group of rootGroups) buildRootTable(host, group, config, ctx);
        return host;
    }

    const { key: rootKey, items: rootItems } = rootGroups[0];
    const rootTitle = config.title
        || (rootKey ? rootKey.toUpperCase() : '')
        || (isUrlData(config.data) ? titleFromUrl(config.data[0]) : '');

    // labelStyle is the table's one labelling rule, applied by inferColumns — so
    // columns added later from the Columns picker match (TAP, not Tap).
    const rootCtx = descend(ctx, rootKey);
    return initTable({
        ...config,
        data:       rootItems,
        columns:    getColumns(rootItems, rootCtx, 0),
        formats:    rootCtx.childOpts.formats,
        title:      rootTitle,
        labelStyle: 'upper',
    });
}

// A root group is a full, non-nested table (its own scroll wrapper, no-results and
// Columns menu), unlike the nested tables buildGroupTable makes for child rows.
function buildRootTable(host, group, config, ctx) {
    const table = document.createElement('table');
    host.appendChild(table);
    const groupCtx = descend(ctx, group.key);
    return initTable({
        ...config,
        table,
        tableId:    undefined,
        data:       group.items,
        columns:    getColumns(group.items, groupCtx, 0),
        formats:    groupCtx.childOpts.formats,
        title:      group.key.toUpperCase(),
        labelStyle: 'upper',
        collapsed:  true,
    });
}

// Formats are keyed by path from the point of view of the table they were written
// for, but a group becomes its own table whose columns are keyed by the item's own
// keys — 'installed[*].time' on the root is 'time' inside the INSTALLED table. So
// on every descent the group's prefix ('k.', 'k[*].', 'k[3].') is stripped and the
// remainder added; the original keys stay, letting the next level strip again.
function formatsForGroup(formats, groupKey) {
    if (!formats || !groupKey) return formats;
    const esc = groupKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const prefix = new RegExp(`^${esc}(\\[(?:\\*|\\d+)\\])?\\.`);
    const out = { ...formats };
    Object.entries(formats).forEach(([key, format]) => {
        const rest = key.replace(prefix, '');
        if (rest !== key) out[rest] = format;
    });
    return out;
}

// The ctx a group's table (and, via getColumns' toggle metadata, everything under
// it) runs with: the parent's, with the formats re-keyed one level down.
function descend(ctx, groupKey) {
    const formats = formatsForGroup(ctx.childOpts.formats, groupKey);
    if (formats === ctx.childOpts.formats) return ctx;
    return { ...ctx, childOpts: { ...ctx.childOpts, formats } };
}

// One delegated click listener for every tree on the page — catches row toggles
// from all nested levels. The whole first-cell wrapper is a click target too; it
// resolves to the toggle button it contains. Toolbar disclosure toggles also match
// .aj-toggle but have no btnMeta entry — handleToggle ignores them and the
// controller's own titleWrap listener handles the collapse. Bound to the document
// rather than the container so it survives a rebuild that replaces the container
// (the Columns picker, File > Open).
let _toggleListenerBound = false;
function ensureToggleListener() {
    if (_toggleListenerBound) return;
    _toggleListenerBound = true;
    document.addEventListener('click', e => {
        const hit = e.target.closest?.('.aj-toggle, .aj-toggle-wrap');
        if (!hit) return;
        const btn = hit.classList.contains('aj-toggle') ? hit : hit.querySelector('.aj-toggle');
        if (btn) handleToggle(btn);
    });
}

// The root's groups, mirroring getChildGroups one level up: an explicit dataKey wins,
// otherwise every array-of-objects property of the root object; a bare array is a
// single unnamed group. Empty groups are dropped so they never render as a table
// with no rows.
function getRootGroups(rawData, dataKey) {
    if (Array.isArray(rawData)) return rawData.length ? [{ key: null, items: rawData }] : [];
    if (dataKey) {
        const only = groupAt(rawData, dataKey);
        return only ? [only] : [];
    }
    const groups = Object.keys(rawData)
        .filter(k => isObjectArray(rawData[k]))
        .map(k => ({ key: k, items: rawData[k] }));
    if (groups.length) return groups;
    // No array of objects: fall back to the first array property, as before.
    const first = Object.keys(rawData).find(k => rawData[k]?.length && Array.isArray(rawData[k]));
    if (first) return [{ key: first, items: rawData[first] }];
    // No array at all. A root property holding a single record is a one-row group
    // (`{ meta: {...}, tree: {...} }`): the record's own arrays of objects are then
    // ordinary child groups, so a tree whose root is one node — an AST, a profile —
    // opens from that row like any other. Empty objects hold nothing to show.
    const records = Object.keys(rawData)
        .map(k => groupAt(rawData, k))
        .filter(Boolean);
    // Nothing but scalars: the root is itself the one record, so it becomes a
    // one-row table rather than a blank page.
    return records.length ? records : [{ key: null, items: [rawData] }];
}

// One group from a named root property: an array as itself, a single record wrapped
// in a one-item array. Null when the property holds nothing worth a table.
function groupAt(rawData, key) {
    const value = rawData[key];
    if (Array.isArray(value)) return value.length ? { key, items: value } : null;
    if (!isRecord(value)) return null;
    // The property name is the record's name — the same injection getChildGroups
    // makes one level down, so the row carries what it was found under.
    return Object.keys(value).length ? { key, items: [{ name: key, ...value }] } : null;
}

// Returns every child group of an item — properties holding arrays of objects, and
// the child nodes named by property — optionally restricted to allowedKeys (from a
// levels override) and to the table's nodeKeys (from nodeKeysFor). The named nodes
// merge into ONE group: the Sun's planets are a table of eight rows, not eight tables
// of one. Each carries its property name as `name` (its own wins if it has one),
// which is the column getColumns pulls first, so the row that expands is the one
// bearing the name it was found under.
function getChildGroups(item, allowedKeys, nodeKeys) {
    const keys = Object.keys(item).filter(k => !allowedKeys || allowedKeys.includes(k));
    const groups = keys.filter(k => isObjectArray(item[k])).map(k => ({ key: k, items: item[k] }));
    const named = keys.filter(k => nodeKeys?.has(k) && isRecord(item[k]));
    if (named.length) {
        groups.push({ key: 'children', named: true, items: named.map(k => ({ name: k, ...item[k] })) });
    }
    return groups;
}

// Resolves which children keys are allowed for items at a given depth.
// null = no restriction (auto-detect); [] = none (depth beyond configured levels).
function allowedChildKeys(levels, depth) {
    if (!levels) return null;
    if (depth >= levels.length) return [];
    const def = levels[depth];
    if (def.childrenKeys) return def.childrenKeys;
    if (def.childrenKey)  return [def.childrenKey];
    return null;
}

// Returns column defs with nameKey first. Labels are left to inferColumns, which
// uppercases them for the labelStyle: 'upper' these tables are built with.
// The first column gets a render function that injects an expand toggle (when the
// item has child groups) or a leaf spacer, reusing the col.render hook in buildRows (view.js).
function getColumns(items, ctx, depth) {
    const nameKey = ctx.levels?.[depth]?.nameKey || 'name';
    const allowed = allowedChildKeys(ctx.levels, depth);

    // Keys come from a sample, not just the first item, since records vary. A key
    // is a child group if it holds an array of objects in ANY sampled item — an
    // empty array in the first one must not demote it to a column. Everything else
    // is an ordinary column, arrays of scalars (oldnames, aliases) included: they
    // render as a value list.
    const nodeKeys = nodeKeysFor(items);
    const groupKeys = new Set(nodeKeys);
    items.slice(0, SAMPLE_SIZE).forEach(item => {
        Object.entries(item).forEach(([k, v]) => { if (isObjectArray(v)) groupKeys.add(k); });
    });
    let keys = sampleKeys(items).filter(k => !groupKeys.has(k));
    if (keys.includes(nameKey)) keys = [nameKey, ...keys.filter(k => k !== nameKey)];

    const colCount = keys.length;
    return keys.map((k, i) => {
        const col = { key: k };
        if (i === 0) {
            col.render = item => {
                const groups = getChildGroups(item, allowed, nodeKeys);
                if (!groups.length) {
                    const frag = document.createDocumentFragment();
                    const leaf = document.createElement('span');
                    leaf.className = 'aj-leaf';
                    frag.append(leaf, document.createTextNode(item[k] ?? ''));
                    return frag;
                }
                // Wrapper makes the whole first cell a click target for the toggle.
                const wrap = document.createElement('div');
                wrap.className = 'aj-toggle-wrap';
                const btn = document.createElement('button');
                btn.className = 'aj-toggle aj-rotate';
                btn.setAttribute('aria-expanded', 'false');
                btn.setAttribute('aria-label', 'Toggle children');
                btnMeta.set(btn, { groups, ctx, depth: depth + 1, colCount });
                wrap.append(btn, document.createTextNode(item[k] ?? ''));
                return wrap;
            };
        }
        return col;
    });
}

function handleToggle(btn) {
    const meta = btnMeta.get(btn);
    if (!meta) return; // a toolbar disclosure toggle — wired by the controller

    const isOpen = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!isOpen));
    toggleItemRow(btn, meta, isOpen);
}

// Toggle on an item row. Every child group becomes a nested table with its own
// disclosure toolbar: a single group starts expanded (one click to the table,
// as before), multiple groups start as collapsed toolbar lines.
function toggleItemRow(btn, { groups, ctx, depth, colCount }, isOpen) {
    const parentTr = btn.closest('tr');

    // Already built — just show/hide.
    const nextTr = parentTr.nextElementSibling;
    if (nextTr?.classList.contains('aj-children-row')) {
        nextTr.classList.toggle('aj-hidden', isOpen);
        return;
    }

    if (isOpen) return;

    // Lazy build on first expand.
    const childTr = document.createElement('tr');
    childTr.className = 'aj-children-row';
    const childTd = document.createElement('td');
    childTd.colSpan   = colCount;
    childTd.className = 'aj-children-cell';
    childTr.appendChild(childTd);

    // Insert into DOM before initTable so getElementById can resolve filter button IDs.
    parentTr.insertAdjacentElement('afterend', childTr);

    groups.forEach(group => buildGroupTable(childTd, group, ctx, depth, groups.length > 1));
}

// Each group is a full nested table whose disclosure toolbar is its header line.
// collapsed: true defers the table build to first expand (see controller.js).
//
// A named-node group is the exception: its key is the library's word, not the data's,
// so a header line reading CHILDREN would only repeat the row already above it —
// expanding the Sun shows the planets themselves. It keeps its toolbar only when it
// is one of several groups, since a collapsed group has nothing else to open it.
function buildGroupTable(container, group, ctx, depth, collapsed) {
    const table = document.createElement('table');
    container.appendChild(table);
    const groupCtx = descend(ctx, group.key);
    initTable({
        ...groupCtx.childOpts,
        table,
        data:      group.items,
        columns:   getColumns(group.items, groupCtx, depth),
        nested:    true,
        collapsed,
        showToolbar: !group.named || collapsed,
        labelStyle: 'upper',
        title:     group.key.toUpperCase(),
    });
}
