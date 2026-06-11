// Demo: both tables run on zero config — columns, titles, and tree structure
// are inferred from the data. Supply the two files in demo/data/:
//   flat.json — an array of objects
//   tree.json — a root wrapper object (e.g. { countries: [...] }) whose items
//               may hold arrays of objects as child groups
import { initTable } from '../src/index.js';

initTable({
    data: ['data/flat.json'],
    tableId: 'flatTable',
});

initTable({
    data: ['data/tree.json'],
    tableId: 'treeTable',
});
