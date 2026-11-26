// Vessel models from files: load (.glb, .gltf, .obj + .mtl + pictures, .stl, .ply, .fbx, .dae, .3mf), fit to the ship's frame,
// texture, and save as .glb. The fitted model looks to the inspector (scene.js) and the chart
// (shipmodels.js) like one built by ship.js: { group, dims, dispose(), ... }.
//
// The loaders and the exporter (public/vendor/three-io.js, about 100 kB) are loaded the first time a
// model file is needed.

import * as THREE from '../vendor/three.js';
import { axisRotation, fitPlacement, formatOf } from '../vesselcatalog.js';

let io = null;
const loadIO = () => (io ??= import('../vendor/three-io.js'));

const baseName = (u) => decodeURIComponent(String(u).split(/[?#]/)[0].split('/').pop() ?? '');

/** STL has no materials: one plain grey, like a primer coat. */
const stlMaterial = () => {
  const m = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.55, metalness: 0.1 });
  m.name = 'stl';
  return m;
};

/**
 * Load a model. `src` is { url, format, mtl? } (a file on a website, the vessels folder) or
 * { files: File[] } (chosen by the user: the model and the .mtl, .bin and pictures it names).
 * Resolves to an Object3D in the model's own units and axes.
 */
export async function loadModel(src) {
  const { GLTFLoader, OBJLoader, MTLLoader, STLLoader, PLYLoader, FBXLoader, ColladaLoader, ThreeMFLoader } = await loadIO();
  const manager = new THREE.LoadingManager();
  let url = src.url;
  let format = src.format;
  let mtlUrl = src.mtl ? new URL(src.mtl, src.url).href : null;
  const blobUrls = [];
  if (src.files) {
    const files = [...src.files];
    const main = files.find((f) => formatOf(f.name));
    if (!main) throw new Error('Choose a model file: .glb, .gltf, .obj, .stl, .ply, .fbx, .dae or .3mf (with its .mtl, .bin and pictures, if it has them).');
    format = formatOf(main.name);
    const byName = new Map();
    for (const f of files) {
      const u = URL.createObjectURL(f);
      blobUrls.push(u);
      byName.set(f.name.toLowerCase(), u);
    }
    url = byName.get(main.name.toLowerCase());
    const mtl = files.find((f) => /\.mtl$/i.test(f.name));
    mtlUrl = mtl ? byName.get(mtl.name.toLowerCase()) : null;
    // A model names its other files by their own names: point those at the files chosen.
    manager.setURLModifier((u) => (u.startsWith('blob:') && blobUrls.includes(u) ? u : byName.get(baseName(u).toLowerCase()) ?? u));
  }
  try {
    if (format === 'glb' || format === 'gltf') {
      const gltf = await new GLTFLoader(manager).loadAsync(url);
      return gltf.scene;
    }
    if (format === 'obj') {
      const obj = new OBJLoader(manager);
      if (mtlUrl) {
        try {
          const mtl = new MTLLoader(manager);
          if (!src.files) mtl.setResourcePath(new URL('.', mtlUrl).href);
          const mats = await mtl.loadAsync(mtlUrl);
          mats.preload();
          obj.setMaterials(mats);
        } catch (e) {
          console.warn('materials', e); // the shape still loads, in grey
        }
      }
      const group = await obj.loadAsync(url);
      // MTL colours are written as plain numbers; OBJLoader's own default is a flat Phong. Use the
      // same lit material as the rest of the ships, keeping the colour and picture.
      group.traverse((o) => {
        if (!o.isMesh) return;
        const conv = (m) => {
          if (m.isMeshStandardMaterial) return m;
          const s = new THREE.MeshStandardMaterial({ color: m.color, map: m.map ?? null, roughness: 0.6, metalness: 0.05, transparent: m.transparent, opacity: m.opacity, side: m.side });
          s.name = m.name;
          m.dispose();
          return s;
        };
        o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
      });
      return group;
    }
    if (format === 'stl') {
      const geom = await new STLLoader(manager).loadAsync(url);
      if (!geom.getAttribute('normal')) geom.computeVertexNormals();
      const mesh = new THREE.Mesh(geom, stlMaterial());
      mesh.name = 'hull';
      return mesh;
    }
    if (format === 'ply') {
      const geom = await new PLYLoader(manager).loadAsync(url);
      if (!geom.getAttribute('normal')) geom.computeVertexNormals();
      const m = stlMaterial();
      m.name = 'ply';
      if (geom.getAttribute('color')) { m.vertexColors = true; m.color.set(0xffffff); }
      const mesh = new THREE.Mesh(geom, m);
      mesh.name = 'hull';
      return mesh;
    }
    if (format === 'fbx') return await new FBXLoader(manager).loadAsync(url);
    if (format === 'dae') return (await new ColladaLoader(manager).loadAsync(url)).scene;
    if (format === '3mf') return await new ThreeMFLoader(manager).loadAsync(url);
    throw new Error(`Cannot read ${format || 'this'} files`);
  } finally {
    // Pictures are read into the materials by now; the model file's own address is not needed again.
    setTimeout(() => blobUrls.forEach((u) => URL.revokeObjectURL(u)), 4000);
  }
}

/** Load a .glb held as a Blob (a model saved on this device). */
export async function loadGlbBlob(blob) {
  const { GLTFLoader } = await loadIO();
  const gltf = await new GLTFLoader().parseAsync(await blob.arrayBuffer(), '');
  return gltf.scene;
}

/** Every mesh's materials have a name (materials without one are numbered), for the texture targets. */
export function nameMaterials(object) {
  const seen = new Map();
  let n = 0;
  object.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m || seen.has(m)) continue;
      if (!m.name) m.name = `material_${++n}`;
      seen.set(m, m.name);
    }
  });
  return [...new Set(seen.values())];
}

