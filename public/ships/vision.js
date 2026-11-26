// What a small vision-language model (Qwen3.5, in ai.js) says about each photo of a vessel, made
// into something Rudder can build from: the question it is asked, its answer read (forgivingly: a
// small model's JSON is not always clean), the answers for several photos merged into one
// description, and which view each photo is for the carving (photomodel.js). Also the colours of the
// hull and superstructure sampled from a cut-out photo. Pure, so it is unit tested.

/** The question asked about every photo. Short, with the answers it may give spelled out. */
export const PROMPT = `Look at this photo of a ship. Reply with one JSON object and nothing else:
{"view": "side" | "bow" | "stern" | "bow-quarter" | "stern-quarter" | "above" | "other",
 "bow": "left" | "right" | "toward" | "away" | "unknown",
 "type": "ferry" | "passenger" | "cruise" | "cargo" | "container" | "tanker" | "bulk" | "fishing" | "tug" | "offshore" | "sailing" | "yacht" | "warship" | "other",
 "name": "the name painted on the hull, or empty",
 "hull": "colour of the hull", "superstructure": "colour of the superstructure", "funnel": "colour of the funnel",
 "decks": number of decks above the hull, "funnels": number, "masts": number,
 "bowShape": "raked" | "vertical" | "bulbous" | "clipper" | "ramp",
 "stern": "transom" | "rounded" | "ramp",
 "bridge": "forward" | "middle" | "aft"}
"view" is where the camera is: "side" when the whole side of the ship is seen, "bow" when looking at the front, "stern" when looking at the back. "bow" says which way the front of the ship points in the photo.`;

/**
 * Which way her bow points is asked again on its own for a photo of her side: in two words, of the
 * photo and of her cut-out, each also mirrored. A small model answers a one-word question better than
 * a field in a long answer, and a guess shows itself by not turning round with the picture; the
 * answers that do turn round are counted.
 */
export const BOW_PROMPTS = [
  'Which end of the ship is the bow (the pointed front end)? Answer with one word: left or right.',
  'Is the ship sailing towards the left or towards the right of the picture? Answer with one word: left or right.',
];

/** The bow's side from the answers for the photo and its mirror image; null when they do not agree. */
export function bowFrom(answer, mirrored) {
  const side = (t) => {
    const m = String(t ?? '').toLowerCase().match(/\b(left|right)\b/g);
    return m && new Set(m).size === 1 ? m[0] : null;
  };
  const a = side(answer), b = side(mirrored);
  return a && b && a !== b ? a : null;
}

/** The bow's side from several pairs of answers ([photo, mirrored]): the most of those that agree. */
export function bowVote(pairs) {
  let left = 0, right = 0;
  for (const [a, b] of pairs) {
    const v = bowFrom(a, b);
    if (v === 'left') left++;
    else if (v === 'right') right++;
  }
  return left > right ? 'left' : right > left ? 'right' : null;
}

