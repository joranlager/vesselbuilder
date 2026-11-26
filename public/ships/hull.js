// Ship inspector: the procedural hull surface (HullShape is pure maths and unit tested) and its meshes.

import * as THREE from '../vendor/three.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/**
 * Pure maths describing the hull surface.
 *
 * Coordinates: x along the ship (bow at +x), y up (design waterline at y = 0,
 * keel at y = -draft), z athwartships (starboard +z, port -z).
 * "Heights" (h) inside this class are measured from the keel, so h = y + draft.
 */
export class HullShape {
  p;
  L;
  B;
  T;
  D;
  halfB;
  pm;
  fe;
  fr;
  eBow;
  eStern;
  mSection;
  constructor(p) {
    this.p = p;
    this.L = p.length;
    this.B = p.beam;
    this.T = p.draft;
    this.D = Math.max(p.depth, p.draft + 0.5);
    this.halfB = p.beam / 2;
    const cb = clamp(p.blockCoefficient, 0.35, 0.9);
    this.pm = clamp((cb - 0.5) * 1.6, 0, 0.55); // parallel midbody fraction
    this.fe = (1 - this.pm) * 0.5; // entrance
    this.fr = (1 - this.pm) * 0.5; // run
    this.eBow = 1.25 + 3.5 * (cb - 0.45);
    this.eStern = p.stern === 'cruiser' ? 1.7 : 1.4 + 2.5 * (cb - 0.45);
    this.mSection = clamp(2 + 9 * (cb - 0.45), 1.6, 6.5);
  }
  /** Keel-to-deck height at a longitudinal fraction (0 = stern, 1 = bow). */
  deckH(xn) {
    const fwd = Math.max(0, (xn - 0.45) / 0.55);
    const aft = Math.max(0, (0.4 - xn) / 0.4);
    return this.D + this.p.sheer * this.D * (fwd * fwd + 0.35 * aft * aft);
  }
  get maxDeckH() {
    return Math.max(this.deckH(1), this.deckH(0));
  }
  /** Height of the keel line above baseline: rises at the stern (cut-up) for propeller and rudder. */
  keelH(xn) {
    const T = this.T;
    if (this.p.stern === 'transom') {
      const s = Math.max(0, (0.1 - xn) / 0.1);
      return T * 0.82 * Math.pow(s, 1.6);
    }
    const s = Math.max(0, (0.08 - xn) / 0.08);
    return T * 0.55 * Math.pow(s, 2);
  }
  /** Forward extent of the hull at height h (stem profile). */
  bowX(h) {
    const L2 = this.L / 2;
    const top = this.deckH(1);
    const zn = clamp(h / top, 0, 1);
    switch (this.p.bow) {
      case 'vertical':
        return L2 - 0.02 * top * (1 - zn) - 0.05 * this.T * Math.pow(1 - clamp(h / this.T, 0, 1), 3);
      case 'clipper':
        return L2 - 0.11 * this.L * Math.pow(1 - zn, 1.7);
      case 'bulbous':
      case 'raked':
      default: {
        const rake = 0.55 * (top - h);
        const forefoot = 0.12 * this.T * Math.pow(1 - clamp(h / this.T, 0, 1), 2.5);
        return L2 - rake * 0.45 - forefoot;
      }
    }
  }
  /** Aft extent of the hull at height h (stern profile). */
  sternX(h) {
    const L2 = this.L / 2;
    const top = this.deckH(0);
    if (this.p.stern === 'transom') {
      // slight rake of the transom plate
      return -L2 + 0.12 * (top - h) * 0.3;
    }
    const zn = clamp(h / top, 0, 1);
    return -L2 + 0.05 * this.L * Math.pow(1 - zn, 1.4);
  }
  /** Longitudinal fraction -> x at height h. */
  xAt(xn, h) {
    const a = this.sternX(h);
    const b = this.bowX(h);
    return a + (b - a) * xn;
  }
  /** Plan-view width factor (0..1) of the hull at fraction xn and height h. */
  planW(xn, h) {
    const above = clamp((h - this.T) / Math.max(0.1, this.D - this.T), 0, 1.4);
    const below = clamp(h / this.T, 0, 1);
    if (xn > 1 - this.fe) {
      const t = (1 - xn) / this.fe;
      // flare makes waterlines fuller towards the deck; the forefoot is finer.
      let e = this.eBow * (1 + this.p.flare * 1.6 * above) * (0.8 + 0.2 * below);
      if (this.p.bow === 'clipper') e *= 0.85;
      return 1 - Math.pow(1 - t, Math.max(1.05, e));
    }
    if (xn < this.fr) {
      const s = xn / this.fr;
      let w0 = 0;
      if (this.p.stern === 'transom') w0 = clamp(0.25 + 0.55 * clamp((h - this.T * 0.82) / (this.D - this.T * 0.82), 0, 1), 0, 0.85);
      return w0 + (1 - w0) * (1 - Math.pow(1 - s, this.eStern));
    }
    return 1;
  }
  /** Half-breadth (z) at fraction xn and height h above keel. */
  halfBreadth(xn, h) {
    const kh = this.keelH(xn);
    const w = this.planW(xn, h);
    if (h >= this.T) return this.halfB * w;
    const zn = clamp((h - kh) / Math.max(0.05, this.T - kh), 0, 1);
    // Sections become V-shaped where the waterline is fine.
    const wl = this.planW(xn, this.T);
    const m = 1.15 + (this.mSection - 1.15) * Math.min(1, Math.pow(wl, 1.5));
    const sec = Math.pow(1 - Math.pow(1 - zn, m), 1 / m);
    return this.halfB * w * sec;
  }
  /** World-space deck height and half width at a given x. */
  deckAt(x) {
    // Solve xn for the deck row (deck height depends weakly on xn; two iterations is plenty).
    let xn = clamp((x + this.L / 2) / this.L, 0, 1);
    for (let k = 0; k < 3; k++) {
      const h = this.deckH(xn);
      const a = this.sternX(h);
      const b = this.bowX(h);
      xn = clamp((x - a) / (b - a), 0, 1);
    }
    const h = this.deckH(xn);
    return { y: h - this.T, halfWidth: this.halfBreadth(xn, h), xn };
  }
}
const NS = 120; // stations
const NW = 18; // rows below the waterline
const NA = 12; // rows above the waterline
export function buildHull(p) {
  const s = new HullShape(p);
  const NV = NW + NA;
  const texH = s.maxDeckH;
  const L = s.L;
  // Sample grid of the starboard side.
  const X = [];
  const Y = [];
  const Z = [];
  for (let i = 0; i <= NS; i++) {
    // cluster stations towards the ends where curvature is highest
    const t = i / NS;
    const xn = 0.5 - 0.5 * Math.cos(Math.PI * t) * 0.35 + (t - 0.5) * 0.65;
    const kh = s.keelH(xn);
    const dh = s.deckH(xn);
    const xr = [];
    const yr = [];
    const zr = [];
    for (let j = 0; j <= NV; j++) {
      let h;
      if (j <= NW) {
        const u = j / NW;
        h = kh + (s.T - kh) * Math.pow(u, 1.5);
      } else {
        h = s.T + (dh - s.T) * ((j - NW) / NA);
      }
      if (kh > s.T && j <= NW) h = kh; // fully cut-up region collapses
      xr.push(s.xAt(xn, h));
      yr.push(h - s.T);
      zr.push(s.halfBreadth(xn, h));
    }
    X.push(xr);
    Y.push(yr);
    Z.push(zr);
  }
  // ---- hull sides (starboard then port) ----
  const pos = [];
  const uv = [];
  const idx = [];
  const cols = NV + 1;
  for (const side of [1, -1]) {
    const base = pos.length / 3;
    for (let i = 0; i <= NS; i++) {
      for (let j = 0; j <= NV; j++) {
        const x = X[i][j];
        const y = Y[i][j];
        const z = Z[i][j] * side;
        pos.push(x, y, z);
        const u = (x + L / 2) / L;
        const v = (y + s.T) / texH;
        // Starboard occupies the top half of the texture, port the bottom half,
        // each laid out as seen from outside the ship (so lettering is never mirrored).
        if (side === 1) uv.push(u, 0.5 + 0.5 * v);
        else uv.push(1 - u, 0.5 * v);
      }
    }
    for (let i = 0; i < NS; i++) {
      for (let j = 0; j < NV; j++) {
        const a = base + i * cols + j;
        const b = base + (i + 1) * cols + j;
        const c = base + (i + 1) * cols + j + 1;
        const d = base + i * cols + j + 1;
        if (side === 1) idx.push(a, b, c, a, c, d);
        else idx.push(a, c, b, a, d, c);
      }
    }
  }
  const hull = new THREE.BufferGeometry();
  hull.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  hull.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  hull.setIndex(idx);
  hull.computeVertexNormals();
  // ---- deck (with a little camber) ----
  const dpos = [];
  const duv = [];
  const didx = [];
  const camber = s.B * 0.012;
  for (let i = 0; i <= NS; i++) {
    const x = X[i][NV];
    const y = Y[i][NV];
    const hw = Z[i][NV];
    const cy = y + camber * Math.min(1, hw / s.halfB);
    dpos.push(x, y, hw, x, cy, 0, x, y, -hw);
    const u = (x + L / 2) / L;
    duv.push(u, 1, u, 0.5, u, 0);
  }
  for (let i = 0; i < NS; i++) {
    const S0 = i * 3,
      C0 = S0 + 1,
      P0 = S0 + 2;
    const S1 = S0 + 3,
      C1 = S1 + 1,
      P1 = S1 + 2;
    didx.push(S0, S1, C0, C0, S1, C1, C0, C1, P0, P0, C1, P1);
  }
  const deck = new THREE.BufferGeometry();
  deck.setAttribute('position', new THREE.Float32BufferAttribute(dpos, 3));
  deck.setAttribute('uv', new THREE.Float32BufferAttribute(duv, 2));
  deck.setIndex(didx);
  deck.computeVertexNormals();
  // ---- transom plate ----
  let transom = null;
  let transomInfo = null;
  if (p.stern === 'transom') {
    const tp = [];
    const tuv = [];
    const ti = [];
    let maxW = 0.01;
    for (let j = 0; j <= NV; j++) maxW = Math.max(maxW, Z[0][j]);
    const bottomY = Y[0][0];
    const topY = Y[0][NV];
    for (let j = 0; j <= NV; j++) {
      const x = X[0][j];
      const y = Y[0][j];
      const w = Z[0][j];
      const v = (y - bottomY) / Math.max(0.01, topY - bottomY);
      tp.push(x, y, w, x, y, -w);
      // seen from astern (looking +x), +z (starboard) is on the viewer's right
      tuv.push(0.5 + (0.5 * w) / maxW, v, 0.5 - (0.5 * w) / maxW, v);
    }
    for (let j = 0; j < NV; j++) {
      const S0 = j * 2,
        P0 = S0 + 1,
        S1 = S0 + 2,
        P1 = S0 + 3;
      ti.push(S0, S1, P0, P0, S1, P1);
    }
    transom = new THREE.BufferGeometry();
    transom.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
    transom.setAttribute('uv', new THREE.Float32BufferAttribute(tuv, 2));
    transom.setIndex(ti);
    transom.computeVertexNormals();
    transomInfo = { halfWidth: maxW, bottomY, topY };
  }
  // ---- bulbous bow ----
  let bulb = null;
  if (p.bow === 'bulbous') {
    const hc = s.T * 0.42;
    const len = 0.075 * L;
    const ry = s.T * 0.27;
    const rz = Math.min(s.B * 0.085, ry * 1.1);
    const g = new THREE.SphereGeometry(1, 32, 18);
    g.scale(len / 2, ry, rz);
    const tip = s.bowX(s.T * 0.9) + 0.025 * L;
    g.translate(tip - len / 2, hc - s.T, 0);
    bulb = g;
  }
  return { shape: s, hull, deck, transom, bulb, texHeight: texH, transomInfo };
}
