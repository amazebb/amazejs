// Builds the single-file CDN bundle (dist/amazejs.js).
// Two passes: minify the stylesheet through Bun's CSS pipeline, then bundle the
// JS with that minified CSS inlined as a string via a build-time define. JS is
// minified (comments stripped) by the bundler; the define keeps the inlined CSS
// minified too, instead of the raw text loader's verbatim copy.

const css = await Bun.build({ entrypoints: ['src/amazejs.css'], minify: true })
    .then(r => r.outputs[0].text());

const out = await Bun.build({
    entrypoints: ['build/entry.js'],
    outdir: 'dist',
    naming: 'amazejs.js',
    minify: true,
    format: 'esm',
    define: { __AMAZE_CSS__: JSON.stringify(css) },
});

if (!out.success) {
    console.error(out.logs.join('\n'));
    process.exit(1);
}

console.log(`dist/amazejs.js  ${(out.outputs[0].size / 1024).toFixed(2)} KB`);
