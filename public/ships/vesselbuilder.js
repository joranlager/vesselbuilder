// A vessel built from her photos and what the AI read in them (vision.js): the side photos' outlines
// carve her shape above the water (photomodel.js), with views from above and from the ends drawn from
// her description where there are no photos of those (synthviews.js); each part is painted from the
// photo facing it, or in her colours where no photo shows it; a hull under the water is added to her
// draught. With no side photo the outline cannot be carved, and she is built from her type instead
// (ship.js), in the colours and with the decks, funnels, bow and stern the photos showed.
//
// Her frame is Rudder's: bow +x, y up, starboard +z, metres, waterline y = 0, amidships x = 0.

import * as THREE from '../vendor/three.js';
import { silhouette, sizeFrom, carve, mesh, texturedParts, aspect } from './photomodel.js';
import { planShape, planSilhouette, endSilhouette, halfBeamFromPlan, mix } from './synthviews.js';
import { bandColours, hullTopFromSide, kindFor, BOW_FOR, STERN_FOR, SUPERSTRUCTURE_WIDTH } from './vision.js';
import { buildShip } from './ship.js';
import { DEFAULT_LIVERY, KIND_PRESETS, defaultParams, depthFor } from './presets.js';
import { fitModel } from './vesselmodel.js';
import { HULL_FONTS } from './hullText.js';

const MAX_SIDE = 640; // pictures are cut out at this size; textures keep up to 2048 px
const SIDE_VIEWS = new Set(['port', 'starboard', 'top']);

/** A picture file read into an <img>. */
export function readPicture(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`${file.name} is not a picture this browser can read`)); };
    img.src = url;
  });
}

function canvasOf(img, max) {
  const w = img.naturalWidth ?? img.width, h = img.naturalHeight ?? img.height;
  const k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  c.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, c.width, c.height);
  return c;
}

/** The cut-out as a picture: the vessel on a transparent background, her box marked. */
function previewOf(c, data, sil) {
  const ctx = c.getContext('2d');
  const out = ctx.createImageData(c.width, c.height);
  for (let i = 0; i < sil.mask.length; i++) {
    const on = sil.mask[i];
    out.data[i * 4] = data.data[i * 4];
    out.data[i * 4 + 1] = data.data[i * 4 + 1];
    out.data[i * 4 + 2] = data.data[i * 4 + 2];
    out.data[i * 4 + 3] = on ? 255 : 0;
  }
  const p = document.createElement('canvas');
  p.width = c.width;
  p.height = c.height;
  p.getContext('2d').putImageData(out, 0, 0);
  return p.toDataURL('image/png');
}

/**
 * The vessel cut out of a picture. With `alpha` (the AI's mask, ai.js) it is cut by that; without,
 * by the colour round the picture's border (`threshold`, photomodel.js). `view` fills the outline
 * from keel to top for side and plan views. { sil, data (ImageData at the cut-out's size), preview }.
 */
export function cutPhoto(img, { alpha = null, threshold = 20, view = null } = {}) {
  const c = canvasOf(img, MAX_SIDE);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const data = ctx.getImageData(0, 0, c.width, c.height);
  let input = data;
  if (alpha) {
    // the mask, scaled to this size, as the picture's transparency
    const m = document.createElement('canvas');
    m.width = alpha.width;
    m.height = alpha.height;
    const md = m.getContext('2d').createImageData(alpha.width, alpha.height);
    for (let i = 0; i < alpha.alpha.length; i++) { md.data[i * 4 + 3] = 255; md.data[i * 4] = md.data[i * 4 + 1] = md.data[i * 4 + 2] = alpha.alpha[i]; }
    m.getContext('2d').putImageData(md, 0, 0);
    const s = document.createElement('canvas');
    s.width = c.width;
    s.height = c.height;
    const sctx = s.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(m, 0, 0, c.width, c.height);
    const a = sctx.getImageData(0, 0, c.width, c.height).data;
    input = new ImageData(new Uint8ClampedArray(data.data), c.width, c.height);
    for (let i = 0; i < c.width * c.height; i++) input.data[i * 4 + 3] = a[i * 4] >= 128 ? 255 : 0;
    // photomodel.js cuts by transparency only when there is some: an all-vessel picture stays whole
    if (!input.data.some((v, i) => i % 4 === 3 && v === 0)) input.data[3] = 0;
  }
  const sil = silhouette(input, threshold, { solidColumns: SIDE_VIEWS.has(view) });
  return { sil, data, preview: sil ? previewOf(c, data, sil) : c.toDataURL('image/jpeg', 0.7) };
}

/** The part of a picture inside the vessel's box, for a texture (at most 2048 px). */
function cropped(img, sil) {
  const w = img.naturalWidth ?? img.width;
  const k = w / sil.width;
  const { x0, y0, x1, y1 } = sil.box;
  const sx = x0 * k, sy = y0 * k, sw = (x1 - x0 + 1) * k, sh = (y1 - y0 + 1) * k;
  const s = Math.min(1, 2048 / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * s));
  c.height = Math.max(1, Math.round(sh * s));
  c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}

