// Ship inspector: vessel types, their typical proportions and liveries, and turning Wikidata facts into
// hull parameters. Pure, so it is unit tested.

export const KIND_PRESETS = {
  cargo: {
    label: 'General cargo',
    length: 140,
    lb: 6.6,
    bt: 2.6,
    dt: 1.45,
    airDraft: 1.4,
    cb: 0.72,
    bow: 'bulbous',
    stern: 'transom',
    sheer: 0.12,
    flare: 0.25,
    decks: 4,
    funnels: 1,
    masts: 2,
  },
  container: {
    label: 'Container ship',
    length: 300,
    lb: 6.8,
    bt: 3.3,
    dt: 1.75,
    airDraft: 1.4,
    cb: 0.66,
    bow: 'bulbous',
    stern: 'transom',
    sheer: 0.08,
    flare: 0.35,
    decks: 7,
    funnels: 1,
    masts: 1,
  },
  tanker: {
    label: 'Tanker',
    length: 250,
    lb: 5.6,
    bt: 2.9,
    dt: 1.4,
    airDraft: 1.0,
    cb: 0.83,
    bow: 'bulbous',
    stern: 'transom',
    sheer: 0.05,
    flare: 0.2,
    decks: 6,
    funnels: 1,
    masts: 1,
  },
  bulk: {
    label: 'Bulk carrier',
    length: 225,
    lb: 6.0,
    bt: 2.5,
    dt: 1.4,
    airDraft: 1.1,
    cb: 0.84,
    bow: 'bulbous',
    stern: 'transom',
    sheer: 0.05,
    flare: 0.2,
    decks: 6,
    funnels: 1,
    masts: 1,
  },
  cruise: {
    label: 'Cruise ship',
    length: 300,
    lb: 8.2,
    bt: 4.4,
    dt: 2.1,
    airDraft: 1.75,
    cb: 0.68,
    bow: 'bulbous',
    stern: 'transom',
    sheer: 0.05,
    flare: 0.3,
    decks: 12,
    funnels: 1,
    masts: 1,
  },
  ferry: {
    label: 'Ferry / Ro-Pax',
    length: 180,
    lb: 6.4,
    bt: 4.3,
    dt: 2.3,
    airDraft: 1.4,
    cb: 0.62,
    bow: 'bulbous',
    stern: 'transom',
    sheer: 0.06,
    flare: 0.3,
    decks: 7,
    funnels: 2,
    masts: 1,
  },
  liner: {
    label: 'Ocean liner',
    length: 260,
    lb: 9.2,
    bt: 2.8,
    dt: 1.75,
    airDraft: 1.8,
    cb: 0.62,
    bow: 'vertical',
    stern: 'cruiser',
    sheer: 0.16,
    flare: 0.1,
    decks: 5,
    funnels: 4,
    masts: 2,
  },
  warship: {
    label: 'Warship',
    length: 150,
    lb: 8.5,
    bt: 3.4,
    dt: 1.85,
    airDraft: 2.2,
    cb: 0.48,
    bow: 'raked',
    stern: 'transom',
    sheer: 0.2,
    flare: 0.45,
    decks: 4,
    funnels: 1,
    masts: 1,
  },
  carrier: {
    label: 'Aircraft carrier',
    length: 330,
    lb: 8.2,
    bt: 3.6,
    dt: 2.6,
    airDraft: 1.6,
    cb: 0.6,
    bow: 'bulbous',
    stern: 'transom',
    sheer: 0.03,
    flare: 0.8,
    decks: 5,
    funnels: 0,
    masts: 1,
  },
  sailing: {
    label: 'Sailing ship',
    length: 70,
    lb: 6.0,
    bt: 2.0,
    dt: 1.4,
    airDraft: 4.2,
    cb: 0.52,
    bow: 'clipper',
    stern: 'cruiser',
    sheer: 0.3,
    flare: 0.15,
    decks: 1,
    funnels: 0,
    masts: 3,
  },
  yacht: {
    label: 'Superyacht',
    length: 80,
    lb: 6.0,
    bt: 3.6,
    dt: 2.2,
    airDraft: 2.0,
    cb: 0.45,
    bow: 'raked',
    stern: 'transom',
    sheer: 0.12,
    flare: 0.3,
    decks: 4,
    funnels: 0,
    masts: 1,
  },
  tug: {
    label: 'Tug / workboat',
    length: 32,
    lb: 2.9,
    bt: 2.4,
    dt: 1.4,
    airDraft: 1.5,
    cb: 0.55,
    bow: 'raked',
    stern: 'cruiser',
    sheer: 0.25,
    flare: 0.25,
    decks: 2,
    funnels: 1,
    masts: 1,
  },
};
const KIND_RULES = [
  [/aircraft carrier|supercarrier|helicopter carrier|amphibious assault/i, 'carrier'],
  [/container/i, 'container'],
  [/tanker|lng|lpg|gas carrier/i, 'tanker'],
  [/bulk|ore carrier/i, 'bulk'],
  [/cruise ?ferry|ro-?pax/i, 'ferry'],
  [/cruise/i, 'cruise'],
  [/ocean liner|liner|steamship/i, 'liner'],
  [/ferry|ro-?pax|ro-?ro|passenger/i, 'ferry'],
  [/battleship|destroyer|frigate|corvette|cruiser|warship|naval|patrol|minesweeper|navy|military|submarine|gunboat/i, 'warship'],
  [/barque|bark|schooner|brig|clipper|sailing|tall ship|full-rigged|ship of the line|galleon|windjammer/i, 'sailing'],
  [/yacht/i, 'yacht'],
  [/tug|pilot|workboat|lifeboat|fishing|trawler/i, 'tug'],
];
export function detectKind(texts) {
  const joined = texts.join(' | ');
  // Sailing frigates are sailing ships, not modern warships.
  if (/sailing frigate|ship of the line|full-rigged/i.test(joined)) return 'sailing';
  for (const [re, kind] of KIND_RULES) if (re.test(joined)) return kind;
  return 'cargo';
}
/**
 * Superstructure decks for a ship of this kind and length. The presets' deck counts are for their
 * typical length; a smaller ship has fewer, or a short ferry becomes a tower of decks (each deck is at
 * least 2.5 m). Ferries (AIS "passenger" under 200 m) are mostly car ferries with few decks above
 * the car deck: 1 at 40 m, 2 at 70 m, 3 at 110 m, 4 from about 150 m.
 */
