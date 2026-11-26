// A vessel from photos: up to six views (towards the bow, the stern, from above, the port side, the
// starboard side, and from below), each cut out from its background, carve a 3D shape (the visual hull:
// what lies inside the ship's outline in every view), which is meshed (surface nets, smoothed) and
// textured from the view that faces each part of it most squarely. No three.js here (vesselbuilder.js
// makes the three.js object), so the cutting out, carving and meshing are unit tested.
//
// Conventions for the photos (each can be mirrored in the UI if taken the other way):
//   port       the port side, bow to the LEFT          starboard  the starboard side, bow to the RIGHT
//   top        from above, bow to the RIGHT, port up   bottom     from below, bow to the RIGHT, starboard up
//   bow        towards the bow, from ahead             stern      towards the stern, from astern
// The ship's frame: x from stern (0) to bow (L), y from keel (0) up (H), z across, starboard positive.

export const VIEWS = [
  ['bow', 'Towards the bow', 'From ahead, looking at the bow'],
  ['stern', 'Towards the stern', 'From astern, looking at the stern'],
  ['top', 'From above', 'Bow to the right, port side up'],
  ['port', 'Port side', 'Bow to the left'],
  ['starboard', 'Starboard side', 'Bow to the right'],
  ['bottom', 'From below (optional)', 'Bow to the right, starboard side up'],
];

/** Which way each view looks at the ship from (a unit vector in the ship's frame, towards the camera). */
export const VIEW_DIR = {
  bow: [1, 0, 0], stern: [-1, 0, 0], top: [0, 1, 0], bottom: [0, -1, 0], port: [0, 0, -1], starboard: [0, 0, 1],
};

/**
 * Where a point of the ship (x, y, z) falls in a view's cut-out, as fractions (u across from the left,
 * v down from the top) of the ship's box in that picture; `flip` mirrors it.
 */
export function project(view, [x, y, z], { L, H, B }, flip = false, sil = null) {
  const a = x / L, up = 1 - y / H, zp = (z + B / 2) / B; // zp: 0 at port, 1 at starboard
  let u, v;
  if (sil) {
    // Scaled by the photo's width only (the length, or the beam from the ends), the keel at the
    // bottom of the outline and the centre line in the middle of a plan: a mast or antenna lost in
    // the cut-out of one photo then only loses the mast, not the scale of the whole photo.
    const wpx = sil.box.x1 - sil.box.x0 + 1, hpx = sil.box.y1 - sil.box.y0 + 1;
    const r = (metres, across) => (metres * wpx) / across / hpx; // metres as a fraction of the box's height
    switch (view) {
      case 'port': u = 1 - a; v = 1 - r(y, L); break;
      case 'starboard': u = a; v = 1 - r(y, L); break;
      case 'top': u = a; v = 0.5 + r(z, L); break;
      case 'bottom': u = a; v = 0.5 - r(z, L); break;
      // Bow and stern photos are seldom taken square on (often from above, looking squatter), so their
      // height is stretched over the vessel's, as found from the side photos.
      case 'bow': u = 0.5 - z / B; v = up; break;
      case 'stern': u = 0.5 + z / B; v = up; break;
      default: return null;
    }
    return [flip ? 1 - u : u, v];
  }
  switch (view) {
    case 'port': u = 1 - a; v = up; break;
    case 'starboard': u = a; v = up; break;
    case 'top': u = a; v = zp; break;
    case 'bottom': u = a; v = 1 - zp; break;
    case 'bow': u = 1 - zp; v = up; break; // from ahead, the ship's starboard is on the left
    case 'stern': u = zp; v = up; break;
    default: return null;
  }
  return [flip ? 1 - u : u, v];
}

// ---------- cutting the ship out of a photo ----------

/**
 * The ship's outline in a picture ({ width, height, data: RGBA }): a mask (1 = ship) and the box it
 * fills { x0, y0, x1, y1 } (pixels, inclusive). A picture with transparency is cut by it; otherwise
 * the background is the colour round the picture's border, and what differs from it by more than
 * `threshold` (0-255, colour distance) is the ship. The largest connected part is kept and its holes
 * are filled (a window the colour of the sky stays ship). null when nothing stands out.
 */
