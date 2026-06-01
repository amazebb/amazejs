import { fetchData, inferColumns, getVisible, computeCounts, sortItems } from './model.js';
import {
    buildToolbar, buildNoResults,
    buildHeader, buildRows, buildFilterOptions,
    syncCheckboxes, setRowVisibility,
    updateFilterCounts, filterOptionRows, downloadCsv, downloadJson,
    positionBelow
} from './view.js';

export async function initTable(config) {
    let data = config.data;
    if (Array.isArray(data) && typeof data[0] === 'string') {
        data = await fetchData(...data);
    }

    const {
        tableId,
        searchKeys,
        searchPlaceholder,
        badgeAlwaysShow = false,
        exportFilename,
        striped    = false,
        rowNumbers = false,
        bordered   = false,
        title      = '',
        buttons    = []
    } = config;

    const table     = document.getElementById(tableId);
    if (striped)   table.classList.add('atv-striped');
    if (bordered)  table.classList.add('atv-bordered');
    const tbody     = table.querySelector('tbody');
    const thead     = table.querySelector('thead');
    const tableWrap = table.closest('.table-wrap') || table.parentElement;

    // --- Model: resolve columns ---
    const colsWithAttrs = (config.columns || []).map(col => ({
        ...readColAttr(table, col.key),
        ...col  // explicit config overrides data-col-* attributes
    }));
    const columns = inferColumns(data, colsWithAttrs);

    // --- View: build chrome around the table ---
    const { searchInput, exportBtns, extraBtns, settingsBtns } = buildToolbar(tableWrap, searchPlaceholder, !!exportFilename, buttons);
    const noResults = buildNoResults(tableWrap);

    // --- View: build table content ---
    const { filterDefs, textDefs, titleBadge } = buildHeader(thead, columns, tableId, { rowNumbers, title });
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
        const query = searchInput.value;
        visibleSet  = new Set(getVisible(sortedData, filterState, textFilterState, query, searchKeys));

        setRowVisibility(sortedData, visibleSet, rowMap);
        if (titleBadge) titleBadge.textContent = `${visibleSet.size} / ${data.length}`;
        noResults.classList.toggle('show', visibleSet.size === 0);

        const counts = computeCounts(data, filterState, textFilterState, query, searchKeys);
        filterDefs.forEach(def => {
            const ui = filterUI[def.key];
            updateFilterCounts(def, ui.values, counts[def.key] || {}, filterState[def.key], ui.rows, badgeAlwaysShow);
        });
        textDefs.forEach(def => {
            document.getElementById(def.btnId).classList.toggle('active', !!textFilterState[def.key]);
        });
    }

    searchInput.addEventListener('input', refresh);

    if (exportBtns) {
        const jsonFilename = exportFilename.replace(/\.[^.]+$/, '.json');
        exportBtns.csv.addEventListener('click', () => {
            downloadCsv(columns, [...visibleSet], exportFilename);
            exportBtns.dd.classList.remove('show');
        });
        exportBtns.json.addEventListener('click', () => {
            downloadJson([...visibleSet], jsonFilename);
            exportBtns.dd.classList.remove('show');
        });
    }

    extraBtns.forEach((btn, i) => {
        btn.addEventListener('click', () => buttons[i].onClick([...visibleSet], btn));
    });

    // --- Settings toggles ---
    settingsBtns.rowNums.checked  = rowNumbers;
    settingsBtns.borders.checked  = bordered;

    settingsBtns.rowNums.addEventListener('change', () => {
        table.classList.toggle('atv-hide-rownums', !settingsBtns.rowNums.checked);
    });

    settingsBtns.borders.addEventListener('change', () => {
        table.classList.toggle('atv-bordered', settingsBtns.borders.checked);
    });

    // --- Dropdown management ---
    const allDropdowns = [...filterDefs, ...textDefs].map(def => ({
        dd:   document.getElementById(def.id),
        wrap: document.getElementById(def.btnId).parentElement
    }));
    if (exportBtns) allDropdowns.push({ dd: exportBtns.dd, wrap: exportBtns.wrap });
    allDropdowns.push({ dd: settingsBtns.dd, wrap: settingsBtns.wrap });

    function closeAll() {
        allDropdowns.forEach(({ dd }) => dd.classList.remove('show'));
    }

    function openDropdown(dd, btn) {
        positionBelow(dd, btn.parentElement);
        dd.querySelector('.filter-search').focus();
    }

    filterDefs.forEach(def => {
        const btn = document.getElementById(def.btnId);
        const dd  = document.getElementById(def.id);

        btn.addEventListener('click', e => {
            e.preventDefault();
            const open = dd.classList.contains('show');
            closeAll();
            if (!open) {
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

        btn.addEventListener('click', e => {
            e.preventDefault();
            const open = dd.classList.contains('show');
            closeAll();
            if (!open) openDropdown(dd, btn);
        });

        input.addEventListener('input', () => {
            textFilterState[def.key] = input.value;
            refresh();
        });
    });

    document.addEventListener('click', e => {
        allDropdowns.forEach(({ dd, wrap }) => {
            if (!wrap.contains(e.target) && !dd.contains(e.target)) {
                dd.classList.remove('show');
            }
        });
    });

    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAll(); });

    // --- Sorting ---
    function sortByCol(colIndex) {
        const col = columns.find(c => c._i === colIndex);
        if (!col) return;

        if (sortState.key === col.key) {
            sortState.dir *= -1;
        } else {
            sortState.key = col.key;
            sortState.dir = 1;
        }

        const dirClass = sortState.dir === 1 ? 'asc' : 'desc';
        table.querySelectorAll('th.sortable').forEach(th => th.classList.remove('asc', 'desc'));
        const activeTh = table.querySelector(`th[data-col="${colIndex}"]`);
        if (activeTh) activeTh.classList.add(dirClass);
        [...filterDefs, ...textDefs].forEach(def => {
            if (def.col === colIndex) {
                document.getElementById(def.btnId).parentElement.parentElement.classList.add(dirClass);
            }
        });

        sortedData = sortItems(data, col.key, sortState.dir);
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

// Reads data-col-{key} from the table element and returns { label?, filter? }.
// Format: "Label" or "Label,true|false"
function readColAttr(table, key) {
    const attr = table.dataset[`col${key[0].toUpperCase()}${key.slice(1)}`];
    if (!attr) return {};
    const [labelPart, filterPart] = attr.split(',').map(s => s.trim());
    const result = {};
    if (labelPart) result.label = labelPart;
    if (filterPart !== undefined) result.filter = filterPart.toLowerCase() !== 'false';
    return result;
}
