// Saving a vessel model into a GitHub repository (this one by default), from the browser: the model (.glb), its
// sidecar (.json) and the vessels folder's index.json, in one commit on a branch. Pages builds and
// deploys every branch (the last deploy wins), so the model is on the chart after the next deploy.
//
// It needs a GitHub token of the user's own that may write the repository's contents (a fine-grained
// token for this repository with "Contents: read and write"). The token is kept on this device only
// (localStorage) and sent only to api.github.com.

import { parseIndex, buildIndex, normalizeEntry } from './vesselcatalog.js';

export const GITHUB_KEY = 'rudder.github.v1';
export const VESSELS_PATH = 'public/vessels';
const API = 'https://api.github.com';

/** The repository this page is deployed from, by its address: owner.github.io/repo → owner/repo. */
export function repoFromLocation(loc = globalThis.location) {
  const host = String(loc?.hostname ?? '');
  const m = host.match(/^([a-z0-9-]+)\.github\.io$/i);
  if (!m) return '';
  const first = String(loc.pathname ?? '/').split('/').filter(Boolean)[0];
  return `${m[1]}/${first || `${m[1]}.github.io`}`;
}

/** The branch this build came from ("branch sha" in the page's build stamp), or ''. */
export function branchFromBuild(text) {
  const t = String(text ?? '').trim();
  const parts = t.split(/\s+/);
  return parts.length >= 2 && /^[0-9a-f]{7}$/.test(parts.at(-1)) ? parts.slice(0, -1).join(' ') : '';
}

export function loadGithub(storage = globalThis.localStorage) {
  try {
    const j = JSON.parse(storage?.getItem(GITHUB_KEY) ?? 'null');
    return { token: String(j?.token ?? ''), repo: String(j?.repo ?? ''), branch: String(j?.branch ?? '') };
  } catch {
    return { token: '', repo: '', branch: '' };
  }
}
export function saveGithub(v, storage = globalThis.localStorage) {
  storage.setItem(GITHUB_KEY, JSON.stringify({ token: String(v.token ?? '').trim(), repo: String(v.repo ?? '').trim(), branch: String(v.branch ?? '').trim() }));
}
export function clearGithub(storage = globalThis.localStorage) {
  storage?.removeItem(GITHUB_KEY);
}

/** Is "owner/name" a repository's name? */
export const validRepo = (s) => /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(String(s ?? ''));

/** A file name for a vessel: her IMO number, else her MMSI, else her name. */
export function vesselFileBase({ imo, mmsi, name } = {}) {
  const d = (s) => String(s ?? '').replace(/\D/g, '');
  if (d(imo).length === 7) return `imo-${d(imo)}`;
  if (d(mmsi).length === 9) return `mmsi-${d(mmsi)}`;
  const n = String(name ?? '').toLowerCase().replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return n || 'vessel';
}

/**
 * The vessels folder's index.json with one vessel's sidecar added (or put in place of the entry for
 * the same file). `indexJson` is the index as it is in the repository (parsed), or null.
 */
export function indexWith(indexJson, sidecar, modelFile) {
  const kept = parseIndex(indexJson).filter((e) => e.file !== modelFile);
  const added = normalizeEntry({ ...sidecar, file: modelFile });
  const vessels = [...kept, ...(added ? [added] : [])].sort((a, b) => a.id.localeCompare(b.id));
  return { about: buildIndex([]).about, vessels };
}

/** Bytes as base64, a chunk at a time (a model is megabytes). */
export function base64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function gh(fetchFn, token, method, path, body) {
  const res = await fetchFn(`${API}${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 404 && method === 'GET' && path.includes('/contents/')) return null;
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const why = res.status === 401 ? 'GitHub did not accept the token'
      : res.status === 403 || res.status === 404 ? 'the token may not write to this repository (it needs Contents: read and write)'
        : res.status === 409 || res.status === 422 ? `GitHub refused it (${j.message ?? res.status})`
          : `GitHub answered ${res.status}${j.message ? `: ${j.message}` : ''}`;
    throw new Error(why);
  }
  return j;
}

/**
 * Commit a vessel's model into the repository: `files` { model: { name, blob }, sidecar (object) },
 * `opts` { token, repo, branch, message }. Reads the folder's index.json from the branch, adds the
 * vessel, and writes the three files in one commit. Returns { commit (sha), url, branch }.
 */
export async function commitVessel({ model, sidecar }, { token, repo, branch, message }, { fetchFn = fetch, onStep = () => {} } = {}) {
  if (!token) throw new Error('No GitHub token saved (Settings → GitHub)');
  if (!validRepo(repo)) throw new Error('Say which repository, as owner/name (Settings → GitHub)');
  const r = `/repos/${repo}`;
  onStep('Reading the branch');
  const b = branch || (await gh(fetchFn, token, 'GET', r)).default_branch;
  const ref = await gh(fetchFn, token, 'GET', `${r}/git/ref/heads/${encodeURIComponent(b)}`);
  const head = ref.object.sha;
  const headCommit = await gh(fetchFn, token, 'GET', `${r}/git/commits/${head}`);
  const indexPath = `${VESSELS_PATH}/index.json`;
  const cur = await gh(fetchFn, token, 'GET', `${r}/contents/${indexPath}?ref=${encodeURIComponent(b)}`);
  let indexJson = null;
  if (cur?.content) {
    try { indexJson = JSON.parse(decodeURIComponent(escape(atob(cur.content.replace(/\n/g, ''))))); } catch { indexJson = null; }
  }
  const index = indexWith(indexJson, sidecar, model.name);
  onStep('Uploading the model');
  const bytes = new Uint8Array(await model.blob.arrayBuffer());
  const blob = await gh(fetchFn, token, 'POST', `${r}/git/blobs`, { content: base64(bytes), encoding: 'base64' });
  const text = (o) => JSON.stringify(o, null, 2) + '\n';
  const sidecarName = model.name.replace(/\.[^.]+$/, '.json');
  onStep('Committing');
  const tree = await gh(fetchFn, token, 'POST', `${r}/git/trees`, {
    base_tree: headCommit.tree.sha,
    tree: [
      { path: `${VESSELS_PATH}/${model.name}`, mode: '100644', type: 'blob', sha: blob.sha },
      { path: `${VESSELS_PATH}/${sidecarName}`, mode: '100644', type: 'blob', content: text(sidecar) },
      { path: indexPath, mode: '100644', type: 'blob', content: text(index) },
    ],
  });
  const commit = await gh(fetchFn, token, 'POST', `${r}/git/commits`, { message, tree: tree.sha, parents: [head] });
  await gh(fetchFn, token, 'PATCH', `${r}/git/refs/heads/${encodeURIComponent(b)}`, { sha: commit.sha });
  return { commit: commit.sha, url: `https://github.com/${repo}/commit/${commit.sha}`, branch: b };
}
