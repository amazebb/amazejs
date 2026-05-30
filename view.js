// DOM rendering functions — no business logic or mutable state.

let _arrayDdCount = 0;
let _arrayDdListenerAdded = false;

function closeArrayDds() {
    document.querySelectorAll('[data-array-dd].show').forEach(el => el.classList.remove('show'));
}

function ensureArrayDdListener() {
    if (_arrayDdListenerAdded) return;
    _arrayDdListenerAdded = true;
    document.addEventListener('click', e => {
        if (!e.target.closest('.aj-array-badge, [data-array-dd]')) closeArrayDds();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeArrayDds(); });
    document.addEventListener('scroll', closeArrayDds, true);
}

// Positions dd below anchor, clamped to the viewport edges.
export function positionBelow(dd, anchor) {
    const rect = anchor.getBoundingClientRect();
    dd.style.top  = `${rect.bottom + 4}px`;
    dd.style.left = `${rect.left}px`;
    dd.classList.add('show');
    const r = dd.getBoundingClientRect();
    if (r.right > window.innerWidth - 8) dd.style.left = `${Math.max(8, window.innerWidth - r.width - 8)}px`;
    if (r.left < 8) dd.style.left = '8px';
}

// Renders an array-valued cell: first value inline + "+N" badge that opens a dropdown list.
export function renderArrayCell(td, values) {
    if (!values.length) return;
    if (values.length === 1) { td.textContent = String(values[0]); return; }

    ensureArrayDdListener();

    const id = `ajdd_${++_arrayDdCount}`;
    td.appendChild(document.createTextNode(String(values[0])));

    const badge = document.createElement('button');
    badge.className   = 'aj-array-badge';
    badge.textContent = `+${values.length - 1}`;
    td.appendChild(badge);

    const dd = document.createElement('div');
    dd.className = 'filter-dropdown';
    dd.id = id;
    dd.dataset.arrayDd = '';

    const header = document.createElement('div');
    header.className = 'aj-array-header';
    header.textContent = 'Values';
    dd.appendChild(header);

    values.forEach(v => {
        const item = document.createElement('div');
        item.className = 'aj-array-item';
        item.textContent = String(v);
        dd.appendChild(item);
    });
    document.body.appendChild(dd);

    badge.addEventListener('click', e => {
        e.stopPropagation();
        const isOpen = dd.classList.contains('show');
        document.querySelectorAll('[data-array-dd].show').forEach(el => el.classList.remove('show'));
        if (!isOpen) positionBelow(dd, badge);
    });
}

// Returns a render function that builds <a> (optionally wrapped in another element).
// textKey: data field for link text; hrefKey: data field for href; wrap: tag name e.g. 'code'
export function linkCell(textKey, hrefKey, { wrap } = {}) {
    return item => {
        const a = document.createElement('a');
        a.textContent = item[textKey];
        a.href        = item[hrefKey];
        if (wrap) {
            const el = document.createElement(wrap);
            el.appendChild(a);
            return el;
        }
        return a;
    };
}

// Builds and inserts a toolbar (search input + optional export button) before the table wrapper.
// Returns { searchInput, exportBtn } for controller wiring.
export function buildToolbar(tableWrap, placeholder, hasExport) {
    const toolbar = document.createElement('div');
    toolbar.className = 'atv-toolbar';

    const searchInput       = document.createElement('input');
    searchInput.type        = 'text';
    searchInput.className   = 'atv-search';
    searchInput.placeholder = placeholder || 'Search...';
    toolbar.appendChild(searchInput);

    let exportBtn = null;
    if (hasExport) {
        exportBtn             = document.createElement('button');
        exportBtn.className   = 'atv-export-btn';
        exportBtn.textContent = 'Export CSV';
        toolbar.appendChild(exportBtn);
    }

    tableWrap.insertAdjacentElement('beforebegin', toolbar);
    return { searchInput, exportBtn };
}

// Builds and inserts a footer showing visible/total counts after the table wrapper.
// Returns the footer element for later updates.
export function buildFooter(tableWrap) {
    const footer       = document.createElement('div');
    footer.className   = 'atv-footer';
    tableWrap.insertAdjacentElement('afterend', footer);
    return footer;
}

