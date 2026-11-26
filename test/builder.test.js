import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  enumValue, colourHex, jsonIn, bowFrom, bowVote, BOW_PROMPTS, parseDescription, mergeDescriptions, slotFor, kindFor, bandColours, hullTopFromSide, PROMPT,
} from '../public/ships/vision.js';
import { planShape, planSilhouette, endSilhouette, sectionWidth, halfBeamFromPlan, mix } from '../public/ships/synthviews.js';
import { carve, mesh, sizeFrom, inside } from '../public/ships/photomodel.js';
import {
  repoFromLocation, branchFromBuild, vesselFileBase, indexWith, base64, commitVessel, loadGithub, saveGithub, validRepo,
} from '../public/github.js';

// ---------- what the AI says ----------

test('answers are read into the builder\'s words', () => {
  assert.equal(enumValue('view', 'Port side'), 'side');
  assert.equal(enumValue('view', 'a three-quarter view from the bow'), 'bow-quarter');
  assert.equal(enumValue('view', 'FRONT'), 'bow');
  assert.equal(enumValue('type', 'Ro-Pax'), 'ferry');
  assert.equal(enumValue('type', 'platform supply vessel'), 'offshore');
  assert.equal(enumValue('bow', ''), 'unknown');
  assert.equal(enumValue('stern', 'cruiser stern'), 'rounded');
  assert.equal(enumValue('bridge', 'nonsense'), null);
});

test('colours are named or written as hex', () => {
  assert.equal(colourHex('white'), '#f2f2ef');
  assert.equal(colourHex('Dark blue with a white stripe'), '#16305a');
  assert.equal(colourHex('#ABC'), '#aabbcc');
  assert.equal(colourHex('the colour of #1f5fa8 paint'), '#1f5fa8');
  assert.equal(colourHex('sort of shiny'), null);
});

test('the JSON is found in what the model wrote, even untidy or cut short', () => {
  assert.deepEqual(jsonIn('Here you go:\n```json\n{"view": "side", "decks": 3}\n```'), { view: 'side', decks: 3 });
  assert.deepEqual(jsonIn('<think>hm {no}</think>{"a": "x}y"}'), { a: 'x}y' });
  assert.deepEqual(jsonIn("{view: 'bow', decks: 2,}"), { view: 'bow', decks: 2 });
  assert.deepEqual(jsonIn('{"view": "side", "type": "ferry", "na'), { view: 'side', type: 'ferry' });
  assert.equal(jsonIn('no json here'), null);
});

test('a photo\'s description: views, numbers, colours and the name', () => {
  const d = parseDescription('{"view":"side","bow":"left","type":"Car ferry","name":"Sandøy","hull":"dark blue","superstructure":"white","funnel":"yellow","decks":"3 decks","funnels":1,"masts":99,"bowShape":"raked","stern":"ramp","bridge":"forward"}');
  assert.deepEqual(d, {
    view: 'side', bow: 'left', type: 'ferry', name: 'SANDØY', hull: '#16305a', superstructure: '#f2f2ef', funnel: '#e7b416',
    decks: 3, funnels: 1, masts: null, bowShape: 'raked', stern: 'ramp', bridge: 'forward', doubleEnded: null,
  });
  assert.equal(parseDescription('{"name": "unknown"}').name, '');
  assert.equal(parseDescription('I cannot see a ship.'), null);
  assert.match(PROMPT, /JSON/);
});

test('several photos make one description: votes, side photos count twice, the name most read', () => {
  const m = mergeDescriptions([
    { view: 'side', type: 'ferry', name: 'SANDOY', hull: '#16305a', decks: 3, funnels: 1, bowShape: 'raked' },
    { view: 'bow', type: 'cargo', name: 'SANDØY', hull: '#16305a', decks: 5, funnels: 1, bowShape: 'vertical' },
    { view: 'stern', type: 'cargo', name: 'SANDOY', decks: 2, funnels: 2 },
    null,
  ]);
  assert.equal(m.type, 'ferry', 'the side photo outweighs one other');
  assert.equal(m.name, 'SANDOY');
  assert.equal(m.decks, 3);
  assert.equal(m.funnels, 1);
  assert.equal(m.bowShape, 'raked');
  assert.equal(m.photos, 3);
  assert.equal(mergeDescriptions([]).type, null);
});

