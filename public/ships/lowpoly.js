// A vessel's first model: a low-poly OBJ of the blocks the vision model (Qwen3.5, ai.js) sees in a
// photo of her side. The model is asked for her structure on a coarse grid (a small model names
// "about 3 of 10" far better than it writes vertices): how high her hull stands, how raked her bow
// and stern are, and the blocks on her deck (superstructure, bridge, funnels, masts, cranes),
// measured across the photo from left to right. That plan is turned into an OBJ (and its MTL) in
// her frame here, shown at once, and refined after by carving the photos' outlines
// (vesselbuilder.js, photomodel.js). Pure, so it is unit tested.
//
// Her frame is Rudder's: bow +x, y up, starboard +z, metres, waterline y = 0, amidships x = 0.

import { jsonIn } from './vision.js';

/** The question asked about a photo of her side. */
export const LOWPOLY_PROMPT = `This is a photo of a ship from the side. Describe her shape as a few simple blocks for a low-poly 3D model.
Measure across the photo from the left end of the ship (0) to the right end (10), and up from the waterline (0) to her highest point (10).
Reply with one JSON object and nothing else:
{"bow": "left" | "right",
 "hull": {"height": height of the hull's top edge, "bowRake": 0-3 how far the bow leans forward, "sternRake": 0-3},
 "blocks": [{"part": "superstructure" | "bridge" | "funnel" | "mast" | "crane" | "deckhouse" | "cargo", "from": left edge, "to": right edge, "bottom": 0-10, "top": 0-10}]}
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
 * The vision model's plan, read: { bow: 'left'|'right'|null, hull: { height, bowRake, sternRake }
 * (height a share of her height, rakes 0..3, null when not said), blocks: [{ part, left, right,
 * bottom, top }] (shares across the photo from the left, and of her height from the waterline) }.
 * null when the answer holds no plan.
 */
export function parseLowPoly(text) {
  let j = jsonIn(text);
  if (!j) {
    // cut short in the list of blocks: the blocks written whole, the list and the answer closed
    const s = String(text ?? '');
    const end = s.lastIndexOf('}');
    if (end > 0) j = jsonIn(`${s.slice(0, end + 1)}]}`);
  }
  if (!j || typeof j !== 'object') return null;
  const h = j.hull && typeof j.hull === 'object' ? j.hull : {};
  const bow = /\bleft\b/i.test(String(j.bow ?? '')) ? 'left' : /\bright\b/i.test(String(j.bow ?? '')) ? 'right' : null;
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
 * height the model did not give.
 */
export function shipPlan(plan, bow, hullTop = 0.3) {
  const flip = bow === 'left';
  const along = (x) => (flip ? 1 - x : x);
  return {
    hull: {
      height: plan.hull.height ?? hullTop,
      bowRake: plan.hull.bowRake ?? 1,
      sternRake: plan.hull.sternRake ?? 0.5,
    },
    blocks: plan.blocks.map((b) => {
      const [a0, a1] = [along(b.left), along(b.right)].sort((p, q) => p - q);
      return { part: b.part, a0, a1, bottom: b.bottom, top: b.top };
    }),
  };
}

// Her plan from above, stern (0) to bow (1): the share of her half-beam at stations along her length.
const STATIONS = [[0, 0.84], [0.1, 0.96], [0.25, 1], [0.6, 1], [0.8, 0.86], [0.92, 0.5], [1, 0]];
/** Her half-beam's share at `a` along her length. */
export function beamAt(a) {
  const x = Math.min(1, Math.max(0, a));
  for (let i = 1; i < STATIONS.length; i++) {
    const [a1, w1] = STATIONS[i];
    if (x <= a1) {
      const [a0, w0] = STATIONS[i - 1];
      return w0 + ((x - a0) / (a1 - a0)) * (w1 - w0);
    }
  }
  return 0;
}

/** How wide each kind of block is, as a share of the beam where it stands. */
const WIDTH = { superstructure: 0.9, bridge: 0.98, funnel: 0.16, mast: 0.05, crane: 0.12, deckhouse: 0.7, cargo: 0.86 };
const MATERIAL = { superstructure: 'superstructure', bridge: 'superstructure', deckhouse: 'superstructure', funnel: 'funnel', mast: 'mast', crane: 'mast', cargo: 'cargo' };

/**
 * The OBJ and its MTL for her plan (shipPlan) at her size: `size` { L, B, H (above the waterline), T
 * (draught) } in metres, `colours` { hull, superstructure, funnel, deck, bootTop } as #rrggbb, and
 * `superstructureWidth` (a share of the beam) for her kind. Faces wind outward. Returns { obj, mtl,
 * vertices, faces, parts }.
 */
export function lowPolyObj(plan, size, colours, { superstructureWidth = 0.9, mtlName = 'lowpoly.mtl' } = {}) {
  const { L, B, H, T } = size;
  const D = Math.max(0.3, plan.hull.height * H); // her deck, above the waterline
  const v = []; // [x, y, z]
  const lines = [`# Low-poly vessel from the vision model's plan (vessel builder). Bow +x, y up, starboard +z, metres, waterline y = 0.`, `mtllib ${mtlName}`];
  let faces = 0;
  const parts = [];
  const X = (a) => a * L - L / 2;

  // a part: its vertices, then its faces, each wound so its normal points away from the part's middle
  function part(name, points, polys) {
    parts.push(name);
    const base = v.length;
    v.push(...points);
    const c = points.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]).map((s) => s / points.length);
    lines.push(`o ${name}`);
    for (const p of points) lines.push(`v ${p.map((n) => +n.toFixed(3)).join(' ')}`);
    let mat = null;
    for (const [m, idx] of polys) {
      const ps = idx.map((i) => points[i]);
      // Newell's normal of the polygon, against the way out from the middle
      let nx = 0, ny = 0, nz = 0;
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i], q = ps[(i + 1) % ps.length];
        nx += (p[1] - q[1]) * (p[2] + q[2]); ny += (p[2] - q[2]) * (p[0] + q[0]); nz += (p[0] - q[0]) * (p[1] + q[1]);
      }
      if (Math.hypot(nx, ny, nz) < 1e-9) continue; // a face drawn to a point (her stem)
      const f = ps.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]).map((s) => s / ps.length);
      const out = nx * (f[0] - c[0]) + ny * (f[1] - c[1]) + nz * (f[2] - c[2]) >= 0;
      const order = out ? idx : [...idx].reverse();
      if (m !== mat) { lines.push(`usemtl ${m}`); mat = m; }
      lines.push(`f ${order.map((i) => base + i + 1).join(' ')}`);
      faces++;
    }
  }

  // the hull: a section at each station, from her deck down past the waterline to the keel
  const n = STATIONS.length;
  const ring = 7;
  const hullPts = [];
  for (const [a, w] of STATIONS) {
    const hb = (B / 2) * w;
    // the stem and the stern lean out at the top (rake): the deck reaches the ends, the keel does not
    const lean = a === 1 ? -plan.hull.bowRake * 0.025 * L : a === 0 ? plan.hull.sternRake * 0.02 * L : 0;
    const x = (y) => X(a) + lean * ((D - y) / (D + T));
    hullPts.push(
      [x(D), D, -hb], [x(0), 0, -hb], [x(-T * 0.7), -T * 0.7, -hb * 0.8], [x(-T), -T, 0],
      [x(-T * 0.7), -T * 0.7, hb * 0.8], [x(0), 0, hb], [x(D), D, hb],
    );
  }
  const P = (s, k) => s * ring + k;
  const hullPolys = [];
  const band = ['hull', 'bottom', 'bottom', 'bottom', 'bottom', 'hull'];
  for (let s = 0; s < n - 1; s++) {
    for (let k = 0; k < ring - 1; k++) hullPolys.push([band[k], [P(s, k), P(s + 1, k), P(s + 1, k + 1), P(s, k + 1)]]);
    hullPolys.push(['deck', [P(s, 6), P(s + 1, 6), P(s + 1, 0), P(s, 0)]]);
  }
  hullPolys.push(['hull', [0, 1, 5, 6].map((k) => P(0, k))]); // the transom above the water
  hullPolys.push(['bottom', [1, 2, 3, 4, 5].map((k) => P(0, k))]); // and below it
  part('hull', hullPts, hullPolys);

  // the blocks on her deck: boxes as wide as their kind, inside her hull's plan where they stand
  plan.blocks.forEach((b, i) => {
    const a0 = Math.max(0.005, b.a0), a1 = Math.min(0.995, b.a1);
    if (a1 - a0 < 0.004) return;
    const room = Math.min(beamAt(a0), beamAt(a1), beamAt((a0 + a1) / 2)) * (B / 2);
    const share = b.part === 'superstructure' ? superstructureWidth : WIDTH[b.part] ?? 0.8;
    const hw = Math.max(0.05, Math.min(room * 0.98, (B / 2) * share));
    // a block stands on her deck at least; masts and funnels are made no thinner than they are long
    const y0 = Math.max(D - 0.05, b.bottom * H), y1 = Math.max(y0 + 0.2, b.top * H);
    let x0 = X(a0), x1 = X(a1);
    if (b.part === 'mast' || b.part === 'funnel' || b.part === 'crane') {
      const m = (x0 + x1) / 2, half = Math.max((x1 - x0) / 2, 0.05);
      x0 = m - Math.min(half, hw * 2.5);
      x1 = m + Math.min(half, hw * 2.5);
    }
    // funnels and masts narrow a little toward the top
    const t = b.part === 'funnel' || b.part === 'mast' ? 0.8 : 1;
    const box = [
      [x0, y0, -hw], [x1, y0, -hw], [x1, y0, hw], [x0, y0, hw],
      [x0 + (x1 - x0) * (1 - t) / 2, y1, -hw * t], [x1 - (x1 - x0) * (1 - t) / 2, y1, -hw * t], [x1 - (x1 - x0) * (1 - t) / 2, y1, hw * t], [x0 + (x1 - x0) * (1 - t) / 2, y1, hw * t],
    ];
    const m = MATERIAL[b.part] ?? 'superstructure';
    part(`${b.part}_${i + 1}`, box, [
      [m, [0, 1, 2, 3]], [m, [4, 5, 6, 7]], [m, [0, 1, 5, 4]], [m, [1, 2, 6, 5]], [m, [2, 3, 7, 6]], [m, [3, 0, 4, 7]],
    ]);
  });

  const rgb = (hex) => {
    const h = String(hex ?? '#888888').replace('#', '');
    return [0, 2, 4].map((i) => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ');
  };
  const mats = {
    hull: colours.hull, bottom: colours.bootTop, deck: colours.deck, superstructure: colours.superstructure,
    funnel: colours.funnel, mast: colours.superstructure, cargo: colours.deck,
  };
  const mtl = ['# Colours of the low-poly vessel (vessel builder)'];
  for (const [k, c] of Object.entries(mats)) mtl.push('', `newmtl ${k}`, `Kd ${rgb(c)}`, 'Ka 0 0 0', 'Ks 0.05 0.05 0.05', 'Ns 10', 'd 1', 'illum 2');
  return { obj: lines.join('\n') + '\n', mtl: mtl.join('\n') + '\n', vertices: v.length, faces, parts };
}
