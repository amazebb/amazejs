import { initTable } from './controller.js';

const btnMeta = new WeakMap();

// True when resolved data needs tree handling: a root wrapper object
// (e.g. { countries: [...] }) or items containing arrays of objects.
export function isTreeData(data) {
    if (data && !Array.isArray(data)) return true;
    const first = data?.[0];
    return !!first && Object.values(first).some(
        v => Array.isArray(v) && v.length > 0 && typeof v[0] === 'object'
    );
}

// Called by initTable when tree handling applies; rawData is already fetched.
export async function initTree(config, rawData) {
    const rootItems = getRootItems(rawData, config.dataKey);
    if (!rootItems?.length) return;

    const levels   = Array.isArray(config.levels) ? config.levels : null;
    const rootCols = getColumns(rootItems, levels, 0);

    let rootTitle = config.title;
    if (!rootTitle && !Array.isArray(rawData)) {
        const key = Object.keys(rawData).find(k => Array.isArray(rawData[k]));
        rootTitle = key ? key.toUpperCase() : '';
    }
    if (!rootTitle && Array.isArray(config.data) && typeof config.data[0] === 'string') {
        rootTitle = config.data[0].split('/').pop().replace(/\.[^.]+$/, '').toUpperCase();
    }

    const table = await initTable({ ...config, data: rootItems, columns: rootCols, title: rootTitle || '' });

    // Delegated click listener scoped to the container — catches toggles from all nested levels.
    table.closest('.atv-table-container').addEventListener('click', e => {
        const btn = e.target.closest('.aj-toggle');
        if (!btn) return;
        handleToggle(btn);
    });
    return table;
}

// Extracts the root array: explicit dataKey, direct array, or first array property in root object.
function getRootItems(rawData, dataKey) {
    if (dataKey) return rawData[dataKey];
    if (Array.isArray(rawData)) return rawData;
    const key = Object.keys(rawData).find(k => Array.isArray(rawData[k]));
    return key ? rawData[key] : null;
}

// Returns every child group of an item — properties holding arrays of objects —
// optionally restricted to allowedKeys (from a levels override).
function getChildGroups(item, allowedKeys) {
    return Object.keys(item)
        .filter(k => Array.isArray(item[k]) && item[k].length > 0 && typeof item[k][0] === 'object')
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
function getColumns(items, levels, depth) {
    const sample  = items[0] || {};
    const nameKey = levels?.[depth]?.nameKey || 'name';
    const allowed = allowedChildKeys(levels, depth);

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
                const frag   = document.createDocumentFragment();
                if (groups.length) {
                    const btn = document.createElement('button');
                    btn.className   = 'aj-toggle';
                    btn.textContent = '▶';
                    btn.setAttribute('aria-label', 'Expand');
                    btnMeta.set(btn, { groups, levels, depth: depth + 1, colCount });
                    frag.appendChild(btn);
                } else {
                    const leaf = document.createElement('span');
                    leaf.className = 'aj-leaf';
                    frag.appendChild(leaf);
                }
                frag.appendChild(document.createTextNode(item[k] ?? ''));
                return frag;
            };
        }
        return col;
    });
}

function handleToggle(btn) {
    const isOpen = btn.textContent === '▼';
    btn.textContent = isOpen ? '▶' : '▼';
    btn.setAttribute('aria-label', isOpen ? 'Expand' : 'Collapse');

    const meta = btnMeta.get(btn);
    if (meta.groups) toggleItemRow(btn, meta, isOpen);
    else toggleGroup(btn, meta, isOpen);
}

// Toggle on an item row. A single child group expands straight into its table;
// multiple groups expand into one expandable header line per group.
function toggleItemRow(btn, { groups, levels, depth, colCount }, isOpen) {
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

    if (groups.length === 1) {
        buildGroupTable(childTd, groups[0], levels, depth);
        return;
    }

    groups.forEach(group => {
        const header = document.createElement('div');
        header.className = 'aj-group';

        const gBtn = document.createElement('button');
        gBtn.className   = 'aj-toggle';
        gBtn.textContent = '▶';
        gBtn.setAttribute('aria-label', 'Expand');
        btnMeta.set(gBtn, { group, levels, depth });

        const label = document.createElement('span');
        label.className   = 'aj-group-label';
        label.textContent = group.key.toUpperCase();

        header.append(gBtn, label);

        const body = document.createElement('div');
        body.className = 'aj-group-body';

        childTd.append(header, body);
    });
}

// Toggle on a group header line; the table is built into the body on first expand.
function toggleGroup(btn, { group, levels, depth }, isOpen) {
    const body = btn.closest('.aj-group').nextElementSibling;
    if (body.firstChild) {
        body.classList.toggle('aj-hidden', isOpen);
        return;
    }
    if (isOpen) return;
    buildGroupTable(body, group, levels, depth);
}

function buildGroupTable(container, group, levels, depth) {
    const table = document.createElement('table');
    container.appendChild(table);
    initTable({
        table,
        data:    group.items,
        columns: getColumns(group.items, levels, depth),
        nested:  true,
        title:   group.key.toUpperCase(),
    });
}