/** The materials of a model by name (several meshes may share one name). */
export function materialsNamed(object, name) {
  const out = new Set();
  object.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m && (name === '*' || m.name === name)) out.add(m);
  });
  return [...out];
}

/** The x of the highest point, sampling at most ~20 000 vertices (for the air-draft line). */
function topX(group) {
  let best = 0, bestY = -Infinity;
  const v = new THREE.Vector3();
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh) return;
    const pos = o.geometry.getAttribute('position');
    if (!pos) return;
    const step = Math.max(1, Math.floor(pos.count / 20000));
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      if (v.y > bestY) { bestY = v.y; best = v.x; }
    }
  });
  return best;
}

/**
 * Fit a loaded model to the ship's frame (bow +x, y up, starboard +z, metres, waterline y = 0,
 * amidships x = 0) and wrap it like ship.js's models. `opts`: { up, forward, scale, length, draft,
 * waterline } (see vesselcatalog.js), `shared`: the model's geometry and materials belong to someone
 * else (a cached template on the chart), so dispose() leaves them alone.
 */
export function fitModel(object, opts = {}, { shared = false } = {}) {
  const group = new THREE.Group(); // the ship's frame
  group.name = 'vessel_model';
  const turn = new THREE.Group(); // the model's axes turned to the ship's
  const r = axisRotation(opts.up, opts.forward);
  turn.matrixAutoUpdate = false;
  turn.matrix.set(r[0][0], r[0][1], r[0][2], 0, r[1][0], r[1][1], r[1][2], 0, r[2][0], r[2][1], r[2][2], 0, 0, 0, 0, 1);
  turn.add(object);
  turn.updateMatrixWorld(true);
  const raw = new THREE.Box3().setFromObject(turn, true);
  if (raw.isEmpty()) throw new Error('The model has nothing in it to draw');
  const { scale, offset } = fitPlacement(raw, opts);
  const fit = new THREE.Group();
  fit.scale.setScalar(scale);
  fit.position.set(offset.x, offset.y, offset.z);
  fit.add(turn);
  group.add(fit);
  group.updateMatrixWorld(true);
  object.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const box = new THREE.Box3().setFromObject(group, true);
  const dims = {
    xMin: box.min.x,
    xMax: box.max.x,
    halfBeam: Math.max(Math.abs(box.min.z), Math.abs(box.max.z)),
    keelY: box.min.y,
    topY: box.max.y,
    // A model does not say where its deck is: a ship's freeboard is about a tenth of its length.
    deckY: Math.min(box.max.y, Math.max(0.5, (box.max.x - box.min.x) * 0.07)),
    topX: topX(group),
  };
  return {
    group,
    dims,
    imported: true,
    scale,
    materials: {},
    hullCanvas: null,
    transomCanvas: null,
    applyLivery() {}, // its colours are its own; textures are put on with applyTexture
    dispose() {
      if (shared) return;
      disposeObject(group);
    },
  };
}

