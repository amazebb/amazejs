import { fetchData } from './model.js';
import { initTable } from './controller.js';

const btnMeta = new WeakMap();

export async function initTree(config) {
    let rawData = config.data;
    if (Array.isArray(rawData) && typeof rawData[0] === 'string') {
        rawData = await fetchData(...rawData);
    }

    const rootItems = getRootItems(rawData, config.dataKey);
    if (!rootItems?.length) return;

    const levelDefs = detectLevels(rootItems[0], config.levels || []);
    const rootCols  = getColumns(rootItems, levelDefs, 0);

    let rootTitle = config.title;
    if (!rootTitle && !Array.isArray(rawData)) {
        const key = Object.keys(rawData).find(k => Array.isArray(rawData[k]));
        rootTitle = key ? key.toUpperCase() : '';
    }
    if (!rootTitle && Array.isArray(config.data) && typeof config.data[0] === 'string') {
        rootTitle = config.data[0].split('/').pop().replace(/\.[^.]+$/, '').toUpperCase();
    }

    await initTable({ ...config, data: rootItems, columns: rootCols, title: rootTitle || '' });

    // Delegated click listener scoped to the container — catches toggles from all nested levels.
    const table = document.getElementById(config.tableId);
    table.closest('.atv-table-container').addEventListener('click', e => {
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

// Returns column defs with nameKey first, labels uppercased, filters disabled.
// The first column gets a render function that injects an expand toggle or leaf spacer,
// reusing the existing col.render hook in buildRows (view.js).
function getColumns(items, levelDefs, depth) {
    const sample   = items[0] || {};
    const levelDef = levelDefs[depth] || {};
    const nameKey  = levelDef.nameKey || 'name';
    const childKey = levelDef.childrenKey;

    const keys = Object.keys(sample).filter(k => !Array.isArray(sample[k]));
    if (nameKey && keys.includes(nameKey)) {
        keys.splice(keys.indexOf(nameKey), 1);
        keys.unshift(nameKey);
    }

    const colCount = keys.length;
    return keys.map((k, i) => {
        const col = { key: k, label: k.toUpperCase(), filter: false };
        if (i === 0) {
            col.render = item => {
                const children    = childKey ? (item[childKey] || []) : [];
                const hasChildren = children.length > 0;
                const frag        = document.createDocumentFragment();
                if (hasChildren) {
                    const btn = document.createElement('button');
                    btn.className   = 'aj-toggle';
                    btn.textContent = '▶';
                    btn.setAttribute('aria-label', 'Expand');
                    btnMeta.set(btn, { children, levelDefs, depth: depth + 1, colCount });
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

function buildSectionHeader(thead, childrenKey, count, colSpan, searchInput) {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.colSpan   = colSpan;
    th.className = 'aj-section-header';
    th.appendChild(document.createTextNode((childrenKey || '').toUpperCase() + ' '));
    const badge       = document.createElement('span');
    badge.className   = 'filter-badge';
    badge.textContent = count;
    th.appendChild(badge);
    if (searchInput) th.appendChild(searchInput);
    tr.appendChild(th);
    thead.insertBefore(tr, thead.firstChild);
}

function handleToggle(btn) {
    const parentTr = btn.closest('tr');
    const isOpen   = btn.textContent === '▼';

    btn.textContent = isOpen ? '▶' : '▼';
    btn.setAttribute('aria-label', isOpen ? 'Expand' : 'Collapse');

    // Already built — just show/hide.
    const nextTr = parentTr.nextElementSibling;
    if (nextTr?.classList.contains('aj-children-row')) {
        nextTr.classList.toggle('aj-hidden', isOpen);
        return;
    }

    if (isOpen) return;

    // Lazy build on first expand.
    const { children, levelDefs, depth, colCount } = btnMeta.get(btn);
    const childCols = getColumns(children, levelDefs, depth);

    const childTr = document.createElement('tr');
    childTr.className = 'aj-children-row';
    const childTd = document.createElement('td');
    childTd.colSpan   = colCount;
    childTd.className = 'aj-children-cell';
    const childTable  = document.createElement('table');
    childTd.appendChild(childTable);
    childTr.appendChild(childTd);

    // Insert into DOM before initTable so getElementById can resolve filter button IDs.
    parentTr.insertAdjacentElement('afterend', childTr);

    const nameKey    = levelDefs[depth]?.nameKey || 'name';
    const searchEl   = document.createElement('input');
    searchEl.type        = 'text';
    searchEl.className   = 'atv-search aj-section-search';
    searchEl.placeholder = 'Search...';

    initTable({
        table:         childTable,
        data:          children,
        columns:       childCols,
        nested:        true,
        searchInputEl: searchEl,
        searchKeys:    [nameKey],
    });

    buildSectionHeader(
        childTable.querySelector('thead'),
        levelDefs[depth - 1]?.childrenKey,
        children.length,
        childCols.length,
        searchEl
    );
}
