// Treeview table — expandable rows, each child level rendered as an independent nested table.

export async function initTreeTable(config) {
    let data = config.data;
    if (Array.isArray(data) && typeof data[0] === 'string') {
        const { fetchData } = await import('./model.js');
        data = await fetchData(...data);
    }

    const { tableId, columns, levels } = config;

    const table = document.getElementById(tableId);
    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody');

    buildLevelHeader(thead, columns);

    const rowMap = new Map();
    const frag   = document.createDocumentFragment();
    fillLevel(frag, data, columns, levels, 0, null, rowMap);
    tbody.appendChild(frag);

    // Single delegated listener — clicks bubble up through nested tables naturally.
    table.addEventListener('click', e => {
        const btn = e.target.closest('.aj-toggle');
        if (!btn) return;
        const id = btn.closest('tr').dataset.ajId;
        toggleRow(id, rowMap, btn);
    });
}

function buildLevelHeader(thead, columns) {
    const tr = document.createElement('tr');
    columns.forEach(col => {
        const th       = document.createElement('th');
        th.textContent = col.label || col.key;
        tr.appendChild(th);
    });
    thead.appendChild(tr);
}

function fillLevel(container, items, columns, levels, levelIdx, parentId, rowMap) {
    const levelCfg  = levels[levelIdx] || {};
    const childCols = levelCfg.columns || null;

    items.forEach((item, i) => {
        const id          = parentId != null ? `${parentId}-${i}` : String(i);
        const children    = levelCfg.childrenKey ? (item[levelCfg.childrenKey] || []) : [];
        const hasChildren = children.length > 0 && !!childCols;

        const tr = makeRow(item, columns, id, hasChildren);
        container.appendChild(tr);

        const rowInfo = { tr, detailTr: null, childrenTr: null, expanded: false };

        if (levelCfg.detail?.length) {
            const detailTr = makeDetailRow(item, levelCfg.detail, columns.length);
            container.appendChild(detailTr);
            rowInfo.detailTr = detailTr;
        }

        if (hasChildren) {
            const childrenTr = makeChildrenRow(children, childCols, levels, levelIdx + 1, id, columns.length, rowMap);
            container.appendChild(childrenTr);
            rowInfo.childrenTr = childrenTr;
        }

        rowMap.set(id, rowInfo);
    });
}

function makeRow(item, columns, id, hasChildren) {
    const tr = document.createElement('tr');
    tr.dataset.ajId = id;

    columns.forEach((col, ci) => {
        const td = document.createElement('td');

        if (ci === 0) {
            if (hasChildren) {
                const btn = document.createElement('button');
                btn.className   = 'aj-toggle';
                btn.textContent = '▶';
                btn.setAttribute('aria-label', 'Expand');
                td.appendChild(btn);
            } else {
                const leaf = document.createElement('span');
                leaf.className = 'aj-leaf';
                td.appendChild(leaf);
            }
            td.appendChild(document.createTextNode(item[col.key] ?? ''));
        } else {
            td.textContent = item[col.key] ?? '';
        }

        tr.appendChild(td);
    });

    return tr;
}

function makeChildrenRow(children, childColumns, levels, levelIdx, parentId, colSpan, rowMap) {
    const tr     = document.createElement('tr');
    tr.className = 'aj-children-row aj-hidden';

    const td     = document.createElement('td');
    td.colSpan   = colSpan;
    td.className = 'aj-children-cell';

    const childTable = document.createElement('table');
    const childThead = document.createElement('thead');
    const childTbody = document.createElement('tbody');

    buildLevelHeader(childThead, childColumns);

    const frag = document.createDocumentFragment();
    fillLevel(frag, children, childColumns, levels, levelIdx, parentId, rowMap);
    childTbody.appendChild(frag);

    childTable.appendChild(childThead);
    childTable.appendChild(childTbody);
    td.appendChild(childTable);
    tr.appendChild(td);

    return tr;
}

function makeDetailRow(item, detail, colSpan) {
    const tr     = document.createElement('tr');
    tr.className = 'aj-detail-row aj-hidden';

    const td     = document.createElement('td');
    td.colSpan   = colSpan;
    td.className = 'aj-detail-cell';

    const strip     = document.createElement('div');
    strip.className = 'aj-detail-strip';

    detail.forEach(field => {
        const key   = typeof field === 'string' ? field : field.key;
        const label = typeof field === 'string' ? capitalize(key) : field.label;
        const val   = item[key];
        if (val == null) return;

        const el      = document.createElement('span');
        el.className  = 'aj-detail-item';
        const k       = document.createElement('span');
        k.className   = 'aj-detail-key';
        k.textContent = label;
        const v       = document.createElement('span');
        v.className   = 'aj-detail-val';
        v.textContent = val;
        el.appendChild(k);
        el.appendChild(v);
        strip.appendChild(el);
    });

    td.appendChild(strip);
    tr.appendChild(td);
    return tr;
}

function toggleRow(id, rowMap, btn) {
    const row = rowMap.get(id);
    if (!row) return;
    row.expanded    = !row.expanded;
    btn.textContent = row.expanded ? '▼' : '▶';
    btn.setAttribute('aria-label', row.expanded ? 'Collapse' : 'Expand');
    if (row.detailTr)   row.detailTr.classList.toggle('aj-hidden',   !row.expanded);
    if (row.childrenTr) row.childrenTr.classList.toggle('aj-hidden', !row.expanded);
}

function capitalize(str) {
    return str ? str[0].toUpperCase() + str.slice(1) : '';
}
