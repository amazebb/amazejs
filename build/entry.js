// Bundle-only entrypoint (built by build/build.js). __AMAZE_CSS__ is replaced
// at build time with the minified stylesheet string and handed to the view's
// setStyles(), so the built dist/amazejs.js is fully self-contained (one file,
// CSS injected as a <style>). This file is never imported raw — the dev path
// uses src/index.js, which loads amazejs.css via <link>.
import { setStyles } from '../src/view.js';

setStyles(__AMAZE_CSS__);

export * from '../src/index.js';