// Builds and inserts a no-results message after the footer.
// Returns the element for show/hide toggling.
export function buildNoResults(tableWrap, message) {
    const el           = document.createElement('div');
    el.className       = 'atv-no-results';
    el.textContent     = message || 'No items match the current filters.';
    tableWrap.insertAdjacentElement('afterend', el);
    return el;
}

// Updates the footer text.
export function updateFooter(footerEl, visible, total) {
    footerEl.textContent = `${visible} / ${total}`;
}

// Builds the thead row from column definitions.
// 'category' columns get a button + dropdown with checkboxes.
// 'text' columns get a button + dropdown with just a search input.
// Others are plain sortable ths.
// Returns { filterDefs, textDefs } — both arrays have shape [{ id, btnId, key, col }].
export function buildHeader(thead, columns, tableId, { rowNumbers = false, title = '' } = {}) {
    if (title) {
        const colSpan = columns.length + (rowNumbers ? 1 : 0);
        const titleTr = document.createElement('tr');
        const titleTh = document.createElement('th');
        titleTh.colSpan   = colSpan;
        titleTh.className = 'aj-title-cell';
        titleTh.textContent = title;
        titleTr.appendChild(titleTh);
        thead.appendChild(titleTr);
    }

    const tr         = document.createElement('tr');
    const filterDefs = [];
    const textDefs   = [];

    if (rowNumbers) {
        const th       = document.createElement('th');
        th.className   = 'atv-row-num';
        th.textContent = '#';
        tr.appendChild(th);
    }

    columns.forEach(col => {
        const th = document.createElement('th');
        th.setAttribute('data-col', col._i);

        if (col.filter === 'category' || col.filter === 'text') {
            const filterId = `${tableId}_filter_${col.key}`;
            const btnId    = `${tableId}_btn_${col.key}`;

            const wrap = document.createElement('span');
            wrap.className = 'filter-wrap';

            const btn = document.createElement('button');
            btn.className   = 'filter-btn';
            btn.id          = btnId;
            btn.textContent = col.label;
            wrap.appendChild(btn);
            th.appendChild(wrap);

            if (col.filter === 'category') {
                filterDefs.push({ id: filterId, btnId, key: col.key, col: col._i });
                document.body.appendChild(buildDropdown(filterId));
            } else {
                textDefs.push({ id: filterId, btnId, key: col.key, col: col._i });
                document.body.appendChild(buildTextDropdown(filterId));
            }
        } else {
            th.className   = 'sortable';
            th.textContent = col.label;
        }

        tr.appendChild(th);
    });

    thead.appendChild(tr);
    return { filterDefs, textDefs };
}

function buildDropdown(id) {
    const dd = document.createElement('div');
    dd.className = 'filter-dropdown';
    dd.id        = id;

    const fsearch         = document.createElement('input');
    fsearch.className     = 'filter-search';
    fsearch.type          = 'text';
    fsearch.placeholder   = 'Search...';

    const foptions        = document.createElement('div');
    foptions.className    = 'filter-options';

    const factions        = document.createElement('div');
    factions.className    = 'filter-actions';

    const selAll          = document.createElement('button');
    selAll.className      = 'sel-all';
    selAll.textContent    = 'Show All';

    const badge           = document.createElement('span');
    badge.className       = 'filter-actions-badge';

    const clrAll          = document.createElement('button');
    clrAll.className      = 'clr-all';
    clrAll.textContent    = 'Clear All';

    factions.appendChild(selAll);
    factions.appendChild(badge);
    factions.appendChild(clrAll);
    dd.appendChild(fsearch);
    dd.appendChild(foptions);
    dd.appendChild(factions);
    return dd;
}

function buildTextDropdown(id) {
    const dd = document.createElement('div');
    dd.className = 'filter-dropdown';
    dd.id        = id;

    const input       = document.createElement('input');
    input.className   = 'filter-search';
    input.type        = 'text';
    input.placeholder = 'Filter…';

    dd.appendChild(input);
    return dd;
}

