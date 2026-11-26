// Vessel models saved on this device, in IndexedDB (the browser's database; the same one Rudder uses on the same site).
//
//   models: { id, name, mmsi: [..], imo, callSign, aliases: [..], length, beam, draft, credit,
//             license, source, blob (a .glb file), size, thumb (small picture, data URL), created, updated }
//
// Every model is kept as one .glb in the ship's own frame (bow +x, y up, metres, waterline at y = 0),
// whatever it was uploaded as, with its textures inside; so it loads the same way everywhere and can
// be downloaded as it is. Found by vesselcatalog.js's matchVessel, after the vessels folder.
//
// Nothing leaves the device. No three.js here: the chart can ask what is saved without loading it.

import { normalizeEntry, loadIndex, matchVessel } from './vesselcatalog.js';

const DB = 'rudder-vessels';
const VERSION = 1;

const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
const done = (tx) => new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });

let dbPromise = null;
function open(idb = globalThis.indexedDB) {
  if (!idb) return Promise.reject(new Error('This browser cannot store data (no IndexedDB).'));
  dbPromise ??= (async () => {
    const o = idb.open(DB, VERSION);
    o.onupgradeneeded = () => {
      const db = o.result;
      if (!db.objectStoreNames.contains('models')) db.createObjectStore('models', { keyPath: 'id' });
    };
    return req(o);
  })().catch((e) => { dbPromise = null; throw e; });
  return dbPromise;
}

/** A saved model as a catalog entry (vesselcatalog.js), so it is matched the same way. */
export function libraryEntry(rec) {
  const e = normalizeEntry({
    ...rec, file: `${rec.id}.glb`, format: 'glb', up: '+y', forward: '+x', waterline: 'origin', scale: 'length',
  });
  return e && { ...e, id: rec.id, source: 'device', size: rec.size, thumb: rec.thumb, updated: rec.updated };
}

export const newModelId = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const listeners = new Set();
let cache = null; // entries, without the blobs

/** The saved models as catalog entries (no blobs), newest first. */
export async function listModels() {
  if (cache) return cache;
  try {
    const db = await open();
    const all = await req(db.transaction('models').objectStore('models').getAll());
    cache = all.map(libraryEntry).filter(Boolean).sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0));
  } catch {
    cache = [];
  }
  return cache;
}

/** The .glb of a saved model, or null. */
export async function modelBlob(id) {
  const db = await open();
  const rec = await req(db.transaction('models').objectStore('models').get(id));
  return rec?.blob ?? null;
}

/** Save (or replace, same id) a model; `rec.blob` is its .glb. */
export async function saveModel(rec) {
  const db = await open();
  const now = Date.now();
  const full = { ...rec, id: rec.id ?? newModelId(), size: rec.blob?.size ?? 0, created: rec.created ?? now, updated: now };
  const tx = db.transaction('models', 'readwrite');
  tx.objectStore('models').put(full);
  await done(tx);
  changed();
  return full.id;
}

export async function deleteModel(id) {
  const db = await open();
  const tx = db.transaction('models', 'readwrite');
  tx.objectStore('models').delete(id);
  await done(tx);
  changed();
}

function changed() {
  cache = null;
  for (const f of listeners) f();
}

/** Called after every save or delete (the chart swaps models then). Returns a function that stops it. */
export function onModelsChanged(f) {
  listeners.add(f);
  return () => listeners.delete(f);
}

// ---------- finding a ship's model: the vessels folder first, then this device ----------

/** Where the vessels folder is: public/vessels/, next to this script. */
export const FOLDER_URL = new URL('./vessels/', import.meta.url).href;

let folder = null; // promise of the folder's entries, asked for once per page
export function folderModels() {
  folder ??= loadIndex(FOLDER_URL).then((list) => list.map((e) => ({ ...e, source: 'folder' })));
  return folder;
}

/** Both lists, for matching without waiting (the chart asks for every ship, many times a second). */
export async function vesselModels() {
  const [f, d] = await Promise.all([folderModels(), listModels()]);
  return { folder: f, device: d };
}

/** The model for a ship (AIS report, Wikidata facts or lettering), folder first; null when none. */
export function findIn(models, ship) {
  return matchVessel(models.folder, ship) ?? matchVessel(models.device, ship);
}

export async function findVesselModel(ship) {
  return findIn(await vesselModels(), ship);
}
