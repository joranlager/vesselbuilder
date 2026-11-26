// A vessel's first model: a detailed (high-poly) OBJ made from the structure the vision model (Qwen3.5,
// ai.js) sees in a photo of her side. The model is asked for her structure on a coarse grid (a small
// model names "about 3 of 10" far better than it writes vertices): how high her hull stands, how raked
// her bow and stern are, whether she has a bow at both ends (as many ferries do), and the blocks on her
// deck (superstructure, bridge, funnels, masts, cranes), measured across the photo from left to right.
// That plan is made here into a smooth hull lofted through many sections (sheer, a rounded bilge, a
// fine entrance at the bow, and at the stern too when she is double-ended), superstructure tiers with
// rounded corners that follow the hull's narrowing and carry a band of windows, oval funnels and round
// masts: an OBJ (with its MTL and smooth normals) in her frame, shown at once and refined after by
// carving the photos' outlines (vesselbuilder.js, photomodel.js). Pure, so it is unit tested.
//
// Her frame is Rudder's: bow +x, y up, starboard +z, metres, waterline y = 0, amidships x = 0.

import { jsonIn } from './vision.js';

/** The question asked about a photo of her side. */
export const BLOCKS_PROMPT = `This is a photo of a ship from the side. Describe her shape as simple blocks for a 3D model.
Measure across the photo from the left end of the ship (0) to the right end (10), and up from the waterline (0) to her highest point (10).
Reply with one JSON object and nothing else:
{"bow": "left" | "right" | "both",
 "hull": {"height": height of the hull's top edge, "bowRake": 0-3 how far the bow leans forward, "sternRake": 0-3},
 "blocks": [{"part": "superstructure" | "bridge" | "funnel" | "mast" | "crane" | "deckhouse" | "cargo", "from": left edge, "to": right edge, "bottom": 0-10, "top": 0-10}]}
"bow" is "both" when both ends of the ship are shaped like a bow (a double-ended ferry).
List each block on the deck once, biggest first, at most 10. Numbers 0 to 10.`;

const PARTS = {
  superstructure: ['superstructure', 'accommodation', 'house', 'cabin', 'decks', 'upper deck', 'passenger'],
  bridge: ['bridge', 'wheelhouse', 'pilothouse', 'navigation'],
  funnel: ['funnel', 'chimney', 'stack', 'smokestack', 'exhaust'],
  mast: ['mast', 'radar', 'antenna', 'pole', 'post'],
  crane: ['crane', 'derrick', 'boom', 'gantry'],
  deckhouse: ['deckhouse', 'deck house', 'hatch', 'casing', 'forecastle', 'poop'],
  cargo: ['cargo', 'container', 'containers', 'cars', 'trucks', 'tank', 'tanks', 'load'],
};
function partOf(raw) {
  const s = String(raw ?? '').toLowerCase().trim();
  for (const [k, ws] of Object.entries(PARTS)) if (k === s || ws.includes(s)) return k;
  for (const [k, ws] of Object.entries(PARTS)) if ([k, ...ws].some((w) => s.includes(w))) return k;
  return 'superstructure';
}

const grid = (v, max = 10) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').match(/-?\d+(\.\d+)?/)?.[0] ?? '');
  return Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : null;
};

/**
 * The vision model's plan, read: { bow: 'left'|'right'|null, doubleEnded, hull: { height, bowRake,
 * sternRake } (height a share of her height, rakes 0..3, null when not said), blocks: [{ part, left,
 * right, bottom, top }] (shares across the photo from the left, and of her height from the
 * waterline) }. null when the answer holds no plan.
 */
