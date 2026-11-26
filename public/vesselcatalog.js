// Vessel models made by hand (or by anyone), found before a ship is built from its type.
//
// Rudder looks for a ship's model in two places before it builds one from the ship's type and size
// (ships/ship.js): first its own vessels folder (public/vessels/, listed in vessels/index.json), then
// the models saved on this device (ships/library.js). A model is matched to a ship by MMSI, then IMO
// number, then call sign, then name. Pure (no three.js, no DOM), so it is unit tested; the loading
// and fitting with three.js is in ships/vesselmodel.js.

import { foldName } from './ais.js';

export const VESSELS_DIR = 'vessels/';
export const INDEX_FILE = 'index.json';
export const MODEL_FORMATS = ['glb', 'gltf', 'obj', 'stl', 'ply', 'fbx', 'dae', '3mf'];
/** Pictures that can go on a model as its texture. */
export const PICTURE_FORMATS = ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'bmp'];
export const UP_AXES = ['+y', '+z', '-y', '-z', '+x', '-x'];
export const FORWARD_AXES = ['+x', '-x', '+z', '-z', '+y', '-y'];

/** The model format from a file name, or null. */
export function formatOf(file) {
  const ext = String(file ?? '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return MODEL_FORMATS.includes(ext) ? ext : null;
}

const digits = (s) => String(s ?? '').replace(/\D/g, '');
const list = (x) => (Array.isArray(x) ? x : x == null || x === '' ? [] : [x]);

/** A ship's name for matching: folded (see ais.js), with prefixes such as MS, MV or M/S dropped. */
export function matchName(s) {
  return foldName(s).replace(/^(?:m ?s|m ?v|s ?s|m ?y|s ?y|rms|hms|uss|knm|kv|ms|mv|ss|my|sy)\s+/, '').trim();
}

/**
 * A catalog entry as written in a sidecar or index.json, checked and filled in; null when it names
 * no model file. Every field but `file` may be left out:
 *   { id, name, file, format, mmsi: [..], imo, callSign, aliases: [..],
 *     up: '+y', forward: '+x', scale: 'length' | number, length, beam, draft,
 *     waterline: 'origin' | 'keel', textures: { material: file }, credit, license, source }
 * - up / forward: which of the model's axes point up and to the bow (glTF is usually +y up).
 * - scale 'length' stretches the model to the ship's length (from AIS, else `length`); a number
 *   multiplies the model's own units (1 when it is already in metres).
 * - waterline 'origin': the model's own y = 0 (after turning it upright) is the waterline;
 *   'keel' (the default): the keel goes `draft` metres below the waterline.
 */
export function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const file = String(raw.file ?? '').trim();
  const format = raw.format ? String(raw.format).toLowerCase() : formatOf(file);
  if (!file || !MODEL_FORMATS.includes(format) || file.includes('..') || /^[a-z]+:|^\//i.test(file)) return null;
  let up = UP_AXES.includes(raw.up) ? raw.up : '+y';
  let forward = FORWARD_AXES.includes(raw.forward) ? raw.forward : '+x';
  if (up[1] === forward[1]) { up = '+y'; forward = '+x'; } // the same axis cannot be both
  const num = (x) => (Number(x) > 0 ? Number(x) : undefined);
  const scale = Number(raw.scale) > 0 ? Number(raw.scale) : 'length';
  return {
    id: String(raw.id ?? file.replace(/\.[^.]+$/, '')),
    name: String(raw.name ?? file.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ')),
    file,
    format,
    mmsi: list(raw.mmsi).map(digits).filter((m) => m.length === 9),
    imo: digits(raw.imo).length === 7 ? digits(raw.imo) : '',
    callSign: String(raw.callSign ?? '').trim().toUpperCase(),
    aliases: list(raw.aliases).map(String),
    up,
    forward,
    scale,
    length: num(raw.length),
    beam: num(raw.beam),
    draft: num(raw.draft),
    waterline: raw.waterline === 'origin' ? 'origin' : 'keel',
    textures: raw.textures && typeof raw.textures === 'object' ? { ...raw.textures } : {},
    mtl: raw.mtl ? String(raw.mtl) : undefined,
    credit: raw.credit ? String(raw.credit) : '',
    license: raw.license ? String(raw.license) : '',
    source: raw.source ? String(raw.source) : '',
  };
}

/** The entries of an index.json ({ vessels: [...] } or a bare list), checked. */
export function parseIndex(json) {
  const raw = Array.isArray(json) ? json : Array.isArray(json?.vessels) ? json.vessels : [];
  const seen = new Set();
  const out = [];
  for (const r of raw) {
    const e = normalizeEntry(r);
    if (!e || seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
  }
  return out;
}

/**
 * What is known of a ship, from an AIS report ({ mmsi, imoNumber, callSign, name }), Wikidata facts
 * ({ mmsi, imo, callSign, label }) or the inspector's own lettering.
 */
export function shipKeys(s) {
  return {
    mmsi: digits(s?.mmsi),
    imo: digits(s?.imoNumber ?? s?.imo),
    callSign: String(s?.callSign ?? '').trim().toUpperCase(),
    name: matchName(s?.name ?? s?.label ?? ''),
  };
}

/**
 * The entry for a ship, best match first: MMSI, then IMO number, then call sign, then the name (or
 * an alias). A name alone matches only when the entry gives no MMSI or IMO that disagrees with the
 * ship's own: two ships can share a name. null when none fits.
 */
export function matchVessel(entries, ship) {
  const k = shipKeys(ship);
  if (k.mmsi) { const e = entries.find((x) => x.mmsi.includes(k.mmsi)); if (e) return e; }
  if (k.imo.length === 7) { const e = entries.find((x) => x.imo === k.imo); if (e) return e; }
  if (k.callSign) { const e = entries.find((x) => x.callSign && x.callSign === k.callSign); if (e) return e; }
  if (!k.name) return null;
  return entries.find((x) => {
    if (x.mmsi.length && k.mmsi && !x.mmsi.includes(k.mmsi)) return false;
    if (x.imo && k.imo && x.imo !== k.imo) return false;
    return [x.name, ...x.aliases].some((n) => matchName(n) === k.name);
  }) ?? null;
}

// ---------- fitting a model to the ship's frame ----------
// The ship's frame (as ships/ship.js builds it): +x to the bow, +y up, +z to starboard, metres,
// waterline at y = 0, amidships at x = 0.

const AXIS = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0], '+z': [0, 0, 1], '-z': [0, 0, -1] };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * The rotation taking the model's axes to the ship's, as three rows (row-major 3x3): the ship's x
 * is the model's `forward`, its y the model's `up`, its z (starboard) forward x up.
 */
export function axisRotation(up = '+y', forward = '+x') {
  const f = AXIS[forward] ?? AXIS['+x'];
  const u = AXIS[up] ?? AXIS['+y'];
  if (f.some((x, i) => x !== 0 && u[i] !== 0)) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  return [f, u, cross(f, u)];
}

/**
 * Scale and shift for a model already turned upright and bow forward, from its bounding box there
 * ({ min: {x,y,z}, max: {x,y,z} } in the model's units): the hull is centred on x and z, and its
 * waterline put at y = 0. `opts`: { scale: 'length' | number, length, draft, waterline }.
 * Returns { scale, offset } with ship = model * scale + offset.
 */
export function fitPlacement(box, opts = {}) {
  const lx = box.max.x - box.min.x;
  let scale = 1;
  if (typeof opts.scale === 'number' && opts.scale > 0) scale = opts.scale;
  else if (opts.length > 0 && lx > 0) scale = opts.length / lx;
  const cx = ((box.min.x + box.max.x) / 2) * scale;
  const cz = ((box.min.z + box.max.z) / 2) * scale;
  let y;
  if (opts.waterline === 'origin') y = 0;
  else {
    const L = lx * scale;
    const draft = opts.draft > 0 ? opts.draft : Math.max(0.3, 0.045 * L);
    y = -draft - box.min.y * scale;
  }
  return { scale, offset: { x: 0 - cx, y, z: 0 - cz } };
}

// ---------- the folder's index ----------

/**
 * index.json for the vessels folder from its files: every model file, with the sidecar of the same
 * name (`<model>.json`) when there is one. `files` is [{ name, json? }] (json: the parsed sidecar).
 * Sidecars that name another file (`"file": ...`) are used for that file.
 */
export function buildIndex(files) {
  const byName = new Map(files.map((f) => [f.name, f]));
  const vessels = [];
  const used = new Set();
  for (const f of files) {
    if (!f.name.endsWith('.json') || f.name === INDEX_FILE || !f.json) continue;
    const base = f.name.replace(/\.json$/, '');
    const file = f.json.file ?? MODEL_FORMATS.map((x) => `${base}.${x}`).find((n) => byName.has(n));
    if (!file || !byName.has(file)) continue;
    const e = normalizeEntry({ ...f.json, file });
    if (e) { vessels.push(e); used.add(file); }
  }
  for (const f of files) {
    if (!formatOf(f.name) || used.has(f.name)) continue;
    const e = normalizeEntry({ file: f.name });
    if (e) vessels.push(e);
  }
  vessels.sort((a, b) => a.id.localeCompare(b.id));
  return { about: 'Vessel models Rudder uses before building a ship from its type. Made by `npm run vessels` from the files and their .json sidecars; see README.md here.', vessels };
}

/** Fetch and read the folder's index.json; an empty list when there is none. */
export async function loadIndex(base = VESSELS_DIR, fetchFn = fetch) {
  try {
    const res = await fetchFn(base + INDEX_FILE, { cache: 'no-cache' });
    if (!res.ok) return [];
    return parseIndex(await res.json());
  } catch {
    return [];
  }
}
