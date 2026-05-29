const _link = document.createElement('link');
_link.rel = 'stylesheet';
_link.href = new URL('./amazejs.css', import.meta.url).href;
document.head.appendChild(_link);

export { initTable } from './controller.js';
export { fetchData, parseTsv } from './model.js';
export { linkCell } from './view.js';
