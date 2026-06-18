// Use the local build when developing on localhost, an exact-pinned CDN bundle
// in production (GitHub Pages). Pinning the version (not @latest) gives each
// release a unique, immutable URL, sidestepping jsDelivr's 7-day browser cache
// on the floating @latest URL. Bump this on every release.
const src = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? '../dist/amazejs.js'
    : 'https://cdn.jsdelivr.net/gh/amazebb/amazejs@v0.8.1/dist/amazejs.js';
const { initTable } = await import(src);

initTable({
    data: ['data/flat.json'],
    tableId: 'flatTable',
});

initTable({
    data: ['data/tree.json'],
    tableId: 'treeTable',
});
