import { fetchData, inferColumns, getVisible, computeCounts, sortItems, isUrlData, titleFromUrl, parseCsv, parseTsv, cellDisplay, getValue, discoverPaths, filterFor, unreadableReason, CATEGORY_MAX, sourceText, rememberSource, isDateFormat, toTimestamp, toDateInput, fromDateInput } from './model.js';
import {
    buildToolbar, buildNoResults, buildLoadError,
    buildHeader, buildRows, buildFilterOptions,
    syncCheckboxes, setRowVisibility,
    updateFilterCounts, filterOptionRows, downloadCsv, downloadJson, toCsv,
    attachPopover, ensureStyles, lockColumnWidths,
    buildColumnsMenu, buildColumnOptions, focusColumn, buildSourceView, addToolbarButton
} from './view.js';
import { initTree, isTreeData } from './tree.js';

let _tableCount = 0;

// The ancestor a too-wide table scrolls sideways within, or null when that is the
// page itself — which is the normal case, since freezing the header drops
// .table-wrap's own overflow so the page does the scrolling.
function sidewaysScroller(el) {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (/auto|scroll/.test(getComputedStyle(p).overflowX)) return p;
    }
    return null;
}

// The two custom properties a frozen table publishes on its container, and the only
// channel between the measuring the controller does and the layout the stylesheet
// owns: how far the page insets the container (which becomes the trailing space a
// too-wide table would otherwise run out of), and the toolbar's measured height,
// which the header row pins under. Everything else about the frozen layout is CSS —
// keep it that way; a new number goes in here, not into an element's style.
const TOOLBAR_VARS = ['--aj-port-inset', '--aj-toolbar-h'];

// How far the page insets the container: the gap on its left, which a table wide
// enough to scroll past the host's content box needs repeating on its right. Read
// against whatever scrolls the table sideways, and scroll-invariant — the same number
// wherever the page happens to be scrolled to when this runs. A nested table scrolls
// inside its parent's cell rather than the page and sits flush in it, so it has none.
function pageInset(container, nested) {
    if (nested) return 0;
    const scroller = sidewaysScroller(container);
    const left = scroller ? scroller.getBoundingClientRect().left + scroller.clientLeft : 0;
    const scrolled = scroller ? scroller.scrollLeft : window.scrollX;
    return container.getBoundingClientRect().left - left + scrolled;
}

/** @typedef {import('./model.js').Column} Column */
/** @typedef {import('./model.js').Format} Format */
/** @typedef {import('./tree.js').Level} Level */

/**
 * Every option initTable accepts. The prose behind each one — what the data can
 * overrule, how the frozen layout is measured, why a date format decides a filter —
 * is in CLAUDE.md; this is the shape, so an editor can offer it.
 *
 * @typedef {object} TableConfig
 * @property {any[] | object | string[]} data       Rows, a root wrapper object, or [url, fallbackUrl?] to fetch.
 * @property {string} [tableId]                     Id of the <table>; auto-generated when absent.
 * @property {HTMLTableElement} [table]             The element itself, instead of tableId.
 * @property {Column[]} [columns]                   Inferred from the data when absent.
 * @property {string[]} [searchKeys]                Fields the global search covers.
 * @property {string | false} [exportFilename]      false hides the File menu.
 * @property {{ label: string, onClick: (visibleItems: any[], el: HTMLElement) => void, menu?: 'file' | 'settings' }[]} [buttons]
 * @property {boolean} [nested]                     Child tables: no toolbar or wrapper of their own.
 * @property {string} [title]                       Derived from the root key or the URL filename when absent.
 * @property {string} [dataKey]                     Which array on a root wrapper object to table.
 * @property {Level[] | false} [levels]             Tree overrides per depth; false forces a flat table.
 * @property {boolean} [collapsed]                  Start as a disclosure line; the table builds on first expand.
 * @property {boolean} [showToolbar]
 * @property {HTMLInputElement} [searchInputEl]     External search box, for nested tables.
 * @property {boolean} [striped]
 * @property {boolean} [bordered]
 * @property {boolean} [rowNumbers]
 * @property {boolean} [stickyHeaders]
 * @property {boolean} [showToolbarControls] false leaves only the disclosure handle and title.
 * @property {boolean} [showButtons]                false leaves the toolbar menus permanently out.
 * @property {Record<string, Format>} [formats]     Display formats by column key (a path).
 * @property {'upper'} [labelStyle]                 The table's one labelling rule.
 * @property {boolean} [lockWidths]                 Freeze widths measured over the full data set.
 * @property {'summary' | 'lines' | 'table'} [objectCell]
 * @property {'left' | 'right'} [objectAlign]
 * @property {boolean} [badgeAlwaysShow]
 * @property {'left' | 'right' | 'none'} [badgePosition]
 * @property {boolean | number} [searchDebounce]    true is 150ms; false is none.
 *
 * Threaded through a rebuild rather than passed by a host: the column order the table
 * first stood in, and the definitions of every column it has shown, so a column ticked
 * off and back on returns to its slot as the column it was.
 * @property {string[]} [columnOrder]
 * @property {Map<string, Column>} [columnDefs]
 */