export function silhouette(img, threshold = 20, { solidColumns = false } = {}) {
  const { width: W, height: Hh, data } = img;
  const n = W * Hh;
  const mask = new Uint8Array(n);
  let transparent = 0;
  for (let i = 0; i < n; i++) if (data[i * 4 + 3] < 128) transparent++;
  if (transparent > n * 0.05) {
    for (let i = 0; i < n; i++) mask[i] = data[i * 4 + 3] >= 128 ? 1 : 0;
  } else {
    // the background: the median of the border's colours
    const rs = [], gs = [], bs = [];
    const take = (x, y) => { const i = (y * W + x) * 4; rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]); };
    for (let x = 0; x < W; x++) { take(x, 0); take(x, Hh - 1); }
    for (let y = 0; y < Hh; y++) { take(0, y); take(W - 1, y); }
    const med = (a) => a.sort((p, q) => p - q)[a.length >> 1];
    const bg = [med(rs), med(gs), med(bs)];
    for (let i = 0; i < n; i++) {
      const d = Math.abs(data[i * 4] - bg[0]) + Math.abs(data[i * 4 + 1] - bg[1]) + Math.abs(data[i * 4 + 2] - bg[2]);
      mask[i] = d > threshold * 1.5 ? 1 : 0;
    }
  }
  // the connected parts (4-neighbours): the largest, and those at least 5 % of its size (a ship's
  // decks can be parted by a pale line or rail); specks of noise are left out
  const label = new Int32Array(n);
  const sizes = [0], edges = [false];
  let bestSize = 0, best = 0, next = 0;
  const stack = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    if (!mask[s] || label[s]) continue;
    next++;
    let top = 0, size = 0, edge = false;
    stack[top++] = s;
    label[s] = next;
    while (top) {
      const i = stack[--top];
      size++;
      const x = i % W, y = (i / W) | 0;
      if (x === 0 || y === 0 || x === W - 1 || y === Hh - 1) edge = true;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < Hh - 1 ? i + W : -1]) {
        if (j >= 0 && mask[j] && !label[j]) { label[j] = next; stack[top++] = j; }
      }
    }
    sizes.push(size);
    edges.push(edge);
    if (size > bestSize) { bestSize = size; best = next; }
  }
  if (bestSize < n * 0.002) return null;
  // other parts are kept when big enough and not at the picture's edge (clouds, the quay, the shore)
  const keep = sizes.map((sz, l) => l === best || (sz >= bestSize * 0.05 && !edges[l]));
  for (let i = 0; i < n; i++) mask[i] = label[i] && keep[label[i]] ? 1 : 0;
  // fill holes: what the border cannot reach through the background is ship
  const outside = new Uint8Array(n);
  let top = 0;
  const seed = (i) => { if (!mask[i] && !outside[i]) { outside[i] = 1; stack[top++] = i; } };
  for (let x = 0; x < W; x++) { seed(x); seed((Hh - 1) * W + x); }
  for (let y = 0; y < Hh; y++) { seed(y * W); seed(y * W + W - 1); }
  while (top) {
    const i = stack[--top];
    const x = i % W, y = (i / W) | 0;
    if (x > 0) seed(i - 1);
    if (x < W - 1) seed(i + 1);
    if (y > 0) seed(i - W);
    if (y < Hh - 1) seed(i + W);
  }
  for (let i = 0; i < n; i++) if (!outside[i]) mask[i] = 1;
  // Seen from the side, above or below, a ship has no sky through it from keel to top (or from side
  // to side): each column is filled between its first and last pixel of ship. This closes the gaps a
  // white superstructure against a pale sky leaves, which reach the outline and so are no holes.
  if (solidColumns) {
    for (let x = 0; x < W; x++) {
      let top = -1, bot = -1;
      for (let y = 0; y < Hh; y++) if (mask[y * W + x]) { if (top < 0) top = y; bot = y; }
      for (let y = top; y >= 0 && y <= bot; y++) mask[y * W + x] = 1;
    }
  }
  let x0 = W, y0 = Hh, x1 = -1, y1 = -1;
  for (let i = 0; i < n; i++) {
    if (mask[i]) { const x = i % W, y = (i / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return { mask, width: W, height: Hh, box: { x0, y0, x1, y1 } };
}

/** Is (u, v) (fractions of the ship's box) inside the outline? */
export function inside(sil, u, v) {
  if (u < 0 || u > 1 || v < 0 || v > 1) return false;
  const { x0, y0, x1, y1 } = sil.box;
  const x = Math.min(x1, Math.max(x0, Math.round(x0 + u * (x1 - x0))));
  const y = Math.min(y1, Math.max(y0, Math.round(y0 + v * (y1 - y0))));
  return sil.mask[y * sil.width + x] === 1;
}

/** Width over height of the ship's box in a cut-out. */
export const aspect = (sil) => (sil.box.x1 - sil.box.x0 + 1) / (sil.box.y1 - sil.box.y0 + 1);

/**
 * The ship's size from its length and the cut-outs: height from the side views (else bow and stern),
 * beam from above or below (else bow and stern, from the height). { L, B, H } in metres.
 */
export function sizeFrom(L, sils) {
  const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const sides = ['port', 'starboard'].filter((k) => sils[k]).map((k) => L / aspect(sils[k]));
  const plans = ['top', 'bottom'].filter((k) => sils[k]).map((k) => L / aspect(sils[k]));
  const ends = ['bow', 'stern'].filter((k) => sils[k]).map((k) => aspect(sils[k])); // B / H
  // the tallest side photo: thin tops (masts, antennas) are easily lost against a pale sky
  let H = sides.length ? Math.max(...sides) : null;
  let B = plans.length ? avg(plans) : null;
  if (H === null && B !== null && ends.length) H = B / avg(ends);
  if (B === null && H !== null && ends.length) B = H * avg(ends);
  H ??= L * 0.12;
  B ??= L * 0.16;
  return { L, B, H };
}

// ---------- carving ----------

/**
 * The visual hull on a grid: `res` cells along the length, as many across and up as the size needs.
 * A cell is ship when its centre is inside the outline in every view given. Returns { nx, ny, nz,
 * cell (metres), occ (Uint8Array, x fastest, then y, then z) }.
 */
export function carve(sils, size, { res = 160, flips = {}, tolerance = 0.3 } = {}) {
  const { L, B, H } = size;
  const cell = L / res;
  const nx = res, ny = Math.max(4, Math.round(H / cell)), nz = Math.max(4, Math.round(B / cell));
  const N = nx * ny * nz;
  const views = Object.keys(sils).filter((k) => sils[k] && VIEW_DIR[k]);
  // which views see each cell as ship: one bit per view as given, one per view mirrored (bit + 8)
  const seen = new Uint16Array(N);
  for (let k = 0; k < nz; k++) {
    const z = -B / 2 + (k + 0.5) * (B / nz);
    for (let j = 0; j < ny; j++) {
      const y = (j + 0.5) * (H / ny);
      for (let i = 0; i < nx; i++) {
        const x = (i + 0.5) * (L / nx);
        let bits = 0;
        views.forEach((vname, b) => {
          const [u, v] = project(vname, [x, y, z], size, flips[vname], sils[vname]);
          if (inside(sils[vname], u, v)) bits |= 1 << b;
          if (inside(sils[vname], 1 - u, v)) bits |= 1 << (b + 8);
        });
        seen[i + nx * (j + ny * k)] = bits;
      }
    }
  }
  // A photo taken at an angle, or of another part, disagrees with the others: it would carve away
  // much of what all the others agree on. Such photos are left out, the worst first, while at least
  // one side and one plan view remain.
  let active = views.map((_, b) => b);
  const ignored = [], mirrored = [];
  const flippedOnce = new Set();
  const all = (mask) => { let n = 0; for (let c = 0; c < N; c++) if ((seen[c] & mask) === mask) n++; return n; };
  const maskOf = (bs) => bs.reduce((m, b) => m | (1 << b), 0);
  const essential = (b) => {
    const k = views[b];
    const others = active.filter((x) => x !== b).map((x) => views[x]);
    if (k === 'port' || k === 'starboard') return !others.some((o) => o === 'port' || o === 'starboard');
    if (k === 'top' || k === 'bottom') return !others.some((o) => o === 'top' || o === 'bottom');
    return false;
  };
  for (;;) {
    let worst = -1, wf = tolerance;
    for (const b of active) {
      if (essential(b) || flippedOnce.has(b)) continue;
      const without = all(maskOf(active.filter((x) => x !== b)));
      const withIt = all(maskOf(active));
      const f = without ? (without - withIt) / without : 0;
      if (f > wf) { wf = f; worst = b; }
    }
    if (worst < 0) break;
    // the photo the other way round (a side photo of the other side, or taken mirrored)?
    const others = active.filter((x) => x !== worst);
    const without = all(maskOf(others));
    const flipped = without ? (without - all(maskOf(others) | (1 << (worst + 8)))) / without : 1;
    if (flipped <= tolerance && flipped < wf / 2 && worst < 8) {
      // from now on its mirrored bit stands for it
      for (let c = 0; c < N; c++) seen[c] = (seen[c] & ~(1 << worst)) | (((seen[c] >> (worst + 8)) & 1) << worst);
      mirrored.push(views[worst]);
      flippedOnce.add(worst);
      continue;
    }
    ignored.push({ view: views[worst], removed: wf });
    active = others;
  }
  const m = maskOf(active);
  const occ = new Uint8Array(N);
  for (let c = 0; c < N; c++) if ((seen[c] & m) === m) occ[c] = 1;
  keepLargest(occ, nx, ny, nz);
  return { nx, ny, nz, cell, sx: L / nx, sy: H / ny, sz: B / nz, occ, size, used: active.map((b) => views[b]), ignored, mirrored };
}

/** Keep only the largest connected body of cells (6-neighbours): no pieces floating apart. */
export function keepLargest(occ, nx, ny, nz) {
  const N = occ.length, label = new Int32Array(N), stack = new Int32Array(N);
  let best = 0, bestSize = 0, next = 0;
  for (let s = 0; s < N; s++) {
    if (!occ[s] || label[s]) continue;
    next++;
    let top = 0, size = 0;
    stack[top++] = s;
    label[s] = next;
    while (top) {
      const c = stack[--top];
      size++;
      const i = c % nx, j = ((c / nx) | 0) % ny, k = (c / (nx * ny)) | 0;
      const nb = [i > 0 ? c - 1 : -1, i < nx - 1 ? c + 1 : -1, j > 0 ? c - nx : -1, j < ny - 1 ? c + nx : -1, k > 0 ? c - nx * ny : -1, k < nz - 1 ? c + nx * ny : -1];
      for (const d of nb) if (d >= 0 && occ[d] && !label[d]) { label[d] = next; stack[top++] = d; }
    }
    if (size > bestSize) { bestSize = size; best = next; }
  }
  for (let c = 0; c < N; c++) if (occ[c] && label[c] !== best) occ[c] = 0;
  return occ;
}

// ---------- meshing: naive surface nets, then smoothing ----------

/**
 * A closed surface round the carved cells: { positions: Float32Array (x, y, z in the ship's frame,
 * metres), indices: Uint32Array }. One vertex in each cube of 8 cell centres the surface passes
 * through, at the middle of its crossings; a quad for each pair of neighbouring cells that differ.
 * Then `smooth` passes of Laplacian smoothing, each vertex kept within its cube.
 */
export function mesh(grid, smooth = 4) {
  const { nx, ny, nz, occ, sx, sy, sz, size } = grid;
  // padded: cell (i, j, k) of the grid is (i+1, j+1, k+1) here, with empty cells all round
  const px = nx + 2, py = ny + 2, pz = nz + 2;
  const at = (i, j, k) => (i < 1 || j < 1 || k < 1 || i > nx || j > ny || k > nz ? 0 : occ[(i - 1) + nx * ((j - 1) + ny * (k - 1))]);
  // vertices: one per cube whose 8 corners (cell centres) differ; cube (i, j, k) spans cells i..i+1
  const vid = new Int32Array((px - 1) * (py - 1) * (pz - 1)).fill(-1);
  const cid = (i, j, k) => i + (px - 1) * (j + (py - 1) * k);
  const pos = [], cubes = [];
  const toShip = (gi, gj, gk) => [(gi - 0.5) * sx, (gj - 0.5) * sy, -size.B / 2 + (gk - 0.5) * sz];
  for (let k = 0; k < pz - 1; k++) for (let j = 0; j < py - 1; j++) for (let i = 0; i < px - 1; i++) {
    let m = 0;
    for (let c = 0; c < 8; c++) m |= at(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1)) << c;
    if (m === 0 || m === 255) continue;
    // the middle of the crossings on the cube's 12 edges
    let cx = 0, cy = 0, cz = 0, cn = 0;
    const edge = (a, b) => {
      if (((m >> a) & 1) === ((m >> b) & 1)) return;
      cx += ((a & 1) + (b & 1)) / 2; cy += (((a >> 1) & 1) + ((b >> 1) & 1)) / 2; cz += (((a >> 2) & 1) + ((b >> 2) & 1)) / 2; cn++;
    };
    edge(0, 1); edge(2, 3); edge(4, 5); edge(6, 7);
    edge(0, 2); edge(1, 3); edge(4, 6); edge(5, 7);
    edge(0, 4); edge(1, 5); edge(2, 6); edge(3, 7);
    vid[cid(i, j, k)] = pos.length / 3;
    pos.push(...toShip(i + cx / cn, j + cy / cn, k + cz / cn));
    cubes.push([i, j, k]);
  }
  const idx = [];
  const quad = (a, b, c, d, flip) => { if (flip) idx.push(a, c, b, a, d, c); else idx.push(a, b, c, a, c, d); };
  // faces between cell (i,j,k) and its +x, +y, +z neighbours
  for (let k = 0; k < pz - 1; k++) for (let j = 0; j < py - 1; j++) for (let i = 0; i < px - 1; i++) {
    const s0 = at(i, j, k);
    if (j > 0 && k > 0) {
      const s1 = at(i + 1, j, k);
      if (s0 !== s1) quad(vid[cid(i, j - 1, k - 1)], vid[cid(i, j, k - 1)], vid[cid(i, j, k)], vid[cid(i, j - 1, k)], s1 > s0);
    }
    if (i > 0 && k > 0) {
      const s1 = at(i, j + 1, k);
      if (s0 !== s1) quad(vid[cid(i - 1, j, k - 1)], vid[cid(i - 1, j, k)], vid[cid(i, j, k)], vid[cid(i, j, k - 1)], s1 > s0);
    }
    if (i > 0 && j > 0) {
      const s1 = at(i, j, k + 1);
      if (s0 !== s1) quad(vid[cid(i - 1, j - 1, k)], vid[cid(i, j - 1, k)], vid[cid(i, j, k)], vid[cid(i - 1, j, k)], s1 > s0);
    }
  }
  const positions = new Float32Array(pos);
  const indices = new Uint32Array(idx);
  // smoothing: each vertex towards the mean of its neighbours, kept within its cube
  if (smooth > 0) {
    const nb = Array.from({ length: positions.length / 3 }, () => new Set());
    for (let t = 0; t < indices.length; t += 3) {
      const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]];
      nb[a].add(b); nb[a].add(c); nb[b].add(a); nb[b].add(c); nb[c].add(a); nb[c].add(b);
    }
    const lo = cubes.map(([i, j, k]) => toShip(i, j, k)), hi = cubes.map(([i, j, k]) => toShip(i + 1, j + 1, k + 1));
    for (let it = 0; it < smooth; it++) {
      const next = new Float32Array(positions);
      for (let v = 0; v < nb.length; v++) {
        if (!nb[v].size) continue;
        for (let a = 0; a < 3; a++) {
          let s = 0;
          for (const w of nb[v]) s += positions[w * 3 + a];
          const m = s / nb[v].size;
          next[v * 3 + a] = Math.min(hi[v][a], Math.max(lo[v][a], 0.5 * positions[v * 3 + a] + 0.5 * m));
        }
      }
      positions.set(next);
    }
  }
  return { positions, indices };
}

