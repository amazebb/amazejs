// Dates — parsing, the date/time formats, and the bounds a date filter works in.
// Pure functions, no DOM: model.js formats through them, controller.js sizes its
// date pickers with them.

// Epoch numbers are read as seconds below 1e11 and milliseconds above, which covers
// both conventions without a second name per format; anything else is left to Date,
// so ISO strings ('2026-07-10', '2026-07-10T17:46:53Z') parse as themselves.
export function toDate(value) {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (value == null || value === '') return null;
    const n = Number(value);
    const d = Number.isNaN(n) ? new Date(value) : new Date(Math.abs(n) < 1e11 ? n * 1000 : n);
    return Number.isNaN(d.getTime()) ? null : d;
}

// The instant behind a value, in milliseconds — what a date range compares.
export function toTimestamp(value) {
    const d = toDate(value);
    return d ? d.getTime() : null;
}

const asDate = fn => value => { const d = toDate(value); return d ? fn(d) : null; };

/** @type {[Intl.RelativeTimeFormatUnit, number][]} */
const RELATIVE_UNITS = [['year', 31536000], ['month', 2592000], ['week', 604800],
                        ['day', 86400], ['hour', 3600], ['minute', 60]];

// Built once: an Intl formatter costs far more to construct than to call, and this
// one runs per cell.
const RELATIVE_FORMAT = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

// The date formats are ISO 8601 in local time, 24-hour, with a numeric offset
// (2026-07-07T13:48:31+1000) rather than locale strings: unambiguous about which
// clock produced them, and text that sorts and prefix-searches ('2026-07') the way
// the values themselves order. Locale rendering stays available as a function
// format — `v => new Date(v * 1000).toLocaleString()`.
const pad = n => String(n).padStart(2, '0');
export const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isoTime = d => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
// ±hh, with the minutes only when the zone actually has them (+1000 → +10, but
// +0530 keeps both) — ISO 8601's ±hh and ±hhmm forms.
const isoOffset = d => {
    const mins = -d.getTimezoneOffset(); // minutes east of UTC
    const abs = Math.abs(mins);
    const hh = `${mins < 0 ? '-' : '+'}${pad(Math.floor(abs / 60))}`;
    return abs % 60 ? `${hh}${pad(abs % 60)}` : hh;
};

export const DATE_FORMATTERS = {
    date:     asDate(isoDate),
    datetime: asDate(d => `${isoDate(d)}T${isoTime(d)}${isoOffset(d)}`),
    time:     asDate(isoTime),
    relative: asDate(d => {
        const secs = (d.getTime() - Date.now()) / 1000;
        const [unit, size] = RELATIVE_UNITS.find(([, s]) => Math.abs(secs) >= s)
            || /** @type {[Intl.RelativeTimeFormatUnit, number]} */ (['second', 1]);
        return RELATIVE_FORMAT.format(Math.round(secs / size), unit);
    }),
};

// A column formatted as a date is filtered as one: the Min/Max range becomes two
// date pickers rather than two number boxes, which is what the reader is looking at.
export const isDateFormat = format => typeof format === 'string' && format in DATE_FORMATTERS;

// `<input type="date">` speaks 'YYYY-MM-DD' in local time, both ways.
export const toDateInput = value => {
    const d = toDate(value);
    return d ? isoDate(d) : '';
};

// A picked day covers the whole day: the From box means its first millisecond, the
// To box its last, so picking the same day either side keeps that day's rows.
export const fromDateInput = (text, edge) => {
    if (!text) return null;
    const [y, m, d] = text.split('-').map(Number);
    return edge === 'max'
        ? new Date(y, m - 1, d, 23, 59, 59, 999).getTime()
        : new Date(y, m - 1, d).getTime();
};
