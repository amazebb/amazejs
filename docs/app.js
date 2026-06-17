// Use the local build when developing on localhost, the pinned CDN bundle in
// production (GitHub Pages).
const src = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? '../dist/amazejs.js'
    : 'https://cdn.jsdelivr.net/gh/amazebb/amazejs@latest/dist/amazejs.js';
const { initTable } = await import(src);

initTable({
    data: ['data/flat.json'],
    tableId: 'flatTable',
});

initTable({
    data: ['data/tree.json'],
    tableId: 'treeTable',
});