export function parseBlocks(text) {
  let j = jsonIn(text);
  if (!j) {
    // cut short in the list of blocks: the blocks written whole, the list and the answer closed
    const s = String(text ?? '');
    const end = s.lastIndexOf('}');
    if (end > 0) j = jsonIn(`${s.slice(0, end + 1)}]}`);
  }
  if (!j || typeof j !== 'object') return null;
  const h = j.hull && typeof j.hull === 'object' ? j.hull : {};
  const b0 = String(j.bow ?? '').toLowerCase();
  const doubleEnded = /\b(both|double|two|each)\b/.test(b0) || j.doubleEnded === true || /\b(both|double)\b/i.test(String(j.ends ?? ''));
  const bow = doubleEnded ? null : /\bleft\b/.test(b0) ? 'left' : /\bright\b/.test(b0) ? 'right' : null;
  const list = Array.isArray(j.blocks) ? j.blocks : Array.isArray(j.parts) ? j.parts : [];
  const blocks = [];
  for (const b of list) {
    if (!b || typeof b !== 'object') continue;
    let l = grid(b.from ?? b.left ?? b.start), r = grid(b.to ?? b.right ?? b.end);
    let lo = grid(b.bottom ?? b.base ?? 0), hi = grid(b.top ?? b.height);
    if (l === null || r === null || hi === null) continue;
    if (l > r) [l, r] = [r, l];
    if (lo > hi) [lo, hi] = [hi, lo];
    if (r - l < 0.1 || hi - lo < 0.1) continue;
    blocks.push({ part: partOf(b.part ?? b.type ?? b.name), left: l / 10, right: r / 10, bottom: lo / 10, top: hi / 10 });
    if (blocks.length >= 12) break;
  }
  const height = grid(h.height ?? h.top ?? j.hullHeight);
  if (height === null && !blocks.length) return null;
  return {
    bow,
    doubleEnded,
    hull: {
      height: height === null ? null : Math.min(0.8, Math.max(0.05, height / 10)),
      bowRake: grid(h.bowRake ?? h.bow_rake, 3),
      sternRake: grid(h.sternRake ?? h.stern_rake, 3),
    },
    blocks,
  };
}

/**
 * The plan along her length: `a` from the stern (0) to the bow (1), the picture's left and right
 * turned by which way her bow points in it ('left' or 'right'). `hullTop` stands in for a hull
 * height the model did not give; `doubleEnded` (from the photos' descriptions) for an answer that
 * did not say. A double-ended vessel has the same rake at both ends.
 */
export function shipPlan(plan, bow, hullTop = 0.3, doubleEnded = false) {
  const flip = bow === 'left';
  const along = (x) => (flip ? 1 - x : x);
  const dbl = Boolean(plan.doubleEnded || doubleEnded);
  const bowRake = plan.hull.bowRake ?? 1;
  return {
    doubleEnded: dbl,
    hull: {
      height: plan.hull.height ?? hullTop,
      bowRake: dbl ? Math.max(bowRake, plan.hull.sternRake ?? 0) : bowRake,
      sternRake: dbl ? Math.max(bowRake, plan.hull.sternRake ?? 0) : plan.hull.sternRake ?? 0.5,
    },
    blocks: plan.blocks.map((b) => {
      const [a0, a1] = [along(b.left), along(b.right)].sort((p, q) => p - q);
      return { part: b.part, a0, a1, bottom: b.bottom, top: b.top };
    }),
  };
}

// ---------- her hull ----------

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Her hull as a surface: { at(u, v) → [x, y, z] (u along her from the stern 0 to the bow 1, v up the
 * port side from the keel 0 to the deck 1), halfBeam(x, y), deck(x), ends: { stern, bow } }.
 * `entrance`: the share of her length her bow (and a double-ended stern) narrows over.
 */
