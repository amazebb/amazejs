// DOM rendering functions — no business logic or mutable state.

const _link = document.createElement('link');
_link.rel = 'stylesheet';
_link.href = new URL('./amazejs.css', import.meta.url).href;
document.head.appendChild(_link);

let _arrayDdCount = 0;

// Positions dd below anchor, clamped to the viewport edges.
export function positionBelow(dd, anchor) {
    const rect = anchor.getBoundingClientRect();
    dd.style.top  = `${rect.bottom + 4}px`;
    dd.style.left = `${rect.left}px`;
    dd.showPopover();
    const r = dd.getBoundingClientRect();
    if (r.right > window.innerWidth - 8) dd.style.left = `${Math.max(8, window.innerWidth - r.width - 8)}px`;
    if (r.left < 8) dd.style.left = '8px';
}

// Renders an array-valued cell: first value inline + "+N" badge that opens a dropdown list.
export function renderArrayCell(td, values) {
    if (!values.length) return;
    if (values.length === 1) { td.textContent = String(values[0]); return; }

    const id = `ajdd_${++_arrayDdCount}`;
    td.appendChild(document.createTextNode(String(values[0])));

    const badge = document.createElement('button');
    badge.className   = 'aj-array-badge';
    badge.textContent = `+${values.length - 1}`;
    td.appendChild(badge);

    const dd = document.createElement('div');
    dd.className = 'filter-dropdown';
    dd.id = id;
    dd.popover = 'auto';

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

    let wasOpen = false;
    badge.addEventListener('pointerdown', () => { wasOpen = dd.matches(':popover-open'); });
    badge.addEventListener('click', () => { if (!wasOpen) positionBelow(dd, badge); });
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

// Builds and inserts a toolbar (search input + optional export split button + optional extra buttons) before the table wrapper.
// Returns { searchInput, exportBtns, extraBtns } for controller wiring.
// exportBtns: { csv, json, dd, wrap } — the two clickable items, dropdown el, and wrapper for click-outside detection.
export function buildToolbar(tableWrap, placeholder, hasExport, buttons = []) {
    const toolbar = document.createElement('div');
    toolbar.className = 'atv-toolbar';

    const searchInput       = document.createElement('input');
    searchInput.type        = 'text';
    searchInput.className   = 'atv-search';
    searchInput.placeholder = placeholder || 'Search...';
    toolbar.appendChild(searchInput);

    let exportBtns = null;
    if (hasExport) {
        const group = document.createElement('div');
        group.className = 'atv-split-btn';

        const main        = document.createElement('button');
        main.className    = 'atv-export-btn';
        main.textContent  = 'Export';

        const arrow       = document.createElement('button');
        arrow.className   = 'atv-split-arrow';
        arrow.textContent = '▾';

        group.appendChild(main);
        group.appendChild(arrow);
        toolbar.appendChild(group);

        const dd = document.createElement('div');
        dd.className = 'filter-dropdown atv-export-dd';
        dd.popover   = 'auto';
        document.body.appendChild(dd);

        const csv  = document.createElement('div');
        csv.className   = 'aj-array-item';
        csv.textContent = 'CSV';

        const json = document.createElement('div');
        json.className   = 'aj-array-item';
        json.textContent = 'JSON';

        dd.appendChild(csv);
        dd.appendChild(json);

        let exportWasOpen = false;
        const captureOpen = () => { exportWasOpen = dd.matches(':popover-open'); };
        const openExport  = () => { if (!exportWasOpen) positionBelow(dd, group); };
        main.addEventListener('pointerdown', captureOpen);
        main.addEventListener('click', openExport);
        arrow.addEventListener('pointerdown', captureOpen);
        arrow.addEventListener('click', openExport);

        exportBtns = { csv, json, dd, wrap: group };
    }

    const extraBtns = buttons.map(cfg => {
        const btn           = document.createElement('button');
        btn.className       = 'atv-export-btn';
        btn.textContent     = cfg.label;
        toolbar.appendChild(btn);
        return btn;
    });

    // Settings button — always far right via margin-left: auto
    const settingsBtn       = document.createElement('button');
    settingsBtn.className   = 'atv-settings-btn';
    settingsBtn.textContent = '⚙';
    toolbar.appendChild(settingsBtn);

    const settingsDd = document.createElement('div');
    settingsDd.className = 'filter-dropdown';
    settingsDd.popover   = 'auto';
    document.body.appendChild(settingsDd);

    const settingsHdr       = document.createElement('div');
    settingsHdr.className   = 'aj-array-header';
    settingsHdr.textContent = 'Settings';
    settingsDd.appendChild(settingsHdr);

    const settingsOpts = document.createElement('div');
    settingsOpts.className = 'filter-options';
    settingsDd.appendChild(settingsOpts);

    const rowNumsCb = makeSettingsRow(settingsOpts, 'Row Numbers');
    const bordersCb = makeSettingsRow(settingsOpts, 'Column Separators');

    let settingsWasOpen = false;
    settingsBtn.addEventListener('pointerdown', () => { settingsWasOpen = settingsDd.matches(':popover-open'); });
    settingsBtn.addEventListener('click', () => { if (!settingsWasOpen) positionBelow(settingsDd, settingsBtn); });

    tableWrap.insertAdjacentElement('beforebegin', toolbar);
    return { searchInput, exportBtns, extraBtns, settingsBtns: { rowNums: rowNumsCb, borders: bordersCb, dd: settingsDd, wrap: settingsBtn } };
}

function makeSettingsRow(container, label) {
    const row = document.createElement('div');
    row.className = 'filter-row';

    const lbl = document.createElement('label');
    const cb  = document.createElement('input');
    cb.type   = 'checkbox';
    lbl.appendChild(cb);
    lbl.appendChild(document.createTextNode(label));
    row.appendChild(lbl);
    container.appendChild(row);
    return cb;
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
// Returns { filterDefs, textDefs, titleBadge } — titleBadge is the count span in the title row, or null.
export function buildHeader(thead, columns, tableId, { rowNumbers = false, title = '' } = {}) {
    let titleBadge = null;

    if (title) {
        const colSpan = columns.length + (rowNumbers ? 1 : 0);
        const titleTr = document.createElement('tr');
        const titleTh = document.createElement('th');
        titleTh.colSpan   = colSpan;
        titleTh.className = 'aj-title-cell';
        titleTh.appendChild(document.createTextNode(title + '  '));

        titleBadge           = document.createElement('span');
        titleBadge.className = 'filter-badge';
        titleTh.appendChild(titleBadge);

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
    return { filterDefs, textDefs, titleBadge };
}

function buildDropdown(id) {
    const dd = document.createElement('div');
    dd.className = 'filter-dropdown';
    dd.id        = id;
    dd.popover   = 'auto';

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
    dd.popover   = 'auto';

    const input       = document.createElement('input');
    input.className   = 'filter-search';
    input.type        = 'text';
    input.placeholder = 'Filter…';

    dd.appendChild(input);
    return dd;
}

// Builds tbody rows via DocumentFragment (single reflow).
// Returns a WeakMap<item, tr> for later visibility toggling and sorting.
export function buildRows(tbody, data, columns, { rowNumbers = false } = {}) {
    const rowMap = new WeakMap();
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
        rowMap.set(item, tr);
    });
    tbody.appendChild(fragment);
    return rowMap;
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
export function setRowVisibility(data, visibleSet, rowMap) {
    data.forEach(item => rowMap.get(item).classList.toggle('hidden', !visibleSet.has(item)));
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
    badgeEl.textContent = '';
    if (isFiltered || badgeAlwaysShow) {
        const badge = document.createElement('span');
        badge.className = 'filter-badge';
        badge.textContent = `${visibleSelected}/${visibleTotal}`;
        badgeEl.appendChild(badge);
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

// Generates a JSON file from visible items and triggers a download.
export function downloadJson(items, filename) {
    const clean = [...items];
    const blob  = new Blob([JSON.stringify(clean, null, 2)], { type: 'application/json' });
    const a     = document.createElement('a');
    a.href      = URL.createObjectURL(blob);
    a.download  = filename;
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
