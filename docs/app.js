import { initTable } from 'https://cdn.jsdelivr.net/gh/amazebb/amazejs@latest/dist/amazejs.js';

initTable({
    data: ['data/flat.json'],
    tableId: 'flatTable',
});

initTable({
    data: ['data/tree.json'],
    tableId: 'treeTable',
});
