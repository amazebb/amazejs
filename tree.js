// Treeview table — expandable rows with per-level child arrays and optional detail strips.

export function initTreeTable(data, config) {
    const { tableId, columns, levels } = config;

    const table = document.getElementById(tableId);
    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody');

    buildHeader(thead, columns);

    const rowMap = new Map();
    const frag   = document.createDocumentFragment();
    fillRows(frag, data, columns, levels, 0, null, rowMap);
    tbody.appendChild(frag);

    tbody.addEventListener('click', e => {
        const btn = e.target.closest('.aj-toggle');
        if (!btn) return;
        const id = btn.closest('tr').dataset.ajId;
        toggleRow(id, rowMap, btn);
    });
}

function buildHeader(thead, columns) {
    const tr = document.createElement('tr');
    columns.forEach(col => {
        const th       = document.createElement('th');
        th.textContent = col.label || col.key;
        tr.appendChild(th);
    });
    thead.appendChild(tr);
}

function fillRows(container, data, columns, levels, depth, parentId, rowMap) {
    data.forEach((item, i) => {
        const id        = parentId != null ? `${parentId}-${i}` : String(i);
        const levelCfg  = levels[depth] || {};
        const children  = levelCfg.childrenKey ? (item[levelCfg.childrenKey] || []) : [];

        const tr = makeRow(item, columns, depth, id, children.length > 0);
        if (depth > 0) tr.classList.add('aj-hidden');
        container.appendChild(tr);

        const rowInfo = { tr, childIds: [], expanded: false };

        if (levelCfg.detail?.length) {
            const detailTr = makeDetailRow(item, levelCfg.detail, columns.length);
            container.appendChild(detailTr);
            rowInfo.detailTr = detailTr;
        }

        if (children.length) {
            const labelTr = makeLabelRow(levelCfg.childrenKey, columns.length, depth + 1);
            container.appendChild(labelTr);
            rowInfo.labelTr = labelTr;
        }

        rowMap.set(id, rowInfo);
        if (parentId != null) rowMap.get(parentId)?.childIds.push(id);

        if (children.length) {
            fillRows(container, children, columns, levels, depth + 1, id, rowMap);
        }
    });
}

function makeRow(item, columns, depth, id, hasChildren) {
    const tr = document.createElement('tr');
    tr.dataset.ajId    = id;
    tr.dataset.ajDepth = depth;

    columns.forEach((col, ci) => {
        const td = document.createElement('td');

        if (ci === 0) {
            td.className        = 'aj-name-cell';
            td.style.paddingLeft = `${12 + depth * 20}px`;

            if (hasChildren) {
                const btn = document.createElement('button');
                btn.className = 'aj-toggle';
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

function makeLabelRow(childrenKey, colSpan, depth) {
    const tr    = document.createElement('tr');
    tr.className = 'aj-section-row aj-hidden';
    const td    = document.createElement('td');
    td.colSpan  = colSpan;
    td.className = 'aj-section-cell';
    td.style.paddingLeft = `${12 + depth * 20}px`;
    td.textContent = capitalize(childrenKey);
    tr.appendChild(td);
    return tr;
}

function makeDetailRow(item, detail, colSpan) {
    const tr    = document.createElement('tr');
    tr.className = 'aj-detail-row aj-hidden';

    const td       = document.createElement('td');
    td.colSpan     = colSpan;
    td.className   = 'aj-detail-cell';

    const strip    = document.createElement('div');
    strip.className = 'aj-detail-strip';

    detail.forEach(field => {
        const key   = typeof field === 'string' ? field : field.key;
        const label = typeof field === 'string' ? capitalize(key) : field.label;
        const val   = item[key];
        if (val == null) return;

        const el       = document.createElement('span');
        el.className   = 'aj-detail-item';
        const k        = document.createElement('span');
        k.className    = 'aj-detail-key';
        k.textContent  = label;
        const v        = document.createElement('span');
        v.className    = 'aj-detail-val';
        v.textContent  = val;
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

    if (row.detailTr) row.detailTr.classList.toggle('aj-hidden', !row.expanded);
    if (row.labelTr)  row.labelTr.classList.toggle('aj-hidden',  !row.expanded);
    row.childIds.forEach(cid => setVisible(cid, row.expanded, rowMap));
}

function setVisible(id, visible, rowMap) {
    const row = rowMap.get(id);
    if (!row) return;
    row.tr.classList.toggle('aj-hidden', !visible);

    if (!visible && row.expanded) {
        row.expanded = false;
        const btn    = row.tr.querySelector('.aj-toggle');
        if (btn) { btn.textContent = '▶'; btn.setAttribute('aria-label', 'Expand'); }
        if (row.detailTr) row.detailTr.classList.add('aj-hidden');
        if (row.labelTr)  row.labelTr.classList.add('aj-hidden');
        row.childIds.forEach(cid => setVisible(cid, false, rowMap));
    }
}

function capitalize(str) {
    return str ? str[0].toUpperCase() + str.slice(1) : '';
}