export function disposeObject(root) {
  const seen = new Set();
  root.traverse((o) => {
    o.geometry?.dispose();
    for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
      if (seen.has(m)) continue;
      seen.add(m);
      for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
      m.dispose();
    }
  });
}

// ---------- textures ----------

/** A texture from a loaded picture (an <img> or a canvas), repeating. */
export function textureFrom(img) {
  const t = new THREE.Texture(img);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/**
 * Give a mesh texture coordinates in metres of the ship's frame, each vertex projected along the
 * axis its normal leans to most (box projection), so a picture tiles at the same size everywhere.
 * `toShip` takes the mesh's own coordinates to the ship's frame. The old coordinates are kept and
 * put back by restoreUVs.
 */
export function boxUVs(mesh, toShip) {
  const g = mesh.geometry;
  const pos = g.getAttribute('position');
  if (!pos) return;
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const nor = g.getAttribute('normal');
  if (!g.userData.uv0Kept) {
    g.userData.uv0 = g.getAttribute('uv') ?? null;
    g.userData.uv0Kept = true;
  }
  const nm = new THREE.Matrix3().getNormalMatrix(toShip);
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(toShip);
    n.fromBufferAttribute(nor, i).applyMatrix3(nm);
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    if (ay >= ax && ay >= az) { uv[2 * i] = p.x; uv[2 * i + 1] = p.z; } // deck, roof: seen from above
    else if (az >= ax) { uv[2 * i] = p.x; uv[2 * i + 1] = p.y; } // the sides
    else { uv[2 * i] = p.z; uv[2 * i + 1] = p.y; } // fore and aft faces
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

export function restoreUVs(mesh) {
  const g = mesh.geometry;
  if (!g.userData.uv0Kept) return;
  if (g.userData.uv0) g.setAttribute('uv', g.userData.uv0);
  else g.deleteAttribute('uv');
  delete g.userData.uv0;
  delete g.userData.uv0Kept;
}

/**
 * Put a picture on materials of a model: `materials` (from materialsNamed, or a ship.js material),
 * `img` the picture, `opts` { tile: metres per repeat, projection: 'box' | 'uv' }. With 'box' the
 * meshes get coordinates in metres (boxUVs); with 'uv' the model's own coordinates are used and the
 * picture is stretched once over them. The material's colour goes white (it tints the picture) and
 * comes back with clearTexture.
 */
export function applyTexture(root, materials, img, opts = {}) {
  const tile = opts.tile > 0 ? opts.tile : 10;
  const box = opts.projection !== 'uv';
  const set = new Set(materials);
  root.updateMatrixWorld(true);
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (!mats.some((m) => set.has(m))) return;
    if (box) boxUVs(o, new THREE.Matrix4().multiplyMatrices(toRoot, o.matrixWorld));
    else restoreUVs(o);
  });
  for (const m of set) {
    if (!m.userData.before) m.userData.before = { map: m.map ?? null, color: m.color?.getHex() };
    const t = textureFrom(img);
    if (box) t.repeat.set(1 / tile, 1 / tile);
    if (m.map && m.map !== m.userData.before.map) m.map.dispose();
    m.map = t;
    m.color?.set(0xffffff);
    m.needsUpdate = true;
  }
}

/** Take a picture put on by applyTexture off again. */
export function clearTexture(root, materials) {
  const set = new Set(materials);
  for (const m of set) {
    const b = m.userData.before;
    if (!b) continue;
    if (m.map && m.map !== b.map) m.map.dispose();
    m.map = b.map;
    if (b.color !== undefined) m.color?.setHex(b.color);
    delete m.userData.before;
    m.needsUpdate = true;
  }
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (mats.some((m) => set.has(m))) restoreUVs(o);
  });
}

