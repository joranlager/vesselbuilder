// Every file a page loads is stamped with the build it belongs to (?v=<commit>), so a browser
// never mixes files from two deploys. GitHub Pages lets browsers keep files for ten minutes; without
// the stamp, a page could load a new app.js with an old aismap.js it still had, and run half of a
// change. With it, each deploy's files have their own addresses: one build's page asks for that
// build's files.

const REL = String.raw`\.\.?\/[^'"?#\s]+\.(?:js|css)`;

/** Stamp the relative .js/.css addresses in a script: static and dynamic imports, and new URL(...). */
export function versionScript(source, v) {
  const q = `?v=${encodeURIComponent(v)}`;
  return source
    .replace(new RegExp(String.raw`(\bfrom\s*)(['"])(${REL})\2`, 'g'), `$1$2$3${q}$2`)
    .replace(new RegExp(String.raw`(\bimport\s*)(['"])(${REL})\2`, 'g'), `$1$2$3${q}$2`)
    .replace(new RegExp(String.raw`(\bimport\s*\(\s*)(['"])(${REL})\2`, 'g'), `$1$2$3${q}$2`)
    .replace(new RegExp(String.raw`(\bnew\s+URL\s*\(\s*)(['"])(${REL})\2`, 'g'), `$1$2$3${q}$2`);
}

/** Stamp the page's own scripts and stylesheets (not those from other sites). */
export function versionHtml(html, v) {
  const q = `?v=${encodeURIComponent(v)}`;
  return html.replace(/(<(?:script|link)\b[^>]*?\s(?:src|href)=")((?!https?:|\/\/)[^"?#]+\.(?:js|css))(")/g, `$1$2${q}$3`);
}
