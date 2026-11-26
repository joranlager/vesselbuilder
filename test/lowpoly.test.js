import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLowPoly, shipPlan, lowPolyObj, beamAt, LOWPOLY_PROMPT } from '../public/ships/lowpoly.js';

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

/** The OBJ's vertices and faces, as each part has them. */
function readObj(text) {
  const v = [], parts = {};
  let cur = null;
  for (const line of text.split('\n')) {
    const [k, ...r] = line.trim().split(/\s+/);
    if (k === 'o') parts[(cur = r[0])] = [];
    else if (k === 'v') v.push(r.map(Number));
    else if (k === 'f') parts[cur].push(r.map((i) => Number(i) - 1));
  }
  return { v, parts };
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

test('the vision model\'s blocks are read forgivingly', () => {
  const p = parseLowPoly(ANSWER);
  assert.equal(p.bow, 'left');
  assert.deepEqual(p.hull, { height: 0.3, bowRake: 2, sternRake: 1 });
  assert.deepEqual(p.blocks.map((b) => b.part), ['superstructure', 'bridge', 'funnel', 'mast'], 'a block of no length is dropped; "Wheelhouse" is a bridge');
  assert.deepEqual(p.blocks[0], { part: 'superstructure', left: 0.2, right: 0.7, bottom: 0.3, top: 0.7 });
  assert.equal(p.blocks[3].left, 0.3, 'numbers as text');
  // swapped ends, out of range, cut short
  const q = parseLowPoly('{"hull": {"height": 14}, "blocks": [{"part": "bridge", "from": 8, "to": 6, "bottom": 9, "top": 5}, {"part": "crane", "from": 1, "to": 2, "top": 6}, {"part": "fun');
  assert.equal(q.hull.height, 0.8);
  assert.deepEqual(q.blocks[0], { part: 'bridge', left: 0.6, right: 0.8, bottom: 0.5, top: 0.9 });
  assert.equal(q.blocks[1].bottom, 0);
  assert.equal(parseLowPoly('I cannot tell'), null);
  assert.equal(parseLowPoly('{"view": "side"}'), null);
  assert.match(LOWPOLY_PROMPT, /blocks/);
});

test('the picture\'s left and right become stern and bow', () => {
  const p = parseLowPoly(ANSWER);
  const left = shipPlan(p, 'left'); // bow to the left: the left end is her bow (1)
  assert.deepEqual([left.blocks[0].a0, left.blocks[0].a1].map((x) => +x.toFixed(3)), [0.3, 0.8]);
  const right = shipPlan(p, 'right');
  assert.deepEqual([right.blocks[0].a0, right.blocks[0].a1], [0.2, 0.7]);
  assert.equal(shipPlan({ ...p, hull: { height: null, bowRake: null, sternRake: null } }, 'right', 0.25).hull.height, 0.25, 'the outline\'s hull height when the model gives none');
});

test('the plan becomes a closed low-poly OBJ in her frame', () => {
  const size = { L: 43, B: 11, H: 12, T: 3 };
  const r = lowPolyObj(shipPlan(parseLowPoly(ANSWER), 'left'), size, COLOURS);
  assert.deepEqual(r.parts, ['hull', 'superstructure_1', 'bridge_2', 'funnel_3', 'mast_4']);
  assert.ok(r.faces < 120, `low-poly: ${r.faces} faces`);
  assert.match(r.obj, /^mtllib lowpoly\.mtl$/m);
  const { v, parts } = readObj(r.obj);
  assert.equal(v.length, r.vertices);
  for (const p of v) {
    assert.ok(p[0] >= -size.L / 2 - 1e-6 && p[0] <= size.L / 2 + 1e-6, `x ${p[0]} within her length`);
    assert.ok(Math.abs(p[2]) <= size.B / 2 + 1e-6, `z ${p[2]} within her beam`);
    assert.ok(p[1] >= -size.T - 1e-6 && p[1] <= size.H + 1e-6, `y ${p[1]} from her keel to her top`);
  }
  for (const [name, faces] of Object.entries(parts)) assert.ok(volume(v, faces) > 0, `${name} winds outward`);
  // her deck at 30% of her height, the funnel to the top, nearer the stern than the bridge (bow to the left)
  assert.ok(Math.abs(Math.max(...parts.hull.flat().map((i) => v[i][1])) - 3.6) < 1e-6);
  const xs = (n) => parts[n].flat().map((i) => v[i][0]);
  assert.ok(Math.max(...xs('funnel_3')) < Math.min(...xs('bridge_2')), 'the funnel aft of the bridge');
  for (const m of ['hull', 'bottom', 'deck', 'superstructure', 'funnel', 'mast']) assert.match(r.mtl, new RegExp(`^newmtl ${m}$`, 'm'));
  assert.match(r.mtl, /^Kd 0\.122 0\.231 0\.361$/m, 'the hull\'s colour');
});

test('blocks stay inside her hull where it narrows to the bow', () => {
  const plan = { hull: { height: 0.3, bowRake: 1, sternRake: 0 }, blocks: [{ part: 'superstructure', a0: 0.85, a1: 0.99, bottom: 0.3, top: 0.6 }] };
  const r = lowPolyObj(plan, { L: 100, B: 20, H: 20, T: 5 }, COLOURS);
  const { v, parts } = readObj(r.obj);
  const z = Math.max(...parts.superstructure_1.flat().map((i) => Math.abs(v[i][2])));
  assert.ok(z <= 10 * beamAt(0.99) + 1e-6, `half-width ${z} inside the bow`);
  assert.equal(beamAt(1), 0);
  assert.equal(beamAt(0.4), 1);
});
