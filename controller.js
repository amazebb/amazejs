import { fetchData, inferColumns, getVisible, computeCounts, sortItems, isUrlData, titleFromUrl } from './model.js';
import {
    buildToolbar, buildNoResults,
    buildHeader, buildRows, buildFilterOptions,
    syncCheckboxes, setRowVisibility,
    updateFilterCounts, filterOptionRows, downloadCsv, downloadJson,
    attachPopover
} from './view.js';
import { initTree, isTreeData } from './tree.js';

let _tableCount = 0;

export async function initTable(config) {
    let data = config.data;
    if (isUrlData(data)) {
        data = await fetchData(...data);
    }

    // Tree-shaped data is handled by tree.js, which calls back in here for each
    // table it builds — those calls carry explicit columns and take the flat path.
    // levels: false forces a flat table even when the data looks tree-shaped.
    if (!config.nested && !config.columns && config.levels !== false
        && (config.levels || isTreeData(data))) {
        return initTree(config, data);
    }

    const {
        nested         = false,
        searchKeys     = [],
        badgeAlwaysShow = false,
        exportFilename,
        striped        = false,
        rowNumbers     = false,
        bordered       = false,
        buttons        = [],
        searchDebounce = true,
        stickyHeaders  = true,
        showFilterRow  = true
    } = config;

    const title = config.title ||
        (isUrlData(config.data) ? titleFromUrl(config.data[0]) : '');

    const effectiveExportFilename = exportFilename === false ? null
        : (typeof exportFilename === 'string' ? exportFilename
        : title ? `${title.toLowerCase().replace(/\s+/g, '-')}.csv` : 'data.csv');

    const tableId = config.tableId || `atv_t${++_tableCount}`;
    const table   = config.table  || document.getElementById(tableId);

    if (striped)  table.classList.add('atv-striped');
    if (bordered) table.classList.add('atv-bordered');

    const thead = document.createElement('thead');
    const tbody = document.createElement('tbody');
    table.append(thead, tbody);

    let countBadge, exportBtns, extraBtns, toolbar, controls, settingsBtns, noResults, tableWrap;

    if (!nested) {
        tableWrap = document.createElement('div');
        tableWrap.className = 'table-wrap';
        table.parentNode.insertBefore(tableWrap, table);
        tableWrap.appendChild(table);

        const tableContainer = document.createElement('div');
        tableContainer.className = 'atv-table-container';
        tableWrap.parentNode.insertBefore(tableContainer, tableWrap);
        tableContainer.appendChild(tableWrap);

        noResults = buildNoResults(tableWrap);
    }

    // Toolbar for all tables unless suppressed; nested uses table as anchor (no tableWrap).
    if (config.showToolbar ?? true) {
        ({ countBadge, exportBtns, extraBtns, toolbar, controls, settingsBtns } =
            buildToolbar(tableWrap || table, !!effectiveExportFilename, buttons, title));
    }

    // An external count badge (e.g. a tree group header line) replaces the toolbar one.
    if (config.countBadgeEl) {
        countBadge?.remove();
        countBadge = config.countBadgeEl;
    }


    const effectiveSearchInput = config.searchInputEl || null;

    // --- Model: resolve columns ---
    const columns = inferColumns(data, config.columns);

    // --- View: build table content ---
    const { filterDefs, textDefs } = buildHeader(thead, columns, tableId);
    const rowMap = buildRows(tbody, data, columns);
    if (!rowNumbers) table.classList.add('atv-hide-rownums');

    // --- State ---
    const filterState     = {};
    const textFilterState = {};
    const filterUI        = {};
    let sortedData = [...data];
    let visibleSet = new Set(data);
    const sortState = { key: null, dir: 1 };

    filterDefs.forEach(def => {
        const values = [...new Set(data.map(d => d[def.key]))].filter(Boolean).sort();
        filterState[def.key] = new Set(values);

        const { rows, checkboxes } = buildFilterOptions(
            def.id, values,
            (v, checked) => {
                if (checked) filterState[def.key].add(v);
                else filterState[def.key].delete(v);
                refresh();
            },
            v => {
                filterState[def.key] = new Set([v]);
                syncCheckboxes(filterUI[def.key].checkboxes, filterState[def.key]);
                refresh();
            }
        );

        filterUI[def.key] = { values, rows, checkboxes };
    });

    textDefs.forEach(def => { textFilterState[def.key] = ''; });

    // --- Refresh: apply filters, update all UI ---
    function refresh() {
        const query = effectiveSearchInput ? effectiveSearchInput.value : '';
        visibleSet  = new Set(getVisible(sortedData, filterState, textFilterState, query, searchKeys));

        setRowVisibility(sortedData, visibleSet, rowMap);
        if (countBadge) countBadge.textContent = `${visibleSet.size} / ${data.length}`;
        if (noResults)  noResults.classList.toggle('show', visibleSet.size === 0);

        const counts = computeCounts(data, filterState, textFilterState, query, searchKeys);
        filterDefs.forEach(def => {
            const ui = filterUI[def.key];
            updateFilterCounts(def, ui.values, counts[def.key] || {}, filterState[def.key], ui.rows, badgeAlwaysShow);
        });
        textDefs.forEach(def => {
            document.getElementById(def.btnId).classList.toggle('active', !!textFilterState[def.key]);
        });
    }

    if (effectiveSearchInput) {
        const onSearch = searchDebounce === false ? refresh
            : debounce(refresh, typeof searchDebounce === 'number' ? searchDebounce : 150);
        effectiveSearchInput.addEventListener('input', onSearch);
    }

    if (exportBtns) {
        const jsonFilename = effectiveExportFilename.replace(/\.[^.]+$/, '.json');
        exportBtns.csv.addEventListener('click', () => {
            downloadCsv(columns, [...visibleSet], effectiveExportFilename);
            exportBtns.dd.hidePopover();
        });
        exportBtns.json.addEventListener('click', () => {
            downloadJson([...visibleSet], jsonFilename);
            exportBtns.dd.hidePopover();
        });
    }

    if (extraBtns) {
        extraBtns.forEach((btn, i) => {
            btn.addEventListener('click', () => buttons[i].onClick([...visibleSet], btn));
        });
    }

    // --- Settings toggles (non-nested only) ---
    if (settingsBtns) {
        function applySticky(on) { toolbar.classList.toggle('atv-sticky', on); }

        settingsBtns.rowNums.checked   = rowNumbers;
        settingsBtns.borders.checked   = bordered;
        settingsBtns.sticky.checked    = stickyHeaders;
        settingsBtns.filterRow.checked = showFilterRow;
        applySticky(stickyHeaders);
        const applyFilterRow = on => { controls.style.display = on ? '' : 'none'; };
        applyFilterRow(showFilterRow);

        settingsBtns.rowNums.addEventListener('change', () => {
            table.classList.toggle('atv-hide-rownums', !settingsBtns.rowNums.checked);
        });
        settingsBtns.borders.addEventListener('change', () => {
            table.classList.toggle('atv-bordered', settingsBtns.borders.checked);
        });
        settingsBtns.sticky.addEventListener('change', () => applySticky(settingsBtns.sticky.checked));
        settingsBtns.filterRow.addEventListener('change', () => applyFilterRow(settingsBtns.filterRow.checked));
    }

    // --- Dropdown management ---
    filterDefs.forEach(def => {
        const btn    = document.getElementById(def.btnId);
        const dd     = document.getElementById(def.id);
        const search = dd.querySelector('.filter-search');

        attachPopover(btn, dd, btn.parentElement);
        dd.addEventListener('beforetoggle', e => {
            if (e.newState !== 'open') return;
            search.value = '';
            filterOptionRows(filterUI[def.key].rows, filterUI[def.key].values, '');
            requestAnimationFrame(() => search.focus());
        });

        search.addEventListener('input', function() {
            filterOptionRows(filterUI[def.key].rows, filterUI[def.key].values, this.value);
        });

        dd.querySelector('.sel-all').addEventListener('click', e => {
            e.preventDefault();
            filterState[def.key] = new Set(filterUI[def.key].values);
            syncCheckboxes(filterUI[def.key].checkboxes, filterState[def.key]);
            refresh();
        });

        dd.querySelector('.clr-all').addEventListener('click', e => {
            e.preventDefault();
            filterState[def.key] = new Set();
            syncCheckboxes(filterUI[def.key].checkboxes, filterState[def.key]);
            refresh();
        });
    });

    textDefs.forEach(def => {
        const btn   = document.getElementById(def.btnId);
        const dd    = document.getElementById(def.id);
        const input = dd.querySelector('.filter-search');

        attachPopover(btn, dd, btn.parentElement);
        dd.addEventListener('beforetoggle', e => {
            if (e.newState === 'open') requestAnimationFrame(() => input.focus());
        });

        input.addEventListener('input', () => {
            textFilterState[def.key] = input.value;
            refresh();
        });
    });

    // --- Sorting ---
    function sortByCol(colIndex) {
        const col = columns.find(c => c._i === colIndex);
        if (!col) return;

        sortState.dir = sortState.key === col.key ? sortState.dir * -1 : 1;
        sortState.key = col.key;

        const dirClass = sortState.dir === 1 ? 'asc' : 'desc';
        table.querySelectorAll('th.sortable').forEach(th => th.classList.remove('asc', 'desc'));
        table.querySelector(`th[data-col="${colIndex}"]`)?.classList.add(dirClass);
        [...filterDefs, ...textDefs].forEach(def => {
            if (def.col === colIndex)
                document.getElementById(def.btnId).parentElement.parentElement.classList.add(dirClass);
        });

        sortedData = sortItems(data, col.key, sortState.dir, col.numeric);
        sortedData.forEach(item => tbody.appendChild(rowMap.get(item)));
        refresh();
    }

    table.querySelectorAll('th.sortable').forEach(th => {
        th.addEventListener('click', () => sortByCol(parseInt(th.getAttribute('data-col'))));
    });

    [...filterDefs, ...textDefs].forEach(def => {
        const th = document.getElementById(def.btnId).closest('th');
        th.classList.add('sortable');
        th.addEventListener('click', e => { if (e.target === th) sortByCol(def.col); });
    });

    refresh();
    return table;
}

function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
