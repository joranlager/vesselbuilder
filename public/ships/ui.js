// The vessel builder, laid out like a vessel's page on a ship register (her name, type and numbers
// at the top, her particulars in a table, her picture: here her 3D model). A vessel may come with
// her AIS report (showAisVessel).
//
// Her model is, in this order: her own from the vessels folder or this device; one built from her
// photos (vesselbuilder.js: cut out of their backgrounds and described by AI on this device, ai.js);
// one from model and texture files; or one built from her type. It can be downloaded for a vessels
// folder (.glb and its .json), committed to a GitHub repository (github.js), saved on this device,
// or (with onPlace) placed on a chart.
//
// app.js puts it on the page. It is shared with Rudder (github.com/joranlager/rudder), where it is behind Ships.

import { ShipScene } from './scene.js';
import { hullFromAis, typeName, navStatusText, draughtM, ageMinutes, kindFromAis } from '../ais.js';
import { KIND_PRESETS } from './presets.js';
import { loadModel, loadEntry, fitModel, disposeObject, nameMaterials, materialsNamed, applyTexture, clearTexture, exportGlb, thumbnail } from './vesselmodel.js';
import { formatOf, PICTURE_FORMATS, UP_AXES, FORWARD_AXES } from '../vesselcatalog.js';
import { vesselModels, findIn, FOLDER_URL, modelBlob, saveModel } from '../vessellibrary.js';
import { PROMPT, BOW_PROMPTS, bowVote, parseDescription, mergeDescriptions, slotFor, SLOTS, kindFor } from './vision.js';
import { aspect } from './photomodel.js';
import { readPicture, cutPhoto, buildVessel, buildLowPoly } from './vesselbuilder.js';
import { LOWPOLY_PROMPT, parseLowPoly } from './lowpoly.js';
import { aiCutout, aiDescribe, aiDevice, MODEL_SIZES } from './ai.js';
import { loadGithub, commitVessel, vesselFileBase, branchFromBuild } from '../github.js';
import { lookupImo, validImo, proxyBase, siteUrl, kindFromType } from '../maritimedb.js';
import * as THREE from '../vendor/three.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = (v) => (Number(v) > 0 ? Number(v) : null);
const fmtM = (m) => (m > 0 ? `${m < 20 ? m.toFixed(1) : Math.round(m)} m` : '—');
const mb = (b) => `${Math.round(b / 1e6)} MB`;

const VIEWS = [['quarter', '3/4'], ['profile', 'Side'], ['bow', 'Bow'], ['stern', 'Stern'], ['top', 'Above']];
const KINDS = Object.entries(KIND_PRESETS).map(([k, p]) => [k, p.label]);
const SOURCE = {
  folder: ['own', 'Her own model, from the vessels folder'],
  device: ['own', 'Her own model, saved on this device'],
  upload: ['file', 'From a model file'],
  photos: ['photos', 'Built from her photos'],
  lowpoly: ['photos', 'Low-poly, from what the AI saw'],
  type: ['type', 'Built from her type and size'],
};
// The flag by the first digits of the MMSI (the Maritime Identification Digits), for the common ones.
const MID = {
  257: 'Norway', 258: 'Norway', 259: 'Norway', 231: 'Faroe Islands', 265: 'Sweden', 266: 'Sweden', 219: 'Denmark', 220: 'Denmark',
  230: 'Finland', 251: 'Iceland', 211: 'Germany', 218: 'Germany', 232: 'United Kingdom', 233: 'United Kingdom', 234: 'United Kingdom', 235: 'United Kingdom',
  244: 'Netherlands', 245: 'Netherlands', 246: 'Netherlands', 205: 'Belgium', 226: 'France', 227: 'France', 228: 'France', 224: 'Spain', 225: 'Spain',
  247: 'Italy', 263: 'Portugal', 255: 'Portugal (Madeira)', 248: 'Malta', 249: 'Malta', 256: 'Malta', 215: 'Malta', 209: 'Cyprus', 210: 'Cyprus', 212: 'Cyprus',
  273: 'Russia', 261: 'Poland', 276: 'Estonia', 275: 'Latvia', 277: 'Lithuania', 636: 'Liberia', 538: 'Marshall Islands', 308: 'Bahamas', 309: 'Bahamas', 311: 'Bahamas',
  305: 'Antigua and Barbuda', 351: 'Panama', 352: 'Panama', 353: 'Panama', 354: 'Panama', 355: 'Panama', 356: 'Panama', 357: 'Panama', 370: 'Panama', 371: 'Panama', 372: 'Panama', 373: 'Panama',
  477: 'Hong Kong', 563: 'Singapore', 564: 'Singapore', 565: 'Singapore', 566: 'Singapore', 412: 'China', 413: 'China', 414: 'China', 431: 'Japan', 440: 'South Korea', 441: 'South Korea',
  366: 'United States', 367: 'United States', 368: 'United States', 369: 'United States', 316: 'Canada', 999: 'Placed in Rudder',
};
const flagOf = (mmsi) => MID[String(mmsi ?? '').slice(0, 3)] ?? '';

