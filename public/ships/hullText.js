// Ship inspector: paints the hull livery and lettering (name, port, IMO, draft marks, Plimsoll mark) into a canvas.

export const HULL_FONTS = [
  'Arial Black, Arial, sans-serif',
  'Impact, Haettenschweiler, sans-serif',
  'Georgia, serif',
  '"Times New Roman", serif',
  'Verdana, sans-serif',
  '-apple-system, system-ui, sans-serif',
  '"Courier New", monospace',
];
export function luminance(hex) {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export const contrastOn = (bg) => (luminance(bg) > 0.35 ? '#111111' : '#f5f5f5');
export function hullCanvasSize(L, texH) {
  const w = 4096;
  const sideH = Math.round(Math.min(2048, Math.max(160, (w * texH) / L)));
  return { w, sideH };
}
/**
 * A picture on one side's topsides, from the top of the hull down to the boot-top.
 * `pic`: { img, mode: 'stretch' | 'tile', tile (metres a repeat is wide), opacity (0-1),
 * blend: 'normal' | 'multiply' (keeps the hull's colour under it), flip (the picture's bow is on
 * its left) }. Stretched, the picture runs the ship's length with its right-hand end at the bow, so
 * on the port side it is mirrored, as a ship's own paint would be.
 */
export function paintHullImage(ctx, pic, { top, w, yBoot, pxPerM, vScale, port }) {
  const img = pic.img;
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  if (!iw || !ih || yBoot <= top) return;
  const h = yBoot - top;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, top, w, h);
  ctx.clip();
  ctx.globalAlpha = Math.max(0, Math.min(1, pic.opacity ?? 1));
  ctx.globalCompositeOperation = pic.blend === 'multiply' ? 'multiply' : 'source-over';
  const mirror = port !== Boolean(pic.flip);
  if (mirror) {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  if (pic.mode === 'tile') {
    // the side is drawn stretched (vScale px a metre up, pxPerM along): tiles keep their own shape
    const tw = Math.max(4, (pic.tile > 0 ? pic.tile : 10) * pxPerM);
    const th = Math.max(4, (pic.tile > 0 ? pic.tile : 10) * (ih / iw) * vScale);
    const c = document.createElement('canvas');
    c.width = Math.min(2048, Math.round(tw));
    c.height = Math.min(2048, Math.round(th));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const pat = ctx.createPattern(c, 'repeat');
    pat.setTransform?.(new DOMMatrix().translate(0, yBoot).scale(tw / c.width, th / c.height));
    ctx.fillStyle = pat;
    ctx.fillRect(0, top, w, h);
  } else {
    ctx.drawImage(img, 0, top, w, h);
  }
  ctx.restore();
}
/**
 * Paints the full hull livery (antifouling, boot-top, stripes, windows, lettering,
 * draft marks and Plimsoll line) for both sides into one canvas.
 */
export function paintHull(canvas, shape, texH, kind, livery, text) {
  const L = shape.L;
  const { w, sideH } = hullCanvasSize(L, texH);
  if (canvas.width !== w || canvas.height !== sideH * 2) {
    canvas.width = w;
    canvas.height = sideH * 2;
  }
  const ctx = canvas.getContext('2d');
  const pxPerM = w / L;
  // the two halves are scaled differently vertically vs horizontally; compensate
  const vScale = sideH / texH; // px per metre vertically
  const sides = [
    {
      top: 0,
      layout: {
        X: (x) => ((x + L / 2) / L) * w,
        Y: (h) => (1 - h / texH) * sideH,
        bowDir: 1,
        pxPerM,
      },
    },
    {
      top: sideH,
      layout: {
        X: (x) => (1 - (x + L / 2) / L) * w,
        Y: (h) => sideH + (1 - h / texH) * sideH,
        bowDir: -1,
        pxPerM,
      },
    },
  ];
  const T = shape.T;
  const D = shape.D;
  const free = Math.max(0.5, D - T);
  const boot = T + Math.max(0.25, 0.07 * T);
  for (const { top, layout } of sides) {
    const { X, Y, bowDir } = layout;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top, w, sideH);
    ctx.clip();
    // base coats
    ctx.fillStyle = livery.hull;
    ctx.fillRect(0, top, w, sideH);
    ctx.fillStyle = livery.bootTop;
    ctx.fillRect(0, Y(boot), w, top + sideH - Y(boot));
    // a picture on the topsides (Texture tab), above the boot-top, under the stripe and lettering
    if (livery.hullImage?.img) paintHullImage(ctx, livery.hullImage, { top, w, yBoot: Y(boot), pxPerM, vScale, port: bowDir === -1 });
    // thin waterline accent
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, Y(boot) - 1, w, 2);
    // sheer stripe following the deck line
    if (text.showStripe) {
      const off = free * 0.22;
      const band = Math.max(free * 0.07, 0.15);
      ctx.fillStyle = livery.stripe;
      ctx.beginPath();
      const N = 80;
      for (let k = 0; k <= N; k++) {
        const xn = k / N;
        const h = shape.deckH(xn) - off;
        const px = X(shape.xAt(xn, h));
        const py = Y(h);
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      for (let k = N; k >= 0; k--) {
        const xn = k / N;
        const h = shape.deckH(xn) - off - band;
        ctx.lineTo(X(shape.xAt(xn, h)), Y(h));
      }
      ctx.closePath();
      ctx.fill();
    }
    // rows of windows / portholes in the topsides of passenger ships
    if (kind === 'cruise' || kind === 'ferry' || kind === 'liner' || kind === 'yacht') {
      const rows = kind === 'yacht' ? 1 : Math.max(1, Math.min(4, Math.floor((free - 1.5) / 2.6)));
      ctx.fillStyle = luminance(livery.hull) > 0.35 ? 'rgba(20,32,48,0.85)' : 'rgba(230,220,190,0.55)';
      const spacing = kind === 'yacht' ? 3.2 : 2.2;
      for (let r = 0; r < rows; r++) {
        const h = T + 1.4 + r * 2.6;
        if (h > D - 1.2) break;
        for (let x = -L * 0.38; x < L * 0.4; x += spacing) {
          const xn = (x + L / 2) / L;
          if (shape.deckH(xn) - h < 1.2) continue;
          const cx = X(x);
          const cy = Y(h);
          if (kind === 'liner') {
            ctx.beginPath();
            ctx.arc(cx, cy, Math.max(1.2, 0.22 * vScale), 0, Math.PI * 2);
            ctx.fill();
          } else {
            const ww = (kind === 'yacht' ? 2.6 : 1.2) * pxPerM;
            const hh = Math.max(2, (kind === 'yacht' ? 0.7 : 0.9) * vScale);
            ctx.fillRect(cx - ww / 2, cy - hh / 2, ww, hh);
          }
        }
      }
    }
    // operator banner, amidships
    if (text.banner.trim()) {
      let size = free * 0.55 * text.bannerScale * vScale;
      ctx.font = `700 ${size}px ${text.font}`;
      const maxW = L * 0.55 * pxPerM;
      const mw = ctx.measureText(text.banner).width * (pxPerM / vScale);
      if (mw > maxW) {
        size *= maxW / mw;
        ctx.font = `700 ${size}px ${text.font}`;
      }
      ctx.fillStyle = livery.text;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const h = T + free * 0.5;
      drawStretched(ctx, text.banner, X(-L * 0.02), Y(h), pxPerM / vScale);
    }
    // ship's name at the bow
    if (text.name.trim()) {
      let size = Math.max(0.5, free * 0.2) * text.nameScale * vScale;
      ctx.font = `700 ${size}px ${text.font}`;
      const maxW = L * 0.28 * pxPerM;
      const mw = ctx.measureText(text.name).width * (pxPerM / vScale);
      if (mw > maxW) {
        size *= maxW / mw;
        ctx.font = `700 ${size}px ${text.font}`;
      }
      const h = shape.deckH(0.9) - free * 0.38;
      const xEnd = shape.xAt(0.93, h);
      ctx.fillStyle = livery.text;
      ctx.textBaseline = 'middle';
      ctx.textAlign = bowDir === 1 ? 'right' : 'left';
      drawStretched(ctx, text.name, X(xEnd), Y(h), pxPerM / vScale);
      // name aft as well, smaller, plus the port of registry under it
      const hs = shape.deckH(0.06) - free * 0.35;
      ctx.font = `700 ${size * 0.6}px ${text.font}`;
      ctx.textAlign = bowDir === 1 ? 'left' : 'right';
      drawStretched(ctx, text.name, X(shape.xAt(0.035, hs)), Y(hs), pxPerM / vScale);
      if (text.port.trim()) {
        ctx.font = `600 ${size * 0.38}px ${text.font}`;
        drawStretched(ctx, text.port, X(shape.xAt(0.035, hs)), Y(hs - free * 0.2), pxPerM / vScale);
      }
    }
    // IMO number below the bridge area
    if (text.imo.trim()) {
      const size = Math.max(0.35, free * 0.09) * vScale;
      ctx.font = `700 ${size}px ${text.font}`;
      ctx.fillStyle = livery.text;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      drawStretched(ctx, `IMO ${text.imo}`, X(-L * 0.36), Y(T + free * 0.62), pxPerM / vScale);
    }
    // draft marks at bow, midships and stern
    if (text.showDraftMarks) {
      const maxM = Math.floor(D);
      const step = D > 12 ? 2 : 1;
      const size = Math.max(10, 0.45 * vScale);
      ctx.font = `700 ${size}px Arial, sans-serif`;
      ctx.textBaseline = 'middle';
      for (const xn of [0.975, 0.5, 0.03]) {
        for (let m = step; m <= maxM; m += step) {
          if (m > shape.deckH(xn) - 0.5) break;
          const x = shape.xAt(xn, m);
          ctx.fillStyle = contrastOn(m < boot ? livery.bootTop : livery.hull);
          ctx.textAlign = 'center';
          drawStretched(ctx, `${m}M`, X(x), Y(m), pxPerM / vScale);
          ctx.fillRect(X(x) - size * 0.6, Y(m - step / 2) - 1, size * 1.2, 2);
        }
      }
    }
    // Plimsoll (load line) mark amidships
    if (text.showPlimsoll) {
      const col = contrastOn(livery.hull);
      ctx.strokeStyle = col;
      ctx.fillStyle = col;
      const r = Math.max(0.45, free * 0.12) * vScale;
      const cx = X(-L * 0.04);
      const cy = Y(T + Math.max(0.6, free * 0.18));
      const lw = Math.max(2, r * 0.12);
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * (pxPerM / vScale), r, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillRect(cx - r * 1.6 * (pxPerM / vScale), cy - lw / 2, r * 3.2 * (pxPerM / vScale), lw);
      // deck line above
      const dy = Y(shape.deckH(0.46) - 0.3);
      ctx.fillRect(cx - r * 1.6 * (pxPerM / vScale), dy, r * 3.2 * (pxPerM / vScale), lw);
      ctx.font = `700 ${r * 0.7}px Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      drawStretched(ctx, 'L', cx - r * 1.1 * (pxPerM / vScale), cy - lw, pxPerM / vScale);
      drawStretched(ctx, 'R', cx + r * 1.1 * (pxPerM / vScale), cy - lw, pxPerM / vScale);
      // load line ladder (towards the bow)
      const lx = cx + bowDir * r * 2.6 * (pxPerM / vScale);
      const ladder = ['TF', 'F', 'T', 'S', 'W', 'WNA'];
      ctx.fillRect(lx - lw / 2, cy - r * 1.1, lw, r * 2.4);
      ctx.font = `700 ${r * 0.42}px Arial, sans-serif`;
      ctx.textBaseline = 'middle';
      ladder.forEach((lab, k) => {
        const ly = cy - r * 0.9 + k * r * 0.4;
        ctx.fillRect(lx, ly - lw / 2, bowDir * r * 1.2 * (pxPerM / vScale), lw);
        ctx.textAlign = bowDir === 1 ? 'left' : 'right';
        drawStretched(ctx, lab, lx + bowDir * r * 1.3 * (pxPerM / vScale), ly, pxPerM / vScale);
      });
    }
    ctx.restore();
  }
}
/**
 * The hull texture uses different pixel densities horizontally and vertically.
 * Draw text with a horizontal scale so that glyphs keep their proportions on the 3D hull.
 */
function drawStretched(ctx, s, x, y, sx) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sx, 1);
  ctx.fillText(s, 0, 0);
  ctx.restore();
}
/** Stern plate: name and port of registry, with antifouling below the waterline. */
export function paintTransom(canvas, info, livery, text) {
  const wM = info.halfWidth * 2;
  const hM = Math.max(0.1, info.topY - info.bottomY);
  const W = 1024;
  const H = Math.round(Math.min(2048, Math.max(64, (W * hM) / wM)));
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const ppm = W / wM;
  const vpm = H / hM;
  const Y = (y) => (1 - (y - info.bottomY) / hM) * H;
  ctx.fillStyle = livery.hull;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = livery.bootTop;
  const wl = Y(Math.max(0.25, hM * 0.05) + 0);
  ctx.fillRect(0, wl, W, H - wl);
  ctx.fillStyle = livery.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (text.name.trim()) {
    let size = Math.min(hM * 0.22, 3.5) * vpm * text.nameScale;
    ctx.font = `700 ${size}px ${text.font}`;
    const mw = ctx.measureText(text.name).width * (ppm / vpm);
    if (mw > W * 0.8) {
      size *= (W * 0.8) / mw;
      ctx.font = `700 ${size}px ${text.font}`;
    }
    const yName = info.topY - hM * 0.28;
    drawStretched(ctx, text.name, W / 2, Y(yName), ppm / vpm);
    if (text.port.trim()) {
      ctx.font = `600 ${size * 0.55}px ${text.font}`;
      drawStretched(ctx, text.port, W / 2, Y(yName) + size * 1.0, ppm / vpm);
    }
  }
}
