// A vessel given in the page's address, so other apps can link to her:
//   ?name=SANDOY&mmsi=257125930&imo=9894923&callsign=LGCX&length=43&beam=11&draught=3.2&type=69
// (type: the AIS ship type number). Made into an AIS-like report for the builder. Pure, so tested.

/** An AIS-like report from the address's query, or null when it names no vessel. */
export function vesselFromParams(search) {
  const q = new URLSearchParams(search);
  const num = (k) => (Number(q.get(k)) > 0 ? Number(q.get(k)) : 0);
  const length = num('length'), beam = num('beam');
  const v = {
    name: (q.get('name') ?? '').trim(),
    mmsi: num('mmsi') || undefined,
    imoNumber: num('imo') || undefined,
    callSign: (q.get('callsign') ?? '').trim(),
    shipType: num('type') || undefined,
    dimensionA: length / 2, dimensionB: length / 2,
    dimensionC: beam / 2, dimensionD: beam / 2,
    draught: Math.round(num('draught') * 10),
  };
  return v.name || v.mmsi || v.imoNumber ? v : null;
}
