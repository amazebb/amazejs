// DOM rendering functions — no business logic or mutable state.
import { cellText, cellValue, cellDisplay, applyFormat, getValue, isPlainObject } from './model.js';

// Stylesheet injection, lazy and once, on the first initTable() (ensureStyles).
// Raw/dev use loads the sibling amazejs.css via <link> (import.meta.url); the
// bundled release calls setStyles() at import time with the inlined stylesheet,
// which is injected as a <style> instead.
let _inlinedCss = null;
let _stylesDone = false;
export function setStyles(css) { _inlinedCss = css; }
export function ensureStyles() {
    if (_stylesDone) return;
    _stylesDone = true;
    if (_inlinedCss != null) {
        const style = document.createElement('style');
        style.textContent = _inlinedCss;
        document.head.appendChild(style);
    } else {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = new URL('./amazejs.css', import.meta.url).href;
        document.head.appendChild(link);
    }
}

// Positions an open dd below anchor, clamped to the viewport edges.
function positionBelow(dd, anchor) {
    const rect = anchor.getBoundingClientRect();
    dd.style.top = `${rect.bottom + 4}px`;
    dd.style.left = `${rect.left}px`;
    const r = dd.getBoundingClientRect();
    if (r.right > window.innerWidth - 8) dd.style.left = `${Math.max(8, window.innerWidth - r.width - 8)}px`;
    if (r.left < 8) dd.style.left = '8px';
}

// Grace period before a hover-opened popover closes, long enough to cross the
// gap between the invoker button and the dropdown below it.
const HOVER_CLOSE_DELAY = 300;

// Wires button(s) to toggle dd via the native popovertarget invoker relationship,
// so the browser handles toggling, light dismiss, and aria-expanded. Positioning
// runs in a rAF from beforetoggle: the popover is measurable but not yet painted.
// With hover: true the dropdown also opens on pointer-over and closes after a
// grace delay once the pointer has left both the button and the dropdown.
export function attachPopover(btns, dd, anchor, { hover = false } = {}) {
    const invokers = [btns].flat();
    invokers.forEach(btn => {
        btn.popoverTargetElement = dd;
        btn.setAttribute('aria-expanded', 'false');
    });
    dd.addEventListener('beforetoggle', e => {
        const open = e.newState === 'open';
        invokers.forEach(btn => btn.setAttribute('aria-expanded', String(open)));
        if (open) requestAnimationFrame(() => positionBelow(dd, anchor));
    });

    // Only wire hover-open on devices that actually hover. On touch the first
    // tap synthesizes a mouseenter, which would otherwise open the dropdown
    // before the tap falls through to sort — there the explicit invoker button
    // (and native click toggling) is the only filter path.
    if (hover && window.matchMedia('(hover: hover)').matches) {
        let closeTimer = null;
        const cancelClose = () => clearTimeout(closeTimer);
        const close = () => {
            // Don't close mid-typing: the pointer may drift off while the
            // user is in a filter search field — light dismiss handles it.
            const typing = dd.contains(document.activeElement)
                && document.activeElement.matches('input[type="text"], input[type="number"]');
            if (dd.matches(':popover-open') && !typing) dd.hidePopover();
        };
        const scheduleClose = () => {
            cancelClose();
            closeTimer = setTimeout(close, HOVER_CLOSE_DELAY);
        };
        [...invokers, dd].forEach(el => {
            el.addEventListener('mouseenter', () => {
                cancelClose();
                if (el !== dd && !dd.matches(':popover-open')) dd.showPopover();
            });
            el.addEventListener('mouseleave', e => {
                const t = e.relatedTarget instanceof Element ? e.relatedTarget : null;
                // Still within the trigger or its dropdown (e.g. dropdown back
                // to its own th, which never refires mouseenter): not a leave.
                if (t && (dd.contains(t) || invokers.some(b => b.contains(t)))) return;
                // Leaving the dropdown itself, or moving onto another column
                // header, closes immediately — the grace delay only exists so
                // the pointer can cross the gap from a trigger down to its
                // dropdown. Drop the focus the dropdown grabbed on enter first,
                // else close()'s typing guard pins it open while the pointer is
                // already over the rows below.
                if (el === dd || t?.closest('thead th')) {
                    cancelClose();
                    if (dd.contains(document.activeElement)) document.activeElement.blur();
                    close();
                } else scheduleClose();
            });
        });
    }
}

