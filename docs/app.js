// Use the local build anywhere but GitHub Pages — so a LAN address (testing from
// a phone or tablet against the Mac's dev server) gets the local build too — and an
// exact-pinned CDN bundle in production. Pinning the version (not @latest) gives each
// release a unique, immutable URL, sidestepping jsDelivr's 7-day browser cache
// on the floating @latest URL. Bump this on every release.
const src = !location.hostname.endsWith('github.io')
    ? '../dist/amazejs.js'
    : 'https://cdn.jsdelivr.net/gh/amazebb/amazejs@v0.28.2/dist/amazejs.js';
const { initTable } = await import(src);

initTable({
    data: ['data/flat.json'],
    tableId: 'flatTable',
});

initTable({
    data: ['data/tree.json'],
    tableId: 'treeTable',
});
