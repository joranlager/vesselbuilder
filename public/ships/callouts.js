// Ship inspector: 3D dimension lines and labels (length, beam, draft, air draft).

import * as THREE from '../vendor/three.js';
import { CSS2DObject } from '../vendor/three.js';

export function fmtLen(m, units) {
  if (units === 'imperial') return `${(m / 0.3048).toFixed(m < 30 ? 1 : 0)} ft`;
  return `${m.toFixed(m < 30 ? 2 : 1)} m`;
}
function label(text, src, cls) {
  const el = document.createElement('div');
  el.className = `ship-callout ${cls}`;
  const v = document.createElement('span');
  v.textContent = text;
  el.appendChild(v);
  if (src) {
    const b = document.createElement('em');
    b.textContent = { wikidata: 'Wikidata', ais: 'AIS', estimated: 'est.', model: 'model' }[src] ?? 'manual';
    b.className = src;
    el.appendChild(b);
  }
  return new CSS2DObject(el);
}
/**
 * 3D dimension lines (with arrowheads and extension lines) and HTML labels for
 * length overall, beam, draft and air draft. Lines draw on top of everything.
 */
export function buildCallouts(d, v, units) {
  const g = new THREE.Group();
  g.name = 'callouts';
  const L = d.xMax - d.xMin;
  const head = Math.max(0.4, L * 0.012);
  const lineMat = new THREE.LineBasicMaterial({ color: 0x5ee6ff, depthTest: false, transparent: true });
  const extMat = new THREE.LineDashedMaterial({
    color: 0x5ee6ff,
    depthTest: false,
    transparent: true,
    opacity: 0.55,
    dashSize: head,
    gapSize: head * 0.6,
  });
  const coneMat = new THREE.MeshBasicMaterial({ color: 0x5ee6ff, depthTest: false, transparent: true });
  const seg = (a, b, mat) => {
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const l = new THREE.Line(geo, mat);
    if (mat instanceof THREE.LineDashedMaterial) l.computeLineDistances();
    l.renderOrder = 999;
    g.add(l);
  };
  const arrow = (a, b) => {
    seg(a, b, lineMat);
    for (const [p, q] of [
      [a, b],
      [b, a],
    ]) {
      const dir = new THREE.Vector3().subVectors(p, q).normalize();
      const cone = new THREE.Mesh(new THREE.ConeGeometry(head * 0.35, head, 10), coneMat);
      cone.position.copy(p).addScaledVector(dir, -head / 2);
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      cone.renderOrder = 999;
      g.add(cone);
    }
  };
  const put = (o, p) => {
    o.position.copy(p);
    g.add(o);
  };
  // Length overall: below the keel
  const yL = d.keelY - L * 0.06;
  arrow(new THREE.Vector3(d.xMin, yL, 0), new THREE.Vector3(d.xMax, yL, 0));
  seg(new THREE.Vector3(d.xMin, d.deckY, 0), new THREE.Vector3(d.xMin, yL - head, 0), extMat);
  seg(new THREE.Vector3(d.xMax, d.deckY, 0), new THREE.Vector3(d.xMax, yL - head, 0), extMat);
  put(label(`LOA ${fmtLen(v.loa, units)}`, v.sources.length, 'loa'), new THREE.Vector3((d.xMin + d.xMax) / 2, yL, 0));
  // Beam: across the deck amidships
  const yB = d.deckY + Math.max(2, L * 0.02);
  arrow(new THREE.Vector3(0, yB, -d.halfBeam), new THREE.Vector3(0, yB, d.halfBeam));
  seg(new THREE.Vector3(0, 0, d.halfBeam), new THREE.Vector3(0, yB + head, d.halfBeam), extMat);
  seg(new THREE.Vector3(0, 0, -d.halfBeam), new THREE.Vector3(0, yB + head, -d.halfBeam), extMat);
  put(label(`Beam ${fmtLen(v.beam, units)}`, v.sources.beam, 'beam'), new THREE.Vector3(0, yB, d.halfBeam + head));
  // Draft: aft of the stern, waterline to keel
  const xD = d.xMin - L * 0.04;
  arrow(new THREE.Vector3(xD, 0, 0), new THREE.Vector3(xD, d.keelY, 0));
  seg(new THREE.Vector3(d.xMin, 0, 0), new THREE.Vector3(xD - head, 0, 0), extMat);
  seg(new THREE.Vector3(d.xMin + L * 0.08, d.keelY, 0), new THREE.Vector3(xD - head, d.keelY, 0), extMat);
  put(label(`Draft ${fmtLen(v.draft, units)}`, v.sources.draft, 'draft'), new THREE.Vector3(xD, d.keelY / 2, 0));
  // Air draft: forward of the bow, waterline to highest point
  const xA = d.xMax + L * 0.05;
  arrow(new THREE.Vector3(xA, 0, 0), new THREE.Vector3(xA, d.topY, 0));
  seg(new THREE.Vector3(d.topX, d.topY, 0), new THREE.Vector3(xA + head, d.topY, 0), extMat);
  seg(new THREE.Vector3(d.xMax, 0, 0), new THREE.Vector3(xA + head, 0, 0), extMat);
  put(label(`Air draft ${fmtLen(v.air, units)}`, v.sources.airDraft, 'air'), new THREE.Vector3(xA, d.topY / 2, 0));
  return g;
}
export function disposeCallouts(g) {
  g.traverse((o) => {
    const m = o;
    m.geometry?.dispose();
    if (o instanceof CSS2DObject) o.element.remove();
  });
}
