// A vessel's particulars by her IMO number, from maritime-database.com: her name, MMSI, call sign,
// flag, type, length and beam, gross tonnage, year built and latest draught.
//
// The site does not let pages on other sites read it (CORS), so it is asked through a proxy: the
// one set in Settings, else the local server's own (scripts/serve.mjs, at /maritime/), else the
// Cloudflare Worker in proxy/maritime-worker.js (PROXY). A proxy is given `vessel/imo:<7 digits>` after its
// address and answers with the vessel's page. Reading the page is pure, so it is tested.

export const MARITIME_KEY = 'vesselbuilder.maritime.v1';
export const SITE = 'https://maritime-database.com';
const LOCAL = '/maritime/';
/** The Cloudflare Worker (proxy/maritime-worker.js), deployed with proxy/wrangler.toml. */
export const PROXY = 'https://vesselbuilder-maritime.vesselbuilder.workers.dev/';

/** Is this a valid IMO number (7 digits, the last a check digit)? */
export function validImo(imo) {
  const d = String(imo ?? '').replace(/\D/g, '');
  if (d.length !== 7) return false;
  let sum = 0;
  for (let i = 0; i < 6; i++) sum += Number(d[i]) * (7 - i);
  return sum % 10 === Number(d[6]);
}

/** The proxy set in Settings (or ''). */
export function loadProxy(storage = globalThis.localStorage) {
  try {
    return String(JSON.parse(storage?.getItem(MARITIME_KEY) ?? 'null')?.proxy ?? '');
  } catch {
    return '';
  }
}
export function saveProxy(proxy, storage = globalThis.localStorage) {
  const p = String(proxy ?? '').trim();
  if (p) storage.setItem(MARITIME_KEY, JSON.stringify({ proxy: p }));
  else storage.removeItem(MARITIME_KEY);
}

/** Is the page served by the local server (npm start), which has a proxy of its own? */
export const isLocal = (loc = globalThis.location) => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(String(loc?.hostname ?? ''));

/** The proxy to ask through: the one set in Settings, else the local server's, else the worker. */
export function proxyBase(proxy = loadProxy(), loc = globalThis.location) {
  const p = String(proxy ?? '').trim();
  if (p) return p.endsWith('/') ? p : `${p}/`;
  return isLocal(loc) ? LOCAL : PROXY;
}

/** The address to ask for a vessel by her IMO number, through a proxy. */
export const lookupUrl = (imo, base) => `${base}vessel/imo:${String(imo).replace(/\D/g, '')}`;

/** The site's own page for her (for a link). */
export const siteUrl = (imo) => `${SITE}/vessel/imo:${String(imo).replace(/\D/g, '')}`;

const text = (v) => String(v ?? '').trim();
const pos = (v) => (Number(v) > 0 ? Number(v) : null);

/**
 * Her particulars from her page on maritime-database.com (its HTML), or null when it holds no vessel.
 * { name, imo, mmsi, callSign, flag, type, length, beam, gross, deadweight, built, draught, url }
 */
export function parseVesselPage(html) {
  const m = String(html ?? '').match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  let v;
  try {
    v = JSON.parse(m[1])?.props?.pageProps?.vessel?.vessel;
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object') return null;
  // "43 / 11 m": her length and beam when LOA and BEAM are not given (0)
  const lb = text(v.LENGTHBEAM).match(/([\d.]+)\s*\/\s*([\d.]+)/);
  const imo = text(v.IMO).replace(/\D/g, '');
  const mmsi = text(v.MMSI).replace(/\D/g, '');
  const out = {
    name: text(v.VESSEL_NAME),
    imo: imo.length === 7 ? imo : '',
    mmsi: mmsi.length === 9 ? mmsi : '',
    callSign: text(v.CALLSIGN).toUpperCase(),
    flag: text(v.FLAG || v.COUNTRY_NAME),
    type: text(v.SHIP_TYPE),
    length: pos(v.LOA) ?? pos(lb?.[1]),
    beam: pos(v.BEAM) ?? pos(lb?.[2]),
    gross: pos(v.GROSS),
    deadweight: pos(v.SUMMER_DWT),
    built: /^\d{4}$/.test(text(v.YEAR_BUILT)) ? Number(text(v.YEAR_BUILT)) : null,
    draught: pos(v.DRAUGHT) && v.DRAUGHT < 30 ? Number(v.DRAUGHT) : null,
    url: /^https:\/\/(www\.)?maritime-database\.com\//.test(text(v.URL)) ? text(v.URL) : '',
  };
  return out.name || out.imo || out.mmsi ? out : null;
}

/** The builder's vessel kind (ships/presets.js) for the site's ship type, or '' when it does not say. */
export function kindFromType(type, length = 0) {
  const t = text(type).toLowerCase();
  if (!t) return '';
  if (/container/.test(t)) return 'container';
  if (/tanker|gas carrier|lng|lpg/.test(t)) return 'tanker';
  if (/bulk|ore carrier|cement/.test(t)) return 'bulk';
  if (/cruise/.test(t)) return 'cruise';
  if (/passenger|ferry|ro-?ro|ro-?pax|high speed/.test(t)) return /ro-?ro/.test(t) && !/passenger/.test(t) ? 'cargo' : length >= 200 ? 'cruise' : 'ferry';
  if (/aircraft carrier/.test(t)) return 'carrier';
  if (/naval|military|warship|patrol|frigate|destroyer|law enforce/.test(t)) return 'warship';
  if (/sailing/.test(t)) return 'sailing';
  if (/yacht|pleasure/.test(t)) return 'yacht';
  if (/tug|towing|pilot|rescue|supply|offshore|fishing|trawler|dredg|tender|workboat|research|buoy|icebreaker/.test(t)) return 'tug';
  if (/cargo|reefer|vehicle|livestock|heavy load/.test(t)) return 'cargo';
  return '';
}

/**
 * Her particulars by her IMO number, asked through `base` (proxyBase()). Resolves to null when the
 * site does not know her; throws when it cannot be asked.
 */
export async function lookupImo(imo, { base = proxyBase(), fetch: get = globalThis.fetch, signal } = {}) {
  if (!base) throw new Error('No proxy is set for maritime-database.com (Settings → Vessel lookup).');
  const r = await get(lookupUrl(imo, base), { signal, headers: { Accept: 'text/html' } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`maritime-database.com answered ${r.status}`);
  return parseVesselPage(await r.text());
}