// Renders an array-valued cell: first value inline + "+N" badge that opens a dropdown list.
export function renderArrayCell(td, values) {
    if (!values.length) return;
    if (values.length === 1) { td.textContent = String(values[0]); return; }

    td.appendChild(document.createTextNode(String(values[0])));

    const badge = document.createElement('button');
    badge.className = 'aj-array-badge';
    badge.textContent = `+${values.length - 1}`;
    td.appendChild(badge);

    const dd = document.createElement('div');
    dd.className = 'filter-dropdown';
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
    td.appendChild(dd);

    attachPopover(badge, dd, badge);
}

// Renders a plain-object cell (a nested record like { stable: '4.0.0', head: 'HEAD' };
// arrays of objects become child tables instead). Modes: 'summary' — first pair inline
// plus a +N badge opening a popover with every pair; 'lines' — one pair per line;
// 'table' — a bare key/value table. label titles the popover, align ('left' or
// 'right') sets the value column's text alignment.
export function renderObjectCell(td, obj, mode, label, align = 'left') {
    const pairs = Object.entries(obj).map(([k, v]) => [k, cellText(v)]);
    if (!pairs.length) return;

    if (mode === 'lines') {
        td.classList.add('aj-obj-lines');
        td.textContent = pairs.map(([k, v]) => `${k}: ${v}`).join('\n');
        return;
    }

    if (mode === 'table') {
        const inner = document.createElement('table');
        inner.className = `aj-obj-table aj-obj-${align}`;
        pairs.forEach(([k, v]) => {
            const tr = inner.insertRow();
            tr.insertCell().textContent = k;
            tr.insertCell().textContent = v;
        });
        td.appendChild(inner);
        return;
    }

    td.appendChild(document.createTextNode(`${pairs[0][0]}: ${pairs[0][1]}`));
    if (pairs.length === 1) return;

    const badge = document.createElement('button');
    badge.className = 'aj-array-badge';
    badge.textContent = `+${pairs.length - 1}`;
    td.appendChild(badge);

    const dd = document.createElement('div');
    dd.className = 'filter-dropdown aj-obj-dd';
    dd.popover = 'auto';

    const header = document.createElement('div');
    header.className = 'aj-array-header';
    header.textContent = label;
    dd.appendChild(header);

    // One grid, two content-sized columns: keys line up down the popover and the
    // values sit right beside them instead of being pushed to the far edge.
    const list = document.createElement('div');
    list.className = `aj-obj-pairs aj-obj-${align}`;
    pairs.forEach(([k, v]) => {
        const key = document.createElement('span');
        key.className = 'aj-obj-key';
        key.textContent = k;
        const val = document.createElement('span');
        val.className = 'aj-obj-val';
        val.textContent = v;
        list.append(key, val);
    });
    dd.appendChild(list);
    td.appendChild(dd);

    attachPopover(badge, dd, badge);
}

// Returns a render function that builds <a> (optionally wrapped in another element).
// textKey: data field for link text; hrefKey: data field for href; wrap: tag name e.g. 'code'
export function linkCell(textKey, hrefKey, { wrap } = {}) {
    return item => {
        const a = document.createElement('a');
        a.textContent = cellValue(item, textKey);
        a.href = getValue(item, hrefKey);
        if (wrap) {
            const el = document.createElement(wrap);
            el.appendChild(a);
            return el;
        }
        return a;
    };
}

