// A Cloudflare Worker that lets the vessel builder on GitHub Pages read a vessel's page on
// maritime-database.com, which does not let other sites' pages read it (CORS).
//
// It passes on only GET /vessel/imo:<7 digits>, and answers only the origins in ALLOWED.
//
// To set it up: in the Cloudflare dashboard, Workers & Pages → Create → Worker, paste this file,
// Deploy. Then in the vessel builder, Settings → Vessel lookup, give the worker's address
// (https://<name>.<account>.workers.dev/).

const ALLOWED = ['https://joranlager.github.io', 'http://localhost:8090'];

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') ?? '';
    const cors = ALLOWED.includes(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': 'Accept' } });
    const m = new URL(request.url).pathname.match(/^\/vessel\/imo:(\d{7})$/);
    if (request.method !== 'GET' || !m) return new Response('Not found', { status: 404, headers: cors });
    const r = await fetch(`https://maritime-database.com/vessel/imo:${m[1]}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (vessel builder)', Accept: 'text/html' },
      cf: { cacheTtl: 86400, cacheEverything: true },
    });
    return new Response(r.ok ? r.body : '', { status: r.status, headers: { ...cors, 'Content-Type': 'text/html; charset=utf-8' } });
  },
};
