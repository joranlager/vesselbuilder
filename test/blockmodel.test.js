import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBlocks, shipPlan, blockModelObj, hullShape, BLOCKS_PROMPT } from '../public/ships/blockmodel.js';

const ANSWER = `\`\`\`json
{"bow": "left",
 "hull": {"height": 3, "bowRake": 2, "sternRake": 1},
 "blocks": [
  {"part": "superstructure", "from": 2, "to": 7, "bottom": 3, "top": 7},
  {"part": "Wheelhouse", "from": 2.5, "to": 4, "bottom": 7, "top": 8.5},
  {"part": "funnel", "from": 6, "to": 6.8, "bottom": 7, "top": 10},
  {"part": "mast", "from": "3", "to": "3.2", "bottom": 8.5, "top": 9.8},
  {"part": "nothing", "from": 5, "to": 5, "bottom": 1, "top": 2}
 ]}
\`\`\``;

const COLOURS = { hull: '#1f3b5c', superstructure: '#f2f2ef', funnel: '#e7b416', deck: '#a0a4a8', bootTop: '#8e2a22' };
const SIZE = { L: 43, B: 11, H: 12, T: 3 };

/** The OBJ's vertices, normals and faces (vertex indices), as each part has them. */
function readObj(text) {
  const v = [], vn = [], parts = {};
  let cur = null;
  for (const line of text.split('\n')) {
    const [k, ...r] = line.trim().split(/\s+/);
    if (k === 'o') parts[(cur = r[0])] = [];
    else if (k === 'v') v.push(r.map(Number));
    else if (k === 'vn') vn.push(r.map(Number));
    else if (k === 'f') parts[cur].push(r.map((i) => Number(i.split('/')[0]) - 1));
  }
  return { v, vn, parts };
}
/** A closed part's volume from its faces (fanned into triangles): positive when they wind outward. */
function volume(v, faces) {
  let s = 0;
  for (const f of faces) for (let i = 1; i < f.length - 1; i++) {
    const [a, b, c] = [v[f[0]], v[f[i]], v[f[i + 1]]];
    s += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return s;
}
/**
 * Each edge of a closed surface is walked once each way, its points taken by where they are (the
 * stem's port and starboard sides end on points of their own, for a sharp edge there).
 */
function closed(faces, v) {
  const at = (i) => v[i].map((c) => c.toFixed(3)).join(',');
  const edges = new Map();
  for (const f of faces) for (let i = 0; i < f.length; i++) {
    const a = at(f[i]), b = at(f[(i + 1) % f.length]);
    if (a === b) continue;
    edges.set(`${a}>${b}`, (edges.get(`${a}>${b}`) ?? 0) + 1);
  }
  for (const [e, n] of edges) {
    const [a, b] = e.split('>');
    if (n !== 1 || edges.get(`${b}>${a}`) !== 1) return false;
  }
  return true;
}

test('the vision model\'s blocks are read forgivingly', () => {
  const p = parseBlocks(ANSWER);
  assert.equal(p.bow, 'left');
  assert.equal(p.doubleEnded, false);
  assert.deepEqual(p.hull, { height: 0.3, bowRake: 2, sternRake: 1 });
  assert.deepEqual(p.blocks.map((b) => b.part), ['superstructure', 'bridge', 'funnel', 'mast'], 'a block of no length is dropped; "Wheelhouse" is a bridge');
  assert.deepEqual(p.blocks[0], { part: 'superstructure', left: 0.2, right: 0.7, bottom: 0.3, top: 0.7 });
  assert.equal(p.blocks[3].left, 0.3, 'numbers as text');
  // swapped ends, out of range, cut short
  const q = parseBlocks('{"hull": {"height": 14}, "blocks": [{"part": "bridge", "from": 8, "to": 6, "bottom": 9, "top": 5}, {"part": "crane", "from": 1, "to": 2, "top": 6}, {"part": "fun');
  assert.equal(q.hull.height, 0.8);
  assert.deepEqual(q.blocks[0], { part: 'bridge', left: 0.6, right: 0.8, bottom: 0.5, top: 0.9 });
  assert.equal(q.blocks[1].bottom, 0);
  assert.equal(parseBlocks('I cannot tell'), null);
  assert.equal(parseBlocks('{"view": "side"}'), null);
  assert.match(BLOCKS_PROMPT, /both/);
});

test('a bow at both ends', () => {
  const p = parseBlocks('{"bow": "both", "hull": {"height": 3, "bowRake": 2, "sternRake": 0}, "blocks": []}');
  assert.equal(p.doubleEnded, true);
  assert.equal(p.bow, null);
  const s = shipPlan(p, 'right');
  assert.equal(s.doubleEnded, true);
  assert.deepEqual([s.hull.bowRake, s.hull.sternRake], [2, 2], 'the same rake at both ends');
  assert.equal(shipPlan(parseBlocks(ANSWER), 'left', 0.3, true).doubleEnded, true, 'or from the photos\' descriptions');
});

test('the picture\'s left and right become stern and bow', () => {
  const p = parseBlocks(ANSWER);
  const left = shipPlan(p, 'left'); // bow to the left: the left end is her bow (1)
  assert.deepEqual([left.blocks[0].a0, left.blocks[0].a1].map((x) => +x.toFixed(3)), [0.3, 0.8]);
  const right = shipPlan(p, 'right');
  assert.deepEqual([right.blocks[0].a0, right.blocks[0].a1], [0.2, 0.7]);
  assert.equal(shipPlan({ ...p, hull: { height: null, bowRake: null, sternRake: null } }, 'right', 0.25).hull.height, 0.25, 'the outline\'s hull height when the model gives none');
});

test('the plan becomes a detailed, closed OBJ in her frame', () => {
  const r = blockModelObj(shipPlan(parseBlocks(ANSWER), 'left'), SIZE, COLOURS);
  assert.deepEqual(r.parts, ['hull', 'superstructure_1', 'bridge_2', 'funnel_3', 'mast_4']);
  assert.ok(r.faces > 3000, `high-poly: ${r.faces} faces`);
  assert.match(r.obj, /^mtllib vessel\.mtl$/m);
  const { v, vn, parts } = readObj(r.obj);
  assert.equal(v.length, r.vertices);
  assert.ok(vn.length > 0 && vn.every((n) => Math.abs(Math.hypot(...n) - 1) < 1e-3), 'unit normals');
  for (const p of v) {
    assert.ok(p[0] >= -SIZE.L / 2 - 1e-6 && p[0] <= SIZE.L / 2 + 1e-6, `x ${p[0]} within her length`);
    assert.ok(Math.abs(p[2]) <= SIZE.B / 2 + 1e-6, `z ${p[2]} within her beam`);
    assert.ok(p[1] >= -SIZE.T - 1e-6 && p[1] <= SIZE.H + 1e-6, `y ${p[1]} from her keel to her top`);
  }
  for (const [name, faces] of Object.entries(parts)) {
    assert.ok(volume(v, faces) > 0, `${name} winds outward`);
    assert.ok(closed(faces, v), `${name} is closed`);
  }
  const xs = (n) => parts[n].flat().map((i) => v[i][0]);
  assert.ok(Math.max(...xs('funnel_3')) < Math.min(...xs('bridge_2')), 'the funnel aft of the bridge');
  for (const m of ['hull', 'bottom', 'deck', 'superstructure', 'windows', 'funnel', 'funnelTop', 'mast']) assert.match(r.mtl, new RegExp(`^newmtl ${m}$`, 'm'));
  assert.match(r.mtl, /^Kd 0\.122 0\.231 0\.361$/m, 'the hull\'s colour');
  assert.ok(blockModelObj(shipPlan(parseBlocks(ANSWER), 'left'), SIZE, COLOURS, { detail: 24 }).faces < r.faces / 3, 'detail sets the sections');
});

test('a double-ended hull is fine at both ends; a transom stern is wide', () => {
  const dims = { L: 100, B: 20, T: 4, D: 6 };
  const dbl = hullShape(dims, { bowRake: 2, sternRake: 2, doubleEnded: true });
  const one = hullShape(dims, { bowRake: 2, sternRake: 0.5 });
  const width = (h, x) => h.halfBeam(x, 2);
  assert.ok(Math.abs(width(dbl, -45) - width(dbl, 45)) < 0.05, 'the same at both ends');
  assert.ok(width(dbl, -48) < 3, 'fine aft');
  assert.ok(width(one, -48) > 7, 'a transom aft');
  assert.ok(width(one, 48) < 3, 'fine forward');
  assert.equal(width(one, 0), 10);
  const r = blockModelObj({ doubleEnded: true, hull: { height: 0.3, bowRake: 2, sternRake: 2 }, blocks: [] }, { L: 100, B: 20, H: 20, T: 4 }, COLOURS);
  const { v, parts } = readObj(r.obj);
  assert.ok(volume(v, parts.hull) > 0 && closed(parts.hull, v), 'closed without a transom');
});

test('blocks stay inside her hull where it narrows to the bow', () => {
  const plan = { hull: { height: 0.3, bowRake: 1, sternRake: 0 }, blocks: [{ part: 'superstructure', a0: 0.85, a1: 0.97, bottom: 0.3, top: 0.6 }] };
  const size = { L: 100, B: 20, H: 20, T: 5 };
  const r = blockModelObj(plan, size, COLOURS);
  const { v, parts } = readObj(r.obj);
  const hull = hullShape({ L: 100, B: 20, T: 5, D: 6 }, plan.hull);
  for (const i of parts.superstructure_1.flat()) assert.ok(Math.abs(v[i][2]) <= hull.halfBeam(v[i][0], 6) + 1e-3, `inside her at x ${v[i][0].toFixed(1)}`);
});