// ---------- saving ----------

/**
 * The model as one .glb (binary glTF): geometry in the ship's frame, materials, colours and the
 * pictures on them (the painted hull included). `group` is the model's root (its own position is
 * left out, so the file is in the ship's frame). Lines (rigging) are kept.
 */
export async function exportGlb(group, { maxTextureSize = 4096 } = {}) {
  const { GLTFExporter } = await loadIO();
  const pos = group.position.clone(), rot = group.rotation.clone(), sc = group.scale.clone();
  const parent = group.parent;
  group.position.set(0, 0, 0);
  group.rotation.set(0, 0, 0);
  group.scale.set(1, 1, 1);
  parent?.remove(group);
  group.updateMatrixWorld(true);
  try {
    const out = await new GLTFExporter().parseAsync(group, { binary: true, onlyVisible: true, maxTextureSize });
    return new Blob([out], { type: 'model/gltf-binary' });
  } finally {
    parent?.add(group);
    group.position.copy(pos);
    group.rotation.copy(rot);
    group.scale.copy(sc);
    group.updateMatrixWorld(true);
  }
}

/** A small picture of a model for lists: the scene's current view, cut down. */
export function thumbnail(sourceCanvas, w = 160, h = 100) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const s = Math.max(w / sourceCanvas.width, h / sourceCanvas.height);
  const dw = sourceCanvas.width * s, dh = sourceCanvas.height * s;
  ctx.drawImage(sourceCanvas, (w - dw) / 2, (h - dh) / 2, dw, dh);
  return c.toDataURL('image/jpeg', 0.75);
}

// ---------- the vessels folder and this device ----------

function loadPicture(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

/**
 * A catalog entry's model (vesselcatalog.js), unfitted: from the vessels folder at `folderUrl`, or
 * this device (vessellibrary.js's modelBlob). The folder entry's `textures` ({ material: file } or
 * { material: { file, tile } }) are put on as it loads: with `tile` (metres) the picture repeats
 * that often; without, it is laid on the model's own texture coordinates.
 */
export async function loadEntry(entry, { folderUrl, blobOf }) {
  if (entry.source === 'device') {
    const blob = await blobOf(entry.id);
    if (!blob) throw new Error('This model is no longer saved on this device');
    return loadGlbBlob(blob);
  }
  const url = new URL(entry.file, folderUrl).href;
  const object = await loadModel({ url, format: entry.format, mtl: entry.mtl });
  nameMaterials(object);
  for (const [name, t] of Object.entries(entry.textures ?? {})) {
    const spec = typeof t === 'string' ? { file: t } : t;
    if (!spec?.file || String(spec.file).includes('..')) continue;
    try {
      const img = await loadPicture(new URL(spec.file, folderUrl).href);
      applyTexture(object, materialsNamed(object, name), img, spec.tile > 0 ? { tile: spec.tile, projection: 'box' } : { projection: 'uv' });
    } catch (e) {
      console.warn('vessel texture', entry.id, name, e);
    }
  }
  return object;
}

/** Meshes of a fitted model that would stand around an eye at (x, z) on its bridge, to hide there. */
export function meshesAroundEye(model, x, z) {
  const out = [];
  const L = model.dims.xMax - model.dims.xMin;
  const box = new THREE.Box3();
  model.group.updateMatrixWorld(true);
  const toGroup = new THREE.Matrix4().copy(model.group.matrixWorld).invert();
  model.group.traverse((o) => {
    if (!o.isMesh) return;
    box.setFromObject(o, true).applyMatrix4(toGroup);
    const long = box.max.x - box.min.x > L * 0.6; // the hull itself, or the whole ship in one piece
    if (!long && box.max.y > model.dims.deckY && x >= box.min.x - 1 && x <= box.max.x + 1 && z >= box.min.z - 1 && z <= box.max.z + 1) out.push(o);
  });
  return out;
}
