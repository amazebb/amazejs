import { initTable } from 'https://cdn.jsdelivr.net/gh/amazebb/amazejs@v0.1.0/src/index.js';

initTable({
    data: ['data/flat.json'],
    tableId: 'flatTable',
});

initTable({
    data: ['data/tree.json'],
    tableId: 'treeTable',
});
