// Builds the static site into dist/ for GitHub Pages. There is no backend.
import { cp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { versionScript, versionHtml } from './versioning.mjs';
import { writeVesselIndex } from './vessels.mjs';

await rm('dist', { recursive: true, force: true });
await cp('public', 'dist', { recursive: true });
// The vessels folder's index lists what is really there (public/vessels, scripts/vessels.mjs).
await writeVesselIndex('dist/vessels');
// Stops Pages from running Jekyll, which would hide files starting with an underscore.
await writeFile('dist/.nojekyll', '');

// Stamp the page with the branch and commit being deployed: all branches deploy, the last one wins.
const sha = (process.env.GITHUB_SHA ?? 'local').slice(0, 7);
const branch = process.env.GITHUB_REF_NAME ?? '';
const build = branch ? `${branch} ${sha}` : sha;
const html = await readFile('dist/index.html', 'utf8');
await writeFile('dist/index.html', versionHtml(html.replace('__BUILD__', build.replace(/[<>&"]/g, '')), sha));

// Each script asks for the other scripts and styles of the same build (scripts/versioning.mjs).
async function scripts(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await scripts(p)));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}
for (const f of await scripts('dist')) {
  // Bundled libraries import nothing of ours, but three-io.js imports ./three.js, which must be the very
  // file the app's scripts import (stamped), or the page would hold two copies of three.js.
  if (f.includes(`${path.sep}vendor${path.sep}`) && !f.endsWith('three-io.js')) continue;
  await writeFile(f, versionScript(await readFile(f, 'utf8'), sha));
}

console.log(`Built dist/ (${build})`);