export function decksFor(kind, length) {
  const p = KIND_PRESETS[kind];
  const L = length ?? p.length;
  const n = kind === 'ferry' ? 1 + (L - 30) / 40 : p.decks * (L / p.length);
  return Math.max(1, Math.min(p.decks, Math.round(n)));
}
/** Least freeboard (hull above the waterline) by kind, as a share of the ship's length. */
export const FREEBOARD_SHARE = { ferry: 0.09, cruise: 0.075, liner: 0.065, carrier: 0.06, warship: 0.05, container: 0.045, yacht: 0.06, sailing: 0.04 };
/**
 * Depth from keel to deck for a ship of this kind with this beam and draught (metres). The hull is
 * built for the deeper of the draught its beam implies for its kind (its design draught) and the
 * draught it reports, so a lightly loaded ship floats high and none is sunk to its deck.
 */
export function depthFor(kind, beam, draft, length = 0) {
  const p = KIND_PRESETS[kind] ?? KIND_PRESETS.cargo;
  const design = Math.max(beam / p.bt, draft || 0);
  // Least hull above the waterline, as a share of the length: ferries and cruise ships carry their
  // car and passenger decks inside high sides; working ships sit lower.
  const minFreeboard = (FREEBOARD_SHARE[kind] ?? 0.035) * length;
  return Math.max(design * p.dt, (draft || 0) + Math.max(1, minFreeboard));
}
export function defaultParams(kind, length) {
  const p = KIND_PRESETS[kind];
  const L = length ?? p.length;
  const B = L / p.lb;
  const T = B / p.bt;
  return {
    kind,
    length: L,
    beam: B,
    draft: T,
    depth: T * p.dt,
    airDraft: B * p.airDraft,
    blockCoefficient: p.cb,
    bow: p.bow,
    stern: p.stern,
    sheer: p.sheer,
    flare: p.flare,
    decks: decksFor(kind, L),
    funnels: p.funnels,
    masts: p.masts,
    seed: 7,
  };
}
/**
 * Merge Wikidata dimensions into a preset; anything missing is estimated
 * from typical ratios for that kind of vessel and flagged as such.
 */
