import { fetchData } from './model.js';

const btnMeta = new WeakMap();

export async function initTreeTable(config) {
    let rawData = config.data;
    if (Array.isArray(rawData) && typeof rawData[0] === 'string') {
        rawData = await fetchData(...rawData);
    }

    const rootItems = getRootItems(rawData, config.dataKey);
    if (!rootItems?.length) return;

    const levelDefs = detectLevels(rootItems[0], config.levels || []);

    const table = document.getElementById(config.tableId);
    const thead = document.createElement('thead');
    const tbody = document.createElement('tbody');
    table.append(thead, tbody);

    const tableWrap = document.createElement('div');
    tableWrap.className = 'table-wrap';
    table.parentNode.insertBefore(tableWrap, table);
    tableWrap.appendChild(table);

    const tableContainer = document.createElement('div');
    tableContainer.className = 'atv-table-container';
    tableWrap.parentNode.insertBefore(tableContainer, tableWrap);
    tableContainer.appendChild(tableWrap);

    const rootCols = getColumns(rootItems, levelDefs[0]?.nameKey);
    buildHeader(thead, rootCols);
    buildRows(tbody, rootItems, rootCols, levelDefs, 0);

    // Single delegated listener — clicks from all nested tables bubble up naturally.
    tableContainer.addEventListener('click', e => {
        const btn = e.target.closest('.aj-toggle');
        if (!btn) return;
        handleToggle(btn);
    });
}

// Extracts the root array: explicit dataKey, direct array, or first array property in root object.
function getRootItems(rawData, dataKey) {
    if (dataKey) return rawData[dataKey];
    if (Array.isArray(rawData)) return rawData;
    const key = Object.keys(rawData).find(k => Array.isArray(rawData[k]));
    return key ? rawData[key] : null;
}

// Detects levels by walking the first item of each level.
// If configLevels has entries, limits depth to that count.
// Per-level childrenKey can be explicit (to pick between multiple arrays) or auto-detected.
function detectLevels(sample, configLevels) {
    const limited  = configLevels.length > 0;
    const maxDepth = limited ? configLevels.length : Infinity;
    const defs     = [];
    let current    = sample;
    let i          = 0;

    while (current && i < maxDepth) {
        const cfg      = configLevels[i] || {};
        const childKey = cfg.childrenKey || Object.keys(current).find(k =>
            Array.isArray(current[k]) && current[k].length > 0 && typeof current[k][0] === 'object'
        );
        if (!childKey) break;
        defs.push({ childrenKey: childKey, nameKey: 'name', ...cfg });
        current = current[childKey]?.[0];
        i++;
    }

    return defs;
}

// Returns column defs from non-array keys, nameKey sorted first, labels uppercased.
function getColumns(items, nameKey) {
    const sample = items[0] || {};
    const keys = Object.keys(sample).filter(k => !Array.isArray(sample[k]));
    if (nameKey && keys.includes(nameKey)) {
        keys.splice(keys.indexOf(nameKey), 1);
        keys.unshift(nameKey);
    }
    return keys.map(k => ({ key: k, label: k.toUpperCase() }));
}

function buildSectionHeader(thead, childrenKey, count, colSpan) {
    const tr  = document.createElement('tr');
    const th  = document.createElement('th');
    th.colSpan   = colSpan;
    th.className = 'aj-section-header';
    th.appendChild(document.createTextNode((childrenKey || '').toUpperCase() + ' '));
    const badge = document.createElement('span');
    badge.className   = 'filter-badge';
    badge.textContent = count;
    th.appendChild(badge);
    tr.appendChild(th);
    thead.appendChild(tr);
}

function buildHeader(thead, columns) {
    const tr = document.createElement('tr');
    columns.forEach(col => {
        const th = document.createElement('th');
        th.textContent = col.label;
        tr.appendChild(th);
    });
    thead.appendChild(tr);
}

function buildRows(tbody, items, columns, levelDefs, depth) {
    const childKey = levelDefs[depth]?.childrenKey;
    const frag = document.createDocumentFragment();

    items.forEach(item => {
        const children    = childKey ? (item[childKey] || []) : [];
        const hasChildren = children.length > 0;
        const tr          = document.createElement('tr');

        columns.forEach((col, i) => {
            const td = document.createElement('td');

            if (i === 0) {
                if (hasChildren) {
                    const btn = document.createElement('button');
                    btn.className = 'aj-toggle';
                    btn.textContent = '▶';
                    btn.setAttribute('aria-label', 'Expand');
                    btnMeta.set(btn, { children, levelDefs, depth: depth + 1, colCount: columns.length });
                    td.appendChild(btn);
                } else {
                    const leaf = document.createElement('span');
                    leaf.className = 'aj-leaf';
                    td.appendChild(leaf);
                }
            }

            td.appendChild(document.createTextNode(item[col.key] ?? ''));
            tr.appendChild(td);
        });

        frag.appendChild(tr);
    });

    tbody.appendChild(frag);
}

function handleToggle(btn) {
    const parentTr = btn.closest('tr');
    const isOpen   = btn.textContent === '▼';

    btn.textContent = isOpen ? '▶' : '▼';
    btn.setAttribute('aria-label', isOpen ? 'Expand' : 'Collapse');

    // If child row already built, just show/hide it.
    const nextTr = parentTr.nextElementSibling;
    if (nextTr?.classList.contains('aj-children-row')) {
        nextTr.classList.toggle('aj-hidden', isOpen);
        return;
    }

    if (isOpen) return;

    // Lazy build on first expand.
    const { children, levelDefs, depth, colCount } = btnMeta.get(btn);
    const childCols = getColumns(children, levelDefs[depth]?.nameKey);

    const childTr = document.createElement('tr');
    childTr.className = 'aj-children-row';

    const childTd = document.createElement('td');
    childTd.colSpan = colCount;
    childTd.className = 'aj-children-cell';

    const childTable  = document.createElement('table');
    const childThead  = document.createElement('thead');
    const childTbody  = document.createElement('tbody');
    childTable.append(childThead, childTbody);

    buildSectionHeader(childThead, levelDefs[depth - 1]?.childrenKey, children.length, childCols.length);
    buildHeader(childThead, childCols);
    buildRows(childTbody, children, childCols, levelDefs, depth);

    childTd.appendChild(childTable);
    childTr.appendChild(childTd);
    parentTr.insertAdjacentElement('afterend', childTr);
}
