import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  normalizeEntry, parseIndex, matchVessel, matchName, axisRotation, fitPlacement, buildIndex, formatOf, loadIndex,
} from '../public/vesselcatalog.js';
import { libraryEntry } from '../public/vessellibrary.js';
import { writeVesselIndex } from '../scripts/vessels.mjs';

test('model formats come from the file name', () => {
  assert.equal(formatOf('Color Magic.GLB'), 'glb');
  assert.equal(formatOf('boat.obj'), 'obj');
  assert.equal(formatOf('boat.mtl'), null);
  assert.equal(formatOf('readme'), null);
});

test('an entry is checked and filled in', () => {
  const e = normalizeEntry({ file: 'color-magic.glb', mmsi: 257123000, imo: 'IMO 9349863', callSign: 'lagv7' });
  assert.equal(e.id, 'color-magic');
  assert.equal(e.name, 'color magic');
  assert.equal(e.format, 'glb');
  assert.deepEqual(e.mmsi, ['257123000']);
  assert.equal(e.imo, '9349863');
  assert.equal(e.callSign, 'LAGV7');
  assert.equal(e.up, '+y');
  assert.equal(e.forward, '+x');
  assert.equal(e.scale, 'length');
  assert.equal(e.waterline, 'keel');
  assert.equal(normalizeEntry({ file: 'x.blend' }), null, 'not a format Rudder reads');
  assert.equal(normalizeEntry({ file: 'x.fbx' }).format, 'fbx');
  assert.equal(normalizeEntry({ file: '../secret.glb' }), null, 'stays in the folder');
  assert.equal(normalizeEntry({ file: 'https://example.com/x.glb' }), null, 'stays in the folder');
  assert.deepEqual([normalizeEntry({ file: 'a.glb', up: '+z', forward: '-z' }).up, normalizeEntry({ file: 'a.glb', up: '+z', forward: '-z' }).forward], ['+y', '+x'], 'up and bow on one axis is nonsense');
  assert.equal(normalizeEntry({ file: 'a.glb', scale: 0.01 }).scale, 0.01);
});

test('an index lists each model once', () => {
  const list = parseIndex({ vessels: [{ file: 'a.glb' }, { file: 'a.glb' }, { file: 'b.stl' }, { nothing: 1 }] });
  assert.deepEqual(list.map((e) => e.id), ['a', 'b']);
  assert.deepEqual(parseIndex(null), []);
});

test('ship names match without prefixes, accents or case', () => {
  assert.equal(matchName('MS Color Magic'), 'color magic');
  assert.equal(matchName('M/S Vederøy'), 'vederoy');
  assert.equal(matchName('MV  Ever-Given'), 'ever given');
  assert.equal(matchName('Statsraad Lehmkuhl'), 'statsraad lehmkuhl');
});

test('a ship is matched by MMSI, then IMO, then call sign, then name', () => {
  const entries = parseIndex([
    { id: 'byname', file: 'a.glb', name: 'Color Magic' },
    { id: 'bycall', file: 'b.glb', callSign: 'LAGV7' },
    { id: 'byimo', file: 'c.glb', imo: '9349863' },
    { id: 'bymmsi', file: 'd.glb', mmsi: ['257123000'] },
    { id: 'other', file: 'e.glb', name: 'Nordlys', mmsi: ['259000000'] },
  ]);
  assert.equal(matchVessel(entries, { mmsi: 257123000, imoNumber: 9349863, callSign: 'LAGV7', name: 'COLOR MAGIC' }).id, 'bymmsi');
  assert.equal(matchVessel(entries, { mmsi: 111111111, imoNumber: 9349863, name: 'COLOR MAGIC' }).id, 'byimo');
  assert.equal(matchVessel(entries, { mmsi: 111111111, callSign: 'lagv7 ' }).id, 'bycall');
  assert.equal(matchVessel(entries, { label: 'MS Color Magic', imo: '' }).id, 'byname', 'Wikidata facts');
  assert.equal(matchVessel(entries, { mmsi: 258000000, name: 'NORDLYS' }), null, 'same name, another ship');
  assert.equal(matchVessel(entries, { name: '' }), null);
});

