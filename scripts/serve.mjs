// Minimal static server for local development: npm start -> http://localhost:8090
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const port = Number(process.env.PORT ?? 8090);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

// maritime-database.com does not let other sites' pages read it (CORS), so the page asks it through
// here (public/maritimedb.js). Only a vessel's page by her IMO number is passed on.
async function maritime(pathname, res) {
  const m = pathname.match(/^\/maritime\/vessel\/imo:(\d{7})$/);
  if (!m) return res.writeHead(404).end('Not found');
  try {
    const r = await fetch(`https://maritime-database.com/vessel/imo:${m[1]}`, { headers: { 'User-Agent': 'Mozilla/5.0 (vessel builder)', Accept: 'text/html' } });
    res.writeHead(r.status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(r.ok ? await r.text() : '');
  } catch (e) {
    res.writeHead(502).end(String(e?.message ?? e));
  }
}

http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  if (pathname.startsWith('/maritime/')) return maritime(pathname, res);
  const file = path.resolve(root, pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1)));
  if (file !== root && !file.startsWith(root + path.sep)) return res.writeHead(403).end();
  try {
    let data = await readFile(file);
    if (file.endsWith('index.html')) data = data.toString().replace('__BUILD__', 'dev');
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, () => console.log(`Vessel builder on http://localhost:${port}`));