const ENUMS = {
  view: {
    side: ['side', 'profile', 'broadside', 'port', 'starboard', 'port side', 'starboard side', 'beam'],
    bow: ['bow', 'front', 'ahead', 'head on', 'head-on', 'forward'],
    stern: ['stern', 'back', 'rear', 'astern', 'aft'],
    'bow-quarter': ['bow-quarter', 'bow quarter', 'front quarter', 'three-quarter', '3/4', 'quarter', 'front-quarter', 'oblique'],
    'stern-quarter': ['stern-quarter', 'stern quarter', 'rear quarter', 'back quarter', 'rear-quarter'],
    above: ['above', 'top', 'aerial', 'overhead', 'drone', 'plan', 'from above', 'bird'],
    other: ['other', 'detail', 'inside', 'interior', 'unknown'],
  },
  bow: {
    left: ['left'], right: ['right'], toward: ['toward', 'towards', 'camera', 'viewer', 'front'], away: ['away', 'back'], unknown: ['unknown', 'none', ''],
  },
  type: {
    ferry: ['ferry', 'ro-pax', 'ropax', 'car ferry', 'roro', 'ro-ro'],
    passenger: ['passenger', 'express', 'catamaran', 'hurtigbåt', 'water taxi', 'excursion'],
    cruise: ['cruise', 'liner', 'coastal express', 'expedition'],
    cargo: ['cargo', 'general cargo', 'freighter', 'reefer', 'feeder'],
    container: ['container'],
    tanker: ['tanker', 'chemical', 'lng', 'lpg', 'gas carrier', 'oil'],
    bulk: ['bulk', 'ore', 'self-unloader'],
    fishing: ['fishing', 'trawler', 'seiner', 'longliner', 'fish', 'well boat', 'wellboat'],
    tug: ['tug', 'pilot', 'workboat', 'work boat', 'towing'],
    offshore: ['offshore', 'supply', 'psv', 'ahts', 'platform', 'subsea', 'research', 'survey', 'icebreaker'],
    sailing: ['sailing', 'sail', 'tall ship', 'schooner', 'barque', 'brig'],
    yacht: ['yacht', 'motor yacht', 'superyacht', 'leisure', 'pleasure'],
    warship: ['warship', 'navy', 'naval', 'frigate', 'corvette', 'patrol', 'coast guard', 'coastguard', 'military', 'destroyer'],
    other: ['other', 'unknown'],
  },
  bowShape: {
    raked: ['raked', 'sloped', 'slanted', 'angled', 'normal'],
    vertical: ['vertical', 'straight', 'plumb', 'axe', 'x-bow', 'xbow', 'inverted'],
    bulbous: ['bulbous', 'bulb'],
    clipper: ['clipper', 'curved', 'spoon'],
    ramp: ['ramp', 'visor', 'door', 'flat'],
  },
  stern: {
    transom: ['transom', 'flat', 'square', 'straight'],
    rounded: ['rounded', 'round', 'cruiser', 'elliptical', 'canoe', 'counter'],
    ramp: ['ramp', 'door', 'open', 'slipway'],
  },
  bridge: {
    forward: ['forward', 'front', 'fore', 'bow'],
    middle: ['middle', 'midship', 'midships', 'amidships', 'centre', 'center'],
    aft: ['aft', 'rear', 'back', 'stern'],
  },
};

/** One of `field`'s answers for what the model wrote, or null: "Port side" is "side", "Ro-Pax" "ferry". */
export function enumValue(field, raw) {
  const s = String(raw ?? '').toLowerCase().replace(/[_]+/g, ' ').trim();
  if (!s && field !== 'bow') return null;
  const table = ENUMS[field];
  if (!table) return null;
  for (const [k, words] of Object.entries(table)) if (k === s || words.includes(s)) return k;
  // a longer answer naming one ("a side view of the ship"): the first word found, longest first
  const all = Object.entries(table).flatMap(([k, ws]) => [k, ...ws].map((w) => [w, k])).filter(([w]) => w.length > 2);
  all.sort((a, b) => b[0].length - a[0].length);
  for (const [w, k] of all) if (new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}([^a-z]|$)`).test(s)) return k;
  return null;
}

// ---------- colours ----------

const COLOURS = {
  white: '#f2f2ef', 'off-white': '#e9e6dc', cream: '#ece3c8', beige: '#d8ccaa', ivory: '#efeadb',
  black: '#1b1d20', grey: '#8c9196', gray: '#8c9196', 'light grey': '#c4c8cc', 'light gray': '#c4c8cc', 'dark grey': '#4a4f55', 'dark gray': '#4a4f55', silver: '#b9bec4', charcoal: '#36393d',
  red: '#b3261e', 'dark red': '#7d1d18', maroon: '#5e1a17', burgundy: '#5e1a24', orange: '#e0661b', 'dark orange': '#c45410', yellow: '#e7b416', gold: '#c99a2e', amber: '#e19a1b',
  green: '#2f7d3b', 'dark green': '#1e4d2b', 'light green': '#7cbf6e', olive: '#6b6b2a', teal: '#1f7f80', turquoise: '#2bb3b1',
  blue: '#1f5fa8', 'dark blue': '#16305a', navy: '#14284b', 'navy blue': '#14284b', 'light blue': '#79aedc', 'sky blue': '#79aedc', 'royal blue': '#2a4fb0', cyan: '#2fb4d6',
  brown: '#6d4a3a', 'dark brown': '#4a3226', tan: '#c0a27a', wood: '#9a6f45', teak: '#9a6f45',
  purple: '#5b3a8c', pink: '#d97aa5', magenta: '#b5338a', rust: '#8e4a24',
};

/** A colour as the model names it ("dark blue", "white and red", "#1f5fa8") as #rrggbb, or null. */
export function colourHex(raw) {
  const s = String(raw ?? '').toLowerCase().trim();
  if (!s) return null;
  const hex = s.match(/#([0-9a-f]{6}|[0-9a-f]{3})\b/);
  if (hex) return hex[1].length === 3 ? `#${[...hex[1]].map((c) => c + c).join('')}` : `#${hex[1]}`;
  // the first colour named: "dark blue with a white stripe" is dark blue
  let best = null;
  for (const name of Object.keys(COLOURS)) {
    const at = s.search(new RegExp(`(^|[^a-z])${name}([^a-z]|$)`));
    if (at < 0) continue;
    if (!best || at < best.at || (at === best.at && name.length > best.name.length)) best = { at, name };
  }
  return best ? COLOURS[best.name] : null;
}