// Builds and inserts a toolbar (disclosure toggle + title + count badge + optional
// File menu + extra buttons + settings) before the anchor.
// Returns { countBadge, fileBtns, extraBtns, toolbar, rest, settingsBtns, moreBtn,
// toggleBtn, titleWrap } for controller wiring. The toolbar doubles as the table's
// disclosure header: the controller toggles the table container via toggleBtn/titleWrap.
// fileBtns: { open, csv, json, dd } — the three menu items and the dropdown element.
// The toolbar is just two parts: the disclosure handle (toggle + title) and a
// single `rest` wrapper holding everything after the title (count badge, File/
// Settings menus, extra buttons). Collapsing the table — and showFilterRow:false
// — hide `rest` as one unit, leaving only the handle. The rest's buttons always
// sit behind a `⋯` overflow (moreBtn), revealed on hover/click via CSS — same
// for flat and nested tables.
export function buildToolbar(anchor, hasFileMenu, buttons = [], title = '') {
    const toolbar = document.createElement('div');
    toolbar.className = 'atv-toolbar';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'atv-title-wrap';
    toolbar.appendChild(titleWrap);

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'aj-toggle aj-rotate';
    toggleBtn.setAttribute('aria-expanded', 'true');
    toggleBtn.setAttribute('aria-label', 'Toggle table');
    titleWrap.appendChild(toggleBtn);

    if (title) {
        const titleEl = document.createElement('span');
        titleEl.className = 'atv-title';
        titleEl.textContent = title;
        titleWrap.appendChild(titleEl);
    }


    // Everything after the title collapses as one unit (see header comment).
    const rest = document.createElement('div');
    rest.className = 'atv-toolbar-rest';
    toolbar.appendChild(rest);

    const countBadge = document.createElement('span');
    countBadge.className = 'atv-count-badge';
    rest.appendChild(countBadge);

    // The ⋯ button sits OUTSIDE the hover wrap, so hovering/clicking it never
    // trips the hover-reveal — it's a plain click toggle (aria-expanded). The
    // wrap holds only the menu; hovering the wrap (the reserved space where the
    // hidden buttons sit) is what reveals them on mouse. moreBtn stays adjacent
    // a preceding sibling of moreWrap for the `~ .atv-more-wrap` reveal selector.
    const moreBtn = document.createElement('button');
    moreBtn.className = 'atv-more-btn';
    moreBtn.setAttribute('aria-expanded', 'false');
    moreBtn.setAttribute('aria-label', 'More options');
    rest.appendChild(moreBtn);

    // Raw-source toggle: the word TABLE at rest, RAW while the dump is showing, so it
    // names the view you are in. It sits between the ⋯ and the menu wrap, always out —
    // it is a view switch, not one of the menus the ⋯ hides.
    const sourceBtn = document.createElement('button');
    sourceBtn.className = 'atv-source-btn';
    sourceBtn.setAttribute('aria-pressed', 'false');
    sourceBtn.setAttribute('aria-label', 'View source');
    rest.appendChild(sourceBtn);

    const moreWrap = document.createElement('div');
    moreWrap.className = 'atv-more-wrap';
    rest.appendChild(moreWrap);

    const btnHost = document.createElement('div');
    btnHost.className = 'atv-toolbar-more';
    moreWrap.appendChild(btnHost);

    let fileBtns = null;
    if (hasFileMenu) {
        const fileBtn = document.createElement('button');
        fileBtn.className = 'atv-export-btn';
        fileBtn.textContent = 'File';
        btnHost.appendChild(fileBtn);

        const dd = document.createElement('div');
        dd.className = 'filter-dropdown atv-export-dd';
        dd.popover = 'auto';
        btnHost.appendChild(dd);

        const item = label => {
            const el = document.createElement('div');
            el.className = 'aj-array-item';
            el.textContent = label;
            dd.appendChild(el);
            return el;
        };
        const open = item('Open…');
        const csv = item('Export CSV');
        const json = item('Export JSON');

        attachPopover(fileBtn, dd, fileBtn, { hover: true });

        fileBtns = { open, csv, json, dd };
    }

    const settingsBtn = document.createElement('button');
    settingsBtn.className = 'atv-export-btn';
    settingsBtn.textContent = 'Settings';
    btnHost.appendChild(settingsBtn);

    const settingsDd = document.createElement('div');
    settingsDd.className = 'filter-dropdown';
    settingsDd.popover = 'auto';
    btnHost.appendChild(settingsDd);

    const settingsHdr = document.createElement('div');
    settingsHdr.className = 'aj-array-header';
    settingsHdr.textContent = 'Settings';
    settingsDd.appendChild(settingsHdr);

    const settingsOpts = document.createElement('div');
    settingsOpts.className = 'filter-options';
    settingsDd.appendChild(settingsOpts);

    const showMoreCb = makeSettingsRow(settingsOpts, 'Show Toolbar Buttons');
    const rowNumsCb = makeSettingsRow(settingsOpts, 'Row Numbers');
    const bordersCb = makeSettingsRow(settingsOpts, 'Column Separators');
    const stickyCb = makeSettingsRow(settingsOpts, 'Freeze Toolbar');
    const badgeRightToggle = makeSettingsButton(settingsOpts);

    attachPopover(settingsBtn, settingsDd, settingsBtn, { hover: true });

    // A configured button either joins a menu — appended below that menu's own items,
    // so it reads as the last entry — or becomes a toolbar button of its own. The
    // standalone ones are left for the controller to add once the Columns menu exists,
    // so extra buttons always follow every menu.
    const extraBtns = buttons.map(cfg => {
        if (cfg.menu === 'file' && fileBtns) {
            const el = document.createElement('div');
            el.className = 'aj-array-item';
            el.textContent = cfg.label;
            fileBtns.dd.appendChild(el);
            return el;
        }
        if (cfg.menu === 'settings') return makeSettingsButton(settingsOpts, cfg.label);
        return null;
    });

    anchor.insertAdjacentElement('beforebegin', toolbar);
    return { countBadge, fileBtns, extraBtns, toolbar, rest, moreBtn, toggleBtn, titleWrap, btnHost, sourceBtn,settingsDd, settingsBtns: { rowNums: rowNumsCb, borders: bordersCb, sticky: stickyCb, badgeRight: badgeRightToggle, showMore: showMoreCb } };
}

