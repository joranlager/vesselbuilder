// What an AIS report says of a vessel, for the builder: her type and status in words, her size,
// and her kind and hull for building her. Pure, so it is unit tested.

import { defaultParams, depthFor } from './ships/presets.js';

const TYPE_NAMES = {
  30: 'Fishing', 31: 'Towing', 32: 'Towing, large', 33: 'Dredging or underwater operations', 34: 'Diving operations',
  35: 'Military operations', 36: 'Sailing', 37: 'Pleasure craft', 50: 'Pilot vessel', 51: 'Search and rescue',
  52: 'Tug', 53: 'Port tender', 54: 'Anti-pollution', 55: 'Law enforcement', 58: 'Medical transport', 59: 'Non-combatant ship',
};
/** Readable ship type for an AIS ship and cargo type code. */
export function typeName(code) {
  const t = Number(code);
  if (!t) return 'Not given';
  if (TYPE_NAMES[t]) return TYPE_NAMES[t];
  const tens = Math.floor(t / 10);
  const cargo = ['', 'carrying dangerous goods (A)', 'carrying dangerous goods (B)', 'carrying dangerous goods (C)', 'carrying dangerous goods (D)'][t % 10] ?? '';
  const base = { 2: 'Wing in ground', 4: 'High speed craft', 6: 'Passenger', 7: 'Cargo', 8: 'Tanker', 9: 'Other' }[tens];
  return base ? `${base}${cargo ? `, ${cargo}` : ''}` : `Type ${t}`;
}

const NAV_STATUS = [
  'Under way using engine', 'At anchor', 'Not under command', 'Restricted manoeuvrability', 'Constrained by draught',
  'Moored', 'Aground', 'Engaged in fishing', 'Under way sailing', '', '', 'Towing astern', 'Pushing ahead or towing alongside',
  '', 'AIS-SART, MOB or EPIRB', '',
];
export const navStatusText = (s) => NAV_STATUS[Number(s)] || 'Not defined';

/** Length, beam and where the GPS antenna sits, from the AIS reference dimensions (metres). */
export function vesselSize(v) {
  const a = v.dimensionA ?? 0, b = v.dimensionB ?? 0, c = v.dimensionC ?? 0, d = v.dimensionD ?? 0;
  const length = a + b > 0 ? a + b : v.shipLength ?? 0;
  const beam = c + d > 0 ? c + d : v.shipWidth ?? 0;
  // With no reference point given, assume the antenna amidships.
  const toBow = a + b > 0 ? a : length / 2;
  const toPort = c + d > 0 ? c : beam / 2;
  return { length, beam, toBow, toPort };
}

/** Draught in metres (AIS sends tenths of a metre; 0 = not given). */
export const draughtM = (v) => (v.draught > 0 ? v.draught / 10 : null);

/** Minutes since the report. */
export const ageMinutes = (v, now = Date.now()) => (now - Date.parse(v.msgtime)) / 60000;

/** The builder's vessel kind for an AIS ship type and size. */
export function kindFromAis(code, length = 0, beam = 0) {
  const t = Number(code);
  if (t >= 60 && t <= 69) return length >= 200 ? 'cruise' : 'ferry';
  if (t >= 40 && t <= 49) return 'ferry';
  if (t >= 80 && t <= 89) return 'tanker';
  // AIS does not tell container ships from bulk or general cargo; very large and wide is most likely boxes.
  if (t >= 70 && t <= 79) return length >= 250 && beam >= 32 ? 'container' : 'cargo';
  if ([30, 31, 32, 33, 50, 51, 52, 53, 54].includes(t)) return 'tug';
  if (t === 35 || t === 55) return 'warship';
  if (t === 36) return 'sailing';
  if (t === 37) return 'yacht';
  return 'cargo';
}

/**
 * Hull parameters from an AIS report: length, beam and draught from AIS where given (marked 'ais'),
 * the rest estimated from typical ships of the type.
 */
export function hullFromAis(v) {
  const { length, beam } = vesselSize(v);
  const kind = kindFromAis(v.shipType, length, beam);
  const params = defaultParams(kind, length > 2 ? length : undefined);
  const sources = { length: length > 2 ? 'ais' : 'estimated', beam: 'estimated', draft: 'estimated', airDraft: 'estimated' };
  if (beam > 1) { params.beam = beam; sources.beam = 'ais'; }
  const t = draughtM(v);
  if (t && t < 30) { params.draft = t; sources.draft = 'ais'; }
  // AIS changed the beam and draught: the depth follows them, not the type's typical ship.
  params.depth = depthFor(params.kind, params.beam, params.draft, params.length);
  params.seed = v.mmsi % 100000;
  return { params, sources };
}

/** Text for comparing names: lower case, Norwegian letters spelt out, accents and punctuation dropped. */
export function foldName(s) {
  return String(s ?? '').toLowerCase()
    .replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
