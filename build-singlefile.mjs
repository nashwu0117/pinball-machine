/**
 * Build a fully self-contained game.html:
 * Three.js + cannon-es + all game modules + CSS inlined into ONE file.
 *
 * The result runs from a double-click on file:// with no server, no network
 * and no CDN, because everything is embedded. The dev version (index.html)
 * keeps using CDN import maps.
 *
 *   node build-singlefile.mjs
 */

import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';

const outfile = 'dist/bundle.js';

await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'esm',
  target: 'es2020',
  outfile,
  // Ship the unminified bundle: a school/office proxy cannot break it, and
  // failures stay readable.
  minify: false,
  // 'three' resolves through the import map at runtime in dev; here we pin
  // the exact same versions locally so the bundle is self-contained.
  alias: {
    three: 'three',
    'cannon-es': 'cannon-es',
  },
  logLevel: 'info',
});

const js = await readFile(outfile, 'utf8');
const css = await readFile('style.css', 'utf8');
const sourceHtml = await readFile('index.html', 'utf8');

// Keep one canonical document in index.html. The previous hand-copied body
// silently drifted away from the development build, which meant new controls
// could work in source but disappear from the offline game handed to players.
const html = sourceHtml
  .replace(/\s*<script type="importmap">[\s\S]*?<\/script>/, '')
  .replace('<link rel="stylesheet" href="./style.css" />', `<style>\n${css}\n</style>`)
  .replace('<script type="module" src="./src/main.js"></script>', `<script type="module">\n${js}\n</script>`);

await writeFile('game.html', html);
console.log('game.html written:', (html.length / 1024 / 1024).toFixed(2), 'MB');