// Builds tbody rows via DocumentFragment (single reflow).
// Attaches item.tr to each data item for later visibility toggling.
export function buildRows(tbody, data, columns, { rowNumbers = false } = {}) {
    const fragment = document.createDocumentFragment();
    data.forEach(item => {
        const tr = document.createElement('tr');
        if (rowNumbers) {
            const td     = document.createElement('td');
            td.className = 'atv-row-num';
            tr.appendChild(td);
        }
        columns.forEach(col => {
            const td = document.createElement('td');
            const value = item[col.key];
            if (col.render) {
                td.appendChild(col.render(item));
            } else if (Array.isArray(value)) {
                renderArrayCell(td, value);
            } else {
                td.textContent = value || '';
            }
            tr.appendChild(td);
        });
        fragment.appendChild(tr);
        item.tr = tr;
    });
    tbody.appendChild(fragment);
}



// Builds the checkbox option rows inside a filter dropdown.
// onCheck(value, checked) and onOnly(value) are controller-provided callbacks.
// Returns { rows, checkboxes } for later updates.
export function buildFilterOptions(filterId, values, onCheck, onOnly) {
    const container = document.querySelector(`#${filterId} .filter-options`);
    const rows = {}, checkboxes = {};

    values.forEach(v => {
        const row = document.createElement('div');
        row.className = 'filter-row';
        row.setAttribute('data-value', v.toLowerCase());

        const label = document.createElement('label');
        const cb    = document.createElement('input');
        cb.type    = 'checkbox';
        cb.checked = true;
        cb.addEventListener('change', function() { onCheck(v, this.checked); });
        label.appendChild(cb);
        label.appendChild(document.createTextNode(v));

        const onlyBtn       = document.createElement('button');
        onlyBtn.className   = 'only-btn';
        onlyBtn.textContent = 'Only';
        onlyBtn.addEventListener('click', e => { e.preventDefault(); onOnly(v); });

        row.appendChild(label);
        row.appendChild(onlyBtn);
        container.appendChild(row);

        rows[v]       = row;
        checkboxes[v] = cb;
    });

    return { rows, checkboxes };
}

// Syncs checkbox checked state to match the current selected Set.
export function syncCheckboxes(checkboxes, selected) {
    Object.entries(checkboxes).forEach(([v, cb]) => { cb.checked = selected.has(v); });
}

// Shows/hides rows based on the visible set returned by model.getVisible.
export function setRowVisibility(data, visibleSet) {
    data.forEach(item => item.tr.classList.toggle('hidden', !visibleSet.has(item)));
}

// Updates count labels, hides zero-count options, and refreshes the badge.
export function updateFilterCounts(filterDef, values, counts, selected, rows, badgeAlwaysShow) {
    values.forEach(v => {
        const row   = rows[v];
        const count = counts[v] || 0;
        let countEl = row.querySelector('.filter-count');
        if (!countEl) {
            countEl           = document.createElement('span');
            countEl.className = 'filter-count';
            row.insertBefore(countEl, row.querySelector('.only-btn'));
        }
        countEl.textContent = count;
        row.dataset.empty   = count === 0 ? 'true' : '';
        row.style.display   = count === 0 ? 'none' : '';
    });

    const visibleTotal    = values.filter(v => (counts[v] || 0) > 0).length;
    const visibleSelected = values.filter(v => (counts[v] || 0) > 0 && selected.has(v)).length;
    const isFiltered      = visibleSelected < visibleTotal;
    const btn             = document.getElementById(filterDef.btnId);
    const badgeEl         = document.querySelector(`#${filterDef.id} .filter-actions-badge`);
    btn.classList.toggle('active', isFiltered);
    if (isFiltered || badgeAlwaysShow) {
        badgeEl.innerHTML = `<span class="filter-badge">${visibleSelected}/${visibleTotal}</span>`;
    } else {
        badgeEl.innerHTML = '';
    }
}

// Generates a CSV from visible items using column definitions and triggers a download.
export function downloadCsv(columns, items, filename) {
    const header = columns.map(c => c.label);
    const rows   = items.map(item =>
        columns.map(c => {
            const v = (item[c.key] || '').toString();
            return `"${v.replace(/"/g, '""')}"`;
        })
    );
    const csv  = [header, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
}

// Shows/hides option rows inside an open dropdown based on the search query.
export function filterOptionRows(rows, values, query) {
    const q = query.toLowerCase();
    values.forEach(v => {
        const row   = rows[v];
        const match = (!q || v.toLowerCase().includes(q)) && row.dataset.empty !== 'true';
        row.style.display = match ? '' : 'none';
    });
}