/** A picture for a view no photo shows: her hull colour up to the deck, the superstructure's above. */
function paintedEnd(size, deck, colours) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const ctx = c.getContext('2d');
  const split = Math.round((1 - deck / size.H) * c.height);
  ctx.fillStyle = colours.superstructure;
  ctx.fillRect(0, 0, c.width, split);
  ctx.fillStyle = colours.hull;
  ctx.fillRect(0, split, c.width, c.height - split);
  // a band of windows under the top of the superstructure
  ctx.fillStyle = mix(colours.superstructure, '#1b2a38', 0.75);
  ctx.fillRect(6, Math.round(split * 0.35), c.width - 12, Math.max(2, Math.round(split * 0.08)));
  return c;
}
function paintedTop(colours) {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d');
  ctx.fillStyle = colours.deck;
  ctx.fillRect(0, 0, 32, 32);
  return c;
}

function texture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.userData.mimeType = 'image/jpeg'; // photos as JPEG: a .glb a fraction of the size
  return t;
}

/**
 * The hull under the water: from the waterline down to her draught, her half-beam along the length
 * (`halfBeam(a)`, a share) and a U-shaped section; the forefoot and the stern cut up a little.
 */
function underwaterHull(size, T, halfBeam, colour) {
  const NX = 64, NS = 16;
  const pos = [], idx = [];
  const ring = (a) => {
    const hb = (size.B / 2) * halfBeam(a);
    const depth = T * Math.min(1, Math.sqrt(Math.max(0, (1 - a) / 0.1)), 0.55 + 0.45 * Math.min(1, a / 0.08));
    const out = [];
    for (let s = 0; s <= NS; s++) {
      const th = (s / NS) * Math.PI; // 0: port waterline, pi: starboard
      const c = Math.cos(th), si = Math.sin(th);
      const z = -hb * Math.sign(c) * Math.abs(c) ** 0.5;
      const y = -depth * si ** 0.5;
      out.push([a * size.L - size.L / 2, y, z]);
    }
    return out;
  };
  for (let i = 0; i <= NX; i++) for (const p of ring(i / NX)) pos.push(...p);
  const row = NS + 1;
  for (let i = 0; i < NX; i++) for (let s = 0; s < NS; s++) {
    const a = i * row + s, b = a + row;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  // the stern's end closed (a transom): a fan from its middle at the waterline
  const centre = pos.length / 3;
  pos.push(-size.L / 2, 0, 0);
  for (let s = 0; s < NS; s++) idx.push(centre, s + 1, s);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.8, metalness: 0.05, side: THREE.DoubleSide });
  m.name = 'antifouling';
  const mesh3 = new THREE.Mesh(g, m);
  mesh3.name = 'hull_under_water';
  return mesh3;
}

/**
 * Her colours: sampled from the side photos where they show them, else as the AI named them, else
 * her kind's (presets.js).
 */
export function coloursFor(kind, desc, sampled = {}) {
  const base = DEFAULT_LIVERY[kind] ?? DEFAULT_LIVERY.cargo;
  const hull = sampled.hull ?? desc?.hull ?? base.hull;
  const superstructure = sampled.superstructure ?? desc?.superstructure ?? base.superstructure;
  return {
    hull,
    superstructure,
    funnel: desc?.funnel ?? base.funnel,
    deck: mix(superstructure, '#8d949b', 0.45),
    bootTop: base.bootTop,
  };
}

/**
 * Build her. `photos`: [{ img, sil, data, slot, flip }] (slot: vision.js's SLOTS; 'extra' gives
 * colours only), `desc` the merged description (vision.js), `dims` { length, beam?, draft?, height? }
 * (metres; height above the waterline), `fallbackKind` her kind from AIS when the photos do not say,
 * `prefer` 'photos' (carve when there is a side photo) or 'type'. Returns { model (a fitted model as
 * vesselmodel.js makes them), method: 'photos' | 'type', kind, size, colours, notes: [strings] }.
 */