// ---------- reading an answer ----------

/** The first {...} in a text (a model may wrap its JSON in ``` or words), parsed; null when none. */
export function jsonIn(text) {
  const s = String(text ?? '').replace(/<think>[\s\S]*?<\/think>/g, '');
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false, lastComma = -1;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return tryParse(s.slice(start, i + 1));
    else if (c === ',' && depth === 1) lastComma = i;
  }
  // cut short (out of tokens): what came before the last field begun, closed
  return tryParse(s.slice(start) + '}') ?? (lastComma > 0 ? tryParse(s.slice(start, lastComma) + '}') : null);
}

function tryParse(t) {
  try { return JSON.parse(t); } catch { /* try once more, tidied */ }
  try {
    return JSON.parse(t
      .replace(/,\s*([}\]])/g, '$1') // trailing commas
      .replace(/([{,]\s*)([A-Za-z_][\w-]*)\s*:/g, '$1"$2":') // bare keys
      .replace(/:\s*'([^']*)'/g, ': "$1"')); // single quotes
  } catch {
    return null;
  }
}

const count = (x, max) => {
  const n = typeof x === 'number' ? x : parseInt(String(x ?? '').match(/\d+/)?.[0] ?? '', 10);
  return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n) : null;
};
const cleanName = (s) => String(s ?? '').replace(/["'`]/g, '').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, 40);

/**
 * One photo's description from the model's answer: { view, bow, type, name, hull, superstructure,
 * funnel (#rrggbb), decks, funnels, masts, bowShape, stern, bridge }, each null when not said or not
 * understood. null when the answer has no JSON at all.
 */
export function parseDescription(text) {
  const j = jsonIn(text);
  if (!j || typeof j !== 'object') return null;
  const get = (...keys) => { for (const k of keys) if (j[k] !== undefined) return j[k]; return undefined; };
  const name = cleanName(get('name', 'vesselName', 'ship_name'));
  return {
    view: enumValue('view', get('view', 'camera', 'angle')),
    bow: enumValue('bow', get('bow', 'bowDirection', 'bow_direction', 'facing')) ?? 'unknown',
    type: enumValue('type', get('type', 'vesselType', 'ship_type', 'kind')),
    name: /^(EMPTY|NONE|UNKNOWN|N\/A|NOT VISIBLE|NO NAME|-)$/.test(name) ? '' : name,
    hull: colourHex(get('hull', 'hullColour', 'hullColor', 'hull_colour')),
    superstructure: colourHex(get('superstructure', 'superstructureColour', 'superstructureColor')),
    funnel: colourHex(get('funnel', 'funnelColour', 'funnelColor')),
    decks: count(get('decks', 'deckCount'), 16),
    funnels: count(get('funnels', 'funnelCount'), 6),
    masts: count(get('masts', 'mastCount'), 6),
    bowShape: enumValue('bowShape', get('bowShape', 'bow_shape', 'bowshape')),
    stern: enumValue('stern', get('stern', 'sternShape', 'stern_shape')),
    bridge: enumValue('bridge', get('bridge', 'bridgePosition', 'bridge_position')),
  };
}

// ---------- several photos: one vessel ----------

function vote(values) {
  const n = new Map();
  for (const v of values) if (v !== null && v !== undefined && v !== '' && v !== 'other' && v !== 'unknown') n.set(v, (n.get(v) ?? 0) + 1);
  let best = null, bn = 0;
  for (const [v, c] of n) if (c > bn) { best = v; bn = c; }
  return best;
}
const median = (xs) => {
  const s = xs.filter((x) => x !== null && x !== undefined).sort((a, b) => a - b);
  return s.length ? s[(s.length - 1) >> 1] : null;
};

/**
 * One description of the vessel from its photos' (null ones skipped): the answer most photos gave
 * for each thing, counts their median (a deck count from a side photo is worth more than one from
 * the bow, so side photos count twice), the name most often read (the longest of those).
 */
export function mergeDescriptions(list) {
  const ds = list.filter(Boolean);
  const weighted = ds.flatMap((d) => (d.view === 'side' ? [d, d] : [d]));
  const pick = (k) => vote(weighted.map((d) => d[k]));
  const names = ds.map((d) => d.name).filter(Boolean);
  const byName = new Map();
  for (const n of names) byName.set(n, (byName.get(n) ?? 0) + 1);
  const name = [...byName.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]?.[0] ?? '';
  return {
    type: pick('type'),
    name,
    hull: pick('hull'),
    superstructure: pick('superstructure'),
    funnel: pick('funnel'),
    decks: median(weighted.map((d) => d.decks)),
    funnels: median(weighted.map((d) => d.funnels)),
    masts: median(weighted.map((d) => d.masts)),
    bowShape: pick('bowShape'),
    stern: pick('stern'),
    bridge: pick('bridge'),
    photos: ds.length,
  };
}

// ---------- which view a photo is for ----------

/** The views a photo can be used as (photomodel.js's, and 'extra': colours and name only). */
export const SLOTS = [
  ['port', 'Port side (bow to the left)'],
  ['starboard', 'Starboard side (bow to the right)'],
  ['bow', 'Bow, from ahead'],
  ['stern', 'Stern, from astern'],
  ['top', 'From above'],
  ['extra', 'Other angle (colours only)'],
];

/**
 * The view a described photo is used as, and whether it is mirrored for photomodel.js's conventions.
 * Seen from the side, the bow to the left is the port side and to the right the starboard side,
 * whatever the model says the side is (which way the bow points is the easier thing to see). From
 * above, photomodel.js wants the bow to the right. `aspect` (width over height of the cut-out)
 * decides when the model said nothing: a long, low outline is a side.
 */
export function slotFor(d, aspect = 0) {
  const view = d?.view ?? (aspect > 2.2 ? 'side' : null);
  const bow = d?.bow ?? 'unknown';
  switch (view) {
    case 'side':
      return { slot: bow === 'left' ? 'port' : 'starboard', flip: false, guessed: bow !== 'left' && bow !== 'right' };
    case 'bow': return { slot: 'bow', flip: false };
    case 'stern': return { slot: 'stern', flip: false };
    case 'above': return { slot: 'top', flip: bow === 'left' };
    default: return { slot: 'extra', flip: false };
  }
}

/**
 * Of several photos for the same view, the one to carve with (the others still give colours): the
 * widest cut-out for the sides and above (the most of the ship in it, the least foreshortened).
 * `photos`: [{ slot, sil }]. Returns { [slot]: index }.
 */
export function bestPerSlot(photos) {
  const best = {};
  photos.forEach((p, i) => {
    if (!p?.sil || !p.slot || p.slot === 'extra') return;
    const w = (s) => (s.box.x1 - s.box.x0 + 1) / (s.box.y1 - s.box.y0 + 1);
    const cur = best[p.slot];
    if (cur === undefined || w(p.sil) > w(photos[cur].sil)) best[p.slot] = i;
  });
  return best;
}

// ---------- the vessel's kind and shape for ship.js ----------

/** presets.js's kinds for the model's types; passenger ships over 120 m are cruise ships. */
export function kindFor(type, length = 0, fallback = 'cargo') {
  switch (type) {
    case 'ferry': return 'ferry';
    case 'passenger': return length > 120 ? 'cruise' : 'ferry';
    case 'cruise': return length && length < 90 ? 'ferry' : 'cruise';
    case 'cargo': return 'cargo';
    case 'container': return 'container';
    case 'tanker': return 'tanker';
    case 'bulk': return 'bulk';
    case 'fishing': case 'tug': case 'offshore': return 'tug';
    case 'sailing': return 'sailing';
    case 'yacht': return 'yacht';
    case 'warship': return 'warship';
    default: return fallback;
  }
}
export const BOW_FOR = { raked: 'raked', vertical: 'vertical', bulbous: 'bulbous', clipper: 'clipper', ramp: 'vertical' };
export const STERN_FOR = { transom: 'transom', rounded: 'cruiser', ramp: 'transom' };

/** How wide the superstructure is, as a share of the beam, for the end views the photos lack. */
export const SUPERSTRUCTURE_WIDTH = {
  ferry: 0.92, cruise: 0.9, liner: 0.85, container: 0.95, cargo: 0.7, tanker: 0.72, bulk: 0.72,
  tug: 0.7, sailing: 0.3, yacht: 0.78, warship: 0.65, carrier: 0.4,
};

// ---------- colours from a cut-out photo ----------

const toHex = (r, g, b) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/**
 * The hull's and superstructure's colours in a side photo's cut-out: `img` { width, height, data
 * (RGBA) }, `sil` its silhouette (photomodel.js; same size), `hullTop` the share of the outline's
 * height (from the bottom) that is hull. The median colour of each band, from pixels well inside
 * the outline (its edges are often sky or sea). { hull, superstructure } as #rrggbb, null if none.
 */
export function bandColours(img, sil, hullTop = 0.3) {
  const { x0, y0, x1, y1 } = sil.box;
  const h = y1 - y0 + 1;
  const split = y1 - Math.round(h * hullTop);
  const bands = { hull: [[], [], []], superstructure: [[], [], []] };
  const W = sil.width;
  const step = Math.max(1, Math.round(Math.sqrt(((x1 - x0 + 1) * h) / 20000)));
  for (let y = y0 + 2; y <= y1 - 2; y += step) {
    for (let x = x0 + 2; x <= x1 - 2; x += step) {
      const i = y * W + x;
      // well inside: the pixels two away on all sides are ship too
      if (!sil.mask[i] || !sil.mask[i - 2] || !sil.mask[i + 2] || !sil.mask[i - 2 * W] || !sil.mask[i + 2 * W]) continue;
      const b = y > split ? bands.hull : bands.superstructure;
      b[0].push(img.data[i * 4]); b[1].push(img.data[i * 4 + 1]); b[2].push(img.data[i * 4 + 2]);
    }
  }
  const med = (a) => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
  const of = (b) => (b[0].length >= 12 ? toHex(med(b[0]), med(b[1]), med(b[2])) : null);
  return { hull: of(bands.hull), superstructure: of(bands.superstructure) };
}

/**
 * Where the hull ends and the superstructure starts in a side outline, as a share of its height from
 * the bottom (the waterline): the hull is the band of rows that run (nearly) the whole length; the
 * superstructure stands on it, shorter. Between 0.08 and 0.7; `fallback` when no such band is found.
 */
export function hullTopFromSide(sil, fallback = 0.3) {
  const { x0, y0, x1, y1 } = sil.box;
  const len = x1 - x0 + 1, h = y1 - y0 + 1;
  let top = -1;
  for (let y = y1; y >= y0; y--) {
    let first = -1, last = -1;
    for (let x = x0; x <= x1; x++) if (sil.mask[y * sil.width + x]) { if (first < 0) first = x; last = x; }
    if (first >= 0 && last - first + 1 >= len * 0.78) top = y;
    else if (top >= 0 && y < top - h * 0.03) break; // past the hull, and not a gap of a row or two
  }
  if (top < 0) return fallback;
  return Math.min(0.7, Math.max(0.08, (y1 - top + 1) / h));
}