export function hullShape({ L, B, T, D }, { bowRake = 1, sternRake = 0.5, doubleEnded = false, entrance = 0.28 } = {}) {
  const ends = (u) => Math.max(0, (u - 0.55) / 0.45) ** 2 + (doubleEnded ? Math.max(0, (0.45 - u) / 0.45) ** 2 : 0.3 * Math.max(0, (0.35 - u) / 0.35) ** 2);
  const deckY = (u) => D * (1 + 0.09 * ends(u)); // the sheer: her deck rises toward her ends
  // the keel: cut up under a transom stern (for her propellers), straight under a double-ender's
  const keelY = (u) => (doubleEnded ? -T : -T + T * 0.75 * Math.max(0, (0.09 - u) / 0.09) ** 1.6);
  const top = D * 1.09 + T;
  // where her ends are at a height: the stem leans forward with height (rake), and rounds at the forefoot
  const setback = (rake, y) => {
    const hn = clamp((y + T) / top, 0, 1);
    return L * ((0.015 + 0.025 * rake) * (1 - hn) ** 1.2 + 0.02 * (1 - clamp((y + T) / (T * 0.8), 0, 1)) ** 2.5);
  };
  const bowX = (y) => L / 2 - setback(bowRake, y);
  const sternX = (y) => (doubleEnded ? -L / 2 + setback(sternRake, y) : -L / 2 + L * 0.006 * sternRake * (1 - clamp((y + T) / top, 0, 1)));
  // her width along her, at a height: fine at the bow (fuller toward the deck: flare), a transom or a second bow aft
  const plan = (u, y) => {
    const above = clamp(y / Math.max(0.1, D), 0, 1.2);
    const fine = (t) => 1 - (1 - clamp(t, 0, 1)) ** (1.9 * (1 + 0.45 * above));
    if (u > 1 - entrance) return fine((1 - u) / entrance);
    if (doubleEnded && u < entrance) return fine(u / entrance);
    if (!doubleEnded && u < 0.16) {
      const w0 = y >= 0 ? 0.8 : 0.8 * clamp(1 + y / (T * 0.9), 0.1, 1);
      return w0 + (1 - w0) * (1 - (1 - u / 0.16) ** 2);
    }
    return 1;
  };
  // the section: straight sides above the water, round at the bilge, narrowing to the keel
  const section = (u, y) => {
    if (y >= 0) return 1;
    const k = keelY(u);
    const zn = clamp((y - k) / Math.max(0.05, -k), 0, 1);
    return (1 - (1 - zn) ** 3.5) ** (1 / 3.5);
  };
  const at = (u, v) => {
    const k = keelY(u);
    const y = k + v * (deckY(u) - k);
    const x0 = sternX(y), x1 = bowX(y);
    return [x0 + u * (x1 - x0), y, -(B / 2) * plan(u, y) * section(u, y)];
  };
  /** Her half-beam at x (metres) and height y. */
  const halfBeam = (x, y) => {
    const x0 = sternX(y), x1 = bowX(y);
    if (x <= x0 || x >= x1) return 0;
    const u = (x - x0) / (x1 - x0);
    return (B / 2) * plan(u, y) * section(u, y);
  };
  /** Her deck's height at x. */
  const deck = (x) => deckY(clamp((x + L / 2) / L, 0, 1));
  return { at, halfBeam, deck, doubleEnded };
}

// ---------- OBJ ----------

/**
 * A loft: closed rings of points (each the same count, going round), faced between each ring and the
 * next, and capped at its ends (`caps`: the materials of the first and last caps, or null for none).
 * `mat(i, k)`: the material of the face from ring i, point k. Faces wind outward (by its volume).
 */
function loft(rings, mat, caps = [null, null]) {
  const n = rings[0].length;
  const points = rings.flat();
  const id = (i, k) => i * n + (k % n);
  const faces = [];
  for (let i = 0; i < rings.length - 1; i++) {
    for (let k = 0; k < n; k++) faces.push({ mat: mat(i, k), group: mat(i, k), idx: [id(i, k), id(i + 1, k), id(i + 1, k + 1), id(i, k + 1)] });
  }
  // caps wound to match: the first ring as it goes, the last reversed
  if (caps[0]) faces.push({ mat: caps[0], group: 'cap0', idx: rings[0].map((_, k) => id(0, k)) });
  if (caps[1]) faces.push({ mat: caps[1], group: 'cap1', idx: rings.at(-1).map((_, k) => id(rings.length - 1, k)).reverse() });
  const live = faces.filter((f) => area(points, f.idx) > 1e-9);
  if (volume(points, live) < 0) for (const f of live) f.idx.reverse();
  return { points, faces: live };
}

function newell(points, idx) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < idx.length; i++) {
    const p = points[idx[i]], q = points[idx[(i + 1) % idx.length]];
    nx += (p[1] - q[1]) * (p[2] + q[2]); ny += (p[2] - q[2]) * (p[0] + q[0]); nz += (p[0] - q[0]) * (p[1] + q[1]);
  }
  return [nx, ny, nz];
}
const area = (points, idx) => Math.hypot(...newell(points, idx)) / 2;
function volume(points, faces) {
  let s = 0;
  for (const f of faces) for (let i = 1; i < f.idx.length - 1; i++) {
    const a = points[f.idx[0]], b = points[f.idx[i]], c = points[f.idx[i + 1]];
    s += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return s;
}

/** A rounded rectangle in plan, going round: x0..x1 along her, ±hw across, corners of radius r. */
function roundedRect(x0, x1, hw, r, seg = 6) {
  const out = [];
  const c = [[x1 - r, hw - r, 0], [x0 + r, hw - r, Math.PI / 2], [x0 + r, -hw + r, Math.PI], [x1 - r, -hw + r, 1.5 * Math.PI]];
  for (const [cx, cz, a0] of c) for (let s = 0; s <= seg; s++) {
    const a = a0 + (s / seg) * (Math.PI / 2);
    out.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]);
  }
  return out;
}
/** An ellipse in plan, going round. */
const ellipse = (cx, rx, rz, seg) => Array.from({ length: seg }, (_, s) => {
  const a = (s / seg) * 2 * Math.PI;
  return [cx + rx * Math.cos(a), rz * Math.sin(a)];
});

