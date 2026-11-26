# Vessel builder

Build a vessel's 3D model from her photos, with AI running on your own device, and keep it as a
`.glb` that apps (such as [Rudder](https://github.com/joranlager/rudder)) draw her with.

This is Rudder's ship builder on a page of its own, for quick experiments: no chart, no AIS, one
page. Live at **https://joranlager.github.io/vesselbuilder/**.

## What it does

- **Photos in.** Drop photos of a vessel. Each is cut out of its background (ormbg, 88 MB) and
  described by a small vision-language model (Qwen3.5 0.8B, about 850 MB): which view it is, which
  way her bow points (asked again on its own, of the photo and its mirror, and counted only when the
  answers turn round with it), her type, the name on her hull, her colours, decks, funnels, bow and
  stern. Both run in the browser with transformers.js, on the GPU (WebGPU) or the processor; they are
  downloaded once and kept by the browser, and the photos never leave the device.
- **Her model.** With a photo of her side, her shape above the water is carved from the outlines,
  the views no photo shows are drawn from her kind, each part is painted from the photo facing it
  (else in her colours), and a hull is added under the water. Without one, she is built from her
  type in the colours, decks, funnels, bow and stern the photos show.
- **Files in.** Drop a model (`.glb`, `.gltf` + `.bin`, `.obj` + `.mtl`, `.stl`, `.ply`, `.fbx`,
  `.dae`, `.3mf`, with its pictures): turn it upright, set its waterline, sized to her length. Drop a
  picture to put it on the model.
- **Models out.** Download `.glb` + `.json` (named by IMO number, else MMSI, else name); **Commit to
  GitHub** (model, sidecar and `vessels/index.json` in one commit, with a token of your own in
  Settings: a fine-grained token with *Contents: read and write*); or save on this device.

- **Looked up by IMO number.** Given her IMO number (typed in, or in the address), her name, MMSI,
  call sign, flag, type, length, beam, gross tonnage, year built and draught are read from her page
  on [maritime-database.com](https://maritime-database.com/). They fill in what is not typed in by
  hand nor given by her AIS report. That site lets no other site's page read it, so it is asked
  through a proxy: `npm start` is one (`/maritime/`); for GitHub Pages, deploy
  [proxy/maritime-worker.js](proxy/maritime-worker.js) as a Cloudflare Worker and give its address in
  Settings → Vessel lookup.

A vessel can be given in the address, so other apps can link to her:
`?name=SANDOY&mmsi=257125930&imo=9894923&callsign=LGCX&length=43&beam=11&draught=3.2&type=69`
(`type`: the AIS ship type number).

Models are matched to vessels by MMSI, then IMO number, call sign and name, in the format of
[public/vessels/README.md](public/vessels/README.md), the same as Rudder's. Models saved on the
device are shared with Rudder (both are on joranlager.github.io); for Rudder's chart to draw a
vessel with her model for everyone, commit it to Rudder's repository (set it in Settings).

## Code

| | |
|---|---|
| `public/app.js` | The page: the builder, a vessel from the address, Settings |
| `public/ships/ui.js` | The builder's screen |
| `public/ships/ai.js`, `aiworker.js` | The AI models, in a worker |
| `public/ships/vision.js` | The question, reading the answers, merging photos (tested) |
| `public/ships/vesselbuilder.js` | Her model from photos and description |
| `public/ships/photomodel.js`, `synthviews.js` | Carving from outlines; the views no photo shows (tested) |
| `public/ships/ship.js`, `hull.js`, `presets.js` | A ship built from her type |
| `public/ships/vesselmodel.js` | Loading, fitting, texturing and exporting models |
| `public/github.js` | Commits to GitHub (tested) |
| `public/maritimedb.js` | A vessel by her IMO number from maritime-database.com (tested); `proxy/` its Cloudflare Worker |
| `public/vesselcatalog.js`, `vessellibrary.js` | The vessels folder's index; models on the device |

Plain ES modules, no framework. three.js 0.180 is vendored in `public/vendor/` by `npm run vendor`
(esbuild); the AI library (transformers.js 4.3.2) is loaded from jsDelivr by the worker.

```
npm ci
npm start      # http://localhost:8090
npm test
npm run build  # dist/
```

## Branches and deploys

- `main` is the default branch.
- Features go on `feature/…` branches and fixes on `fix/…` branches, merged into `main` when done.
- Every push to any branch is tested, built and deployed to GitHub Pages
  (`.github/workflows/pages.yml`). All branches share one Pages site, so the latest deploy wins; the
  page shows which branch and commit it is (top bar). Push `main` again to put it back.