/**
 * Builds a table — flat or tree — into the configured <table> element.
 * @param {TableConfig} config
 */
export async function initTable(config) {
    ensureStyles();
    // Whatever arrived; rows by the time anything below the fetch reads it.
    /** @type {any} */
    let data = config.data;
    if (isUrlData(data)) {
        // A failed load is the page's problem, not an unhandled rejection: the reason
        // (a 404, a PDF where a CSV was meant) takes the table's place and is logged.
        try {
            data = await fetchData(data[0], data[1]);
        } catch (err) {
            console.warn(`amazejs: ${err.message}`);
            const anchor = config.table || document.getElementById(config.tableId ?? '');
            return anchor ? buildLoadError(anchor, err.message) : null;
        }
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
        showToolbarControls = true,
        showButtons    = true,
        labelStyle,
        formats,
        lockWidths     = true,
        objectCell     = 'summary',
        objectAlign    = 'left',
        collapsed      = false
    } = config;

    const title = config.title ||
        (isUrlData(config.data) ? titleFromUrl(config.data[0]) : '');

    const effectiveExportFilename = exportFilename === false ? null
        : (typeof exportFilename === 'string' ? exportFilename
        : title ? `${title.toLowerCase().replace(/\s+/g, '-')}.csv` : 'data.csv');

    const tableId = config.tableId || `atv_t${++_tableCount}`;
    const table   = config.table
        || /** @type {HTMLTableElement} */ (document.getElementById(tableId));

    if (striped)  table.classList.add('atv-striped');
    if (bordered) table.classList.add('atv-bordered');

    const thead = document.createElement('thead');
    const tbody = document.createElement('tbody');
    table.append(thead, tbody);

    let countBadge, fileBtns, extraBtns, toolbar, rest, settingsBtns, settingsDd, moreBtn, toggleBtn, titleWrap, btnHost, sourceBtn, noResults, tableWrap;

    // Every table gets a container holding toolbar + table: it is the disclosure
    // target the toolbar collapses. Non-nested tables also get a scroll wrapper
    // and a no-results message.
    const tableContainer = document.createElement('div');
    tableContainer.className = 'atv-table-container';

    if (!nested) {
        tableWrap = document.createElement('div');
        tableWrap.className = 'table-wrap';
        table.before(tableWrap);
        tableWrap.appendChild(table);

        tableWrap.before(tableContainer);
        tableContainer.appendChild(tableWrap);

        noResults = buildNoResults(tableWrap);
    } else {
        table.before(tableContainer);
        tableContainer.appendChild(table);
    }

    // Toolbar for all tables unless suppressed; nested uses table as anchor (no
    // tableWrap). File/Settings always sit behind the `⋯` overflow.
    if (config.showToolbar ?? true) {
        ({ countBadge, fileBtns, extraBtns, toolbar, rest, settingsBtns, settingsDd, moreBtn, toggleBtn, titleWrap, btnHost, sourceBtn } =
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
        // On the right it hangs off the toolbar itself rather than the pinned box of
        // controls: the toolbar is the element that spans the whole scrollable width,
        // so that is the only box a sticky badge has room to stay on screen within.
        if (pos === 'right') toolbar.appendChild(countBadge);
        else rest.prepend(countBadge);
    }
    applyBadgePosition(badgePosition);

    // Show Toolbar Buttons: the menus sit out permanently and the ⋯ disappears. On
    // the container, so nested tables inside it follow — and applied here, before
    // buildTableUI, so a collapsed table is already in the right mode when it opens.
    function applyShowButtons(on) {
        tableContainer.classList.toggle('atv-show-more', on);
        tableContainer.classList.toggle('atv-hide-more', !on);
    }
    // Buttons out by default; false is the old ⋯-only toolbar. Only a table told
    // something is stamped — one left at the default inherits the container above it,
    // which is how a tree's child tables follow the root.
    if (config.showButtons !== undefined || showButtons) applyShowButtons(showButtons);

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
    const columns = inferColumns(data, config.columns, labelStyle, formats);
    // Formats by key for the filter/search layers, which work from keys not columns.
    const colFormats = Object.fromEntries(columns.filter(c => c.format).map(c => [c.key, c.format]));

    // --- View: build table content ---
    // The data decides each column's filter (filterFor): none when its values never
    // differ — one row makes that true of every column — and checkboxes when they
    // are few enough to list. Copies, so the column objects a rebuild reuses keep
    // what they were configured with.
    const headerColumns = columns.map(c => {
        const filter = filterFor(data, c);
        return filter === c.filter ? c : { ...c, filter };
    });
    const { filterDefs, textDefs, rangeDefs } = buildHeader(thead, headerColumns, tableId);
    // The header's own elements, resolved once. refresh() marks every filtering column
    // on each keystroke and updateFilterCounts writes each dropdown's badge, so an id
    // lookup per column per pass is a lookup per column too many. (badgeEl is null on
    // the text and range dropdowns, which have no footer badge.)
    [...filterDefs, ...textDefs, ...rangeDefs].forEach(def => {
        def.th = document.getElementById(def.thId);
        def.dd = document.getElementById(def.id);
        def.badgeEl = def.dd.querySelector('.filter-actions-badge');
    });
    const rowMap = buildRows(tbody, data, columns, objectCell, objectAlign);
    if (!rowNumbers) table.classList.add('atv-hide-rownums');

    // --- State ---
    // The source panel, built on the first press of the raw toggle, refilled by refresh().
    /** @type {?HTMLPreElement} */
    let sourcePre = null;
    let renderSource = () => {};
    const filterState     = {};
    const optionQuery     = {};
    const textFilterState = {};
    const rangeState      = {};
    const filterUI        = {};
    let sortedData = [...data];
    let visibleSet = new Set(data);
    const sortState = { key: null, dir: 1 };

    filterDefs.forEach(def => {
        // Blank values are a real option: missing/empty cells get their own row so
        // they stay selectable instead of being silently filtered out. A numeric
        // column promoted to checkboxes orders by the raw value it kept beside each
        // display text — text order would put 10 before 2, and the separators the
        // display carries make its own text unparseable. A date-formatted column
        // orders chronologically for the same reason: 'relative' and a function
        // format have no order in their text at all.
        const col = columns[def.col];
        const raw = new Map();
        data.forEach(d => {
            const text = cellDisplay(d, col);
            if (!raw.has(text)) raw.set(text, getValue(d, col.key));
        });
        const byValue = isDateFormat(col.format)
                // A value that isn't a date has no instant to rank by, and sorts first.
                ? (a, b) => (toTimestamp(raw.get(a)) ?? 0) - (toTimestamp(raw.get(b)) ?? 0)
            : col.numeric
                ? (a, b) => Number(raw.get(a)) - Number(raw.get(b))
            : undefined;
        const values = [...raw.keys()].sort(byValue);
        filterState[def.key] = new Set(values);
        optionQuery[def.key] = '';

        const { rows, checkboxes } = buildFilterOptions(
            def.dd, values,
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
    // `date` travels with the state: matchesNonCategory reads the value as an instant
    // rather than a number when it is set.
    rangeDefs.forEach(def => { rangeState[def.key] = { min: null, max: null, date: !!def.date }; });

    // Each category selection narrowed by its dropdown's option search, so typing
    // there filters the table too, not just the list of options.
    function narrowedFilterState() {
        const state = {};
        Object.entries(filterState).forEach(([key, selected]) => {
            const q = optionQuery[key].toLowerCase();
            state[key] = q ? new Set([...selected].filter(v => v.toLowerCase().includes(q))) : selected;
        });
        return state;
    }

    // --- Refresh: apply filters, update all UI ---
    function refresh() {
        const query = effectiveSearchInput ? effectiveSearchInput.value : '';
        const activeState = narrowedFilterState();
        visibleSet  = new Set(getVisible(sortedData, activeState, textFilterState, rangeState, query, searchKeys, colFormats));

        setRowVisibility(sortedData, visibleSet, rowMap);
        if (tableContainer.classList.contains('atv-source')) renderSource();
        if (countBadge) countBadge.textContent = `${visibleSet.size} / ${data.length}`;
        if (noResults)  noResults.classList.toggle('show', visibleSet.size === 0);

        const counts = computeCounts(data, activeState, textFilterState, rangeState, query, searchKeys, colFormats);
        filterDefs.forEach(def => {
            const ui = filterUI[def.key];
            updateFilterCounts(def, ui.values, counts[def.key] || {}, activeState[def.key], ui.rows, badgeAlwaysShow);
        });
        textDefs.forEach(def => {
            def.th.classList.toggle('active', !!textFilterState[def.key]);
        });
        rangeDefs.forEach(def => {
            const { min, max } = rangeState[def.key];
            def.th.classList.toggle('active', min != null || max != null);
        });
    }

    if (effectiveSearchInput) {
        const onSearch = searchDebounce === false ? refresh
            : debounce(refresh, typeof searchDebounce === 'number' ? searchDebounce : 150);
        effectiveSearchInput.addEventListener('input', onSearch);
    }

    // The two go together — the menu is built only when there is a filename to export to.
    if (fileBtns && effectiveExportFilename) {
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

    // The raw-source toggle swaps the table for a text dump of what the table is
    // showing — the rows the filters left, in the shape the data arrived in (CSV when
    // the import was delimited, JSON otherwise). It tracks the filters while open, so
    // it reads as the same view the table does, not the untouched file.
    if (sourceBtn) {
        const raw = sourceText.get(data);
        const importedAsJson = !raw || /^\s*[[{]/.test(raw);
        sourceBtn.addEventListener('click', () => {
            const showing = tableContainer.classList.toggle('atv-source');
            if (showing && !sourcePre) sourcePre = buildSourceView(tableWrap || tableContainer);
            if (showing) renderSource();
            sourceBtn.setAttribute('aria-pressed', String(showing));
            sourceBtn.setAttribute('aria-label', showing ? 'View table' : 'View source');
        });
        renderSource = () => {
            if (!sourcePre) return;
            sourcePre.textContent = importedAsJson
                ? JSON.stringify([...visibleSet], null, 2)
                : toCsv(columns, [...visibleSet]);
        };
    }

    // File > Open: tears down everything this init built (toolbar and dropdowns
    // are nested in the container DOM, so removing it removes them too) and
    // re-inits in place with columns re-inferred from the opened data.
    async function rebuild(newData, newTitle) {
        const fresh = document.createElement('table');
        fresh.id = tableId;
        // A root object holding several arrays became one container per group inside a
        // tree host, each with a File menu of its own. Opening a file from any of them
        // replaces the whole tree — otherwise the groups whose menu was not used stay
        // on screen beside the newly opened data. (rebuildColumns below stays with its
        // own container: re-picking columns is that one group's business.)
        const outgoing = tableContainer.parentElement?.classList.contains('aj-tree-host')
            ? tableContainer.parentElement
            : tableContainer;
        outgoing.replaceWith(fresh);
        return initTable({
            ...config,
            data: newData, title: newTitle,
            // New data, new shape: the old column order and definitions mean nothing to it.
            columns: undefined, dataKey: undefined, columnOrder: undefined, columnDefs: undefined,
            collapsed: false,
            table: fresh,
        });
    }

    // Same in-place re-init as File > Open, but with an explicit column list over
    // the data already resolved. Existing column objects are reused as they are, so
    // a tree's first column keeps its render — and therefore its row toggles.
    async function rebuildColumns(newColumns, columnOrder, columnDefs) {
        const fresh = document.createElement('table');
        fresh.id = tableId;
        tableContainer.replaceWith(fresh);
        return initTable({ ...config, data, columns: newColumns, columnOrder, columnDefs, title, collapsed: false, table: fresh });
    }

    // --- Columns picker: every leaf path found in the data, ticked for the columns
    // on screen. Ticking one adds it as an ordinary column — deep fields work
    // because a column key may be a path — and rebuilds the table. Paths with few
    // distinct values get a checkbox filter, so a boolean lands as true/false
    // checkboxes rather than a text box. ---
    // Every table with a toolbar gets one, nested child tables included: a group's
    // table has its own data to pick columns from, and rebuildColumns replaces the
    // container in place wherever it sits, a children cell as readily as the page.
    if (btnHost) {
        const found = discoverPaths(data);
        const distinct = new Map(found.map(d => [d.path, d.distinct]));
        const shown = columns.map(c => c.key);
        // Current columns first (a tree's name column is never a discovered leaf).
        const paths = [...shown.filter(k => !distinct.has(k)), ...found.map(d => d.path)];

        // The order columns belong in: the table as it stands, then everything else in
        // discovery order. Carried across rebuilds (columnOrder), so a column ticked off
        // and back on returns to the slot it held rather than to the data's idea of it —
        // a configured table's order is the host's, and untouched by the picker.
        const baseOrder = config.columnOrder
            ?? [...shown, ...paths.filter(p => !shown.includes(p))];
        // The dropdown lists in that same order — the columns as the table shows them,
        // then the rest — so the picker reads as the table it is picking for. Anything
        // discovered since the order was fixed goes on the end rather than being lost.
        const listOrder = [...baseOrder, ...paths.filter(p => !baseOrder.includes(p))];

        // A newly ticked column lands before the first column that ranks after it, and
        // only that one column moves — the rest keep the order they are in.
        const order = new Map(baseOrder.map((p, i) => [p, i]));
        const rankOf = key => order.get(key) ?? Infinity;
        const insert = (cols, col) => {
            const at = cols.findIndex(c => rankOf(c.key) > rankOf(col.key));
            const next = [...cols];
            next.splice(at === -1 ? next.length : at, 0, col);
            return next;
        };

        // Every column object the table has held, by key, carried across rebuilds: a
        // column ticked off and back on comes back as the column it was — its label,
        // its render (brewbar's linkCell), its format — not a bare key. Only a key the
        // table has never shown gets a fresh definition, and that one carries no label:
        // inferColumns derives it on the rebuild, in the table's own style.
        const columnDefs = config.columnDefs ?? new Map();
        columns.forEach(c => columnDefs.set(c.key, c));
        const colFor = path => columnDefs.get(path)
            ?? (distinct.get(path) <= CATEGORY_MAX ? { key: path, filter: 'category' } : { key: path });

        const menu = buildColumnsMenu(btnHost, `${tableId}_columns`);
        const rows = buildColumnOptions(menu.dd, listOrder, new Set(shown), (path, checked) => {
            const next = checked
                ? insert(columns, colFor(path))
                : columns.filter(c => c.key !== path);
            if (!next.length) return;
            rebuildColumns(next, baseOrder, columnDefs).then(fresh => {
                if (checked) focusColumn(fresh, next.findIndex(c => c.key === path));
            });
        }, path => {
            // Only means only: one column, nothing kept alongside it — not even a tree's
            // first column, whose row toggles go with it until it is ticked back on.
            rebuildColumns([colFor(path)], baseOrder, columnDefs);
        });

        // The badge counts ticked against listed, the same shape a filter's does.
        const listed = () => listOrder.filter(p => rows[p].style.display !== 'none');
        function syncColumnsBadge() {
            const on = listed().filter(p => shown.includes(p)).length;
            menu.badge.textContent = '';
            const badge = document.createElement('span');
            badge.className = 'filter-badge';
            badge.textContent = `${on}/${listed().length}`;
            menu.badge.appendChild(badge);
        }
        syncColumnsBadge();

        menu.search.addEventListener('input', /** @this {HTMLInputElement} */ function() {
            filterOptionRows(rows, listOrder, this.value);
            syncColumnsBadge();
        });

        // Show All / Clear All act on what the search has left listed, so they mean
        // "these columns", never "every path in the data". Clear All keeps the first
        // column: a table with no columns has nothing to tick them back on with.
        menu.selAll.addEventListener('click', e => {
            e.preventDefault();
            const add = listed().filter(p => !shown.includes(p)).map(colFor);
            if (add.length) rebuildColumns(add.reduce(insert, columns), baseOrder, columnDefs);
        });

        menu.clrAll.addEventListener('click', e => {
            e.preventDefault();
            const drop = new Set(listed());
            const next = columns.filter(c => !drop.has(c.key));
            rebuildColumns(next.length ? next : [columns[0]], baseOrder, columnDefs);
        });
    }

    function openFileDialog() {
        const input  = document.createElement('input');
        input.type   = 'file';
        input.accept = '.csv,.tsv,.json,text/csv,text/tab-separated-values,application/json';
        input.addEventListener('change', async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                // accept= is a filter, not a guarantee — the dialog's All Files escape
                // hatch and a renamed file both get here. Refuse what isn't text before
                // parsing it: JSON throws on its own, but any byte is a valid CSV field,
                // so a PNG would otherwise become a table of mojibake.
                const reason = unreadableReason(file.name, file.type, text);
                if (reason) throw new Error(reason);
                const name = file.name.toLowerCase();
                const data = name.endsWith('.json') ? JSON.parse(text)
                    : name.endsWith('.tsv') ? parseTsv(text)
                    : parseCsv(text);
                await rebuild(rememberSource(data, text), titleFromUrl(file.name));
            } catch (err) {
                alert(`Could not open ${file.name}: ${err.message}`);
            }
        });
        input.click();
    }

    // Extra buttons: the menu-placed ones already exist inside File or Settings; the
    // rest become toolbar buttons here, after the Columns menu, so they always follow
    // every menu. A menu item closes its dropdown before the handler runs, as the
    // menu's own items do.
    if (extraBtns) {
        extraBtns.forEach((btn, i) => {
            const cfg = buttons[i];
            const el = btn || (extraBtns[i] = addToolbarButton(btnHost, cfg.label));
            const dd = cfg.menu === 'file' ? fileBtns?.dd : cfg.menu === 'settings' ? settingsDd : null;
            el.addEventListener('click', () => {
                dd?.hidePopover();
                cfg.onClick([...visibleSet], el);
            });
        });
    }

    // --- Settings toggles ---
    if (settingsBtns) {
        // Freezing the toolbar freezes the header row with it, and both need numbers
        // only layout can give: how tall the toolbar's own contents make it, and the
        // box it has to fill. The controller measures and publishes; every rule that
        // consumes them lives in the stylesheet (.atv-toolbar.atv-sticky, and the
        // header row's top offset).
        const host = tableContainer.parentElement;
        function syncToolbarBox() {
            const style = tableContainer.style;
            if (!tableContainer.classList.contains('atv-sticky-head')) {
                TOOLBAR_VARS.forEach(v => style.removeProperty(v));
                return;
            }
            style.setProperty('--aj-port-inset', `${pageInset(tableContainer, nested)}px`);
            style.setProperty('--aj-toolbar-h', `${toolbar.offsetHeight}px`);
        }
        function applySticky(on) {
            toolbar.classList.toggle('atv-sticky', on);
            tableContainer.classList.toggle('atv-sticky-head', on);
            syncToolbarBox();
        }
        // The toolbar sets the header's offset, and its height changes when its
        // buttons wrap, so re-measure whenever it — or the space it is fitted to —
        // resizes.
        const resize = new ResizeObserver(syncToolbarBox);
        resize.observe(toolbar);
        if (host) resize.observe(host);

        // Ticked when this table shows its buttons, inherited from an ancestor included.
        settingsBtns.showMore.checked = showButtons || !!tableContainer.closest('.atv-show-more');
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
        if (!showToolbarControls) rest.style.display = 'none';

        settingsBtns.showMore.addEventListener('change', () => {
            applyShowButtons(settingsBtns.showMore.checked);
        });
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
        const { th, dd } = def;
        const search = dd.querySelector('.filter-search');

        attachPopover([th, th.querySelector('.atv-filter-btn')], dd, th, { hover: true });
        dd.addEventListener('beforetoggle', e => {
            if (e.newState !== 'open' || !search.value) return;
            search.value = '';
            optionQuery[def.key] = '';
            refresh();
            filterOptionRows(filterUI[def.key].rows, filterUI[def.key].values, '');
        });
        // Focus only once the pointer commits to the dropdown — focusing on
        // open would steal focus while sweeping across hover-opened headers
        dd.addEventListener('mouseenter', () => search.focus());

        // refresh() first: it rewrites option counts (and their row display), so the
        // option-row filtering has to run after it to survive.
        search.addEventListener('input', /** @this {HTMLInputElement} */ function() {
            optionQuery[def.key] = this.value;
            refresh();
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
        const { th, dd } = def;
        const input = dd.querySelector('.filter-search');

        attachPopover([th, th.querySelector('.atv-filter-btn')], dd, th, { hover: true });
        dd.addEventListener('mouseenter', () => input.focus());

        input.addEventListener('input', () => {
            textFilterState[def.key] = input.value;
            refresh();
        });
    });

    rangeDefs.forEach(def => {
        const { th, dd } = def;
        const minInp = dd.querySelector('.filter-range-min');
        const maxInp = dd.querySelector('.filter-range-max');

        attachPopover([th, th.querySelector('.atv-filter-btn')], dd, th, { hover: true });
        dd.addEventListener('mouseenter', () => minInp.focus());

        // The column's actual span bounds the controls: on a date column it is the
        // pickers' own min/max, so the calendar opens on the data's years and refuses
        // days the column doesn't reach; on a numeric one it shows as the placeholders,
        // with both inputs widened to fit the longer number (digits in ch + room for
        // padding and the number spinner).
        if (def.date) {
            const stamps = data.map(d => toTimestamp(getValue(d, def.key))).filter(t => t != null);
            if (stamps.length) {
                // reduce, not Math.min(...stamps): a spread of a column's every value
                // is an argument list, and a long enough one overflows the stack.
                const lo = toDateInput(stamps.reduce((a, b) => Math.min(a, b)));
                const hi = toDateInput(stamps.reduce((a, b) => Math.max(a, b)));
                minInp.min = maxInp.min = lo;
                minInp.max = maxInp.max = hi;
                // Both boxes start filled with the span they bound — a date picker has
                // no placeholder to say it with, and the pair reads as the range the
                // column covers, ready to be narrowed from either end.
                minInp.value = lo;
                maxInp.value = hi;
            }
        } else {
            const nums = data.map(d => Number(getValue(d, def.key))).filter(n => !Number.isNaN(n));
            if (nums.length) {
                minInp.placeholder = String(nums.reduce((a, b) => Math.min(a, b)));
                maxInp.placeholder = String(nums.reduce((a, b) => Math.max(a, b)));
                const chars = Math.max(minInp.placeholder.length, maxInp.placeholder.length, 2);
                minInp.style.width = maxInp.style.width = `calc(${chars}ch + 2.5em)`;
            }
        }

        const setRange = patch => { Object.assign(rangeState[def.key], patch); refresh(); };
        // A date box yields the day's first or last millisecond, so From and To on the
        // same day keep that day; a number box yields the number itself.
        const parse = (v, edge) => def.date ? fromDateInput(v, edge)
            : (v.trim() === '' ? null : Number(v));
        // min/max on a date input only steer the calendar — a typed year outside the
        // column's span is still accepted — so the value is held to the span here.
        // ISO 'YYYY-MM-DD' compares as text in date order, so these are plain compares.
        const clamp = inp => !def.date || !inp.value || !inp.min ? inp.value
            : inp.value < inp.min ? inp.min
            : inp.value > inp.max ? inp.max
            : inp.value;

        minInp.addEventListener('input', () => setRange({ min: parse(clamp(minInp), 'min') }));
        maxInp.addEventListener('input', () => setRange({ max: parse(clamp(maxInp), 'max') }));

        // The box itself is corrected once the edit is committed (change, not input),
        // so a year being typed digit by digit isn't rewritten mid-keystroke.
        [minInp, maxInp].forEach(inp => inp.addEventListener('change', () => {
            const fixed = clamp(inp);
            if (fixed !== inp.value) inp.value = fixed;
        }));
    });

    // --- Sorting ---
    const colDirs = {};

    function sortByCol(colIndex) {
        const col = columns[colIndex];
        if (!col) return;

        // Each column keeps the direction it was last sorted in: clicking the sorted
        // column flips it, clicking another resumes where that column left off. Only
        // .sorted moves, so switching columns never rewrites anyone else's chevron.
        const last = colDirs[colIndex] || 1;
        sortState.dir = sortState.key === col.key ? last * -1 : last;
        sortState.key = col.key;
        colDirs[colIndex] = sortState.dir;

        // aria-sort marks the one column the table is ordered by, so the direction
        // the ::after chevron shows is in the accessibility tree too; the headers
        // that merely remember a direction carry no state.
        const th = table.querySelector(`th[data-col="${colIndex}"]`);
        table.querySelectorAll('th.sorted').forEach(el => {
            el.classList.remove('sorted');
            el.removeAttribute('aria-sort');
        });
        th?.classList.remove('asc', 'desc');
        th?.classList.add(sortState.dir === 1 ? 'asc' : 'desc', 'sorted');
        th?.setAttribute('aria-sort', sortState.dir === 1 ? 'ascending' : 'descending');

        sortedData = sortItems(data, col.key, sortState.dir, col.numeric);
        sortedData.forEach(item => tbody.appendChild(rowMap.get(item)));
        refresh();
    }

    /** @type {NodeListOf<HTMLElement>} */ (table.querySelectorAll('th.sortable')).forEach(th => {
        th.addEventListener('click', () => sortByCol(Number(th.dataset.col)));
    });

    [...filterDefs, ...textDefs, ...rangeDefs].forEach(({ th, col }) => {
        th.classList.add('sortable');
        th.addEventListener('click', e => { if (e.target === th) sortByCol(col); });
    });

    // Measured last, with every row visible and every header finished: filterable
    // ths only just became .sortable, and a width locked before their ::after arrow
    // exists is a width the arrow then overflows into the next column.
    if (lockWidths) lockColumnWidths(table);

    refresh();

    }
}

function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