/** How wide each kind of block is, as a share of the beam where it stands. */
const WIDTH = { superstructure: 0.9, bridge: 0.98, funnel: 0.16, mast: 0.05, crane: 0.12, deckhouse: 0.7, cargo: 0.86 };
/** Where its band of windows is, as shares of its height, for the blocks that have one. */
const WINDOWS = { superstructure: [0.45, 0.75], bridge: [0.5, 0.85], deckhouse: [0.5, 0.75] };

/**
 * The OBJ and its MTL for her plan (shipPlan) at her size: `size` { L, B, H (above the waterline), T
 * (draught) } in metres, `colours` { hull, superstructure, funnel, deck, bootTop } as #rrggbb, and
 * `superstructureWidth` (a share of the beam) for her kind, `detail` the sections along her hull
 * (96 makes some 8000 triangles). Faces wind outward; normals are smooth within each material and
 * sharp between them. Returns { obj, mtl, vertices, faces, parts }.
 */
export function blockModelObj(plan, size, colours, { superstructureWidth = 0.9, mtlName = 'vessel.mtl', detail = 96 } = {}) {
  const { L, B, H, T } = size;
  const D = Math.max(0.3, plan.hull.height * H); // her deck amidships, above the waterline
  const hull = hullShape({ L, B, T, D }, { ...plan.hull, doubleEnded: plan.doubleEnded });
  const solids = [];

  // the hull: a ring round each section (up the port side, down the starboard, across her deck)
  const NU = Math.max(12, Math.round(detail)), NV = Math.max(6, Math.round(detail / 5));
  const rings = [];
  for (let i = 0; i <= NU; i++) {
    const u = i / NU;
    const port = [];
    for (let j = NV; j >= 0; j--) port.push(hull.at(u, j / NV)); // deck to keel
    const stbd = port.slice(0, -1).reverse().map(([x, y, z]) => [x, y, -z]); // keel to deck
    rings.push([...port, ...stbd]);
  }
  const R = 2 * NV + 1;
  solids.push(['hull', loft(rings, (i, k) => {
    if (k === R - 1) return 'deck'; // the last point, starboard at the deck, back to the first: her deck
    const y = (rings[i][k][1] + rings[i][(k + 1) % R][1] + rings[i + 1][k][1]) / 3;
    return y < 0 ? 'bottom' : 'hull';
  }, [plan.doubleEnded ? null : 'hull', null])]);

  // the blocks on her deck
  const roomAt = (x, y) => hull.halfBeam(x, Math.min(y, D)) * 0.97;
  plan.blocks.forEach((b, i) => {
    const a0 = clamp(b.a0, 0.01, 0.99), a1 = clamp(b.a1, 0.01, 0.99);
    if (a1 - a0 < 0.004) return;
    let x0 = a0 * L - L / 2, x1 = a1 * L - L / 2;
    const footDeck = Math.min(hull.deck(x0), hull.deck(x1));
    const y0 = Math.max(footDeck - 0.1, b.bottom * H), y1 = Math.max(y0 + 0.3, b.top * H);
    const room = Math.min(roomAt(x0, footDeck), roomAt(x1, footDeck), roomAt((x0 + x1) / 2, footDeck));
    if (room <= 0.05) return;
    const share = b.part === 'superstructure' ? superstructureWidth : WIDTH[b.part] ?? 0.8;
    const hw = Math.max(0.06, Math.min(room, (B / 2) * share));
    const name = `${b.part}_${i + 1}`;
    if (b.part === 'funnel' || b.part === 'mast' || b.part === 'crane') {
      // round: oval funnels, round masts and crane pedestals, narrowing a little toward the top
      const cx = (x0 + x1) / 2;
      const rx = b.part === 'funnel' ? Math.max(0.15, Math.min((x1 - x0) / 2, hw * 2.2)) : Math.max(0.06, Math.min((x1 - x0) / 2, 0.35));
      const rz = b.part === 'funnel' ? Math.min(hw, rx * 0.75) : rx;
      const seg = b.part === 'funnel' ? 32 : 16;
      const heights = b.part === 'funnel' ? [y0, y1 - (y1 - y0) * 0.14, y1] : [y0, y1];
      const taper = b.part === 'funnel' ? 0.88 : 0.6;
      const rs = heights.map((y) => {
        const k = 1 - (1 - taper) * ((y - y0) / (y1 - y0));
        return ellipse(cx, rx * k, rz * k, seg).map(([x, z]) => [x, y, z]);
      });
      const m = b.part === 'funnel' ? (i2) => (i2 === 1 ? 'funnelTop' : 'funnel') : () => 'mast';
      solids.push([name, loft(rs, (i2) => m(i2), [m(0), m(heights.length - 2)])]);
      return;
    }
    // a tier with rounded corners: kept inside her hull where it narrows, its band of windows round it
    const r = Math.min(hw * 0.35, (x1 - x0) * 0.22);
    const outline = roundedRect(x0, x1, hw, r).map(([x, z]) => [x, Math.sign(z) * Math.min(Math.abs(z), Math.max(0.05, roomAt(x, footDeck)))]);
    const win = WINDOWS[b.part];
    const hs = win ? [y0, y0 + (y1 - y0) * win[0], y0 + (y1 - y0) * win[1], y1] : [y0, y1];
    const rs = hs.map((y) => outline.map(([x, z]) => [x, y, z]));
    const m = b.part === 'cargo' ? 'cargo' : 'superstructure';
    solids.push([name, loft(rs, (i2) => (win && i2 === 1 ? 'windows' : m), [m, m])]);
  });

  // written out: vertices, normals smooth within a material (or a cap), faces
  const lines = [`# Vessel from the vision model's plan (vessel builder). Bow +x, y up, starboard +z, metres, waterline y = 0.`, `mtllib ${mtlName}`];
  const vn = [];
  let vBase = 0, faceCount = 0;
  for (const [name, s] of solids) {
    lines.push(`o ${name}`);
    for (const p of s.points) lines.push(`v ${p.map((n) => +n.toFixed(4)).join(' ')}`);
    // each point's normal in each smoothing group: the sum of its faces' (area-weighted) normals
    const normals = new Map();
    for (const f of s.faces) {
      const n = newell(s.points, f.idx);
      for (const i of f.idx) {
        const key = `${i}|${f.group}`;
        const a = normals.get(key) ?? [0, 0, 0];
        normals.set(key, [a[0] + n[0], a[1] + n[1], a[2] + n[2]]);
      }
    }
    const nIndex = new Map();
    for (const [key, n] of normals) {
      const l = Math.hypot(...n) || 1;
      vn.push(n.map((c) => +(c / l).toFixed(4)));
      lines.push(`vn ${vn.at(-1).join(' ')}`);
      nIndex.set(key, vn.length);
    }
    let mat = null;
    for (const f of s.faces) {
      if (f.mat !== mat) { lines.push(`usemtl ${f.mat}`); mat = f.mat; }
      lines.push(`f ${f.idx.map((i) => `${vBase + i + 1}//${nIndex.get(`${i}|${f.group}`)}`).join(' ')}`);
      faceCount++;
    }
    vBase += s.points.length;
  }

  const rgb = (hex) => {
    const h = String(hex ?? '#888888').replace('#', '');
    return [0, 2, 4].map((i) => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ');
  };
  const mats = {
    hull: colours.hull, bottom: colours.bootTop, deck: colours.deck, superstructure: colours.superstructure,
    windows: '#1b2a38', funnel: colours.funnel, funnelTop: '#1b1d20', mast: colours.superstructure, cargo: colours.deck,
  };
  const mtl = ['# Colours of the vessel (vessel builder)'];
  for (const [k, c] of Object.entries(mats)) mtl.push('', `newmtl ${k}`, `Kd ${rgb(c)}`, 'Ka 0 0 0', `Ks ${k === 'windows' ? '0.4 0.4 0.4' : '0.05 0.05 0.05'}`, `Ns ${k === 'windows' ? 60 : 10}`, 'd 1', 'illum 2');
  return { obj: lines.join('\n') + '\n', mtl: mtl.join('\n') + '\n', vertices: vBase, faces: faceCount, parts: solids.map(([n]) => n) };
}
