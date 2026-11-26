import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vesselFromParams } from '../public/vesselparams.js';

test('a vessel given in the address becomes a report for the builder', () => {
  const v = vesselFromParams('?name=SANDOY&mmsi=257125930&imo=9894923&callsign=LGCX&length=43&beam=11&draught=3.2&type=69');
  assert.deepEqual(v, {
    name: 'SANDOY', mmsi: 257125930, imoNumber: 9894923, callSign: 'LGCX', shipType: 69,
    dimensionA: 21.5, dimensionB: 21.5, dimensionC: 5.5, dimensionD: 5.5, draught: 32,
  });
  assert.equal(vesselFromParams('?length=43'), null, 'no name or number: no vessel');
  assert.equal(vesselFromParams(''), null);
  assert.equal(vesselFromParams('?mmsi=abc&name=X').mmsi, undefined);
});