let cssLoaded = false;
function loadCss() {
  if (cssLoaded) return;
  cssLoaded = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL(`./ships.css${new URL(import.meta.url).search}`, import.meta.url).href;
  document.head.appendChild(link);
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** A vessel with nothing known yet: typed in, or the start screen. */
const blankVessel = () => ({ name: '', mmsi: '', imo: '', callSign: '', kind: 'ferry', length: 40, beam: null, draft: null, height: null, ais: null, db: null });

/**
 * Builds the builder into `root` (an empty element over the map). `onClose`: its close button;
 * `onPlace(spec, keepLook)`: put the vessel on the chart (app.js).
 */
export function createShipInspector(root, { onClose, onPlace } = {}) {
  loadCss();
  const st = {
    vessel: blankVessel(),
    view: null, // { model, source, entry?, object?, fit?, notes: [] }
    photos: [], // { id, name, img, thumb, alpha, cut, desc, raw, slot, flip, status, error }
    desc: null,
    useAi: { cutout: true, describe: true },
    gpu: null,
    busy: null, // { text, progress: { [file]: { loaded, total } } }
    error: null,
    notes: [],
    prefer: 'photos', // her shape: 'photos' (carved, refined from the low-poly), 'lowpoly' or 'type'
    lowpoly: null, // the low-poly OBJ last made: { obj, mtl }
    texTarget: '*',
    save: { text: '', tone: '', link: '' },
    units: 'metric',
    callouts: true,
    typed: new Set(), // the particulars typed in by hand: a lookup leaves them be
    lookup: { state: '', imo: '' }, // her particulars from maritime-database.com: '', 'busy', 'ok', 'none', 'err'
  };
  let photoSeq = 0;
  let seq = 0; // each new vessel: work for an older one is dropped

  root.classList.add('ships', 'vb');
  root.innerHTML = `
    <header class="vb-head">
      <div class="vb-id"></div>
      ${onClose ? `<button type="button" class="close vb-close" aria-label="Close the ship builder">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" d="M6 6l12 12M18 6 6 18"/></svg>
      </button>` : ''}
    </header>
    <div class="vb-main">
      <div class="vb-stage">
        <div class="ships-view"></div>
        <div class="vb-views" role="group" aria-label="Camera">
          ${VIEWS.map(([v, l]) => `<button type="button" data-cam="${v}">${l}</button>`).join('')}
          <button type="button" data-act="callouts" aria-pressed="true" title="Dimension lines">↔</button>
        </div>
        <div class="vb-badge"></div>
      </div>
      <div class="vb-side">
        <section class="vb-card" data-sec="status"></section>
        <section class="vb-card" data-sec="particulars"></section>
        <section class="vb-card" data-sec="photos"></section>
        <section class="vb-card" data-sec="files"></section>
        <section class="vb-card" data-sec="save"></section>
      </div>
    </div>
    <input type="file" class="vb-hidden" data-pick="photos" accept="image/*" multiple>
    <input type="file" class="vb-hidden" data-pick="files" accept=".glb,.gltf,.bin,.obj,.mtl,.stl,.ply,.fbx,.dae,.3mf,${PICTURE_FORMATS.map((f) => `.${f}`).join(',')}" multiple>`;

  const $ = (s) => root.querySelector(s);
  const sec = (name) => root.querySelector(`[data-sec="${name}"]`);
  let scene = null;
  try {
    scene = new ShipScene($('.ships-view'));
  } catch (e) {
    $('.ships-view').innerHTML = `<p class="ships-noview">The 3D view is not available here: ${esc(e instanceof Error ? e.message : e)}</p>`;
  }

  // ---------- the model in view ----------

  const dimsOf = (m) => ({ loa: m.dims.xMax - m.dims.xMin, beam: m.dims.halfBeam * 2, draft: Math.max(0, -m.dims.keelY), air: m.dims.topY });
  function show(view, reframe = true) {
    const old = st.view;
    st.view = view;
    if (scene) {
      scene.setShip(view.model, reframe); // disposes the model it had
      const d = dimsOf(view.model);
      scene.setCallouts({ ...d, sources: {} }, st.units, st.callouts);
    }
    // a model from a file shares its loaded object with the fitting wrapper: free it when it goes
    if (old?.object && old.object !== view.object) setTimeout(() => disposeObject(old.object), 200);
    render('status', 'files', 'save', 'badge');
  }

  /** Her model from her type and size (ship.js), in the colours the photos showed if any. */
  function showFromType() {
    const v = st.vessel;
    const r = buildVessel({ photos: [], desc: st.desc, dims: dimsFor(), fallbackKind: v.kind, prefer: 'type' });
    show({ model: r.model, source: 'type', notes: [] });
  }
  const dimsFor = () => ({ length: num(st.vessel.length) ?? 40, beam: num(st.vessel.beam), draft: num(st.vessel.draft), height: num(st.vessel.height) });

  /** How a model from a file is turned and sized at first: as its entry says, to her size where known. */
  const fitFor = (entry = {}) => ({
    up: entry.up ?? '+y',
    forward: entry.forward ?? '+x',
    scale: entry.scale ?? 'length',
    length: num(st.vessel.length) ?? entry.length,
    draft: num(st.vessel.draft) ?? entry.draft,
    waterline: entry.waterline ?? 'keel',
  });
  function showFile(object, fit, source, entry = null, reframe = true) {
    nameMaterials(object);
    object.removeFromParent();
    const model = fitModel(object, fit, { shared: true });
    show({ model, source, entry, object, fit, notes: [] }, reframe);
  }

  /** A vessel just opened: her own model if the vessels folder or this device has one. */
  async function lookForModel(my) {
    const models = await vesselModels();
    const e = findIn(models, { mmsi: st.vessel.mmsi, imo: st.vessel.imo, callSign: st.vessel.callSign, name: st.vessel.name });
    if (!e || my !== seq) return;
    try {
      const object = await loadEntry(e, { folderUrl: FOLDER_URL, blobOf: modelBlob });
      if (my !== seq) { disposeObject(object); return; }
      showFile(object, fitFor(e), e.source, e);
    } catch (err) {
      st.error = `Her model (${e.name}) could not be loaded: ${err.message}`;
      render('status');
    }
  }

  /** Her model follows a new size or kind (a model of her own is sized to her length). */
  function resized() {
    if (st.view?.fit) showFile(st.view.object, { ...st.view.fit, length: num(st.vessel.length) ?? st.view.fit.length, draft: num(st.vessel.draft) ?? st.view.fit.draft }, st.view.source, st.view.entry, false);
    else if (st.photos.some((p) => p.cut?.sil)) build();
    else showFromType();
  }

  /**
   * Her particulars by her IMO number, from maritime-database.com. They fill in what is not typed in
   * by hand, nor known from her AIS report.
   */
  async function lookUp(imo) {
    const my = seq;
    if (!validImo(imo)) { st.lookup = { state: '', imo: '' }; render('particulars'); return; }
    if (!proxyBase()) { st.lookup = { state: 'err', imo, text: 'To look her up on maritime-database.com from here, set a proxy in Settings → Vessel lookup.' }; render('particulars'); return; }
    st.lookup = { state: 'busy', imo };
    render('particulars');
    let d;
    try {
      d = await lookupImo(imo);
    } catch (err) {
      if (my !== seq || st.vessel.imo !== imo) return;
      st.lookup = { state: 'err', imo, text: `Not looked up on maritime-database.com: ${err.message}` };
      render('particulars');
      return;
    }
    if (my !== seq || st.vessel.imo !== imo) return; // another vessel, or another number, since
    if (!d) { st.lookup = { state: 'none', imo, text: `maritime-database.com does not know IMO ${imo}.` }; render('particulars'); return; }
    const v = st.vessel;
    const ais = v.ais;
    const src = ais ? hullFromAis(ais).sources : {};
    const fromAis = { name: ais?.name, mmsi: ais?.mmsi, callSign: ais?.callSign, length: src.length === 'ais', beam: src.beam === 'ais', draft: ais && draughtM(ais) };
    const set = (k, val) => { if (val !== null && val !== undefined && val !== '' && !st.typed.has(k) && !fromAis[k]) v[k] = val; };
    const before = [v.kind, v.length, v.beam, v.draft].join();
    set('name', d.name);
    set('mmsi', d.mmsi);
    set('callSign', d.callSign);
    set('length', d.length);
    set('beam', d.beam);
    set('draft', d.draught);
    set('kind', kindFromType(d.type, d.length ?? num(v.length) ?? 0));
    v.db = d;
    st.lookup = { state: 'ok', imo };
    render('head', 'particulars', 'save');
    if ([v.kind, v.length, v.beam, v.draft].join() !== before) resized();
    if (!st.view || st.view.source === 'type') lookForModel(my); // her own model, now that more of her is known
  }

  // ---------- photos ----------

  const sizeTotal = () => {
    const p = st.busy?.progress ?? {};
    let loaded = 0, total = 0;
    for (const f of Object.values(p)) { loaded += f.loaded; total += f.total; }
    return { loaded, total };
  };
  const onProgress = (what) => (p) => {
    if (!st.busy) return;
    st.busy.progress ??= {};
    st.busy.progress[`${p.model}/${p.file}`] = { loaded: p.loaded, total: p.total || p.loaded };
    const { loaded, total } = sizeTotal();
    st.busy.text = `Downloading ${what} (${mb(loaded)}${total ? ` of ${mb(total)}` : ''}), once for this browser…`;
    render('busy');
  };

  /** A picture mirrored left to right. */
  function mirrored(img) {
    const w = img.naturalWidth ?? img.width, h = img.naturalHeight ?? img.height;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(img, 0, 0);
    return c;
  }

  /** The vessel as cut out, on white: nothing else in the picture to look at. */
  async function cutOutOnWhite(p) {
    const im = new Image();
    im.src = p.cut.preview;
    await im.decode();
    const c = document.createElement('canvas');
    c.width = im.naturalWidth;
    c.height = im.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(im, 0, 0);
    return c;
  }

  async function addPhotos(files) {
    const pics = [...files].filter((f) => f.type.startsWith('image/') || PICTURE_FORMATS.includes(String(f.name).split('.').pop().toLowerCase()));
    if (!pics.length) return;
    const my = seq;
    for (const f of pics) {
      try {
        const img = await readPicture(f);
        st.photos.push({ id: ++photoSeq, name: f.name, img, thumb: img.src, status: 'new', slot: null, flip: false });
      } catch (e) {
        st.error = e.message;
      }
    }
    render('photos');
    await processPhotos(my);
  }

  /** Cut out and describe each new photo, one at a time, then build her from them. */
  async function processPhotos(my) {
    if (st.busy) return; // already at it: the new photos are picked up below
    st.busy = { text: 'Reading the photos…' };
    st.error = null;
    render('photos');
    try {
      for (;;) {
        const p = st.photos.find((x) => x.status === 'new');
        if (!p || my !== seq) break;
        const n = st.photos.indexOf(p) + 1;
        if (st.useAi.cutout) {
          p.status = 'cutting';
          st.busy.text = `Cutting the vessel out of photo ${n}…`;
          render('photos');
          try {
            p.alpha = await aiCutout(p.img, { onProgress: onProgress(`the background remover (${MODEL_SIZES.cutout} MB)`) });
          } catch (e) {
            p.alpha = null;
            p.warn = `The AI could not cut it out (${e.message}), so it was cut by its border colour.`;
          }
          st.busy.progress = {};
        }
        p.cut = cutPhoto(p.img, { alpha: p.alpha, view: 'port' });
        if (st.useAi.describe) {
          p.status = 'describing';
          p.raw = '';
          st.busy.text = `Looking at photo ${n}…`;
          render('photos');
          try {
            const r = await aiDescribe(p.img, PROMPT, {
              onProgress: onProgress(`the vision model, Qwen3.5 (${MODEL_SIZES.describe} MB)`),
              onToken: (t) => { p.raw += t; if (st.busy) { st.busy.text = `Looking at photo ${n}: ${p.raw.slice(-80)}`; render('busy'); } },
            });
            p.raw = r.text;
            p.desc = parseDescription(r.text);
            if (!p.desc) p.warn = `The AI's answer could not be read; set its view by hand.`;
          } catch (e) {
            p.warn = `The AI could not describe it: ${e.message}`;
          }
          st.busy.progress = {};
        }
        // seen from the side: which way her bow points, asked on its own of the photo and its mirror
        const long = p.cut.sil ? aspect(p.cut.sil) : 0;
        if (st.useAi.describe && (p.desc?.view === 'side' || (!p.desc?.view && long > 2.2))) {
          try {
            st.busy.text = `Looking at which way the bow of photo ${n} points…`;
            render('busy');
            const pics = [p.img, p.cut.sil ? await cutOutOnWhite(p) : null].filter(Boolean);
            const pairs = [];
            for (const q of BOW_PROMPTS) {
              for (const pic of pics) {
                const a = await aiDescribe(pic, q, { maxTokens: 4 });
                const b = await aiDescribe(mirrored(pic), q, { maxTokens: 4 });
                pairs.push([a.text, b.text]);
              }
            }
            p.desc = { ...(p.desc ?? {}), view: 'side', bow: bowVote(pairs) ?? 'unknown' };
          } catch { /* the first answer stands */ }
        }
        const s = slotFor(p.desc, long);
        p.slot = s.slot;
        p.flip = s.flip;
        p.guessed = s.guessed;
        if (['port', 'starboard', 'top'].includes(p.slot)) p.cut = cutPhoto(p.img, { alpha: p.alpha, view: p.slot });
        // seen from the side: her structure as low-poly blocks, her first model before any carving
        if (st.useAi.describe && p.cut.sil && (p.slot === 'port' || p.slot === 'starboard')) {
          try {
            p.raw = '';
            st.busy.text = `Seeing her shape in photo ${n} as blocks…`;
            render('busy');
            const r = await aiDescribe(p.img, LOWPOLY_PROMPT, {
              maxTokens: 480,
              onToken: (t) => { p.raw += t; if (st.busy) { st.busy.text = `Seeing her shape in photo ${n} as blocks: ${p.raw.slice(-60)}`; render('busy'); } },
            });
            p.plan = parseLowPoly(r.text);
            if (!p.plan) p.warn = 'The AI\'s blocks for her shape could not be read; she is carved from the outline only.';
          } catch { p.plan = null; }
          if (p.plan && my === seq && st.view?.source !== 'lowpoly') await showLowPoly(p);
        }
        p.status = p.cut.sil ? 'done' : 'error';
        if (!p.cut.sil) p.error = 'No vessel found in it';
        render('photos');
      }
    } finally {
      st.busy = null;
    }
    if (my !== seq) return;
    describeAll();
    build();
  }

  /** What all the photos say, merged; fills in her particulars that are not known yet. */
  function describeAll() {
    st.desc = mergeDescriptions(st.photos.map((p) => p.desc));
    const v = st.vessel;
    if (!v.ais) {
      if (st.desc.name && !v.name) v.name = st.desc.name;
      if (st.desc.type) v.kind = kindFor(st.desc.type, num(v.length) ?? 0, v.kind);
      render('particulars', 'head');
    }
  }

  /** The side photo whose blocks make her low-poly model: the widest of those with a plan. */
  const planned = () => st.photos.filter((p) => p.plan && p.cut?.sil && (p.slot === 'port' || p.slot === 'starboard'))
    .sort((a, b) => aspect(b.cut.sil) - aspect(a.cut.sil))[0] ?? null;

  /** Her low-poly model from a side photo's plan (lowpoly.js), shown as her model. */
  async function showLowPoly(p) {
    const my = seq;
    try {
      const r = await buildLowPoly({ photo: { sil: p.cut.sil, data: p.cut.data, slot: p.slot, flip: p.flip }, plan: p.plan, desc: st.desc ?? p.desc, dims: dimsFor(), fallbackKind: st.vessel.kind });
      if (my !== seq) { r.model.dispose(); return false; }
      st.lowpoly = { obj: r.obj, mtl: r.mtl };
      st.buildError = null;
      show({ model: r.model, source: 'lowpoly', notes: r.notes });
      return true;
    } catch (e) {
      st.buildError = `The low-poly model could not be made: ${e.message}`;
      return false;
    }
  }

  function build() {
    const photos = st.photos.filter((p) => p.cut?.sil).map((p) => ({ img: p.img, sil: p.cut.sil, data: p.cut.data, slot: p.slot, flip: p.flip }));
    if (!photos.length) { render('photos'); return; }
    if (st.prefer === 'lowpoly' && planned()) { showLowPoly(planned()).then(() => render('photos')); return; }
    try {
      const r = buildVessel({ photos, desc: st.desc, dims: dimsFor(), fallbackKind: st.vessel.kind, prefer: st.prefer });
      st.buildError = null;
      show({ model: r.model, source: r.method === 'photos' ? 'photos' : 'type', notes: r.notes });
    } catch (e) {
      st.buildError = e.message;
    }
    render('photos');
  }

  function recut(p) {
    p.cut = cutPhoto(p.img, { alpha: p.alpha, view: p.slot });
    p.status = p.cut.sil ? 'done' : 'error';
  }

  // ---------- model and texture files ----------

  async function addFiles(files) {
    const list = [...files];
    const modelFile = list.find((f) => formatOf(f.name));
    const pictures = list.filter((f) => PICTURE_FORMATS.includes(String(f.name).split('.').pop().toLowerCase()));
    st.save = { text: '', tone: '', link: '' };
    if (modelFile) {
      st.busy = { text: `Reading ${modelFile.name}…` };
      render('files');
      try {
        const object = await loadModel({ files: list });
        const f = formatOf(modelFile.name);
        // glTF, FBX and Collada are y-up by their rules; STL and 3MF come from CAD and 3D printing (z-up)
        const up = f === 'stl' || f === '3mf' || f === 'ply' ? '+z' : '+y';
        showFile(object, { ...fitFor(), up, forward: guessForward(object, up) }, 'upload', { name: modelFile.name.replace(/\.[^.]+$/, '') });
        st.texTarget = '*';
      } catch (e) {
        st.error = `Could not read ${modelFile.name}: ${e.message}`;
      }
      st.busy = null;
      render('files', 'status');
      return; // its own pictures went in with it
    }
    if (pictures.length && st.view) {
      try {
        const img = await readPicture(pictures[0]);
        const mats = materialsNamed(st.view.model.group, st.texTarget);
        // a picture made for a model's own texture coordinates goes on them; else it repeats every 10 m
        const hasUv = mats.length && st.view.model.group.getObjectByProperty('isMesh', true)?.geometry.getAttribute('uv');
        applyTexture(st.view.model.group, mats, img, { projection: st.texTarget !== '*' && hasUv ? 'uv' : 'box', tile: 10 });
        st.view.textured = true;
      } catch (e) {
        st.error = e.message;
      }
      render('files');
    }
  }

  /** The axis a model is longest along, across the up axis: most likely her length. */
  function guessForward(object, up) {
    object.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(object, true).getSize(new THREE.Vector3());
    const axes = ['x', 'y', 'z'].filter((a) => a !== up[1]);
    return `+${size[axes[0]] >= size[axes[1]] ? axes[0] : axes[1]}`;
  }

  // ---------- saving ----------

  const keys = () => {
    const v = st.vessel;
    return { name: (v.name || 'Vessel').trim(), mmsi: String(v.mmsi ?? '').replace(/\D/g, ''), imo: String(v.imo ?? '').replace(/\D/g, ''), callSign: String(v.callSign ?? '').trim().toUpperCase() };
  };
  function sidecar() {
    const k = keys();
    const d = dimsOf(st.view.model);
    return {
      name: k.name,
      ...(k.mmsi.length === 9 ? { mmsi: [k.mmsi] } : {}),
      ...(k.imo.length === 7 ? { imo: k.imo } : {}),
      ...(k.callSign ? { callSign: k.callSign } : {}),
      up: '+y',
      forward: '+x',
      scale: 'length',
      length: +d.loa.toFixed(2),
      beam: +d.beam.toFixed(2),
      draft: +d.draft.toFixed(2),
      waterline: 'origin',
      source: `Vessel builder (${SOURCE[st.view.source]?.[1].toLowerCase() ?? st.view.source})`,
    };
  }
  const glb = () => exportGlb(st.view.model.group);
  const say = (text, tone = '', link = '') => { st.save = { text, tone, link }; render('save'); };

  async function download() {
    const base = vesselFileBase(keys());
    say('Making the file…');
    const blob = await glb();
    downloadBlob(`${base}.glb`, blob);
    downloadBlob(`${base}.json`, new Blob([JSON.stringify(sidecar(), null, 2) + '\n'], { type: 'application/json' }));
    say(`Downloaded ${base}.glb (${mb(blob.size)}) and ${base}.json. Put both in public/vessels/ and run npm run vessels.`, 'ok');
  }

  async function commit() {
    const g = loadGithub();
    const branch = g.branch || branchFromBuild(document.getElementById('build')?.textContent);
    const base = vesselFileBase(keys());
    try {
      say('Making the file…');
      const blob = await glb();
      const r = await commitVessel({ model: { name: `${base}.glb`, blob }, sidecar: sidecar() }, {
        token: g.token, repo: g.repo, branch, message: `Vessel model: ${keys().name}${keys().imo ? ` (IMO ${keys().imo})` : ''}`,
      }, { onStep: (t) => say(`${t}…`) });
      say(`Committed to ${r.branch}. She is drawn with it on the chart after the next deploy.`, 'ok', r.url);
    } catch (e) {
      say(`Not committed: ${e.message}.`, 'err');
    }
  }

  async function saveHere() {
    const k = keys();
    say('Saving…');
    try {
      const blob = await glb();
      const d = dimsOf(st.view.model);
      await saveModel({
        id: st.view.entry?.source === 'device' ? st.view.entry.id : `own-${vesselFileBase(k)}`,
        name: k.name, mmsi: k.mmsi ? [k.mmsi] : [], imo: k.imo, callSign: k.callSign, blob,
        length: +d.loa.toFixed(2), beam: +d.beam.toFixed(2), draft: +d.draft.toFixed(2),
        thumb: scene ? thumbnail(scene.renderer.domElement) : '', credit: '', source: 'builder',
      });
      say('Saved on this device. She is drawn with it on the chart here.', 'ok');
    } catch (e) {
      say(`Not saved: ${e.message}`, 'err');
    }
  }

  function place() {
    if (!onPlace || !st.view) return;
    const d = dimsOf(st.view.model);
    const name = keys().name.replace(/^(MS|MV|M\/S|RMS)\s+/i, '');
    const spec = { name, kind: st.vessel.kind, length: d.loa, beam: d.beam, draft: Math.max(0.5, d.draft) };
    // her look goes with her: saved on this device under the MMSI she is given
    const keepLook = async (mmsi) => {
      const blob = await glb();
      await saveModel({ id: `placed-${mmsi}`, name, mmsi: [String(mmsi)], blob, length: +d.loa.toFixed(2), beam: +d.beam.toFixed(2), draft: +d.draft.toFixed(2), placed: true, thumb: scene ? thumbnail(scene.renderer.domElement) : '' });
    };
    onPlace(spec, keepLook);
  }

  // ---------- drawing the page ----------

  function renderHead() {
    const v = st.vessel;
    const k = keys();
    const kind = KIND_PRESETS[v.kind]?.label ?? '';
    const type = v.db?.type || (v.ais ? typeName(v.ais.shipType) : kind);
    const ids = [k.imo.length === 7 ? `IMO ${k.imo}` : '', k.mmsi ? `MMSI ${k.mmsi}` : ''].filter(Boolean).join(' · ');
    $('.vb-id').innerHTML = `<h1>${esc(v.name || 'New vessel')}</h1><p>${esc([type, ids].filter(Boolean).join(', '))}</p>`;
  }

  function renderBadge() {
    const s = st.view ? SOURCE[st.view.source] : null;
    $('.vb-badge').innerHTML = s ? `<span class="vb-tag" data-kind="${s[0]}">${esc(s[1])}</span>` : '';
  }

  function renderStatus() {
    const v = st.vessel.ais;
    const rows = [];
    if (v?.msgtime) { // a report heard, not only her particulars
      const age = ageMinutes(v);
      rows.push(['Status', esc(navStatusText(v.navigationalStatus))]);
      if (Number.isFinite(v.speedOverGround)) rows.push(['Speed / course', `${v.speedOverGround.toFixed(1)} kn / ${Number.isFinite(v.courseOverGround) ? Math.round(v.courseOverGround) + '°' : '—'}`]);
      if (v.destination) rows.push(['Destination', esc(v.destination)]);
      if (Number.isFinite(age)) rows.push(['Last report', age < 1 ? 'just now' : age < 90 ? `${Math.round(age)} min ago` : `${Math.round(age / 60)} h ago`]);
    }
    const d = st.view ? dimsOf(st.view.model) : null;
    sec('status').innerHTML = `
      ${rows.length ? `<table class="vb-table">${rows.map(([a, b]) => `<tr><th>${a}</th><td>${b}</td></tr>`).join('')}</table>` : ''}
      ${d ? `<p class="vb-model">Model: <b>${esc(SOURCE[st.view.source]?.[1] ?? '')}</b>, ${fmtM(d.loa)} × ${fmtM(d.beam)}, ${fmtM(d.air)} above the water.</p>` : ''}
      ${st.error ? `<p class="vb-msg" data-tone="err">${esc(st.error)}</p>` : ''}`;
  }

  function renderParticulars() {
    const v = st.vessel;
    const ais = v.ais;
    const field = (key, label, value, attrs = '') => `<tr><th><label for="vb-${key}">${label}</label></th><td><input id="vb-${key}" data-field="${key}" value="${esc(value ?? '')}" ${attrs}></td></tr>`;
    const db = v.db?.imo === String(v.imo) ? v.db : null;
    const flag = db?.flag || flagOf(v.mmsi);
    const lk = st.lookup.imo === v.imo ? st.lookup : { state: '' };
    const ro = (label, value) => (value ? `<tr><th>${label}</th><td class="vb-ro">${esc(value)}</td></tr>` : '');
    sec('particulars').innerHTML = `
      <h2>Particulars</h2>
      <table class="vb-table vb-edit">
        ${field('name', 'Name', v.name, 'autocomplete="off" spellcheck="false"')}
        ${field('imo', 'IMO', v.imo, 'inputmode="numeric" autocomplete="off" placeholder="7 digits"')}
        ${field('mmsi', 'MMSI', v.mmsi, 'inputmode="numeric" autocomplete="off" placeholder="9 digits"')}
        ${field('callSign', 'Call sign', v.callSign, 'autocomplete="off" spellcheck="false"')}
        ${ro('Flag', flag)}
        ${ro('Type', db?.type)}
        ${ais ? ro('AIS type', typeName(ais.shipType)) : ''}
        ${ro('Gross tonnage', db?.gross)}
        ${ro('Deadweight (t)', db?.deadweight)}
        ${ro('Built', db?.built)}
        <tr><th><label for="vb-kind">Kind</label></th><td><select id="vb-kind" data-field="kind">${KINDS.map(([k, l]) => `<option value="${k}" ${k === v.kind ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></td></tr>
        ${field('length', 'Length (m)', v.length, 'inputmode="decimal"')}
        ${field('beam', 'Beam (m)', v.beam, 'inputmode="decimal" placeholder="from the photos"')}
        ${field('draft', 'Draught (m)', v.draft, 'inputmode="decimal" placeholder="typical for her kind"')}
        ${field('height', 'Above water (m)', v.height, 'inputmode="decimal" placeholder="from the photos"')}
      </table>
      ${lk.state === 'busy' ? `<p class="vb-msg">Looking up IMO ${esc(lk.imo)} on maritime-database.com…</p>` : ''}
      ${lk.state === 'none' || lk.state === 'err' ? `<p class="vb-msg" data-tone="err">${esc(lk.text)}</p>` : ''}
      ${lk.state === 'ok' && db ? `<p class="fine">Particulars by her IMO number from <a href="${esc(db.url || siteUrl(db.imo))}" target="_blank" rel="noopener">maritime-database.com</a>${v.ais ? ', where her AIS report does not give them' : ''}.</p>` : ''}
      ${!lk.state && v.imo && !validImo(v.imo) ? '<p class="vb-msg" data-tone="err">That is not an IMO number: 7 digits, the last a check digit.</p>' : ''}
      ${ais?.msgtime ? '<p class="fine">From her AIS report; change anything that is wrong.</p>' : '<p class="fine">Her MMSI or IMO number is how she is known when she is met on a chart (Rudder matches by them).</p>'}`;
  }

  function renderBusy() {
    const el = sec('photos').querySelector('.vb-busy');
    if (!el) return;
    const { loaded, total } = sizeTotal();
    el.hidden = !st.busy;
    el.querySelector('span').textContent = st.busy?.text ?? '';
    const bar = el.querySelector('progress');
    bar.hidden = !total;
    if (total) { bar.max = total; bar.value = loaded; }
  }

  function renderPhotos() {
    const d = st.desc;
    const chips = d ? [
      d.type && `<span class="chip">${esc(d.type)}</span>`,
      d.name && `<span class="chip">“${esc(d.name)}”</span>`,
      ...['hull', 'superstructure', 'funnel'].filter((k) => d[k]).map((k) => `<span class="chip"><i class="vb-swatch" style="background:${d[k]}"></i>${k}</span>`),
      d.decks !== null && `<span class="chip">${d.decks} deck${d.decks === 1 ? '' : 's'}</span>`,
      d.funnels !== null && `<span class="chip">${d.funnels} funnel${d.funnels === 1 ? '' : 's'}</span>`,
      d.bowShape && `<span class="chip">${esc(d.bowShape)} bow</span>`,
      d.stern && `<span class="chip">${esc(d.stern)} stern</span>`,
    ].filter(Boolean) : [];
    const tile = (p) => `
      <li class="vb-photo" data-photo="${p.id}" data-status="${p.status}">
        <div class="vb-pic"><img src="${p.cut?.preview ?? p.thumb}" alt=""></div>
        <select data-slot="${p.id}" aria-label="What photo ${esc(p.name)} shows" ${p.slot ? '' : 'disabled'}>
          ${SLOTS.map(([k, l]) => `<option value="${k}" ${k === p.slot ? 'selected' : ''}>${esc(l)}</option>`).join('')}
        </select>
        <span class="vb-ps" ${p.warn ? `title="${esc(p.warn)}" data-warn` : ''}>${esc(p.warn ? 'See the note below' : p.status === 'cutting' ? 'Cutting out…' : p.status === 'describing' ? 'Looking…' : p.status === 'new' ? 'Waiting' : p.error ? p.error : p.guessed ? 'Which side? Check' : p.alpha ? 'Cut out by AI' : 'Cut out')}</span>
        <button type="button" class="vb-x" data-remove="${p.id}" aria-label="Remove this photo">×</button>
      </li>`;
    const gpu = st.gpu ? (st.gpu.webgpu ? 'This browser runs them on the graphics card.' : 'No WebGPU here, so they run on the processor: expect minutes per photo.') : '';
    const sides = st.photos.some((p) => p.slot === 'port' || p.slot === 'starboard');
    sec('photos').innerHTML = `
      <h2>Build from photos</h2>
      <div class="vb-drop" data-drop="photos">
        <p><b>Drop photos of her here</b> or <button type="button" class="link" data-act="pick-photos">choose photos</button>.</p>
        <p class="fine">A photo from abeam gives her shape; more photos (the other side, the bow, the stern, from above) give more of it, and of her colours.</p>
      </div>
      ${st.photos.length ? `<ul class="vb-photos">${st.photos.map(tile).join('')}</ul>` : ''}
      <div class="vb-busy" hidden><span></span><progress hidden></progress></div>
      ${[...st.photos.filter((p) => p.warn).map((p) => `Photo ${st.photos.indexOf(p) + 1}: ${p.warn}`), st.buildError].filter(Boolean).map((t) => `<p class="vb-msg" data-tone="err">${esc(t)}</p>`).join('')}
      ${chips.length ? `<div class="chips vb-chips">${chips.join('')}</div>` : ''}
      ${st.view?.notes?.length ? `<ul class="vb-notes">${st.view.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      ${st.photos.length ? `<div class="row vb-row">
        <button type="button" class="primary" data-act="build" ${st.busy || !st.photos.some((p) => p.cut?.sil) ? 'disabled' : ''}>Build again</button>
        ${sides ? `<label class="vb-check">Shape <select data-act="prefer">${[['photos', 'carved from the photos'], ['lowpoly', 'low-poly blocks'], ['type', 'from her type']].filter(([k]) => k !== 'lowpoly' || planned()).map(([k, l]) => `<option value="${k}" ${k === st.prefer ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}
        ${st.lowpoly ? '<button type="button" data-act="download-obj">Low-poly .obj</button>' : ''}
        <button type="button" data-act="clear-photos" ${st.busy ? 'disabled' : ''}>Clear</button>
      </div>` : ''}
      <details class="vb-ai">
        <summary>AI on this device</summary>
        <label class="vb-check"><input type="checkbox" data-ai="cutout" ${st.useAi.cutout ? 'checked' : ''}> Remove backgrounds (ormbg, ${MODEL_SIZES.cutout} MB)</label>
        <label class="vb-check"><input type="checkbox" data-ai="describe" ${st.useAi.describe ? 'checked' : ''}> Describe the photos: view, type, name, colours, decks, funnels, bow and stern (Qwen3.5, ${MODEL_SIZES.describe} MB)</label>
        <p class="fine">Downloaded once from Hugging Face and kept by the browser. Your photos never leave this device. ${gpu}</p>
      </details>`;
    renderBusy();
  }

  function renderFiles() {
    const v = st.view;
    const isFile = v && (v.source === 'upload' || v.source === 'folder' || v.source === 'device') && v.fit;
    const mats = v ? nameMaterials(v.model.group) : [];
    const axis = (k, list, cur) => `<label>${k === 'up' ? 'Up' : 'Bow'}<select data-fit="${k}">${list.map((a) => `<option ${a === cur ? 'selected' : ''}>${a}</option>`).join('')}</select></label>`;
    sec('files').innerHTML = `
      <h2>Model and texture files</h2>
      <div class="vb-drop" data-drop="files">
        <p><b>Drop a model</b> (.glb, .gltf, .obj with .mtl, .stl, .ply, .fbx, .dae, .3mf, with its pictures) <b>or a picture</b> to put on the model, or <button type="button" class="link" data-act="pick-files">choose files</button>.</p>
      </div>
      ${isFile ? `<div class="row vb-row vb-fit">${axis('up', UP_AXES, v.fit.up)}${axis('forward', FORWARD_AXES, v.fit.forward)}
        <label>Waterline<select data-fit="waterline"><option value="keel" ${v.fit.waterline === 'keel' ? 'selected' : ''}>keel at her draught</option><option value="origin" ${v.fit.waterline === 'origin' ? 'selected' : ''}>the model's own</option></select></label></div>
        <p class="fine">Turn the model until her bow points right in Side view, then she is sized to her length.</p>` : ''}
      ${v ? `<div class="row vb-row"><label>Picture on<select data-act="tex-target"><option value="*">the whole model</option>${mats.map((m) => `<option ${m === st.texTarget ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label>
        ${v.textured ? '<button type="button" data-act="tex-clear">Take pictures off</button>' : ''}</div>` : ''}`;
  }

  function renderSave() {
    const g = loadGithub();
    const ok = Boolean(st.view);
    sec('save').innerHTML = `
      <h2>Keep her model</h2>
      <div class="vb-actions">
        <button type="button" class="primary" data-act="download" ${ok ? '' : 'disabled'}>Download .glb and .json</button>
        <button type="button" data-act="commit" ${ok ? '' : 'disabled'}>Commit to GitHub</button>
        <button type="button" data-act="save-here" ${ok ? '' : 'disabled'}>Save on this device</button>
        ${onPlace ? `<button type="button" data-act="place" ${ok ? '' : 'disabled'}>Place on the chart</button>` : ''}
      </div>
      ${st.save.text ? `<p class="vb-msg" data-tone="${st.save.tone}">${esc(st.save.text)}${st.save.link ? ` <a href="${esc(st.save.link)}" target="_blank" rel="noopener">See the commit</a>` : ''}</p>` : ''}
      <p class="fine">The download goes in the repository's public/vessels folder. ${g.token ? `Commits go to <b>${esc(g.repo || '?')}</b>.` : 'To commit from here, add a GitHub token in Settings → GitHub.'} She is matched by MMSI, then IMO number, call sign and name.</p>`;
  }

  const RENDER = { head: renderHead, badge: renderBadge, status: renderStatus, particulars: renderParticulars, photos: renderPhotos, busy: renderBusy, files: renderFiles, save: renderSave };
  function render(...parts) {
    for (const p of parts.length ? parts : Object.keys(RENDER)) RENDER[p]();
  }

  // ---------- events ----------

  function setVessel(v) {
    seq++;
    st.vessel = v;
    st.photos = [];
    st.desc = null;
    st.lowpoly = null;
    st.error = null;
    st.save = { text: '', tone: '', link: '' };
    st.typed = new Set();
    st.lookup = { state: '', imo: '' };
    showFromType();
    render();
    lookForModel(seq);
    if (validImo(v.imo)) lookUp(v.imo);
  }

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.classList.contains('vb-close')) { onClose?.(); return; }
    if (b.dataset.cam) { scene?.view(b.dataset.cam); return; }
    if (b.dataset.remove) {
      st.photos = st.photos.filter((p) => String(p.id) !== b.dataset.remove);
      describeAll();
      if (st.photos.some((p) => p.cut?.sil)) build(); else { showFromType(); render('photos'); }
      return;
    }
    const a = b.dataset.act;
    if (a === 'pick-photos') $('[data-pick="photos"]').click();
    else if (a === 'pick-files') $('[data-pick="files"]').click();
    else if (a === 'build') build();
    else if (a === 'clear-photos') { st.photos = []; st.desc = null; st.lowpoly = null; showFromType(); render('photos'); }
    else if (a === 'download-obj' && st.lowpoly) {
      const base = vesselFileBase(keys());
      // the OBJ names its colours as lowpoly.mtl: named after her, both files
      downloadBlob(`${base}.obj`, new Blob([st.lowpoly.obj.replace('mtllib lowpoly.mtl', `mtllib ${base}.mtl`)], { type: 'text/plain' }));
      downloadBlob(`${base}.mtl`, new Blob([st.lowpoly.mtl], { type: 'text/plain' }));
    }
    else if (a === 'callouts') {
      st.callouts = !st.callouts;
      b.setAttribute('aria-pressed', String(st.callouts));
      if (st.view && scene) scene.setCallouts({ ...dimsOf(st.view.model), sources: {} }, st.units, st.callouts);
    } else if (a === 'tex-clear' && st.view) {
      clearTexture(st.view.model.group, materialsNamed(st.view.model.group, '*'));
      st.view.textured = false;
      render('files');
    } else if (a === 'download' && st.view) download().catch((err) => say(`Not downloaded: ${err.message}`, 'err'));
    else if (a === 'commit' && st.view) commit();
    else if (a === 'save-here' && st.view) saveHere();
    else if (a === 'place') place();
  });

  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.pick === 'photos') { addPhotos(t.files); t.value = ''; return; }
    if (t.dataset.pick === 'files') { addFiles(t.files); t.value = ''; return; }
    if (t.dataset.slot) {
      const p = st.photos.find((x) => String(x.id) === t.dataset.slot);
      if (!p) return;
      p.slot = t.value;
      p.flip = false;
      p.guessed = false;
      recut(p);
      render('photos');
      build();
      return;
    }
    if (t.dataset.ai) { st.useAi[t.dataset.ai] = t.checked; return; }
    if (t.dataset.act === 'prefer') { st.prefer = t.value; build(); return; }
    if (t.dataset.act === 'tex-target') { st.texTarget = t.value; return; }
    if (t.dataset.fit && st.view?.fit) {
      const fit = { ...st.view.fit, [t.dataset.fit]: t.value };
      if (t.dataset.fit === 'up' && fit.forward[1] === t.value[1]) fit.forward = guessForward(st.view.object, t.value);
      showFile(st.view.object, fit, st.view.source, st.view.entry, false);
      return;
    }
    if (t.dataset.field) {
      const k = t.dataset.field;
      st.vessel[k] = k === 'kind' || k === 'name' || k === 'callSign' ? t.value : t.value.trim();
      if (k === 'imo') st.vessel.imo = st.vessel.imo.replace(/\D/g, '');
      else st.typed.add(k);
      render('head');
      // a new size or kind: her model follows (a model of her own is sized to her length)
      if (['kind', 'length', 'beam', 'draft', 'height'].includes(k)) resized();
      if (['mmsi', 'imo', 'name', 'callSign'].includes(k)) render('particulars', 'save');
      if (k === 'imo' && st.vessel.imo !== st.lookup.imo) lookUp(st.vessel.imo);
    }
  });

  // photos and files dropped on their boxes (or anywhere: pictures are photos, models are files)
  root.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); e.target.closest('[data-drop]')?.classList.add('over'); } });
  root.addEventListener('dragleave', (e) => e.target.closest?.('[data-drop]')?.classList.remove('over'));
  root.addEventListener('drop', (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    const box = e.target.closest('[data-drop]');
    box?.classList.remove('over');
    const files = [...e.dataTransfer.files];
    if (box?.dataset.drop === 'files' || files.some((f) => formatOf(f.name))) addFiles(files);
    else addPhotos(files);
  });

  // ---------- start ----------

  setVessel(blankVessel());
  aiDevice().then((g) => { st.gpu = g; render('photos'); }).catch(() => {});

  return {
    /** Open a vessel from her AIS report (ais.js): her particulars, and her model. */
    showAisVessel(v) {
      const { params } = hullFromAis(v);
      setVessel({
        name: String(v.name ?? '').trim(),
        mmsi: v.mmsi ? String(v.mmsi) : '',
        imo: v.imoNumber ? String(v.imoNumber) : '',
        callSign: String(v.callSign ?? '').trim(),
        kind: params.kind ?? kindFromAis(v.shipType),
        length: +params.length.toFixed(1),
        beam: +params.beam.toFixed(1),
        draft: draughtM(v) ?? null,
        height: null,
        ais: v,
      });
    },
    resume() { scene?.resume(); },
    pause() { scene?.pause(); },
    destroy() {
      seq++;
      scene?.dispose();
      root.innerHTML = '';
    },
  };
}