test('a model is turned upright with the bow to +x', () => {
  const apply = (r, v) => r.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
  assert.deepEqual(axisRotation('+y', '+x'), [[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
  // z-up, bow along -y (common in CAD): the model's up goes to y, its bow to x, rotation proper
  const r = axisRotation('+z', '-y');
  assert.deepEqual(apply(r, [0, 0, 1]), [0, 1, 0]);
  assert.deepEqual(apply(r, [0, -1, 0]), [1, 0, 0]);
  const det = r[0][0] * (r[1][1] * r[2][2] - r[1][2] * r[2][1]) - r[0][1] * (r[1][0] * r[2][2] - r[1][2] * r[2][0]) + r[0][2] * (r[1][0] * r[2][1] - r[1][1] * r[2][0]);
  assert.equal(det, 1, 'a turn, not a mirror');
  // glTF's own forward (+z): bow to x, starboard to -x... whatever: still a proper rotation
  const g = axisRotation('+y', '+z');
  assert.deepEqual(apply(g, [0, 0, 1]), [1, 0, 0]);
});

test('a model is scaled to the ship and put on the waterline', () => {
  const box = { min: { x: 0, y: -1, z: -5 }, max: { x: 20, y: 9, z: 5 } };
  const a = fitPlacement(box, { scale: 'length', length: 100, draft: 6 });
  assert.equal(a.scale, 5);
  assert.deepEqual(a.offset, { x: -50, y: -6 + 5, z: 0 }); // keel (-1 * 5) at -6
  const b = fitPlacement(box, { scale: 1, waterline: 'origin' });
  assert.deepEqual(b, { scale: 1, offset: { x: -10, y: 0, z: 0 } });
  const c = fitPlacement(box, { scale: 'length' }); // no length known: its own units
  assert.equal(c.scale, 1);
  const keel = box.min.y * c.scale + c.offset.y;
  assert.ok(keel < 0 && keel > -2, `some draught is guessed: keel at ${keel}`);
});

test('the folder index is made from the models and their sidecars', () => {
  const idx = buildIndex([
    { name: 'index.json', json: { vessels: [] } },
    { name: 'color-magic.glb' },
    { name: 'color-magic.json', json: { name: 'Color Magic', imo: '9349863' } },
    { name: 'tug.obj' },
    { name: 'tug.mtl' },
    { name: 'skiff.stl' },
    { name: 'renamed.json', json: { file: 'skiff.stl', name: 'Skiff' } },
    { name: 'orphan.json', json: { name: 'No model' } },
    { name: 'README.md' },
  ]);
  assert.deepEqual(idx.vessels.map((e) => [e.id, e.name, e.file]), [
    ['color-magic', 'Color Magic', 'color-magic.glb'],
    ['skiff', 'Skiff', 'skiff.stl'],
    ['tug', 'tug', 'tug.obj'],
  ]);
});

test('npm run vessels writes the index, and the committed one is up to date', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'vessels-'));
  try {
    await writeFile(path.join(dir, 'a.glb'), 'x');
    await writeFile(path.join(dir, 'a.json'), JSON.stringify({ name: 'A', mmsi: ['257000001'] }));
    const idx = await writeVesselIndex(dir);
    assert.equal(idx.vessels[0].name, 'A');
    const back = await loadIndex(`file://${dir}/`, async (u) => ({ ok: true, json: async () => JSON.parse(await readFile(new URL(u), 'utf8')) }));
    assert.deepEqual(back.map((e) => e.mmsi), [['257000001']]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  const committed = JSON.parse(await readFile('public/vessels/index.json', 'utf8'));
  const dir2 = await mkdtemp(path.join(tmpdir(), 'vessels-'));
  try {
    const { readdir, copyFile } = await import('node:fs/promises');
    for (const f of await readdir('public/vessels')) await copyFile(path.join('public/vessels', f), path.join(dir2, f));
    assert.deepEqual(await writeVesselIndex(dir2), committed, 'run npm run vessels');
  } finally {
    await rm(dir2, { recursive: true, force: true });
  }
});

test('a missing index is an empty folder', async () => {
  assert.deepEqual(await loadIndex('vessels/', async () => ({ ok: false })), []);
  assert.deepEqual(await loadIndex('vessels/', async () => { throw new Error('offline'); }), []);
});

test('models saved on the device are matched like the folder\'s, in the ship\'s frame', () => {
  const e = libraryEntry({ id: 'm1', name: 'Nordlys', mmsi: ['257000001'], blob: {}, size: 10 });
  assert.equal(e.source, 'device');
  assert.equal(e.waterline, 'origin');
  assert.equal(e.id, 'm1');
  assert.equal(matchVessel([e], { mmsi: 257000001 }).id, 'm1');
});
