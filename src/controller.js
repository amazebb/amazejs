import { fetchData, inferColumns, getVisible, computeCounts, sortItems, isUrlData, titleFromUrl, parseCsv, parseTsv } from './model.js';
import {
    buildToolbar, buildNoResults,
    buildHeader, buildRows, buildFilterOptions,
    syncCheckboxes, setRowVisibility,
    updateFilterCounts, filterOptionRows, downloadCsv, downloadJson,
    attachPopover, ensureStyles
} from './view.js';
import { initTree, isTreeData } from './tree.js';

let _tableCount = 0;

export async function initTable(config) {
    ensureStyles();
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
        badgePosition  = 'left',
        exportFilename,
        striped        = false,
        rowNumbers     = false,
        bordered       = false,
        buttons        = [],
        searchDebounce = true,
        stickyHeaders  = true,
        showFilterRow  = true,
        collapsed      = false
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

    let countBadge, fileBtns, extraBtns, toolbar, rest, settingsBtns, moreBtn, toggleBtn, titleWrap, noResults, tableWrap;

    // Every table gets a container holding toolbar + table: it is the disclosure
    // target the toolbar collapses. Non-nested tables also get a scroll wrapper
    // and a no-results message.
    const tableContainer = document.createElement('div');
    tableContainer.className = 'atv-table-container';

    if (!nested) {
        tableWrap = document.createElement('div');
        tableWrap.className = 'table-wrap';
        table.parentNode.insertBefore(tableWrap, table);
        tableWrap.appendChild(table);

        tableWrap.parentNode.insertBefore(tableContainer, tableWrap);
        tableContainer.appendChild(tableWrap);

        noResults = buildNoResults(tableWrap);
    } else {
        table.parentNode.insertBefore(tableContainer, table);
        tableContainer.appendChild(table);
    }

    // Toolbar for all tables unless suppressed; nested uses table as anchor (no
    // tableWrap). File/Settings always sit behind the `⋯` overflow.
    if (config.showToolbar ?? true) {
        ({ countBadge, fileBtns, extraBtns, toolbar, rest, settingsBtns, moreBtn, toggleBtn, titleWrap } =
            buildToolbar(tableWrap || table, !!effectiveExportFilename, buttons, title));
    }

    if (moreBtn) {
        moreBtn.addEventListener('click', () => {
            const open = moreBtn.getAttribute('aria-expanded') === 'true';
            moreBtn.setAttribute('aria-expanded', String(!open));
        });
    }

    // Count badge leads the rest wrapper ('left', sitting just after the title)
    // by default; 'right' relocates it to the far end, after every button
    // (margin-left:auto in CSS); 'none' hides it. Applied here so the placement
    // is right even while a table is collapsed, before buildTableUI wires the
    // matching settings toggle.
    function applyBadgePosition(pos) {
        if (!countBadge) return;
        countBadge.classList.toggle('atv-badge-none', pos === 'none');
        countBadge.classList.toggle('atv-badge-right', pos === 'right');
        if (pos === 'right') rest.appendChild(countBadge);
        else rest.prepend(countBadge);
    }
    applyBadgePosition(badgePosition);

    const effectiveSearchInput = config.searchInputEl || null;

    // --- Disclosure: the toolbar doubles as a collapse/expand header line for
    // the container. A table starting collapsed defers its whole build (header,
    // rows, filter wiring) to the first expand — tree child groups rely on this
    // to keep deep trees lazy.
    let built = false;
    function setExpanded(open) {
        tableContainer.classList.toggle('atv-collapsed', !open);
        toggleBtn.setAttribute('aria-expanded', String(open));
        if (open && !built) { built = true; buildTableUI(); }
    }
    if (titleWrap) {
        titleWrap.addEventListener('click', () => {
            setExpanded(toggleBtn.getAttribute('aria-expanded') !== 'true');
        });
    }

    if (collapsed && toggleBtn) {
        tableContainer.classList.add('atv-collapsed');
        toggleBtn.setAttribute('aria-expanded', 'false');
        // Full count until the table is built and refresh() takes over.
        if (countBadge) countBadge.textContent = `${data.length} / ${data.length}`;
    } else {
        built = true;
        buildTableUI();
    }

    return table;

    function buildTableUI() {

    // --- Model: resolve columns ---
    const columns = inferColumns(data, config.columns);

    // --- View: build table content ---
    const { filterDefs, textDefs, rangeDefs } = buildHeader(thead, columns, tableId);
    const rowMap = buildRows(tbody, data, columns);
    if (!rowNumbers) table.classList.add('atv-hide-rownums');

    // --- State ---
    const filterState     = {};
    const textFilterState = {};
    const rangeState      = {};
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
    rangeDefs.forEach(def => { rangeState[def.key] = { min: null, max: null }; });

    // --- Refresh: apply filters, update all UI ---
    function refresh() {
        const query = effectiveSearchInput ? effectiveSearchInput.value : '';
        visibleSet  = new Set(getVisible(sortedData, filterState, textFilterState, rangeState, query, searchKeys));

        setRowVisibility(sortedData, visibleSet, rowMap);
        if (countBadge) countBadge.textContent = `${visibleSet.size} / ${data.length}`;
        if (noResults)  noResults.classList.toggle('show', visibleSet.size === 0);

        const counts = computeCounts(data, filterState, textFilterState, rangeState, query, searchKeys);
        filterDefs.forEach(def => {
            const ui = filterUI[def.key];
            updateFilterCounts(def, ui.values, counts[def.key] || {}, filterState[def.key], ui.rows, badgeAlwaysShow);
        });
        textDefs.forEach(def => {
            document.getElementById(def.thId).classList.toggle('active', !!textFilterState[def.key]);
        });
        rangeDefs.forEach(def => {
            const { min, max } = rangeState[def.key];
            document.getElementById(def.thId).classList.toggle('active', min != null || max != null);
        });
    }

    if (effectiveSearchInput) {
        const onSearch = searchDebounce === false ? refresh
            : debounce(refresh, typeof searchDebounce === 'number' ? searchDebounce : 150);
        effectiveSearchInput.addEventListener('input', onSearch);
    }

    if (fileBtns) {
        const jsonFilename = effectiveExportFilename.replace(/\.[^.]+$/, '.json');
        fileBtns.open.addEventListener('click', () => {
            fileBtns.dd.hidePopover();
            openFileDialog();
        });
        fileBtns.csv.addEventListener('click', () => {
            downloadCsv(columns, [...visibleSet], effectiveExportFilename);
            fileBtns.dd.hidePopover();
        });
        fileBtns.json.addEventListener('click', () => {
            downloadJson([...visibleSet], jsonFilename);
            fileBtns.dd.hidePopover();
        });
    }

    // File > Open: tears down everything this init built (toolbar and dropdowns
    // are nested in the container DOM, so removing it removes them too) and
    // re-inits in place with columns re-inferred from the opened data.
    async function rebuild(newData, newTitle) {
        const fresh = document.createElement('table');
        fresh.id = tableId;
        tableContainer.replaceWith(fresh);
        return initTable({
            ...config,
            data: newData, title: newTitle,
            columns: undefined, dataKey: undefined,
            collapsed: false,
            table: fresh,
        });
    }

    function openFileDialog() {
        const input  = document.createElement('input');
        input.type   = 'file';
        input.accept = '.csv,.tsv,.json,text/csv,text/tab-separated-values,application/json';
        input.addEventListener('change', async () => {
            const file = input.files[0];
            if (!file) return;
            try {
                const text = await file.text();
                const name = file.name.toLowerCase();
                const data = name.endsWith('.json') ? JSON.parse(text)
                    : name.endsWith('.tsv') ? parseTsv(text)
                    : parseCsv(text);
                await rebuild(data, titleFromUrl(file.name));
            } catch (err) {
                alert(`Could not open ${file.name}: ${err.message}`);
            }
        });
        input.click();
    }

    if (extraBtns) {
        extraBtns.forEach((btn, i) => {
            btn.addEventListener('click', () => buttons[i].onClick([...visibleSet], btn));
        });
    }

    // --- Settings toggles ---
    if (settingsBtns) {
        function applySticky(on) { toolbar.classList.toggle('atv-sticky', on); }

        settingsBtns.rowNums.checked = rowNumbers;
        settingsBtns.borders.checked = bordered;
        settingsBtns.sticky.checked  = stickyHeaders;
        const BADGE_CYCLE  = { left: 'right', right: 'none', none: 'left' };
        const BADGE_LABELS = { left: 'Count on Left', right: 'Count on Right', none: 'Count None' };
        let badgeState = BADGE_LABELS[badgePosition] ? badgePosition : 'left';
        const setBadgeState = pos => {
            badgeState = pos;
            settingsBtns.badgeRight.textContent = BADGE_LABELS[pos];
            settingsBtns.badgeRight.setAttribute('aria-pressed', String(pos !== 'none'));
        };
        setBadgeState(badgeState);
        applySticky(stickyHeaders);
        if (!showFilterRow) rest.style.display = 'none';

        settingsBtns.rowNums.addEventListener('change', () => {
            table.classList.toggle('atv-hide-rownums', !settingsBtns.rowNums.checked);
        });
        settingsBtns.borders.addEventListener('change', () => {
            table.classList.toggle('atv-bordered', settingsBtns.borders.checked);
        });
        settingsBtns.sticky.addEventListener('change', () => applySticky(settingsBtns.sticky.checked));
        settingsBtns.badgeRight.addEventListener('click', () => {
            const next = BADGE_CYCLE[badgeState];
            setBadgeState(next);
            applyBadgePosition(next);
        });
    }

    // --- Dropdown management ---
    filterDefs.forEach(def => {
        const th     = document.getElementById(def.thId);
        const dd     = document.getElementById(def.id);
        const search = dd.querySelector('.filter-search');

        attachPopover([th, th.querySelector('.atv-filter-btn')], dd, th, { hover: true });
        dd.addEventListener('beforetoggle', e => {
            if (e.newState !== 'open') return;
            search.value = '';
            filterOptionRows(filterUI[def.key].rows, filterUI[def.key].values, '');
        });
        // Focus only once the pointer commits to the dropdown — focusing on
        // open would steal focus while sweeping across hover-opened headers
        dd.addEventListener('mouseenter', () => search.focus());

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
        const th    = document.getElementById(def.thId);
        const dd    = document.getElementById(def.id);
        const input = dd.querySelector('.filter-search');

        attachPopover([th, th.querySelector('.atv-filter-btn')], dd, th, { hover: true });
        dd.addEventListener('mouseenter', () => input.focus());

        input.addEventListener('input', () => {
            textFilterState[def.key] = input.value;
            refresh();
        });
    });

    rangeDefs.forEach(def => {
        const th     = document.getElementById(def.thId);
        const dd     = document.getElementById(def.id);
        const minInp = dd.querySelector('.filter-range-min');
        const maxInp = dd.querySelector('.filter-range-max');

        attachPopover([th, th.querySelector('.atv-filter-btn')], dd, th, { hover: true });
        dd.addEventListener('mouseenter', () => minInp.focus());

        // Show the column's actual span as placeholders so the bounds are
        // obvious, and widen both inputs to fit the longer number (digits in
        // ch + room for padding and the number spinner).
        const nums = data.map(d => Number(d[def.key])).filter(n => !Number.isNaN(n));
        if (nums.length) {
            minInp.placeholder = String(Math.min(...nums));
            maxInp.placeholder = String(Math.max(...nums));
            const chars = Math.max(minInp.placeholder.length, maxInp.placeholder.length, 2);
            minInp.style.width = maxInp.style.width = `calc(${chars}ch + 2.5em)`;
        }

        // Single point where range state is set — every numeric control (the
        // inputs now, presets/slider later) funnels through here.
        const setRange = patch => { Object.assign(rangeState[def.key], patch); refresh(); };
        const parse = v => v.trim() === '' ? null : Number(v);
        minInp.addEventListener('input', () => setRange({ min: parse(minInp.value) }));
        maxInp.addEventListener('input', () => setRange({ max: parse(maxInp.value) }));
    });

    // --- Sorting ---
    function sortByCol(colIndex) {
        const col = columns[colIndex];
        if (!col) return;

        sortState.dir = sortState.key === col.key ? sortState.dir * -1 : 1;
        sortState.key = col.key;

        const dirClass = sortState.dir === 1 ? 'asc' : 'desc';
        table.querySelectorAll('th.sortable').forEach(th => th.classList.remove('asc', 'desc'));
        table.querySelector(`th[data-col="${colIndex}"]`)?.classList.add(dirClass);
        [...filterDefs, ...textDefs, ...rangeDefs].forEach(def => {
            if (def.col === colIndex)
                document.getElementById(def.thId).classList.add(dirClass);
        });

        sortedData = sortItems(data, col.key, sortState.dir, col.numeric);
        sortedData.forEach(item => tbody.appendChild(rowMap.get(item)));
        refresh();
    }

    table.querySelectorAll('th.sortable').forEach(th => {
        th.addEventListener('click', () => sortByCol(parseInt(th.getAttribute('data-col'))));
    });

    [...filterDefs, ...textDefs, ...rangeDefs].forEach(def => {
        const th = document.getElementById(def.thId);
        th.classList.add('sortable');
        th.addEventListener('click', e => { if (e.target === th) sortByCol(def.col); });
    });

    refresh();

    }
}

function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