// A plain toolbar button, appended wherever the host is up to — the controller adds
// the configured ones after the Columns menu, so they sit past every menu.
export function addToolbarButton(btnHost, label) {
    const btn = document.createElement('button');
    btn.className = 'atv-export-btn';
    btn.textContent = label;
    btnHost.appendChild(btn);
    return btn;
}

// The Columns menu: a toolbar button plus the filter-dropdown shell, giving the
// picker the same search box and checkbox rows as a column filter. The Show All /
// Clear All actions are dropped — on deep data they would mean "add 400 columns".
export function buildColumnsMenu(btnHost, id) {
    const btn = document.createElement('button');
    btn.className = 'atv-export-btn';
    btn.textContent = 'Columns';
    btnHost.appendChild(btn);

    const dd = buildDropdown(id);
    dd.querySelector('.filter-actions').remove();
    const header = document.createElement('div');
    header.className = 'aj-array-header';
    header.textContent = 'Columns';
    dd.prepend(header);
    btnHost.appendChild(dd);

    attachPopover(btn, dd, btn, { hover: true });
    return { btn, dd, search: dd.querySelector('.filter-search') };
}

// One checkbox row per discovered path, ticked for the columns already shown.
// onToggle(path, checked) rebuilds the table; returns the rows for search filtering.
export function buildColumnOptions(dd, paths, active, onToggle) {
    const container = dd.querySelector('.filter-options');
    const rows = {};

    paths.forEach(path => {
        const row = document.createElement('div');
        row.className = 'filter-row';
        row.setAttribute('data-value', path.toLowerCase());

        const label = document.createElement('label');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = active.has(path);
        cb.addEventListener('change', function() { onToggle(path, this.checked); });
        label.appendChild(cb);
        label.appendChild(document.createTextNode(path));

        row.appendChild(label);
        container.appendChild(row);
        rows[path] = row;
    });

    return rows;
}

function makeSettingsRow(container, label) {
    const row = document.createElement('div');
    row.className = 'filter-row';

    const lbl = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    lbl.appendChild(cb);
    lbl.appendChild(document.createTextNode(label));
    row.appendChild(lbl);
    container.appendChild(row);
    return cb;
}

// A settings row that is a single toggle button instead of a checkbox. State
// lives in aria-pressed; the controller flips it and sets the label on click.
function makeSettingsButton(container, label = '') {
    const row = document.createElement('div');
    row.className = 'filter-row';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'atv-settings-btn';
    btn.setAttribute('aria-pressed', 'false');
    if (label) btn.textContent = label;

    row.appendChild(btn);
    container.appendChild(row);
    return btn;
}

