// Rebuilds public/vendor/*.js from the pinned devDependencies (npm ci && npm run vendor).
// The output is committed, so the site needs no CDN and no install step to deploy.
import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';

const banner = { js: `// Bundled by scripts/vendor.mjs from npm packages pinned in package.json. Do not edit.` };
const common = { bundle: true, format: 'esm', minify: true, legalComments: 'inline', target: 'es2020', banner };

await build({ ...common, entryPoints: ['scripts/vendor/three.js'], outfile: 'public/vendor/three.js' });
console.log('public/vendor/three.js');

// The add-ons import 'three'; it stays outside the bundle and is pointed at ./three.js, so the page
// holds one copy of three.js (two copies would not share classes, and a scene would mix them).
const bareThree = {
  name: 'bare-three',
  setup(b) { b.onResolve({ filter: /^three$/ }, () => ({ path: 'three', external: true })); },
};
await build({ ...common, entryPoints: ['scripts/vendor/three-io.js'], outfile: 'public/vendor/three-io.js', plugins: [bareThree] });
const io = await readFile('public/vendor/three-io.js', 'utf8');
const fixed = io.replace(/(from\s*|import\s*)(['"])three\2/g, '$1$2./three.js$2');
if (/['"]three['"]/.test(fixed)) throw new Error('three-io.js still imports "three"');
await writeFile('public/vendor/three-io.js', fixed);
console.log('public/vendor/three-io.js');
