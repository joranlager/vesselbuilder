import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVesselPage, kindFromType, validImo, proxyBase, lookupUrl, lookupImo, loadProxy, saveProxy, MARITIME_KEY, PROXY } from '../public/maritimedb.js';

// The part of a vessel's page on maritime-database.com that is read: Next.js's page data.
const page = (vessel) => `<!DOCTYPE html><html><head><title>SANDOY - Maritime Database</title></head><body>
<div id="__next"><b>Vessel Name: </b><span>SANDOY</span></div>
<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { vessel: { vessel, similars: [{ VESSEL_NAME: 'HUSAVIK' }] } } } })}</script>
</body></html>`;
const SANDOY = {
  VESSEL_ID: 193979, MMSI: '257125930', VESSEL_NAME: 'SANDOY', IMO: '9894923 ', CALLSIGN: 'LGCX', FLAG: 'Norway',
  LENGTHBEAM: '43 / 11 m', SHIP_TYPE: 'Passenger/Ro-Ro Cargo Ship', GROSS: 498, SUMMER_DWT: 0, LOA: 0, BEAM: 0, YEAR_BUILT: '2021',
  URL: 'https://www.maritime-database.com/vessel/vesselid:193979/imo:9894923/mmsi:257125930/vessel:sandoy', DRAUGHT: 3.6,
};

test('a vessel page gives her particulars', () => {
  assert.deepEqual(parseVesselPage(page(SANDOY)), {
    name: 'SANDOY', imo: '9894923', mmsi: '257125930', callSign: 'LGCX', flag: 'Norway', type: 'Passenger/Ro-Ro Cargo Ship',
    length: 43, beam: 11, gross: 498, deadweight: null, built: 2021, draught: 3.6,
    url: 'https://www.maritime-database.com/vessel/vesselid:193979/imo:9894923/mmsi:257125930/vessel:sandoy',
  });
  const p = parseVesselPage(page({ ...SANDOY, LOA: 44.2, BEAM: 11.4, URL: 'https://evil.example/', DRAUGHT: 0 }));
  assert.equal(p.length, 44.2, 'LOA and BEAM before the rounded length / beam');
  assert.equal(p.beam, 11.4);
  assert.equal(p.url, '');
  assert.equal(p.draught, null);
});

test('a page with no vessel gives nothing', () => {
  assert.equal(parseVesselPage('<html>Not found</html>'), null);
  assert.equal(parseVesselPage(''), null);
  assert.equal(parseVesselPage('<script id="__NEXT_DATA__" type="application/json">{oops</script>'), null);
  assert.equal(parseVesselPage(page(null)), null);
});

test('IMO numbers have a check digit', () => {
  assert.ok(validImo('9894923'));
  assert.ok(validImo('IMO 9074729'));
  assert.ok(!validImo('9894924'));
  assert.ok(!validImo('989492'));
  assert.ok(!validImo(''));
});

test('the site\'s ship types become the builder\'s kinds', () => {
  assert.equal(kindFromType('Passenger/Ro-Ro Cargo Ship', 43), 'ferry');
  assert.equal(kindFromType('Passenger Ship', 300), 'cruise');
  assert.equal(kindFromType('Container Ship'), 'container');
  assert.equal(kindFromType('Crude Oil Tanker'), 'tanker');
  assert.equal(kindFromType('Bulk Carrier'), 'bulk');
  assert.equal(kindFromType('Ro-Ro Cargo Ship'), 'cargo');
  assert.equal(kindFromType('General Cargo Ship'), 'cargo');
  assert.equal(kindFromType('Tug'), 'tug');
  assert.equal(kindFromType('Sailing Vessel'), 'sailing');
  assert.equal(kindFromType(''), '');
  assert.equal(kindFromType('Unknown'), '');
});

test('the proxy: the one set, else the local server\'s, else the worker', () => {
  assert.equal(proxyBase('https://x.workers.dev', { hostname: 'joranlager.github.io' }), 'https://x.workers.dev/');
  assert.equal(proxyBase('', { hostname: 'localhost' }), '/maritime/');
  assert.equal(proxyBase('', { hostname: 'joranlager.github.io' }), PROXY);
  assert.match(PROXY, /^https:\/\/.+\/$/);
  assert.equal(lookupUrl('9894923', '/maritime/'), '/maritime/vessel/imo:9894923');
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  saveProxy(' https://x.workers.dev/ ', storage);
  assert.equal(loadProxy(storage), 'https://x.workers.dev/');
  saveProxy('', storage);
  assert.ok(!store.has(MARITIME_KEY));
});

test('looking her up asks the proxy', async () => {
  const asked = [];
  const fetch = async (url) => { asked.push(url); return url.endsWith('9894923') ? new Response(page(SANDOY)) : new Response('', { status: 404 }); };
  assert.equal((await lookupImo('9894923', { base: 'https://p/', fetch })).name, 'SANDOY');
  assert.equal(await lookupImo('9074729', { base: 'https://p/', fetch }), null);
  assert.deepEqual(asked, ['https://p/vessel/imo:9894923', 'https://p/vessel/imo:9074729']);
  await assert.rejects(lookupImo('9894923', { base: '', fetch }), /No proxy/);
  await assert.rejects(lookupImo('9894923', { base: 'https://p/', fetch: async () => new Response('', { status: 502 }) }), /502/);
});
