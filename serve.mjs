/**
 * Zero-dependency static file server with caching disabled.
 *
 * The browser must never serve a stale module of this game: `no-store` makes
 * every reload pick up the current files, so "I changed the code but the page
 * did not change" cannot happen.
 *
 *   node serve.mjs [port]      # default 8181
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const root = process.cwd();
const port = Number(process.argv[2] || 8181);

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  try {
    let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    // The root path IS the game: serve the self-contained build directly.
    if (pathname === '/' || pathname === '/index.html') {
      const single = await readFile(join(root, 'game.html'));
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(single);
      return;
    }
    const file = normalize(join(root, pathname));
    if (!file.startsWith(root + sep) && file !== root) throw new Error('forbidden');
    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': types[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
}).listen(port, '0.0.0.0', () => {
  console.log(`taiwan-pinball serving ${root}`);
  console.log(`open http://localhost:${port}/index.html  (Cache-Control: no-store)`);
});
