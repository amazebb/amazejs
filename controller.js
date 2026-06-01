import { fetchData, inferColumns, getVisible, computeCounts, sortItems } from './model.js';
import {
    buildToolbar, buildNoResults,
    buildHeader, buildRows, buildFilterOptions,
    syncCheckboxes, setRowVisibility,
    updateFilterCounts, filterOptionRows, downloadCsv, downloadJson,
    positionBelow
} from './view.js';

let _tableCount = 0;

export async function initTable(config) {
    let data = config.data;
    if (Array.isArray(data) && typeof data[0] === 'string') {
        data = await fetchData(...data);
    }

    const {
        nested         = false,
        searchKeys     = [],
        searchPlaceholder,
        badgeAlwaysShow = false,
        exportFilename,
        striped        = false,
        rowNumbers     = false,
        bordered       = false,
        buttons        = [],
        searchDebounce = true,
        stickyHeaders  = true
    } = config;

    const tableId = config.tableId || `atv_t${++_tableCount}`;
    const table   = config.table  || document.getElementById(tableId);

    if (striped)  table.classList.add('atv-striped');
    if (bordered) table.classList.add('atv-bordered');

    const thead = document.createElement('thead');
    const tbody = document.createElement('tbody');
    table.append(thead, tbody);

    let searchInput, countBadge, exportBtns, extraBtns, toolbar, settingsBtns, noResults, tableWrap;

    if (!nested) {
        tableWrap = document.createElement('div');
        tableWrap.className = 'table-wrap';
        table.parentNode.insertBefore(tableWrap, table);
        tableWrap.appendChild(table);

        const tableContainer = document.createElement('div');
        tableContainer.className = 'atv-table-container';
        tableWrap.parentNode.insertBefore(tableContainer, tableWrap);
        tableContainer.appendChild(tableWrap);

        ({ searchInput, countBadge, exportBtns, extraBtns, toolbar, settingsBtns } =
            buildToolbar(tableWrap, searchPlaceholder, !!exportFilename, buttons));

        noResults = buildNoResults(tableWrap);
    }

    // --- Model: resolve columns ---
    const colsWithAttrs = (config.columns || []).map(col => ({
        ...readColAttr(table, col.key),
        ...col
    }));
    const columns = inferColumns(data, colsWithAttrs);

    // --- View: build table content ---
    const { filterDefs, textDefs } = buildHeader(thead, columns, tableId, { rowNumbers });
    const rowMap = buildRows(tbody, data, columns, { rowNumbers });

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
        const query = searchInput ? searchInput.value : '';
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

    if (searchInput) {
        const onSearch = searchDebounce === false ? refresh
            : debounce(refresh, typeof searchDebounce === 'number' ? searchDebounce : 150);
        searchInput.addEventListener('input', onSearch);
    }

    if (exportBtns) {
        const jsonFilename = exportFilename.replace(/\.[^.]+$/, '.json');
        exportBtns.csv.addEventListener('click', () => {
            downloadCsv(columns, [...visibleSet], exportFilename);
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

        settingsBtns.rowNums.checked = rowNumbers;
        settingsBtns.borders.checked = bordered;
        settingsBtns.sticky.checked  = stickyHeaders;
        applySticky(stickyHeaders);

        settingsBtns.rowNums.addEventListener('change', () => {
            table.classList.toggle('atv-hide-rownums', !settingsBtns.rowNums.checked);
        });
        settingsBtns.borders.addEventListener('change', () => {
            table.classList.toggle('atv-bordered', settingsBtns.borders.checked);
        });
        settingsBtns.sticky.addEventListener('change', () => applySticky(settingsBtns.sticky.checked));
    }

    // --- Dropdown management ---
    function openDropdown(dd, btn) {
        positionBelow(dd, btn.parentElement);
        dd.querySelector('.filter-search').focus();
    }

    filterDefs.forEach(def => {
        const btn = document.getElementById(def.btnId);
        const dd  = document.getElementById(def.id);

        let wasOpen = false;
        btn.addEventListener('pointerdown', () => { wasOpen = dd.matches(':popover-open'); });
        btn.addEventListener('click', e => {
            e.preventDefault();
            if (!wasOpen) {
                openDropdown(dd, btn);
                const search = dd.querySelector('.filter-search');
                search.value = '';
                filterOptionRows(filterUI[def.key].rows, filterUI[def.key].values, '');
            }
        });

        dd.querySelector('.filter-search').addEventListener('input', function() {
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

        let wasOpen = false;
        btn.addEventListener('pointerdown', () => { wasOpen = dd.matches(':popover-open'); });
        btn.addEventListener('click', e => {
            e.preventDefault();
            if (!wasOpen) openDropdown(dd, btn);
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
}

function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function readColAttr(table, key) {
    const attr = table.dataset[`col${key[0].toUpperCase()}${key.slice(1)}`];
    if (!attr) return {};
    const [labelPart, filterPart] = attr.split(',').map(s => s.trim());
    const result = {};
    if (labelPart) result.label = labelPart;
    if (filterPart !== undefined) result.filter = filterPart.toLowerCase() !== 'false';
    return result;
}
