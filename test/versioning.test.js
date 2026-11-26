import { test } from 'node:test';
import assert from 'node:assert/strict';
import { versionScript, versionHtml } from '../scripts/versioning.mjs';

test('relative imports, dynamic imports and new URL get the build stamp', () => {
  const src = [
    "import { a } from './ais.js';",
    'import * as THREE from "../vendor/three.js";',
    "import './side-effect.js';",
    "const m = await import('./ships/ui.js');",
    "link.href = new URL('./ships.css', import.meta.url).href;",
    "import x from 'maplibre-gl';",
    "fetch('https://example.com/a.js');",
    "const s = 'not an import ./x.js';",
  ].join('\n');
  const out = versionScript(src, 'abc1234').split('\n');
  assert.equal(out[0], "import { a } from './ais.js?v=abc1234';");
  assert.equal(out[1], 'import * as THREE from "../vendor/three.js?v=abc1234";');
  assert.equal(out[2], "import './side-effect.js?v=abc1234';");
  assert.equal(out[3], "const m = await import('./ships/ui.js?v=abc1234');");
  assert.equal(out[4], "link.href = new URL('./ships.css?v=abc1234', import.meta.url).href;");
  assert.equal(out[5], "import x from 'maplibre-gl';", 'packages are left alone');
  assert.equal(out[6], "fetch('https://example.com/a.js');", 'other sites too');
  assert.equal(out[7], "const s = 'not an import ./x.js';");
  assert.equal(versionScript(versionScript(src, 'a'), 'b').includes('?v=a'), true, 'stamped addresses are not stamped twice');
});

test('the page asks for its own script and stylesheet of the same build, not those of other sites', () => {
  const html = '<link rel="stylesheet" href="https://unpkg.com/x.css"><link rel="stylesheet" href="style.css">'
    + '<script src="https://unpkg.com/x.js"></script><script type="module" src="app.js"></script><img src="icon.svg">';
  const out = versionHtml(html, 'abc1234');
  assert.ok(out.includes('href="style.css?v=abc1234"'));
  assert.ok(out.includes('src="app.js?v=abc1234"'));
  assert.ok(out.includes('href="https://unpkg.com/x.css"') && out.includes('src="https://unpkg.com/x.js"'));
  assert.ok(out.includes('src="icon.svg"'), 'images are left alone');
});