// ---------- texturing ----------

/**
 * Each triangle's picture: the view (of those given) that faces it most squarely, by its normal.
 * Returns an array of view names, one per triangle.
 */
export function faceViews({ positions, indices }, available) {
  const have = new Set(available.filter((k) => VIEW_DIR[k]));
  // A side photo paints the other side too when that one is missing (as do the bow and stern photos
  // for each other): ships are much the same on both. Bow and stern photos, often taken from above
  // at an angle, paint only what they face nearly square on; from above paints nothing facing down.
  const OPP = { port: 'starboard', starboard: 'port', bow: 'stern', stern: 'bow' };
  const cands = [];
  for (const k of have) cands.push([k, VIEW_DIR[k]]);
  for (const [k, o] of Object.entries(OPP)) if (have.has(k) && !have.has(o)) cands.push([k, VIEW_DIR[o]]);
  const END = new Set(['bow', 'stern']);
  const out = new Array(indices.length / 3);
  for (let t = 0; t < indices.length; t += 3) {
    const p = (i) => [positions[indices[i] * 3], positions[indices[i] * 3 + 1], positions[indices[i] * 3 + 2]];
    const [a, b, c] = [p(t), p(t + 1), p(t + 2)];
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(...n) || 1;
    let best = null, bd = -Infinity, fallback = null, fd = -Infinity;
    for (const [k, d] of cands) {
      const s = (n[0] * d[0] + n[1] * d[1] + n[2] * d[2]) / l;
      if (s > fd) { fd = s; fallback = k; }
      if (END.has(k) && s < 0.8) continue;
      if (s > bd) { bd = s; best = k; }
    }
    out[t / 3] = best ?? fallback;
  }
  return out;
}

