// The vessel builder as a page of its own: the builder (ships/ui.js) filling the page under the top
// bar, a vessel given in the address (vesselparams.js), and Settings for committing models to GitHub
// (github.js) and for looking vessels up by IMO number (maritimedb.js).

import { createShipInspector } from './ships/ui.js';
import { vesselFromParams } from './vesselparams.js';
import { loadGithub, saveGithub, clearGithub, repoFromLocation, branchFromBuild, validRepo } from './github.js';
import { loadProxy, saveProxy, isLocal, PROXY } from './maritimedb.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const root = $('#builder');
root.innerHTML = '';
const builder = createShipInspector(root, {});
const given = vesselFromParams(location.search);
if (given) builder.showAisVessel(given);

// ---------- settings: GitHub ----------

let msg = { text: '', tone: '' };
let lookMsg = { text: '', tone: '' };
function renderSettings() {
  const g = loadGithub();
  const repo = g.repo || repoFromLocation();
  const branch = g.branch || branchFromBuild($('#build')?.textContent);
  $('#settings-body').innerHTML = `
    <h3>GitHub</h3>
    <p class="fine"><b>Commit to GitHub</b> puts a vessel's model in a repository's <code>public/vessels/</code> folder,
      with its index, in one commit. Use a fine-grained token for that repository with <b>Contents: read and write</b>.
      To have Rudder's chart draw her with it, set the repository to Rudder's.</p>
    ${msg.text ? `<p class="state" data-tone="${msg.tone}">${esc(msg.text)}</p>` : g.token ? '<p class="state" data-tone="ok">A GitHub token is saved on this device.</p>' : ''}
    <form id="github-form" autocomplete="off">
      <label>Repository<input name="repo" value="${esc(repo)}" placeholder="owner/name" spellcheck="false" autocapitalize="off"></label>
      <label>Branch<input name="branch" value="${esc(branch)}" placeholder="the repository's default branch" spellcheck="false" autocapitalize="off"></label>
      <label>Token<input name="token" type="password" value="${esc(g.token)}" placeholder="github_pat_…" autocomplete="new-password" spellcheck="false"></label>
      <div class="buttons"><button type="submit">Save on this device</button>${g.token ? '<button type="button" class="quiet" data-forget>Remove</button>' : ''}</div>
    </form>
    <p class="fine">Kept only on this device and sent only to api.github.com.</p>
    <h3>Vessel lookup</h3>
    <p class="fine">Given her IMO number, her name, numbers, type and size are looked up on maritime-database.com.
      That site lets no other site's page read it, so it is asked through a proxy: ${isLocal() ? 'the local server' : `the vessel builder’s own, <code>${esc(new URL(PROXY).host)}</code>`}, unless you give another here.</p>
    ${lookMsg.text ? `<p class="state" data-tone="${lookMsg.tone}">${esc(lookMsg.text)}</p>` : ''}
    <form id="lookup-form" autocomplete="off">
      <label>Proxy<input name="proxy" type="url" value="${esc(loadProxy())}" placeholder="${isLocal() ? 'the local server' : esc(PROXY)}" spellcheck="false" autocapitalize="off"></label>
      <div class="buttons"><button type="submit">Save on this device</button></div>
    </form>
    <p class="fine">Only the IMO numbers you give are sent to it.</p>`;
}

$('#settings-btn').addEventListener('click', () => {
  msg = { text: '', tone: '' };
  lookMsg = { text: '', tone: '' };
  renderSettings();
  $('#settings').showModal();
});
$('#settings-body').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  if (e.target.id === 'lookup-form') {
    const proxy = String(f.get('proxy') ?? '').trim();
    if (proxy && !/^https?:\/\/[^/]+/.test(proxy)) lookMsg = { text: 'Give the proxy’s whole address, starting https://.', tone: 'err' };
    else {
      try {
        saveProxy(proxy);
        lookMsg = { text: proxy ? 'Saved on this device.' : 'The vessel builder’s own proxy is used.', tone: 'ok' };
      } catch {
        lookMsg = { text: 'This browser will not store anything (private browsing?).', tone: 'err' };
      }
    }
    renderSettings();
    return;
  }
  const repo = String(f.get('repo') ?? '').trim();
  if (repo && !validRepo(repo)) msg = { text: 'Write the repository as owner/name.', tone: 'err' };
  else {
    try {
      saveGithub({ repo, branch: f.get('branch'), token: f.get('token') });
      msg = { text: 'Saved on this device.', tone: 'ok' };
    } catch {
      msg = { text: 'This browser will not store anything (private browsing?).', tone: 'err' };
    }
  }
  renderSettings();
});
$('#settings-body').addEventListener('click', (e) => {
  if (!e.target.closest('[data-forget]')) return;
  clearGithub();
  msg = { text: 'Token removed from this device.', tone: '' };
  renderSettings();
});

window.vesselbuilder = { builder };