test('which view a photo is: the side by which way the bow points', () => {
  assert.deepEqual(slotFor({ view: 'side', bow: 'left' }), { slot: 'port', flip: false, guessed: false });
  assert.deepEqual(slotFor({ view: 'side', bow: 'right' }), { slot: 'starboard', flip: false, guessed: false });
  assert.equal(slotFor({ view: 'side', bow: 'unknown' }).guessed, true);
  assert.deepEqual(slotFor({ view: 'above', bow: 'left' }), { slot: 'top', flip: true });
  assert.equal(slotFor({ view: 'bow-quarter' }).slot, 'extra');
  assert.equal(slotFor(null, 3.5).slot, 'starboard', 'without AI a long low outline is a side');
  assert.equal(slotFor(null, 1.2).slot, 'extra');
});

test('the bow side counts only when it turns with the mirrored photo', () => {
  assert.equal(bowFrom('right', ' Left.'), 'right');
  assert.equal(bowFrom('right', 'right'), null, 'the same both ways is a guess');
  assert.equal(bowFrom('left or right', 'left'), null);
  assert.equal(bowFrom('', 'left'), null);
  assert.ok(BOW_PROMPTS.every((p) => /left or right/.test(p)));
  assert.equal(bowVote([['left', 'left'], ['right', 'left'], ['right', 'left'], ['right', 'right']]), 'right', 'what the guesses say is not counted');
  assert.equal(bowVote([['right', 'left'], ['left', 'right']]), null, 'a tie is no answer');
  assert.equal(bowVote([]), null);
});

test('kinds for the types', () => {
  assert.equal(kindFor('passenger', 40), 'ferry');
  assert.equal(kindFor('passenger', 250), 'cruise');
  assert.equal(kindFor('cruise', 60), 'ferry');
  assert.equal(kindFor('fishing'), 'tug');
  assert.equal(kindFor(null, 0, 'tanker'), 'tanker');
});

// a side outline: hull (full length, rows 30..39) with a superstructure (x 20..60, rows 10..29)
function sideSil() {
  const W = 100, H = 50, mask = new Uint8Array(W * H);
  for (let y = 30; y < 40; y++) for (let x = 0; x < W; x++) mask[y * W + x] = 1;
  for (let y = 10; y < 30; y++) for (let x = 20; x < 60; x++) mask[y * W + x] = 1;
  return { mask, width: W, height: H, box: { x0: 0, y0: 10, x1: W - 1, y1: 39 } };
}

test('the hull\'s top in a side outline, and its colours', () => {
  const sil = sideSil();
  assert.ok(Math.abs(hullTopFromSide(sil) - 10 / 30) < 0.01);
  const data = new Uint8ClampedArray(100 * 50 * 4);
  for (let y = 0; y < 50; y++) for (let x = 0; x < 100; x++) {
    const i = (y * 100 + x) * 4;
    const hull = y >= 30;
    data[i] = hull ? 20 : 240; data[i + 1] = hull ? 40 : 240; data[i + 2] = hull ? 90 : 235; data[i + 3] = 255;
  }
  const c = bandColours({ width: 100, height: 50, data }, sil, hullTopFromSide(sil));
  assert.equal(c.hull, '#14285a');
  assert.equal(c.superstructure, '#f0f0eb');
  const empty = { mask: new Uint8Array(100 * 50), width: 100, height: 50, box: { x0: 0, y0: 0, x1: 99, y1: 49 } };
  assert.equal(hullTopFromSide(empty, 0.25), 0.25);
});

// ---------- the views no photo shows ----------

test('the plan narrows to the stem, a transom stays wide, a cruiser stern closes', () => {
  assert.equal(planShape(0.5), 1);
  assert.ok(planShape(0.999) < 0.05);
  assert.ok(planShape(0.9) < planShape(0.8));
  assert.ok(planShape(0, { stern: 'transom' }) > 0.7);
  assert.ok(planShape(0, { stern: 'cruiser' }) < 0.2);
});

