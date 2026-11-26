// Writes public/vessels/index.json (or another folder's, given as an argument) from the model files
// there and their .json sidecars: npm run vessels. The build runs it too (scripts/build.mjs), so the
// deployed index always lists what is in the folder.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildIndex, INDEX_FILE } from '../public/vesselcatalog.js';

export async function writeVesselIndex(dir = 'public/vessels') {
  const files = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (!e.isFile()) continue;
    const f = { name: e.name };
    if (e.name.endsWith('.json') && e.name !== INDEX_FILE) {
      try { f.json = JSON.parse(await readFile(path.join(dir, e.name), 'utf8')); }
      catch (err) { throw new Error(`${path.join(dir, e.name)}: ${err.message}`); }
    }
    files.push(f);
  }
  const index = buildIndex(files);
  await writeFile(path.join(dir, INDEX_FILE), JSON.stringify(index, null, 2) + '\n');
  return index;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] ?? 'public/vessels';
  const index = await writeVesselIndex(dir);
  console.log(`${path.join(dir, INDEX_FILE)}: ${index.vessels.length} vessel model${index.vessels.length === 1 ? '' : 's'}`);
}
