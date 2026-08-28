import { initTable } from './controller.js';
import { isUrlData, titleFromUrl, sampleKeys, SAMPLE_SIZE } from './model.js';

const btnMeta = new WeakMap();

const isObjectArray = v => Array.isArray(v) && v.length > 0 && typeof v[0] === 'object';

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
            badgeAlwaysShow: config.badgeAlwaysShow,
            badgePosition:   config.badgePosition,
            lockWidths:      config.lockWidths,
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
    return initTable({ ...config, data: rootItems, columns: getColumns(rootItems, ctx, 0), title: rootTitle, labelStyle: 'upper' });
}

// A root group is a full, non-nested table (its own scroll wrapper, no-results and
// Columns menu), unlike the nested tables buildGroupTable makes for child rows.
function buildRootTable(host, group, config, ctx) {
    const table = document.createElement('table');
    host.appendChild(table);
    return initTable({
        ...config,
        table,
        tableId:    undefined,
        data:       group.items,
        columns:    getColumns(group.items, ctx, 0),
        title:      group.key.toUpperCase(),
        labelStyle: 'upper',
        collapsed:  true,
    });
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
    if (dataKey) return rawData[dataKey]?.length ? [{ key: dataKey, items: rawData[dataKey] }] : [];
    const groups = Object.keys(rawData)
        .filter(k => isObjectArray(rawData[k]))
        .map(k => ({ key: k, items: rawData[k] }));
    if (groups.length) return groups;
    // No array of objects: fall back to the first array property, as before.
    const first = Object.keys(rawData).find(k => rawData[k]?.length && Array.isArray(rawData[k]));
    return first ? [{ key: first, items: rawData[first] }] : [];
}

// Returns every child group of an item — properties holding arrays of objects —
// optionally restricted to allowedKeys (from a levels override).
function getChildGroups(item, allowedKeys) {
    return Object.keys(item)
        .filter(k => isObjectArray(item[k]))
        .filter(k => !allowedKeys || allowedKeys.includes(k))
        .map(k => ({ key: k, items: item[k] }));
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
    const groupKeys = new Set();
    items.slice(0, SAMPLE_SIZE).forEach(item => {
        Object.entries(item).forEach(([k, v]) => { if (isObjectArray(v)) groupKeys.add(k); });
    });
    const keys = sampleKeys(items).filter(k => !groupKeys.has(k));
    if (keys.includes(nameKey)) {
        keys.splice(keys.indexOf(nameKey), 1);
        keys.unshift(nameKey);
    }

    const colCount = keys.length;
    return keys.map((k, i) => {
        const col = { key: k };
        if (i === 0) {
            col.render = item => {
                const groups = getChildGroups(item, allowed);
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
function buildGroupTable(container, group, ctx, depth, collapsed) {
    const table = document.createElement('table');
    container.appendChild(table);
    initTable({
        ...ctx.childOpts,
        table,
        data:      group.items,
        columns:   getColumns(group.items, ctx, depth),
        nested:    true,
        collapsed,
        labelStyle: 'upper',
        title:     group.key.toUpperCase(),
    });
}