// Freezes the column widths the auto layout computed from the full data set and
// switches the table to a fixed layout. Without this the browser re-fits columns
// to whichever rows a filter leaves visible, so a single match shrinks its column
// and squeezes the rest. Call once, with every row still visible.
export function lockColumnWidths(table) {
    const cells = [...table.tHead.rows[0].cells];
    // The row-number column is display:none until Settings turns it on. Measured in
    // that state it locks at 0px and the numbers stay invisible once shown, so it is
    // unhidden for the measurement and hidden again in the same frame.
    const hidden = table.classList.contains('atv-hide-rownums');
    if (hidden) table.classList.remove('atv-hide-rownums');
    const widths = cells.map(th => th.offsetWidth);
    if (hidden) table.classList.add('atv-hide-rownums');
    if (!widths.some(w => w > 0)) return; // not laid out (hidden) — leave it auto
    cells.forEach((th, i) => { th.style.width = `${widths[i]}px`; });
    table.style.tableLayout = 'fixed';
    // A fixed table narrower than its columns shrinks every one of them proportionally,
    // so a phone or a rotated tablet squeezes the locked widths and the nowrap header
    // content (sort arrow, filter funnel) spills under the next cell. Hold the measured
    // total as the min-width: the wrapper scrolls instead.
    table.style.minWidth = `${widths.reduce((a, b) => a + b, 0)}px`;
}

// Points the eye at a column after a rebuild: scrolls it into view (a new column can
// land off-screen on a wide table) and flashes its header.
export function focusColumn(table, index) {
    const th = table.querySelector(`th[data-col="${index}"]`);
    if (!th) return;
    th.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    th.classList.add('aj-flash');
    th.addEventListener('animationend', () => th.classList.remove('aj-flash'), { once: true });
}

// Builds and inserts a no-results message after the table wrapper.
// Returns the element for show/hide toggling.
export function buildNoResults(tableWrap, message) {
    const el = document.createElement('div');
    el.className = 'atv-no-results';
    el.textContent = message || 'No items match the current filters.';
    tableWrap.insertAdjacentElement('afterend', el);
    return el;
}

// Builds the thead row from column definitions.
// 'category' columns get a button + dropdown with checkboxes.
// 'text' columns get a button + dropdown with just a search input.
// 'range' columns (numeric) get a button + dropdown with Min/Max number inputs.
// Others are plain sortable ths.
export function buildHeader(thead, columns, tableId) {
    const tr = document.createElement('tr');
    const filterDefs = [];
    const textDefs = [];
    const rangeDefs = [];

    const th = document.createElement('th');
    th.className = 'atv-row-num';
    th.textContent = '';
    tr.appendChild(th);

    columns.forEach((col, i) => {
        const th = document.createElement('th');
        th.setAttribute('data-col', i);

        if (col.filter === 'category' || col.filter === 'text' || col.filter === 'range') {
            // Keyed by column index, not by col.key: a path key ('installed[*].time')
            // carries characters that break the `#id` selectors these ids feed.
            const filterId = `${tableId}_filter_${i}`;
            const thId = `${tableId}_th_${i}`;

            th.id = thId;
            th.textContent = col.label;

            // Explicit filter affordance: a tap target distinct from the sort
            // gesture. Mouse users open the dropdown by hovering the th; touch
            // devices (no hover) tap this button. The sort click guard
            // (e.target === th) ignores taps that land here, so the two
            // actions never collide.
            const filterBtn = document.createElement('button');
            filterBtn.className = 'atv-filter-btn aj-rotate';
            filterBtn.setAttribute('aria-label', `Filter ${col.label}`);
            th.appendChild(filterBtn);

            if (col.filter === 'category') {
                filterDefs.push({ id: filterId, thId, key: col.key, col: i });
                th.appendChild(buildDropdown(filterId));
            } else if (col.filter === 'range') {
                rangeDefs.push({ id: filterId, thId, key: col.key, col: i });
                th.appendChild(buildRangeDropdown(filterId));
            } else {
                textDefs.push({ id: filterId, thId, key: col.key, col: i });
                th.appendChild(buildTextDropdown(filterId));
            }
        } else {
            th.className = 'sortable';
            th.textContent = col.label;
        }

        tr.appendChild(th);
    });

    thead.appendChild(tr);
    return { filterDefs, textDefs, rangeDefs };
}