export function buildVessel({ photos, desc = null, dims, fallbackKind = 'cargo', prefer = 'photos', res = 180 }) {
  const L = dims.length > 0 ? dims.length : KIND_PRESETS[kindFor(desc?.type, 0, fallbackKind)]?.length ?? 60;
  const kind = kindFor(desc?.type, L, fallbackKind);
  const preset = KIND_PRESETS[kind] ?? KIND_PRESETS.cargo;
  const B = dims.beam > 0 ? dims.beam : L / preset.lb;
  const notes = [];
  // the photo to carve with for each view: the widest cut-out
  const bySlot = {};
  for (const p of photos) {
    if (!p.sil || !p.slot || p.slot === 'extra') continue;
    if (!bySlot[p.slot] || aspect(p.sil) > aspect(bySlot[p.slot].sil)) bySlot[p.slot] = p;
  }
  const sides = ['port', 'starboard'].filter((k) => bySlot[k]);
  // colours and the height of the hull from the side photos
  let hullTop = null;
  const sampled = {};
  for (const k of sides) {
    const p = bySlot[k];
    hullTop ??= hullTopFromSide(p.sil);
    const c = bandColours(p.data, p.sil, hullTop);
    sampled.hull ??= c.hull;
    sampled.superstructure ??= c.superstructure;
  }
  const colours = coloursFor(kind, desc, sampled);
  const T = dims.draft > 0 ? dims.draft : B / preset.bt;
  const shape = { kind, stern: STERN_FOR[desc?.stern] ?? preset.stern };

  if (!sides.length || prefer === 'type') {
    if (!sides.length && photos.length) notes.push('No photo shows her side, so she is built from her type in the colours and shape the photos show. A photo from abeam makes her own shape.');
    return { ...fromType(kind, { L, B, T, height: dims.height }, desc, colours), kind, colours, notes };
  }

  // the views to carve with: the photos, and drawn ones for what they lack
  const sils = {}, flips = {};
  for (const [k, p] of Object.entries(bySlot)) { sils[k] = p.sil; flips[k] = Boolean(p.flip); }
  const est = sizeFrom(L, sils);
  const size = { L, B, H: dims.height > 0 ? dims.height : est.H };
  const deck = Math.min(size.H * 0.7, Math.max(0.5, (hullTop ?? 0.3) * size.H));
  const width = SUPERSTRUCTURE_WIDTH[kind] ?? 0.8;
  const drawn = [];
  if (!sils.top) { sils.top = planSilhouette(size, shape); drawn.push('top'); }
  if (!sils.bow) { sils.bow = endSilhouette(size, { deck, width }); drawn.push('bow'); }
  if (!sils.stern) { sils.stern = endSilhouette(size, { deck, width }); drawn.push('stern'); }
  let g = carve(sils, size, { res, flips });
  for (const k of g.mirrored) flips[k] = !flips[k];
  const m = mesh(g, 4);
  if (!m.indices.length) throw new Error('The photos leave nothing in common: check which view each one is');
  const parts = texturedParts(m, size, g.used, flips, sils);
  const group = new THREE.Group();
  group.name = 'vessel_from_photos';
  for (const [k, p] of Object.entries(parts)) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(p.positions, 3));
    geom.setAttribute('normal', new THREE.BufferAttribute(p.normals, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(p.uvs, 2));
    geom.translate(-size.L / 2, 0, 0);
    const photo = bySlot[k];
    const canvas = photo ? cropped(photo.img, photo.sil) : k === 'top' ? paintedTop(colours) : paintedEnd(size, deck, colours);
    const mat = new THREE.MeshStandardMaterial({ map: texture(canvas), roughness: 0.7, metalness: 0.05 });
    mat.name = photo ? `photo_${k}` : `painted_${k}`;
    const part = new THREE.Mesh(geom, mat);
    part.name = `above_water_${k}`;
    group.add(part);
  }
  const halfBeam = bySlot.top ? halfBeamFromPlan(bySlot.top.sil, size, flips.top) : (a) => planShape(a, shape);
  group.add(underwaterHull(size, T, halfBeam, colours.bootTop));
  for (const i of g.ignored) notes.push(`The ${i.view} photo did not fit the others and was left out of the shape.`);
  for (const k of g.mirrored) notes.push(`The ${k} photo was taken the other way round, and was turned.`);
  if (drawn.length) notes.push(`No photo ${drawn.map((k) => ({ top: 'from above', bow: 'of the bow', stern: 'of the stern' })[k]).join(', ')}: ${drawn.length > 1 ? 'those views are' : 'that view is'} drawn from her type and painted in her colours.`);
  const model = fitModel(group, { up: '+y', forward: '+x', scale: 1, waterline: 'origin' });
  return { model, method: 'photos', kind, size: { ...size, T }, colours, notes };
}

/** She built from her type (ship.js), with what the description says of her. */
function fromType(kind, { L, B, T, height }, desc, colours) {
  const p = defaultParams(kind, L);
  const params = {
    ...p,
    beam: B,
    draft: T,
    depth: Math.max(p.depth * (B / p.beam), depthFor(kind, B, T, L)),
    bow: BOW_FOR[desc?.bowShape] ?? p.bow,
    stern: STERN_FOR[desc?.stern] ?? p.stern,
    decks: desc?.decks > 0 ? Math.min(12, desc.decks) : p.decks,
    funnels: desc?.funnels >= 0 && desc?.funnels !== null ? Math.min(4, desc.funnels) : p.funnels,
    masts: desc?.masts >= 0 && desc?.masts !== null ? Math.min(5, desc.masts) : p.masts,
  };
  if (height > 0) params.airDraft = height;
  const livery = { ...(DEFAULT_LIVERY[kind] ?? DEFAULT_LIVERY.cargo), hull: colours.hull, superstructure: colours.superstructure, funnel: colours.funnel };
  const name = desc?.name ?? '';
  const model = buildShip(params, livery, { name, port: '', banner: '', imo: '', font: HULL_FONTS[0], showDraftMarks: false, showPlimsoll: false, showStripe: false, nameScale: 1, bannerScale: 1 });
  return { model, method: 'type', size: { L, B, H: model.dims.topY, T }, params, livery };
}
