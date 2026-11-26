// The page's side of the ship builder's AI (aiworker.js): one worker, started the first time it is
// needed, asked to cut a vessel out of a photo or to describe it. Pictures go to it as JPEG blobs no
// bigger than they need to be. Nothing leaves the device but the downloads of the models themselves.

/** What the models cost to download, once (the browser keeps them). */
export const MODEL_SIZES = { cutout: 88, describe: 850 }; // MB

let worker = null;
let cpu = false; // the cut-out failed on this GPU: a fresh worker that keeps it on the processor
let seq = 0;
const pending = new Map();

function start() {
  if (worker) return worker;
  // the same build's worker as this script (scripts/versioning.mjs stamps ?v= on the scripts)
  const url = new URL(`./aiworker.js${new URL(import.meta.url).search}`, import.meta.url);
  if (cpu) url.searchParams.set('cpu', '1');
  worker = new Worker(url, { type: 'module' });
  worker.onmessage = (e) => {
    const m = e.data;
    const p = pending.get(m.id);
    if (!p) return;
    if (m.progress) p.onProgress?.(m.progress);
    else if (m.token !== undefined) p.onToken?.(m.token);
    else {
      pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error));
      else p.resolve(m.result);
    }
  };
  worker.onerror = (e) => {
    const err = new Error(e.message || 'The AI could not start in this browser');
    for (const p of pending.values()) p.reject(err);
    pending.clear();
    worker = null;
  };
  return worker;
}

function ask(msg, { onProgress, onToken } = {}) {
  const w = start();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress, onToken });
    w.postMessage({ id, ...msg });
  });
}

/** A picture (img, canvas or bitmap) as a JPEG no wider or taller than `max`. */
export async function jpegOf(img, max = 1024, quality = 0.9) {
  const w = img.naturalWidth ?? img.width, h = img.naturalHeight ?? img.height;
  const k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read the picture'))), 'image/jpeg', quality));
}

/** The vessel cut out of `img`: { width, height, alpha (Uint8Array, 0..255) } at up to 1024 px. */
export async function aiCutout(img, opts = {}) {
  const blob = await jpegOf(img, 1024);
  try {
    return await ask({ task: 'cutout', blob }, opts);
  } catch (e) {
    if (cpu || !/^GPU:/.test(e.message)) throw e;
    // a GPU that cannot run it leaves its runtime unusable for it: start again on the processor
    cpu = true;
    stopAi();
    return ask({ task: 'cutout', blob }, opts);
  }
}

/** The model's answer to `prompt` about `img`: { text, device }. `onToken` gets it as it is written. */
export async function aiDescribe(img, prompt, opts = {}) {
  return ask({ task: 'describe', blob: await jpegOf(img, 896), prompt, maxTokens: opts.maxTokens ?? 220 }, opts);
}

/** Whether this browser can run the models on its GPU (much quicker): { webgpu, f16 }. */
export const aiDevice = () => ask({ task: 'device' });

/** Stop the worker (and anything it is doing). The models stay in the browser's cache. */
export function stopAi() {
  worker?.terminate();
  worker = null;
  for (const p of pending.values()) p.reject(new Error('Stopped'));
  pending.clear();
}
