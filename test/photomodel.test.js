import { test } from 'node:test';
import assert from 'node:assert/strict';
import { silhouette, inside, aspect, sizeFrom, carve, mesh, faceViews, texturedParts, project, VIEWS } from '../public/ships/photomodel.js';

/** A picture W x H on a plain background, with `paint(x, y)` true where the ship is (grey). */
function picture(W, H, paint, bg = [180, 210, 240]) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, s = paint(x, y);
    data[i] = s ? 60 : bg[0]; data[i + 1] = s ? 60 : bg[1]; data[i + 2] = s ? 70 : bg[2]; data[i + 3] = 255;
  }
  return { width: W, height: H, data };
}
const rect = (W, H, x0, y0, x1, y1) => picture(W, H, (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1);

const signedVolume = ({ positions: p, indices: t }) => {
  let v = 0;
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
    v += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
  }
  return v;
};

test('the ship is cut out of its background, holes filled, its box found', () => {
  // a ship with a window the colour of the sky
  const img = picture(200, 100, (x, y) => x >= 20 && x <= 179 && y >= 40 && y <= 79 && !(x > 90 && x < 100 && y > 50 && y < 56));
  const s = silhouette(img);
  assert.deepEqual(s.box, { x0: 20, y0: 40, x1: 179, y1: 79 });
  assert.equal(inside(s, 0.5, 0.3), true, 'the window is ship');
  assert.equal(aspect(s), 4);
  // speckles away from the ship are left out
  const noisy = picture(200, 100, (x, y) => (x >= 20 && x <= 179 && y >= 40 && y <= 79) || (x === 5 && y === 5));
  assert.deepEqual(silhouette(noisy).box, { x0: 20, y0: 40, x1: 179, y1: 79 });
  assert.equal(silhouette(picture(50, 50, () => false)), null, 'nothing there');
  // transparency, where there is some, is the cut-out
  const png = rect(100, 50, 10, 10, 89, 39);
  for (let i = 0; i < 100 * 50; i++) { const x = i % 100, y = (i / 100) | 0; png.data[i * 4 + 3] = x >= 10 && x <= 89 && y >= 10 && y <= 39 ? 255 : 0; png.data[i * 4] = 60; }
  assert.deepEqual(silhouette(png).box, { x0: 10, y0: 10, x1: 89, y1: 39 });
});

test('size from the length and the pictures', () => {
  const side = silhouette(rect(400, 100, 0, 30, 399, 69)); // 400 x 40
  const top = silhouette(rect(400, 100, 0, 20, 399, 79)); // 400 x 60
  const s = sizeFrom(100, { port: side, top });
  assert.equal(s.L, 100);
  assert.equal(s.H, 10);
  assert.ok(Math.abs(s.B - 100 / (400 / 60)) < 1e-9);
});

test('views project the ship as the conventions say', () => {
  const size = { L: 100, B: 20, H: 10 };
  const bowTop = [100, 10, 0];
  assert.deepEqual(project('port', bowTop, size), [0, 0], 'port side: bow to the left, top up');
  assert.deepEqual(project('starboard', bowTop, size), [1, 0]);
  assert.deepEqual(project('top', [100, 5, -10], size), [1, 0], 'from above: bow right, port up');
  assert.deepEqual(project('bottom', [100, 5, 10], size), [1, 0], 'from below: starboard up');
  assert.deepEqual(project('bow', [100, 10, 10], size), [0, 0], 'from ahead: starboard on the left');
  assert.deepEqual(project('stern', [0, 10, -10], size), [0, 0], 'from astern: port on the left');
  assert.deepEqual(project('port', bowTop, size, true), [1, 0], 'mirrored');
  assert.equal(VIEWS.length, 6);
});

test('a box ship carves to a closed box, facing outwards', () => {
  const full = silhouette(rect(100, 100, 0, 0, 99, 99));
  const sils = { port: full, starboard: full, top: full, bow: full, stern: full };
  const size = { L: 60, B: 12, H: 8 };
  const g = carve(sils, size, { res: 60 });
  assert.equal(g.occ.reduce((a, b) => a + b, 0), g.nx * g.ny * g.nz, 'all of it');
  const m = mesh(g, 0);
  const vol = signedVolume(m);
  assert.ok(vol > 0, 'faces point outwards');
  assert.ok(Math.abs(vol - 60 * 12 * 8) / (60 * 12 * 8) < 0.15, `volume ${vol}`);
  // every edge shared by exactly two triangles: closed
  const edges = new Map();
  for (let t = 0; t < m.indices.length; t += 3) for (let c = 0; c < 3; c++) {
    const a = m.indices[t + c], b = m.indices[t + ((c + 1) % 3)];
    const k = a < b ? `${a},${b}` : `${b},${a}`;
    edges.set(k, (edges.get(k) ?? 0) + 1);
  }
  assert.ok([...edges.values()].every((n) => n === 2), 'closed surface');
  assert.ok(signedVolume(mesh(g, 4)) > 0, 'still closed and outward after smoothing');
});

test('a pointed bow seen from above and the side gives a pointed hull, textured by the views facing it', () => {
  // from above: a hull narrowing to a point at the bow (right); from the side: a plain rectangle
  const W = 400, Hh = 120;
  const top = silhouette(picture(W, Hh, (x, y) => { const half = x < 300 ? 50 : 50 * (1 - (x - 300) / 100); return Math.abs(y - 60) <= half; }));
  const side = silhouette(rect(W, 100, 0, 30, W - 1, 69));
  const sils = { port: side, starboard: side, top };
  const size = sizeFrom(100, sils);
  const g = carve(sils, size, { res: 100 });
  const at = (fx) => { let n = 0; const i = Math.min(g.nx - 1, Math.floor(fx * g.nx)); for (let k = 0; k < g.nz; k++) for (let j = 0; j < g.ny; j++) n += g.occ[i + g.nx * (j + g.ny * k)]; return n; };
  assert.ok(at(0.97) < at(0.5) * 0.3, 'narrow at the bow');
  const m = mesh(g, 3);
  const views = faceViews(m, ['port', 'starboard', 'top']);
  const count = (k) => views.filter((v) => v === k).length;
  assert.ok(count('port') > 0 && count('starboard') > 0 && count('top') > 0);
  const parts = texturedParts(m, size, ['port', 'starboard', 'top']);
  for (const p of Object.values(parts)) {
    assert.equal(p.positions.length / 3, p.uvs.length / 2);
    assert.ok(p.uvs.every((u) => u >= 0 && u <= 1));
  }
});

test('side and plan views are filled solid between keel and top: a white superstructure on a pale sky', () => {
  // a hull with a pale band that reaches the outline (no hole: open to the side)
  const img = picture(200, 100, (x, y) => x >= 20 && x <= 179 && y >= 30 && y <= 79 && !(y >= 45 && y <= 55 && x < 120));
  const open = silhouette(img);
  assert.equal(inside(open, 0.2, 0.4), false, 'without: a gap');
  const solid = silhouette(img, 20, { solidColumns: true });
  assert.equal(inside(solid, 0.2, 0.4), true, 'filled');
});