test('drawn views are what the carving reads: as wide as the ship, the superstructure narrower', () => {
  const size = { L: 100, B: 16, H: 20 };
  const top = planSilhouette(size, { kind: 'ferry' }, 400);
  assert.equal(top.height, 64);
  assert.ok(inside(top, 0.5, 0.5) && inside(top, 0.5, 0.02) && !inside(top, 0.99, 0.2));
  const end = endSilhouette(size, { deck: 6, width: 0.6 });
  assert.ok(inside(end, 0.02, 0.9), 'the hull is the full beam low down');
  assert.ok(!inside(end, 0.1, 0.3) && inside(end, 0.5, 0.3), 'the superstructure is narrower');
  assert.equal(sectionWidth(3, { H: 20, deck: 6, width: 0.6 }), 1);
  assert.ok(sectionWidth(19.5, { H: 20, deck: 6, width: 0.6 }) < 0.3);
  // the plan read back from its own outline gives the same half-beam
  const hb = halfBeamFromPlan(top, size);
  for (const a of [0.1, 0.5, 0.85]) assert.ok(Math.abs(hb(a) - planShape(a, { kind: 'ferry' })) < 0.06, `at ${a}`);
  assert.ok(Math.abs(halfBeamFromPlan(top, size, true)(0.9) - hb(0.1)) < 0.02, 'mirrored');
});

test('a side photo with drawn views carves a ship, narrower above the deck', () => {
  const side = sideSil();
  const size = { ...sizeFrom(100, { starboard: side }), B: 16 };
  assert.equal(size.H, 100 / (100 / 30));
  const sils = { starboard: side, top: planSilhouette(size, { kind: 'ferry' }), bow: endSilhouette(size, { deck: 10, width: 0.6 }), stern: endSilhouette(size, { deck: 10, width: 0.6 }) };
  const g = carve(sils, size, { res: 60 });
  assert.deepEqual(g.ignored, []);
  const at = (x, y, z) => g.occ[Math.floor((x / size.L) * g.nx) + g.nx * (Math.floor((y / size.H) * g.ny) + g.ny * Math.floor(((z + size.B / 2) / size.B) * g.nz))];
  assert.equal(at(50, 5, 7), 1, 'the hull is wide');
  assert.equal(at(50, 20, 7), 0, 'the superstructure is not');
  assert.equal(at(40, 20, 0), 1, 'but is there on the centre line');
  assert.equal(at(90, 20, 0), 0, 'and only where the side photo has it');
  assert.ok(mesh(g, 2).indices.length > 100);
});

test('colours mix', () => {
  assert.equal(mix('#000000', '#ffffff', 0.5), '#808080');
});

// ---------- GitHub ----------

test('the repository and branch this page came from', () => {
  assert.equal(repoFromLocation({ hostname: 'jo.github.io', pathname: '/rudder/' }), 'jo/rudder');
  assert.equal(repoFromLocation({ hostname: 'jo.github.io', pathname: '/' }), 'jo/jo.github.io');
  assert.equal(repoFromLocation({ hostname: 'localhost', pathname: '/' }), '');
  assert.equal(branchFromBuild('feature/ship-builder 1a2b3c4'), 'feature/ship-builder');
  assert.equal(branchFromBuild('dev'), '');
  assert.ok(validRepo('jo/rudder') && !validRepo('rudder') && !validRepo('jo/../x'.replace('..', '/')));
});

test('a vessel\'s file is named by IMO, else MMSI, else name', () => {
  assert.equal(vesselFileBase({ imo: '9894923', mmsi: '257125930', name: 'Sandøy' }), 'imo-9894923');
  assert.equal(vesselFileBase({ imo: '12', mmsi: '257125930' }), 'mmsi-257125930');
  assert.equal(vesselFileBase({ name: 'MS Sandøy!' }), 'ms-sandoy');
  assert.equal(vesselFileBase({}), 'vessel');
});

test('the index gets the vessel, in place of an older model of the same file', () => {
  const before = { vessels: [{ id: 'imo-9894923', file: 'imo-9894923.glb', name: 'Old' }, { id: 'a', file: 'a.glb' }] };
  const idx = indexWith(before, { name: 'SANDOY', mmsi: ['257125930'], imo: '9894923', waterline: 'origin' }, 'imo-9894923.glb');
  assert.deepEqual(idx.vessels.map((v) => [v.id, v.name]), [['a', 'a'], ['imo-9894923', 'SANDOY']]);
  assert.equal(idx.vessels[1].waterline, 'origin');
  assert.equal(indexWith(null, { name: 'X' }, 'x.glb').vessels.length, 1);
});