function buildDropdown(id) {
    const dd = document.createElement('div');
    dd.className = 'filter-dropdown';
    dd.id = id;
    dd.popover = 'auto';

    const fsearch = document.createElement('input');
    fsearch.className = 'filter-search';
    fsearch.type = 'text';
    fsearch.placeholder = 'Search...';

    const foptions = document.createElement('div');
    foptions.className = 'filter-options';

    const factions = document.createElement('div');
    factions.className = 'filter-actions';

    const selAll = document.createElement('button');
    selAll.className = 'sel-all';
    selAll.textContent = 'Show All';

    const badge = document.createElement('span');
    badge.className = 'filter-actions-badge';

    const clrAll = document.createElement('button');
    clrAll.className = 'clr-all';
    clrAll.textContent = 'Clear All';

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
    dd.id = id;
    dd.popover = 'auto';

    const input = document.createElement('input');
    input.className = 'filter-search';
    input.type = 'text';
    input.placeholder = 'Filter…';

    dd.appendChild(input);
    return dd;
}

// Numeric range dropdown: a Min and Max number input. The controller wires both
// to the column's [min, max] range state. Future numeric controls (comparator
// presets, a slider) can be appended here — they write the same range state, so
// no surrounding code changes.
function buildRangeDropdown(id) {
    const dd = document.createElement('div');
    dd.className = 'filter-dropdown filter-range-dd';
    dd.id = id;
    dd.popover = 'auto';

    const row = document.createElement('div');
    row.className = 'filter-range';

    const min = document.createElement('input');
    min.className = 'filter-range-min';
    min.type = 'number';
    min.placeholder = 'Min';
    min.setAttribute('aria-label', 'Minimum');

    const sep = document.createElement('span');
    sep.className = 'filter-range-sep';
    sep.textContent = '–';

    const max = document.createElement('input');
    max.className = 'filter-range-max';
    max.type = 'number';
    max.placeholder = 'Max';
    max.setAttribute('aria-label', 'Maximum');

    row.append(min, sep, max);
    dd.appendChild(row);
    return dd;
}

// Display-only formatting for a cell value. Numeric columns get locale thousands
// separators (27400013 -> "27,400,013"), preserving decimals. Opt out per column
// with `separator: false` (years, IDs, zips). Sort/filter read the raw data, so
// this never affects them.
function formatCell(value, col) {
    if (col.numeric && col.separator !== false && value !== '' && value != null
        && !Number.isNaN(Number(value))) {
        return Number(value).toLocaleString(undefined, { maximumFractionDigits: 20 });
    }
    return value ?? '';
}

