// Bundle-only entrypoint. Inlines amazejs.css as a string and hands it to the
// view's setStyles() so the built dist/amazejs.js is fully self-contained (one
// file, CSS injected as a <style>). The raw src/ entry stays import-and-go.
import css from '../src/amazejs.css' with { type: 'text' };
import { setStyles } from '../src/view.js';

setStyles(css);

export * from '../src/index.js';
