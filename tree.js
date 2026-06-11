import { initTable } from './controller.js';
import { isUrlData, titleFromUrl } from './model.js';

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
    const { key: rootKey, items: rootItems } = getRootItems(rawData, config.dataKey);
    if (!rootItems?.length) return;

    // Settings threaded down to every nested level via the toggle metadata.
    const ctx = {
        levels: Array.isArray(config.levels) ? config.levels : null,
    };
    const rootCols = getColumns(rootItems, ctx, 0);

    const rootTitle = config.title
        || (rootKey ? rootKey.toUpperCase() : '')
        || (isUrlData(config.data) ? titleFromUrl(config.data[0]) : '');

    const table = await initTable({ ...config, data: rootItems, columns: rootCols, title: rootTitle });

    // Delegated click listener scoped to the container — catches row toggles from
    // all nested levels. The whole first-cell wrapper is a click target too; it
    // resolves to the toggle button it contains. Toolbar disclosure toggles also
    // match .aj-toggle but have no btnMeta entry — handleToggle ignores them and
    // the controller's own titleWrap listener handles the collapse.
    table.closest('.atv-table-container').addEventListener('click', e => {
        const hit = e.target.closest('.aj-toggle, .aj-toggle-wrap');
        if (!hit) return;
        const btn = hit.classList.contains('aj-toggle') ? hit : hit.querySelector('.aj-toggle');
        if (btn) handleToggle(btn);
    });
    return table;
}

// Extracts the root array and its wrapper key (null when data is already an array):
// explicit dataKey, or the first array property in a root object.
function getRootItems(rawData, dataKey) {
    if (Array.isArray(rawData)) return { key: null, items: rawData };
    const key = dataKey || Object.keys(rawData).find(k => Array.isArray(rawData[k]));
    return { key, items: key ? rawData[key] : null };
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

// Returns column defs with nameKey first and labels uppercased.
// The first column gets a render function that injects an expand toggle (when the
// item has child groups) or a leaf spacer, reusing the col.render hook in buildRows (view.js).
function getColumns(items, ctx, depth) {
    const sample  = items[0] || {};
    const nameKey = ctx.levels?.[depth]?.nameKey || 'name';
    const allowed = allowedChildKeys(ctx.levels, depth);

    const keys = Object.keys(sample).filter(k => !Array.isArray(sample[k]));
    if (keys.includes(nameKey)) {
        keys.splice(keys.indexOf(nameKey), 1);
        keys.unshift(nameKey);
    }

    const colCount = keys.length;
    return keys.map((k, i) => {
        const col = { key: k, label: k.toUpperCase() };
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
        table,
        data:      group.items,
        columns:   getColumns(group.items, ctx, depth),
        nested:    true,
        collapsed,
        title:     group.key.toUpperCase(),
    });
}