/**
 * The mesh split by picture: for each view, its triangles with their own vertices (positions) and
 * texture coordinates (uv, 0..1 over the ship's box in that view's cut-out, v up as textures have it).
 * { [view]: { positions: Float32Array, uvs: Float32Array } }.
 */
export function texturedParts(m, size, available, flips = {}, sils = {}) {
  const views = faceViews(m, available);
  const normals = vertexNormals(m);
  const parts = {};
  for (let t = 0; t < views.length; t++) {
    const k = views[t];
    if (!k) continue;
    const part = (parts[k] ??= { positions: [], uvs: [], normals: [] });
    for (let c = 0; c < 3; c++) {
      const i = m.indices[t * 3 + c];
      const p = [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]];
      part.positions.push(...p);
      part.normals.push(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]);
      const [u, v] = project(k, p, size, flips[k], sils[k]);
      part.uvs.push(Math.min(1, Math.max(0, u)), 1 - Math.min(1, Math.max(0, v)));
    }
  }
  for (const k of Object.keys(parts)) parts[k] = { positions: new Float32Array(parts[k].positions), uvs: new Float32Array(parts[k].uvs), normals: new Float32Array(parts[k].normals) };
  return parts;
}

/** Smooth normals: each vertex's the sum of its triangles' (area-weighted), unit length. */
export function vertexNormals({ positions: p, indices: t }) {
  const n = new Float32Array(p.length);
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
    const e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]], e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
    const f = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    for (const v of [a, b, c]) { n[v] += f[0]; n[v + 1] += f[1]; n[v + 2] += f[2]; }
  }
  for (let v = 0; v < n.length; v += 3) {
    const l = Math.hypot(n[v], n[v + 1], n[v + 2]) || 1;
    n[v] /= l; n[v + 1] /= l; n[v + 2] /= l;
  }
  return n;
}
