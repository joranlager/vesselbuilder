// The views a vessel's photos lack, drawn from what is known of her: from above (her waterplane: a
// fine bow, a full stern), and from ahead or astern (the hull her full beam up to the deck, the
// superstructure narrower on it). photomodel.js carves with these as with photos, so a vessel with
// only a side photo still comes out as a ship and not a slab. Also the half-beam along her length,
// for the hull under the water (vesselbuilder.js). Pure, so it is unit tested.
//
// Silhouettes are photomodel.js's: { mask (1 = ship), width, height, box: { x0, y0, x1, y1 } }.

/** The share of the length the bow's taper takes, by kind (presets.js's kinds). */
const ENTRANCE = { ferry: 0.22, cruise: 0.24, liner: 0.26, container: 0.24, cargo: 0.2, tanker: 0.16, bulk: 0.16, tug: 0.3, sailing: 0.32, yacht: 0.36, warship: 0.34, carrier: 0.24 };

/**
 * The half-beam at `a` (0 at the stern, 1 at the bow) as a share of the half-beam: 1 amidships, to
 * nothing at the stem; a transom stern stays wide, a rounded (cruiser) one closes.
 */
export function planShape(a, { kind = 'cargo', stern = 'transom' } = {}) {
  const e = ENTRANCE[kind] ?? 0.22;
  const s = 0.12;
  let f = 1;
  if (a > 1 - e) f = 1 - ((a - (1 - e)) / e) ** 1.8;
  else if (stern === 'double' && a < e) f = 1 - ((e - a) / e) ** 1.8; // a bow at both ends
  else if (a < s) f = stern === 'cruiser' ? 0.15 + 0.85 * Math.sqrt(a / s) : 0.78 + 0.22 * Math.sqrt(a / s);
  return Math.max(0.02, Math.min(1, f));
}

/**
 * A plan view (from above, bow to the right, port up) of a ship `size` { L, B } long and wide: `W`
 * pixels along the length. `halfBeam(a)` (a share, 0..1) defaults to planShape.
 */
export function planSilhouette(size, shape = {}, W = 480, halfBeam = (a) => planShape(a, shape)) {
  const Hpx = Math.max(8, Math.round((W * size.B) / size.L));
  const mask = new Uint8Array(W * Hpx);
  for (let x = 0; x < W; x++) {
    const hb = halfBeam((x + 0.5) / W) * 0.5; // as a share of the beam
    for (let y = 0; y < Hpx; y++) if (Math.abs((y + 0.5) / Hpx - 0.5) <= hb) mask[y * W + x] = 1;
  }
  return { mask, width: W, height: Hpx, box: { x0: 0, y0: 0, x1: W - 1, y1: Hpx - 1 }, synthetic: true };
}

/**
 * Her width at height y (metres above the waterline) as a share of the beam, seen from ahead: the
 * hull the full beam up to `deck` metres, the superstructure `width` of it, narrowing near the top
 * (the wheelhouse roof, the mast).
 */
export function sectionWidth(y, { H, deck, width = 0.8 }) {
  if (y <= deck) return 1;
  const t = (y - deck) / Math.max(0.01, H - deck);
  return width * (t < 0.65 ? 1 : 1 - ((t - 0.65) / 0.35) * 0.6);
}

/** A view from ahead or astern of a ship `size` { B, H } (metres above the waterline): `Hpx` high. */
export function endSilhouette(size, { deck, width }, Hpx = 240) {
  const W = Math.max(8, Math.round((Hpx * size.B) / size.H));
  const mask = new Uint8Array(W * Hpx);
  for (let y = 0; y < Hpx; y++) {
    const w = sectionWidth((1 - (y + 0.5) / Hpx) * size.H, { H: size.H, deck, width }) * 0.5;
    for (let x = 0; x < W; x++) if (Math.abs((x + 0.5) / W - 0.5) <= w) mask[y * W + x] = 1;
  }
  return { mask, width: W, height: Hpx, box: { x0: 0, y0: 0, x1: W - 1, y1: Hpx - 1 }, synthetic: true };
}

/**
 * The half-beam along the length from a plan view's outline (from above, bow to the right, `flip`
 * when the bow is to the left), as a function of a (0 stern, 1 bow) giving a share 0..1; smoothed
 * over a few columns. Made with photomodel.js's scaling for plans (the width is the length, the
 * centre line in the middle), so it agrees with the carving.
 */
export function halfBeamFromPlan(sil, size, flip = false) {
  const { x0, y0, x1, y1 } = sil.box;
  const wpx = x1 - x0 + 1, hpx = y1 - y0 + 1;
  const mid = y0 + hpx / 2;
  const pxPerM = wpx / size.L;
  const raw = new Float32Array(wpx);
  for (let i = 0; i < wpx; i++) {
    const x = x0 + i;
    let far = 0;
    for (let y = y0; y <= y1; y++) if (sil.mask[y * sil.width + x]) far = Math.max(far, Math.abs(y + 0.5 - mid));
    raw[i] = Math.min(1, far / pxPerM / (size.B / 2));
  }
  const k = Math.max(1, Math.round(wpx / 60));
  const smooth = raw.map((_, i) => {
    let s = 0, n = 0;
    for (let j = Math.max(0, i - k); j <= Math.min(wpx - 1, i + k); j++) { s += raw[j]; n++; }
    return s / n;
  });
  return (a) => {
    const u = flip ? 1 - a : a;
    const i = Math.min(wpx - 1, Math.max(0, Math.floor(u * wpx)));
    return Math.max(0.02, smooth[i]);
  };
}

/** A colour #rrggbb mixed with another, `t` of the second. */
export function mix(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}