export function paramsFromFacts(facts) {
  const kind = detectKind([...facts.types, facts.description ?? '', ...facts.shipClass, facts.label]);
  const p = KIND_PRESETS[kind];
  const sane = (v, lo, hi) => (v !== undefined && v > lo && v < hi ? v : undefined);
  let L = sane(facts.length, 3, 600);
  let B = sane(facts.beam, 1, 100);
  let T = sane(facts.draft, 0.3, 40);
  const H = sane(facts.height, 2, 120);
  const sources = {
    length: L ? 'wikidata' : 'estimated',
    beam: B ? 'wikidata' : 'estimated',
    draft: T ? 'wikidata' : 'estimated',
    airDraft: H ? 'wikidata' : 'estimated',
  };
  if (!L && B) L = B * p.lb;
  if (!L && facts.grossTonnage) L = Math.min(400, Math.max(20, 5.2 * Math.cbrt(facts.grossTonnage) * 1.35));
  if (!L) L = p.length;
  if (!B) B = L / p.lb;
  if (!T) T = B / p.bt;
  const base = defaultParams(kind, L);
  const params = {
    ...base,
    beam: B,
    draft: T,
    depth: Math.max(T * p.dt, T + 1),
    airDraft: H ?? B * p.airDraft,
    seed: hashSeed(facts.qid),
  };
  return { params, sources };
}
export function hashSeed(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % 100000;
}
export const DEFAULT_LIVERY = {
  cargo: {
    hull: '#1f3b5c',
    bootTop: '#8e2a22',
    stripe: '#e6e6e6',
    superstructure: '#f2f2ee',
    funnel: '#d9a521',
    funnelTop: '#1c1c1c',
    deck: '#6d4a3a',
    text: '#ffffff',
  },
  container: {
    hull: '#2b5d8a',
    bootTop: '#8e2a22',
    stripe: '#ffffff',
    superstructure: '#f3f3f0',
    funnel: '#2b5d8a',
    funnelTop: '#1a1a1a',
    deck: '#3f5c48',
    text: '#ffffff',
  },
  tanker: {
    hull: '#3d3d3d',
    bootTop: '#86241d',
    stripe: '#c7c7c7',
    superstructure: '#f1f1ec',
    funnel: '#c0392b',
    funnelTop: '#1a1a1a',
    deck: '#7a3d2b',
    text: '#ffffff',
  },
  bulk: {
    hull: '#1d2d44',
    bootTop: '#8e2a22',
    stripe: '#d9d9d9',
    superstructure: '#f1f1ec',
    funnel: '#e3a92c',
    funnelTop: '#1a1a1a',
    deck: '#6b3a2f',
    text: '#ffffff',
  },
  cruise: {
    hull: '#f6f6f4',
    bootTop: '#1f3550',
    stripe: '#1f5fa8',
    superstructure: '#ffffff',
    funnel: '#1f5fa8',
    funnelTop: '#1a1a1a',
    deck: '#9b6b45',
    text: '#1f3550',
  },
  ferry: {
    hull: '#ffffff',
    bootTop: '#26415f',
    stripe: '#d0312d',
    superstructure: '#ffffff',
    funnel: '#d0312d',
    funnelTop: '#1a1a1a',
    deck: '#5f6f5f',
    text: '#d0312d',
  },
  liner: {
    hull: '#141414',
    bootTop: '#8c1f1a',
    stripe: '#d4b24c',
    superstructure: '#f4f1e6',
    funnel: '#c98d2e',
    funnelTop: '#111111',
    deck: '#b58b5a',
    text: '#e8d38a',
  },
  warship: {
    hull: '#6f767c',
    bootTop: '#2b2b2b',
    stripe: '#5d6369',
    superstructure: '#7c8389',
    funnel: '#6f767c',
    funnelTop: '#252525',
    deck: '#4b5056',
    text: '#ffffff',
  },
  carrier: {
    hull: '#6b7177',
    bootTop: '#2a2a2a',
    stripe: '#5d6369',
    superstructure: '#787e84',
    funnel: '#6b7177',
    funnelTop: '#252525',
    deck: '#3b3e42',
    text: '#ffffff',
  },
  sailing: {
    hull: '#1a1a1a',
    bootTop: '#7a5a2a',
    stripe: '#f0ead6',
    superstructure: '#8b6a45',
    funnel: '#3b2a1a',
    funnelTop: '#1a1a1a',
    deck: '#c9a874',
    text: '#f0d98a',
  },
  yacht: {
    hull: '#20262e',
    bootTop: '#20262e',
    stripe: '#c0c4c9',
    superstructure: '#f8f8f6',
    funnel: '#f8f8f6',
    funnelTop: '#20262e',
    deck: '#b8916a',
    text: '#d8d8d8',
  },
  tug: {
    hull: '#1d1d1d',
    bootTop: '#8e2a22',
    stripe: '#f2f2f2',
    superstructure: '#e8b020',
    funnel: '#e8b020',
    funnelTop: '#1a1a1a',
    deck: '#4a4a4a',
    text: '#ffffff',
  },
};
const NAMED_COLORS = {
  black: '#151515',
  white: '#f4f4f2',
  red: '#b3261e',
  blue: '#1f4e8c',
  'navy blue': '#1b2a4a',
  green: '#2e6b3a',
  grey: '#7a7f85',
  gray: '#7a7f85',
  yellow: '#e2b41b',
  orange: '#e0661b',
  brown: '#6b4630',
  beige: '#d8c8a8',
  'light blue': '#7fb2d8',
  turquoise: '#2aa8a0',
};
/** Seed a livery from Wikidata "color" (P462) statements when present. */
export function liveryFromFacts(kind, facts) {
  const lv = { ...DEFAULT_LIVERY[kind] };
  const named = (facts?.colors ?? []).map((c) => NAMED_COLORS[c.toLowerCase()]).filter(Boolean);
  if (named[0]) lv.hull = named[0];
  if (named[1]) lv.superstructure = named[1];
  return lv;
}
