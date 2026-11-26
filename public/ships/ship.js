// Ship inspector: assembles a whole ship (hull, decks, deckhouses, funnels, masts, cargo) and its materials.

import * as THREE from '../vendor/three.js';
import { buildHull } from './hull.js';
import { paintHull, paintTransom } from './hullText.js';

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const CONTAINER_COLORS = ['#2f6fa6', '#b8312f', '#8a8f94', '#e3e3de', '#d9822b', '#3b7d4a', '#7a4a2e', '#1f3d6b', '#c9b037', '#5a2e5f'];
function makeMaterials() {
  const std = (name, o = {}) => {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.05, ...o });
    m.name = name;
    return m;
  };
  const rig = new THREE.LineBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.7 });
  rig.name = 'rigging';
  return {
    hull: std('hull_livery', { roughness: 0.5, metalness: 0.1 }),
    transom: std('transom_livery', { roughness: 0.5, metalness: 0.1 }),
    deck: std('deck', { roughness: 0.85 }),
    bulb: std('antifouling', { roughness: 0.7 }),
    superstructure: std('superstructure', { roughness: 0.45 }),
    window: std('windows', { color: 0x2b3f52, roughness: 0.12, metalness: 0.55 }),
    funnel: std('funnel', { roughness: 0.45 }),
    funnelTop: std('funnel_top', { roughness: 0.8 }),
    metal: std('metal', { color: 0x9aa1a8, roughness: 0.35, metalness: 0.7 }),
    lifeboat: std('lifeboat', { color: 0xf07a1a, roughness: 0.5 }),
    sail: std('sail', { color: 0xf1ead8, roughness: 0.9, side: THREE.DoubleSide }),
    wood: std('wood', { color: 0x6b4a2b, roughness: 0.8 }),
    container: std('containers', { color: 0xffffff, roughness: 0.7 }),
    marking: std('markings', { color: 0xf2f2f2, roughness: 0.6 }),
    rigging: rig,
  };
}
/** Plan-view deckhouse with rounded corners, extruded upwards from y = 0. */
function houseGeom(x0, x1, halfW, h, roundFront = 0.15, roundAft = 0.05) {
  const len = Math.max(0.2, x1 - x0);
  const rf = Math.min(roundFront * halfW, len / 2, halfW);
  const ra = Math.min(roundAft * halfW, len / 2 - rf * 0.01, halfW);
  const s = new THREE.Shape();
  s.moveTo(x0 + ra, -halfW);
  s.lineTo(x1 - rf, -halfW);
  s.quadraticCurveTo(x1, -halfW, x1, -halfW + rf);
  s.lineTo(x1, halfW - rf);
  s.quadraticCurveTo(x1, halfW, x1 - rf, halfW);
  s.lineTo(x0 + ra, halfW);
  s.quadraticCurveTo(x0, halfW, x0, halfW - ra);
  s.lineTo(x0, -halfW + ra);
  s.quadraticCurveTo(x0, -halfW, x0 + ra, -halfW);
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.05, h), bevelEnabled: false, curveSegments: 6 });
  g.rotateX(-Math.PI / 2);
  return g;
}
class Builder {
  s;
  p;
  m;
  group = new THREE.Group();
  rnd;
  constructor(s, p, m) {
    this.s = s;
    this.p = p;
    this.m = m;
    this.rnd = mulberry32(p.seed || 1);
  }
  get L() {
    return this.s.L;
  }
  add(geom, mat, name, at) {
    const mesh = new THREE.Mesh(geom, mat);
    mesh.name = name;
    if (at) mesh.position.set(at.x, at.y, at.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    return mesh;
  }
  /** lowest deck height and narrowest half width over [x0, x1] */
  span(x0, x1) {
    let y = Infinity;
    let hw = Infinity;
    for (let k = 0; k <= 8; k++) {
      const d = this.s.deckAt(x0 + ((x1 - x0) * k) / 8);
      y = Math.min(y, d.y);
      hw = Math.min(hw, d.halfWidth);
    }
    return { y, hw: Math.max(0.3, hw) };
  }
  house(x0, x1, halfW, y, h, opts = {}) {
    const g = houseGeom(x0, x1, halfW, h, opts.round ?? 0.15, opts.roundAft ?? 0.05);
    this.add(g, opts.mat ?? this.m.superstructure, opts.name ?? 'deckhouse', { x: 0, y, z: 0 });
    if (opts.windows) {
      const wh = h * opts.windows;
      const wg = houseGeom(x0 - 0.04, x1 + 0.04, halfW + 0.04, wh, opts.round ?? 0.15, opts.roundAft ?? 0.05);
      this.add(wg, this.m.window, 'windows', { x: 0, y: y + h * 0.42 - wh / 2 + h * 0.08, z: 0 });
    }
  }
  box(w, h, d, mat, x, y, z, name = 'box') {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(0, h / 2, 0);
    return this.add(g, mat, name, { x, y, z });
  }
  funnel(x, z, y, h, rx, rz, rake = 0.06) {
    const f = new THREE.Group();
    f.name = 'funnel';
    const body = new THREE.CylinderGeometry(1, 1.06, 1, 28);
    body.translate(0, 0.5, 0);
    body.scale(rx, h * 0.84, rz);
    const top = new THREE.CylinderGeometry(1, 1, 1, 28);
    top.translate(0, 0.5, 0);
    top.scale(rx, h * 0.16, rz);
    top.translate(0, h * 0.84, 0);
    const a = new THREE.Mesh(body, this.m.funnel);
    const b = new THREE.Mesh(top, this.m.funnelTop);
    a.name = 'funnel';
    b.name = 'funnel_top';
    for (const mm of [a, b]) {
      mm.castShadow = true;
      mm.receiveShadow = true;
      f.add(mm);
    }
    f.position.set(x, y - 0.3, z);
    f.rotation.z = rake;
    this.group.add(f);
  }
  mast(x, z, y0, y1, r, opts = {}) {
    const h = Math.max(1, y1 - y0);
    const g = new THREE.CylinderGeometry(r * 0.55, r, h, 10);
    g.translate(0, h / 2, 0);
    const mast = this.add(g, this.m.metal, 'mast', { x, y: y0, z });
    mast.rotation.z = opts.rake ?? 0;
    if (opts.yard) {
      const yg = new THREE.CylinderGeometry(r * 0.35, r * 0.35, opts.yard, 8);
      yg.rotateX(Math.PI / 2);
      yg.translate(0, h * 0.72, 0);
      mast.add(new THREE.Mesh(yg, this.m.metal));
    }
    if (opts.radar) {
      const rg = new THREE.BoxGeometry(r * 1.2, r * 0.6, Math.min(this.s.B * 0.35, r * 14));
      rg.translate(r * 1.5, h * 0.6, 0);
      const radar = new THREE.Mesh(rg, this.m.metal);
      radar.name = 'radar';
      mast.add(radar);
    }
    return mast;
  }
  lifeboats(x0, x1, y, zAbs, size, mat = this.m.lifeboat) {
    const n = Math.max(1, Math.floor((x1 - x0) / (size * 1.45)));
    const r = size * 0.18;
    const proto = new THREE.CapsuleGeometry(r, size - 2 * r, 4, 10);
    proto.rotateZ(Math.PI / 2);
    for (const side of [1, -1]) {
      for (let k = 0; k < n; k++) {
        const x = x0 + ((k + 0.5) * (x1 - x0)) / n;
        this.add(proto.clone(), mat, 'lifeboat', { x, y: y + r, z: side * zAbs });
      }
    }
    proto.dispose();
  }
  rigging(points) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    const lines = new THREE.LineSegments(g, this.m.rigging);
    lines.name = 'rigging';
    this.group.add(lines);
  }
  /** stack of tiers; returns the top of the stack */
  stack(x0, x1, tiers, tierH, widthFrac, step, opts = {}) {
    const { y, hw } = this.span(x0, x1);
    let top = y;
    for (let t = 0; t < tiers; t++) {
      const a = x0 + t * step * 0.3;
      const b = x1 - t * step;
      if (b - a < 1.5) break;
      this.house(a, b, hw * widthFrac * (1 - t * 0.01), top, tierH * 0.985, { round: opts.round, windows: opts.windows ?? 0.32 });
      top += tierH;
    }
    return { top, hw, y };
  }
  bridgeWings(x, y, h, halfW) {
    this.house(x - 3.2, x, halfW, y, h, { round: 0.02, windows: 0.4, name: 'bridge_wings' });
  }
  hatches(x0, x1, n, widthFrac, mat = this.m.funnel) {
    const gap = 1.8;
    const len = (x1 - x0 - gap * (n - 1)) / n;
    for (let k = 0; k < n; k++) {
      const a = x0 + k * (len + gap);
      const { y, hw } = this.span(a, a + len);
      this.house(a, a + len, hw * widthFrac, y - 0.2, 1.8, { round: 0.02, mat, roundAft: 0.02, name: 'hatch_cover' });
    }
  }
  crane(x, y, h, jib, dir) {
    const post = new THREE.CylinderGeometry(0.7, 0.9, h, 12);
    post.translate(0, h / 2, 0);
    this.add(post, this.m.funnel, 'crane', { x, y, z: 0 });
    const jg = new THREE.CylinderGeometry(0.25, 0.4, jib, 8);
    jg.translate(0, jib / 2, 0);
    const j = this.add(jg, this.m.funnel, 'crane_jib', { x, y: y + h * 0.85, z: 0 });
    j.rotation.z = -dir * 1.15;
  }
  containers(x0, x1, maxTiers, avoid) {
    const bayL = 12.4;
    const cw = 2.44;
    const ch = 2.59;
    const items = [];
    for (let a = x0; a + bayL <= x1; a += bayL + 0.6) {
      if (avoid.some(([p, q]) => a + bayL > p && a < q)) continue;
      const { y, hw } = this.span(a, a + bayL);
      const rows = Math.floor((hw * 2 * 0.96) / cw);
      if (rows < 1) continue;
      // bays near the bow carry fewer tiers to keep the forward view clear
      const fwd = (a + bayL / 2) / (this.L / 2);
      const bayTiers = Math.max(1, Math.round(maxTiers * (fwd > 0.6 ? 0.6 : 1)));
      for (let r = 0; r < rows; r++) {
        const z = (r - (rows - 1) / 2) * cw;
        const tiers = Math.max(1, bayTiers - (this.rnd() < 0.35 ? Math.floor(this.rnd() * 3) : 0));
        for (let t = 0; t < tiers; t++) {
          const c = CONTAINER_COLORS[Math.floor(this.rnd() * CONTAINER_COLORS.length)];
          items.push({ x: a + bayL / 2, y: y + 0.3 + t * ch + ch / 2, z, c });
        }
      }
    }
    if (!items.length) return;
    const g = new THREE.BoxGeometry(bayL - 0.2, ch - 0.06, cw - 0.08);
    const inst = new THREE.InstancedMesh(g, this.m.container, items.length);
    inst.name = 'containers';
    const mtx = new THREE.Matrix4();
    const col = new THREE.Color();
    items.forEach((it, k) => {
      mtx.makeTranslation(it.x, it.y, it.z);
      inst.setMatrixAt(k, mtx);
      inst.setColorAt(k, col.set(it.c));
    });
    inst.castShadow = true;
    inst.receiveShadow = true;
    this.group.add(inst);
  }
  sails(x, y0, top) {
    const B = this.s.B;
    const levels = [0.3, 0.5, 0.67, 0.82, 0.94];
    const H = top - y0;
    for (let k = 0; k < levels.length - 1; k++) {
      const yy = y0 + H * levels[k + 1];
      const yb = y0 + H * levels[k] + 0.3;
      const w = B * 1.9 * (1 - 0.17 * k);
      const yard = new THREE.CylinderGeometry(0.18, 0.18, w * 1.06, 6);
      yard.rotateX(Math.PI / 2);
      this.add(yard, this.m.wood, 'yard', { x, y: yy, z: 0 });
      const sh = yy - yb;
      const sg = new THREE.PlaneGeometry(w, sh, 10, 6);
      const pos = sg.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        const u = pos.getX(i) / w + 0.5;
        const v = pos.getY(i) / sh + 0.5;
        pos.setZ(i, Math.sin(Math.PI * u) * Math.sin(Math.PI * (0.15 + 0.85 * v)) * w * 0.07);
      }
      sg.computeVertexNormals();
      sg.rotateY(Math.PI / 2); // plane faces +x (forward), billowing forward
      this.add(sg, this.m.sail, 'sail', { x: x + 0.4, y: yb + sh / 2, z: 0 });
    }
  }
}
export function buildShip(p, livery, text) {
  const hb = buildHull(p);
  const s = hb.shape;
  const m = makeMaterials();
  const b = new Builder(s, p, m);
  const L = s.L;
  const T = s.T;
  const F = s.D - T; // freeboard amidships
  const air = Math.max(p.airDraft, F + 3);
  const avail = air - F;
  // hull and texture
  const hullCanvas = document.createElement('canvas');
  const hullTex = new THREE.CanvasTexture(hullCanvas);
  hullTex.colorSpace = THREE.SRGBColorSpace;
  hullTex.anisotropy = 8;
  m.hull.map = hullTex;
  b.add(hb.hull, m.hull, 'hull');
  b.add(hb.deck, m.deck, 'deck');
  let transomCanvas = null;
  let transomTex = null;
  if (hb.transom) {
    transomCanvas = document.createElement('canvas');
    transomTex = new THREE.CanvasTexture(transomCanvas);
    transomTex.colorSpace = THREE.SRGBColorSpace;
    m.transom.map = transomTex;
    b.add(hb.transom, m.transom, 'transom');
  }
  if (hb.bulb) b.add(hb.bulb, m.bulb, 'bulbous_bow');
  const X = (f) => f * L;
  const merchantTierH = Math.min(3.0, Math.max(2.3, (avail * 0.68) / Math.max(1, p.decks)));
  const aftHouse = (x0f, x1f, funnelF) => {
    const st = b.stack(X(x0f), X(x1f), p.decks, merchantTierH, 0.86, 0.35, { round: 0.04 });
    const front = X(x1f) - (p.decks - 1) * 0.35;
    b.bridgeWings(front, st.top - merchantTierH, merchantTierH * 0.95, s.halfB * 1.0);
    if (p.funnels > 0) {
      const fy = b.span(X(funnelF) - 3, X(funnelF) + 3).y;
      b.funnel(X(funnelF), 0, fy, Math.max(6, st.top - fy + merchantTierH * 1.4), Math.max(2, 0.018 * L), Math.max(1.6, s.B * 0.13), 0.05);
    }
    if (p.masts > 0) b.mast(front - 4, 0, st.top, Math.max(st.top + 3, air), 0.35, { yard: s.B * 0.4, radar: true });
    return st;
  };
  const foremast = (f = 0.45) => {
    const d = s.deckAt(X(f));
    b.mast(X(f), 0, d.y, d.y + Math.max(6, avail * 0.45), 0.35, { yard: s.B * 0.25 });
  };
  switch (p.kind) {
    case 'container': {
      const st = aftHouse(-0.41, -0.33, -0.445);
      const maxTiers = Math.max(1, Math.min(9, Math.floor((st.top - st.y - 5) / 2.59)));
      b.containers(X(-0.315), X(0.4), maxTiers, []);
      const d = s.deckAt(X(0.425));
      b.house(X(0.41), X(0.44), d.halfWidth * 0.9, d.y, Math.min(6, maxTiers * 2.6 * 0.4), { round: 0.6, name: 'breakwater' });
      foremast(0.455);
      break;
    }
    case 'tanker': {
      aftHouse(-0.45, -0.36, -0.47);
      const { y } = b.span(X(-0.34), X(0.42));
      b.box(X(0.76), 1.2, 1.4, m.metal, X(0.04), y + 0.4, 0, 'pipe_rack');
      b.box(4, 2.2, s.B * 0.8, m.metal, X(0.0), y + 0.2, 0, 'manifold');
      foremast();
      break;
    }
    case 'bulk': {
      aftHouse(-0.45, -0.36, -0.47);
      b.hatches(X(-0.33), X(0.41), 7, 0.6);
      const dy = b.span(X(-0.3), X(0.3)).y;
      for (const f of [-0.225, -0.115, -0.005, 0.105]) b.crane(X(f), dy, Math.max(8, avail * 0.35), s.B * 0.75, 1);
      foremast();
      break;
    }
    case 'cargo': {
      aftHouse(-0.42, -0.32, -0.445);
      b.hatches(X(-0.29), X(0.4), 4, 0.68);
      const dy = b.span(X(-0.3), X(0.3)).y;
      for (const f of [-0.12, 0.05, 0.22]) b.crane(X(f), dy, Math.max(8, avail * 0.4), s.B * 0.8, 1);
      foremast();
      break;
    }
    case 'cruise':
    case 'ferry': {
      const cruise = p.kind === 'cruise';
      const tierH = Math.min(3.2, Math.max(2.5, (avail * (cruise ? 0.78 : 0.62)) / Math.max(1, p.decks)));
      const x0 = X(cruise ? -0.46 : -0.36);
      const x1 = X(cruise ? 0.33 : 0.26);
      const { y, hw } = b.span(x0, x1);
      let top = y;
      for (let t = 0; t < p.decks; t++) {
        const frac = t / Math.max(1, p.decks - 1);
        const a = x0 + (frac > 0.6 ? (frac - 0.6) * X(0.12) : 0);
        const f = x1 - frac * X(0.05) - (frac > 0.75 ? X(0.04) : 0);
        b.house(a, f, hw * 0.985, top, tierH * 0.985, { round: 0.55, roundAft: 0.15, windows: 0.36 });
        top += tierH;
      }
      const bridgeTier = Math.max(1, Math.round(p.decks * (cruise ? 0.62 : 0.7)));
      const bridgeY = y + bridgeTier * tierH;
      b.bridgeWings(x1 - (bridgeTier / Math.max(1, p.decks - 1)) * X(0.05) - X(0.004), bridgeY, tierH * 0.95, s.halfB * 1.06);
      b.lifeboats(x0 + X(0.18), x1 - X(0.2), y + tierH * 1.15, hw * 0.985 + 1.6, Math.max(6, Math.min(12, L * 0.035)));
      const fx = cruise ? X(-0.3) : X(-0.22);
      const fh = Math.max(tierH * 2.5, air - top);
      if (p.funnels >= 2 && !cruise) {
        b.funnel(fx, s.B * 0.22, top, fh, X(0.025), s.B * 0.09, 0.1);
        b.funnel(fx, -s.B * 0.22, top, fh, X(0.025), s.B * 0.09, 0.1);
      } else if (p.funnels > 0) {
        for (let k = 0; k < p.funnels; k++) b.funnel(fx - k * X(0.07), 0, top, fh, X(0.035), s.B * 0.22, 0.14);
      }
      if (p.masts > 0) b.mast(x1 - X(0.12), 0, top, Math.max(top + 4, air), 0.4, { radar: true, yard: s.B * 0.3 });
      break;
    }
    case 'liner': {
      const tierH = 2.7;
      const x0 = X(-0.3);
      const x1 = X(0.26);
      const st = b.stack(x0, x1, p.decks, tierH, 0.92, 0.6, { round: 0.3, windows: 0.25 });
      b.bridgeWings(x1 - (p.decks - 1) * 0.6, st.top - tierH, tierH * 0.95, s.halfB * 0.98);
      m.lifeboat.color.set('#f2f2ee');
      b.lifeboats(x0 + X(0.04), x1 - X(0.1), st.top, st.hw * 0.86, 9);
      const n = Math.max(0, p.funnels);
      for (let k = 0; k < n; k++) {
        const fx = n === 1 ? X(-0.02) : X(0.18 - (0.38 * k) / (n - 1));
        b.funnel(fx, 0, st.top, Math.max(8, (air - st.top) * 0.55), X(0.014), X(0.011), 0.09);
      }
      const mf = s.deckAt(X(0.37));
      const ma = s.deckAt(X(-0.36));
      b.mast(X(0.37), 0, mf.y, air, 0.4, { rake: 0.09, yard: s.B * 0.3 });
      b.mast(X(-0.36), 0, ma.y, air * 0.96, 0.4, { rake: 0.09, yard: s.B * 0.3 });
      const topF = new THREE.Vector3(X(0.37) - Math.sin(0.09) * (air - mf.y), air, 0);
      const topA = new THREE.Vector3(X(-0.36) - Math.sin(0.09) * (air * 0.96 - ma.y), air * 0.96, 0);
      const bowD = s.deckAt(X(0.49));
      const sternD = s.deckAt(X(-0.49));
      b.rigging([topF.x, topF.y, 0, topA.x, topA.y, 0, topF.x, topF.y, 0, X(0.49), bowD.y, 0, topA.x, topA.y, 0, X(-0.49), sternD.y, 0]);
      break;
    }
    case 'warship': {
      const tierH = Math.min(3.0, Math.max(2.4, avail * 0.12));
      const { y, hw } = b.span(X(-0.24), X(0.1));
      b.house(X(-0.24), X(0.1), hw * 0.88, y, tierH * 1.6, { round: 0.05, name: 'hangar' });
      b.house(X(-0.06), X(0.1), hw * 0.78, y + tierH * 1.6, tierH, { round: 0.2 });
      b.house(X(0.0), X(0.095), hw * 0.62, y + tierH * 2.6, tierH, { round: 0.3, windows: 0.4, name: 'bridge' });
      const mastBase = y + tierH * 3.6;
      const mh = Math.max(6, air - mastBase);
      const pg = new THREE.CylinderGeometry(0.5, hw * 0.45, mh, 4);
      pg.rotateY(Math.PI / 4);
      pg.translate(0, mh / 2, 0);
      b.add(pg, m.superstructure, 'mast', { x: X(0.04), y: mastBase, z: 0 });
      for (const side of [1, -1]) {
        b.box(0.3, tierH * 1.1, hw * 0.5, m.metal, X(0.04) + side * hw * 0.2, mastBase + mh * 0.15, 0, 'radar_panel');
      }
      if (p.funnels > 0) b.funnel(X(-0.09), 0, y + tierH * 1.6, tierH * 2.2, X(0.022), hw * 0.4, 0.04);
      const gy = s.deckAt(X(0.3)).y;
      b.house(X(0.27), X(0.32), hw * 0.38, gy, 1.8, { round: 0.9, name: 'gun_turret' });
      const barrel = new THREE.CylinderGeometry(0.12, 0.18, X(0.06), 10);
      barrel.rotateZ(-Math.PI / 2);
      barrel.translate(X(0.03), 0, 0);
      const bm = b.add(barrel, m.metal, 'gun_barrel', { x: X(0.32), y: gy + 1.1, z: 0 });
      bm.rotation.z = 0.06;
      const vy = s.deckAt(X(0.2)).y;
      b.box(X(0.05), 0.25, hw * 0.9, m.funnelTop, X(0.2), vy, 0, 'vls_cells');
      const hy = s.deckAt(X(-0.38)).y;
      const ring = new THREE.RingGeometry(hw * 0.5, hw * 0.56, 40);
      ring.rotateX(-Math.PI / 2);
      b.add(ring, m.marking, 'helideck_marking', { x: X(-0.38), y: hy + 0.05, z: 0 });
      break;
    }
    case 'carrier': {
      const fy = s.deckAt(0).y + 2.5;
      const B = s.B;
      const pts = [
        [-0.495, -0.62],
        [-0.495, 0.56],
        [0.22, 0.62],
        [0.44, 0.32],
        [0.5, 0.05],
        [0.47, -0.3],
        [0.12, -0.8],
        [-0.22, -0.82],
      ];
      // shape y maps to world -z after rotateX(-90deg), so negate to keep +pz = starboard
      const shape2 = new THREE.Shape(pts.map(([px, pz]) => new THREE.Vector2(X(px), -pz * B)));
      const fd = new THREE.ExtrudeGeometry(shape2, { depth: 1.4, bevelEnabled: false });
      fd.rotateX(-Math.PI / 2);
      b.add(fd, m.deck, 'flight_deck', { x: 0, y: fy - 1.4, z: 0 });
      // hangar walls: follow the deck edge up to the flight deck
      {
        const wp = [];
        const wi = [];
        const N = 60;
        for (let k = 0; k <= N; k++) {
          const d = s.deckAt(X(-0.495 + (0.985 * k) / N));
          const x = X(-0.495 + (0.985 * k) / N);
          const w = d.halfWidth * 0.985;
          wp.push(x, d.y - 0.3, w, x, fy - 1.3, w, x, d.y - 0.3, -w, x, fy - 1.3, -w);
        }
        for (let k = 0; k < N; k++) {
          const a = k * 4;
          const c = a + 4;
          wi.push(a, c, c + 1, a, c + 1, a + 1); // starboard, facing +z
          wi.push(a + 2, a + 3, c + 3, a + 2, c + 3, c + 2); // port, facing -z
        }
        wi.push(0, 1, 3, 0, 3, 2); // stern wall, facing -x
        const wg = new THREE.BufferGeometry();
        wg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
        wg.setIndex(wi);
        wg.computeVertexNormals();
        b.add(wg, m.superstructure, 'hangar_sides');
      }
      // deck markings
      const line = (x0, z0, x1, z1) => {
        const len = Math.hypot(x1 - x0, z1 - z0);
        const g = new THREE.BoxGeometry(len, 0.05, 0.6);
        const mm = b.add(g, m.marking, 'deck_marking', { x: (x0 + x1) / 2, y: fy + 0.04, z: (z0 + z1) / 2 });
        mm.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
      };
      line(X(-0.45), 0, X(0.45), 0);
      line(X(-0.45), -B * 0.05, X(0.15), -B * 0.6);
      // island on the starboard edge
      const ix0 = X(0.02);
      const ix1 = X(0.12);
      const iz = B * 0.48;
      const ih = Math.max(8, (air - fy) * 0.45);
      const isl = houseGeom(ix0, ix1, B * 0.07, ih, 0.2, 0.2);
      b.add(isl, m.superstructure, 'island', { x: 0, y: fy, z: iz });
      const iw = houseGeom(ix0 - 0.05, ix1 + 0.05, B * 0.072, ih * 0.12, 0.2, 0.2);
      b.add(iw, m.window, 'windows', { x: 0, y: fy + ih * 0.7, z: iz });
      b.mast((ix0 + ix1) / 2, iz, fy + ih, Math.max(fy + ih + 4, air), 0.5, { radar: true, yard: B * 0.15 });
      // a few parked aircraft silhouettes
      const ac = new THREE.Group();
      for (let k = 0; k < 6; k++) {
        const fus = new THREE.BoxGeometry(17, 1.6, 1.6);
        const wing = new THREE.BoxGeometry(5, 0.3, 13);
        wing.translate(-1, 0, 0);
        const am = new THREE.Mesh(fus, m.metal);
        const wm = new THREE.Mesh(wing, m.metal);
        am.add(wm);
        am.position.set(X(-0.3) + k * 19, fy + 1, B * 0.35);
        am.rotation.y = 0.6;
        am.castShadow = true;
        ac.add(am);
      }
      ac.name = 'aircraft';
      b.group.add(ac);
      break;
    }
    case 'sailing': {
      const n = Math.max(1, Math.min(5, p.masts));
      const positions = n === 1 ? [0.05] : Array.from({ length: n }, (_, k) => 0.27 - (0.52 * k) / (n - 1));
      positions.forEach((f, k) => {
        const d = s.deckAt(X(f));
        const top = k === Math.floor(n / 2) || n <= 2 ? air : air * (0.92 - 0.04 * Math.abs(k - Math.floor(n / 2)));
        b.mast(X(f), 0, d.y, top, Math.max(0.25, s.B * 0.035));
        b.sails(X(f), d.y, top);
        b.rigging([X(f), top * 0.95, 0, X(f) - 2, d.y, d.halfWidth, X(f), top * 0.95, 0, X(f) - 2, d.y, -d.halfWidth]);
      });
      // bowsprit and jib
      const bow = s.deckAt(X(0.49));
      const bsLen = X(0.16);
      const bs = new THREE.CylinderGeometry(0.15, 0.3, bsLen, 8);
      bs.translate(0, bsLen / 2, 0);
      const bsm = b.add(bs, m.wood, 'bowsprit', { x: X(0.47), y: bow.y, z: 0 });
      bsm.rotation.z = -Math.PI / 2 + 0.25;
      const tip = new THREE.Vector3(X(0.47) + Math.cos(0.25) * bsLen, bow.y + Math.sin(0.25) * bsLen, 0);
      const fore = X(positions[0]);
      // two headsails set on the forestays between the foremast and the bowsprit
      const foreDeck = s.deckAt(fore).y;
      const stayTop = new THREE.Vector3(fore, foreDeck + (air - foreDeck) * 0.62, 0);
      b.rigging([tip.x, tip.y, 0, stayTop.x, stayTop.y, 0]);
      for (const [f0, f1] of [
        [0.12, 0.55],
        [0.6, 0.95],
      ]) {
        const a = new THREE.Vector3().lerpVectors(tip, stayTop, f0);
        const c = new THREE.Vector3().lerpVectors(tip, stayTop, f1);
        const foot = new THREE.Vector3().lerpVectors(a, c, 0.15);
        foot.y = Math.max(foreDeck + 2.5, a.y + 1);
        foot.x = Math.min(foot.x + (c.x - a.x) * 0.4, X(0.48));
        const jg = new THREE.BufferGeometry().setFromPoints([a, c, foot]);
        jg.computeVertexNormals();
        b.add(jg, m.sail, 'jib');
      }
      const { y, hw } = b.span(X(-0.4), X(-0.3));
      b.house(X(-0.42), X(-0.3), hw * 0.55, y, 2.2, { mat: m.wood, round: 0.1, name: 'deckhouse' });
      break;
    }
    case 'yacht': {
      const tierH = 2.9;
      const tiers = Math.max(1, Math.min(5, p.decks));
      const { y, hw } = b.span(X(-0.32), X(0.2));
      let top = y;
      for (let t = 0; t < tiers; t++) {
        const a = X(-0.32 + t * 0.05);
        const f = X(0.2 - t * 0.08);
        if (f - a < 3) break;
        b.house(a, f, hw * (0.96 - t * 0.06), top, tierH, { round: 0.9, roundAft: 0.3, windows: 0.55 });
        top += tierH;
      }
      const arch = Math.max(top + 2, Math.min(air, top + 6));
      b.mast(X(-0.05), 0, top, arch, 0.3, { radar: true });
      break;
    }
    case 'tug': {
      const { y, hw } = b.span(X(-0.05), X(0.25));
      b.house(X(-0.05), X(0.25), hw * 0.78, y, 2.6, { round: 0.3, windows: 0.25 });
      b.house(X(0.05), X(0.22), hw * 0.62, y + 2.6, 2.5, { round: 0.4, windows: 0.55, name: 'wheelhouse' });
      for (const side of p.funnels >= 2 ? [1, -1] : [0]) {
        b.funnel(X(-0.08), side * hw * 0.4, y, 7.5, 0.8, 0.6, 0.12);
      }
      b.mast(X(0.14), 0, y + 5.1, Math.max(y + 9, air), 0.2, { radar: true, yard: s.B * 0.3 });
      const wy = s.deckAt(X(-0.3)).y;
      b.box(2.4, 1.6, hw, m.metal, X(-0.3), wy, 0, 'towing_winch');
      // fender band around the bow
      const fp = [];
      for (let k = 0; k <= 24; k++) {
        const xn = 0.72 + (0.28 * k) / 24;
        const h = s.deckH(xn) - 0.6;
        fp.push(new THREE.Vector3(s.xAt(xn, h), h - T, s.halfBreadth(xn, h) + 0.3));
      }
      const fpPort = fp
        .slice()
        .reverse()
        .map((v) => new THREE.Vector3(v.x, v.y, -v.z));
      const curve = new THREE.CatmullRomCurve3([...fp, ...fpPort.slice(1)]);
      b.add(new THREE.TubeGeometry(curve, 80, 0.5, 8, false), m.funnelTop, 'fender');
      break;
    }
  }
  // measure the result for callouts
  const box = new THREE.Box3().setFromObject(b.group);
  const hullBox = new THREE.Box3().setFromBufferAttribute(hb.hull.getAttribute('position'));
  const topPoint = findTop(b.group);
  const dims = {
    xMin: hullBox.min.x,
    xMax: Math.max(hullBox.max.x, hb.bulb ? new THREE.Box3().setFromBufferAttribute(hb.bulb.getAttribute('position')).max.x : -Infinity),
    halfBeam: hullBox.max.z,
    keelY: hullBox.min.y,
    topY: box.max.y,
    deckY: s.deckAt(0).y,
    topX: topPoint,
  };
  const applyLivery = (lv, tx) => {
    m.deck.color.set(lv.deck);
    m.bulb.color.set(lv.bootTop);
    m.superstructure.color.set(lv.superstructure);
    m.funnel.color.set(lv.funnel);
    m.funnelTop.color.set(lv.funnelTop);
    if (p.kind === 'carrier') m.deck.color.set('#3a3d40');
    paintHull(hullCanvas, s, hb.texHeight, p.kind, lv, tx);
    hullTex.needsUpdate = true;
    if (transomCanvas && transomTex && hb.transomInfo) {
      paintTransom(transomCanvas, hb.transomInfo, lv, tx);
      transomTex.needsUpdate = true;
    }
  };
  applyLivery(livery, text);
  return {
    group: b.group,
    shape: s,
    dims,
    materials: m,
    hullCanvas,
    transomCanvas,
    applyLivery,
    dispose() {
      b.group.traverse((o) => {
        const mesh = o;
        if (mesh.geometry) mesh.geometry.dispose();
      });
      Object.values(m).forEach((mat) => {
        const mm = mat;
        mm.map?.dispose();
        mm.dispose();
      });
    },
  };
}
/** x position of the highest vertex (where the air-draft callout should point). */
function findTop(group) {
  let best = 0;
  let bestY = -Infinity;
  const v = new THREE.Vector3();
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    const mesh = o;
    if (!mesh.isMesh || mesh.isInstancedMesh) return;
    const pos = mesh.geometry.getAttribute('position');
    if (!pos) return;
    for (let i = 0; i < pos.count; i += 1) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      if (v.y > bestY) {
        bestY = v.y;
        best = v.x;
      }
    }
  });
  return bestY > -Infinity ? best : 0;
}