test('bytes to base64, a chunk at a time', () => {
  const b = new Uint8Array(70000).map((_, i) => i % 251);
  assert.equal(base64(b), Buffer.from(b).toString('base64'));
});

test('settings are kept, and read back safely', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  assert.deepEqual(loadGithub(storage), { token: '', repo: '', branch: '' });
  saveGithub({ token: ' t ', repo: 'jo/rudder', branch: 'main' }, storage);
  assert.deepEqual(loadGithub(storage), { token: 't', repo: 'jo/rudder', branch: 'main' });
  mem.set('rudder.github.v1', '{broken');
  assert.equal(loadGithub(storage).token, '');
});

test('a commit: the model, its sidecar and the index, in one commit on the branch', async () => {
  const calls = [];
  const index = { vessels: [{ id: 'a', file: 'a.glb' }] };
  const fetchFn = async (url, opts) => {
    const path = url.replace('https://api.github.com', '');
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push([opts.method, path, body]);
    assert.equal(opts.headers.Authorization, 'Bearer tok');
    const ok = (j) => ({ ok: true, status: 200, json: async () => j });
    if (path === '/repos/jo/rudder/git/ref/heads/main') return ok({ object: { sha: 'head1' } });
    if (path === '/repos/jo/rudder/git/commits/head1') return ok({ tree: { sha: 'tree1' } });
    if (path.startsWith('/repos/jo/rudder/contents/public/vessels/index.json')) return ok({ content: Buffer.from(JSON.stringify(index)).toString('base64') });
    if (path === '/repos/jo/rudder/git/blobs') return ok({ sha: 'blob1' });
    if (path === '/repos/jo/rudder/git/trees') return ok({ sha: 'tree2' });
    if (path === '/repos/jo/rudder/git/commits') return ok({ sha: 'commit2' });
    if (path === '/repos/jo/rudder/git/refs/heads/main') return ok({});
    return { ok: false, status: 404, json: async () => ({ message: 'Not Found' }) };
  };
  const r = await commitVessel(
    { model: { name: 'imo-9894923.glb', blob: new Blob([new Uint8Array([1, 2, 3])]) }, sidecar: { name: 'SANDOY', imo: '9894923' } },
    { token: 'tok', repo: 'jo/rudder', branch: 'main', message: 'Vessel model: SANDOY' },
    { fetchFn },
  );
  assert.deepEqual(r, { commit: 'commit2', url: 'https://github.com/jo/rudder/commit/commit2', branch: 'main' });
  const blob = calls.find(([, p]) => p.endsWith('/git/blobs'))[2];
  assert.deepEqual(blob, { content: 'AQID', encoding: 'base64' });
  const tree = calls.find(([, p]) => p.endsWith('/git/trees'))[2];
  assert.equal(tree.base_tree, 'tree1');
  assert.deepEqual(tree.tree.map((t) => t.path), ['public/vessels/imo-9894923.glb', 'public/vessels/imo-9894923.json', 'public/vessels/index.json']);
  assert.deepEqual(JSON.parse(tree.tree[2].content).vessels.map((v) => v.id), ['a', 'imo-9894923']);
  assert.deepEqual(calls.find(([, p]) => p.endsWith('/git/commits'))[2], { message: 'Vessel model: SANDOY', tree: 'tree2', parents: ['head1'] });
  assert.deepEqual(calls.at(-1), ['PATCH', '/repos/jo/rudder/git/refs/heads/main', { sha: 'commit2' }]);
});

test('a token that may not write is said plainly', async () => {
  const fetchFn = async () => ({ ok: false, status: 403, json: async () => ({ message: 'Resource not accessible' }) });
  await assert.rejects(commitVessel({ model: { name: 'x.glb', blob: new Blob([]) }, sidecar: {} }, { token: 't', repo: 'jo/rudder', branch: 'main', message: 'm' }, { fetchFn }), /Contents: read and write/);
  await assert.rejects(commitVessel({ model: { name: 'x.glb', blob: new Blob([]) }, sidecar: {} }, { token: '', repo: 'jo/rudder' }, { fetchFn }), /No GitHub token/);
});
