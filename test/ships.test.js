import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectKind, defaultParams, paramsFromFacts, liveryFromFacts, DEFAULT_LIVERY } from '../public/ships/presets.js';
import { HullShape, buildHull } from '../public/ships/hull.js';
import { fmtLen } from '../public/ships/callouts.js';

const facts = (over = {}) => ({
  qid: 'Q1', label: 'Test', types: [], builders: [], operators: [], owners: [], flags: [], homePorts: [], shipClass: [], colors: [], ...over,
});

test('the vessel type comes from Wikidata types, class and description', () => {
  assert.equal(detectKind(['container ship']), 'container');
  assert.equal(detectKind(['cruiseferry', 'ro-ro passenger ship']), 'ferry');
  assert.equal(detectKind(['ocean liner', 'cruise ship']), 'cruise');
  assert.equal(detectKind(['four funnel liner', 'shipwreck']), 'liner');
  assert.equal(detectKind(['supercarrier']), 'carrier');
  assert.equal(detectKind(['training vessel', 'barque']), 'sailing');
  assert.equal(detectKind(['sailing frigate']), 'sailing'); // not a modern warship
  assert.equal(detectKind(['frigate']), 'warship');
  assert.equal(detectKind(['oil tanker']), 'tanker');
  assert.equal(detectKind(['something unknown']), 'cargo');
});

test('Wikidata dimensions are used as given and flagged, missing ones estimated', () => {
  const { params, sources } = paramsFromFacts(facts({ types: ['container ship'], length: 399.9, beam: 58.8 }));
  assert.equal(params.kind, 'container');
  assert.equal(params.length, 399.9);
  assert.equal(params.beam, 58.8);
  assert.deepEqual(sources, { length: 'wikidata', beam: 'wikidata', draft: 'estimated', airDraft: 'estimated' });
  assert.ok(params.draft > 10 && params.draft < 25, `draft ${params.draft}`);
  assert.ok(params.depth > params.draft);
});

test('nonsense values are ignored and estimated instead', () => {
  const { params, sources } = paramsFromFacts(facts({ types: ['ferry'], length: 0.2, beam: 5000 }));
  assert.equal(sources.length, 'estimated');
  assert.equal(sources.beam, 'estimated');
  assert.ok(params.length > 10 && params.beam < 100);
});

test('the same item always builds the same ship', () => {
  assert.equal(paramsFromFacts(facts({ qid: 'Q25173' })).params.seed, paramsFromFacts(facts({ qid: 'Q25173' })).params.seed);
});

test('Wikidata colour statements seed the livery', () => {
  const lv = liveryFromFacts('cargo', facts({ colors: ['black', 'white'] }));
  assert.equal(lv.hull, '#151515');
  assert.equal(lv.superstructure, '#f4f4f2');
  assert.deepEqual(liveryFromFacts('tug'), DEFAULT_LIVERY.tug);
});

test('the hull has the given beam amidships and closes at the bow', () => {
  const p = defaultParams('cargo', 120);
  const s = new HullShape(p);
  assert.ok(Math.abs(s.halfBreadth(0.5, p.draft) - p.beam / 2) < 1e-9);
  assert.equal(s.halfBreadth(1, p.draft), 0);
  assert.equal(s.halfBreadth(0.5, s.keelH(0.5)), 0); // keel on the centreline
  assert.ok(s.planW(0, p.depth) > 0.3, 'a transom stern stays wide at the deck');
  const d = s.deckAt(0);
  assert.ok(Math.abs(d.y - (p.depth - p.draft)) < 0.05, 'deck amidships is depth minus draft above the waterline');
});

test('the hull mesh spans the length, beam and draft', () => {
  const p = defaultParams('tanker', 250);
  const hb = buildHull(p);
  hb.hull.computeBoundingBox();
  const box = hb.hull.boundingBox;
  assert.ok(Math.abs(box.max.x - box.min.x - p.length) < p.length * 0.03, `length ${box.max.x - box.min.x}`);
  assert.ok(Math.abs(box.max.z * 2 - p.beam) < 1e-6);
  assert.ok(Math.abs(box.min.y + p.draft) < 1e-6, 'keel at -draft');
  assert.ok(hb.transom, 'a transom stern has a transom plate');
  assert.ok(hb.bulb, 'tankers get a bulbous bow');
  const cruiser = buildHull({ ...p, stern: 'cruiser', bow: 'raked' });
  assert.equal(cruiser.transom, null);
  assert.equal(cruiser.bulb, null);
});

test('lengths read in metres or feet', () => {
  assert.equal(fmtLen(269.1, 'metric'), '269.1 m');
  assert.equal(fmtLen(10.54, 'metric'), '10.54 m');
  assert.equal(fmtLen(269.1, 'imperial'), '883 ft');
});