// Builds tbody rows via DocumentFragment (single reflow).
// Returns a WeakMap<item, tr> for later visibility toggling and sorting.
export function buildRows(tbody, data, columns, objectCell = 'summary', objectAlign = 'left') {
    const rowMap = new WeakMap();
    const fragment = document.createDocumentFragment();
    data.forEach(item => {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.className = 'atv-row-num';
        tr.appendChild(td);
        columns.forEach(col => {
            const td = document.createElement('td');
            const value = getValue(item, col.key);
            // A format wins over the array/object renderers: it is the column's
            // stated way of reading its values, whatever shape they arrive in.
            const formatted = applyFormat(value, col.format, item);
            if (col.render) {
                td.appendChild(col.render(item));
            } else if (formatted != null) {
                td.textContent = formatted;
            } else if (Array.isArray(value)) {
                renderArrayCell(td, value);
            } else if (isPlainObject(value)) {
                renderObjectCell(td, value, col.objectCell || objectCell, col.label, col.objectAlign || objectAlign);
            } else {
                td.textContent = formatCell(value, col);
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
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = true;
        cb.addEventListener('change', function() { onCheck(v, this.checked); });
        label.appendChild(cb);
        label.appendChild(document.createTextNode(v));

        const onlyBtn = document.createElement('button');
        onlyBtn.className = 'only-btn';
        onlyBtn.textContent = 'Only';
        onlyBtn.addEventListener('click', e => { e.preventDefault(); onOnly(v); });

        row.appendChild(label);
        row.appendChild(onlyBtn);
        container.appendChild(row);

        rows[v] = row;
        checkboxes[v] = cb;
    });

    return { rows, checkboxes };
}

// Syncs checkbox checked state to match the current selected Set.
export function syncCheckboxes(checkboxes, selected) {
    Object.entries(checkboxes).forEach(([v, cb]) => { cb.checked = selected.has(v); });
}

// Shows/hides rows based on the visible set returned by model.getVisible.
// Also hides any expanded child table row so nested content collapses with the parent.
export function setRowVisibility(data, visibleSet, rowMap) {
    data.forEach(item => {
        const tr = rowMap.get(item);
        const visible = visibleSet.has(item);
        tr.classList.toggle('hidden', !visible);
        const next = tr.nextElementSibling;
        if (next?.classList.contains('aj-children-row')) {
            next.classList.toggle('hidden', !visible);
        }
    });
}

// Updates count labels, hides zero-count options, and refreshes the badge.
export function updateFilterCounts(filterDef, values, counts, selected, rows, badgeAlwaysShow) {
    values.forEach(v => {
        const row = rows[v];
        const count = counts[v] || 0;
        let countEl = row.querySelector('.filter-count');
        if (!countEl) {
            countEl = document.createElement('span');
            countEl.className = 'filter-count';
            row.insertBefore(countEl, row.querySelector('.only-btn'));
        }
        countEl.textContent = count;
        row.dataset.empty = count === 0 ? 'true' : '';
        row.style.display = count === 0 ? 'none' : '';
    });

    const visibleTotal = values.filter(v => (counts[v] || 0) > 0).length;
    const visibleSelected = values.filter(v => (counts[v] || 0) > 0 && selected.has(v)).length;
    // Whether this column filters anything is its own selection against its own
    // values — not the visible counts, which another column's filter can zero out,
    // taking the indicator off a column that is still filtering.
    const isFiltered = selected.size < values.length;
    const th = document.getElementById(filterDef.thId);
    const badgeEl = document.querySelector(`#${filterDef.id} .filter-actions-badge`);
    th.classList.toggle('active', isFiltered);
    badgeEl.textContent = '';
    if (isFiltered || badgeAlwaysShow) {
        const badge = document.createElement('span');
        badge.className = 'filter-badge';
        badge.textContent = `${visibleSelected}/${visibleTotal}`;
        badgeEl.appendChild(badge);
    }
}

// Opens the native OS save dialog when available; falls back to <a> download.
async function saveFile(blob, suggestedName, types) {
    if ('showSaveFilePicker' in window) {
        try {
            const handle = await window.showSaveFilePicker({ suggestedName, types });
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            return;
        } catch (e) {
            if (e.name === 'AbortError') return;
            // fall through to legacy on unexpected errors
        }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = suggestedName;
    a.click();
    URL.revokeObjectURL(a.href);
}

// Generates a CSV from visible items and saves it.
export function toCsv(columns, items) {
    const header = columns.map(c => c.label);
    const rows = items.map(item =>
        columns.map(c => {
            const v = cellDisplay(item, c);
            return `"${v.replace(/"/g, '""')}"`;
        })
    );
    return [header, ...rows].map(r => r.join(',')).join('\n');
}

export async function downloadCsv(columns, items, filename) {
    const blob = new Blob([toCsv(columns, items)], { type: 'text/csv' });
    await saveFile(blob, filename, [{ description: 'CSV', accept: { 'text/csv': ['.csv'] } }]);
}

// Generates a JSON file from visible items and saves it.
export async function downloadJson(items, filename) {
    const blob = new Blob([JSON.stringify([...items], null, 2)], { type: 'application/json' });
    await saveFile(blob, filename, [{ description: 'JSON', accept: { 'application/json': ['.json'] } }]);
}

// The raw-source panel: a text dump shown in place of the table, which CSS hides
// while the container carries .atv-source. Built once and refilled by the controller
// as the filters change. Text, not markup, so a file with tags in it shows them as
// text.
export function buildSourceView(host) {
    const pre = document.createElement('pre');
    pre.className = 'aj-source';
    host.appendChild(pre);
    return pre;
}

// Shows/hides option rows inside an open dropdown based on the search query.
export function filterOptionRows(rows, values, query) {
    const q = query.toLowerCase();
    values.forEach(v => {
        const row = rows[v];
        const match = (!q || v.toLowerCase().includes(q)) && row.dataset.empty !== 'true';
        row.style.display = match ? '' : 'none';
    });
}
