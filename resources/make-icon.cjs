// Generates a 256x256 PNG-embedded ICO for DERO Hive.
// "Hive Mind" — 1 central queen mind + 6 satellite worker minds, linked,
// inside an outer hexagonal hive enclosure.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const W = 256, H = 256;

function makeCanvas() {
  const pixels = Buffer.alloc(W * H * 4);
  return { pixels };
}

// Flat-top hex helper: returns vertices around (cx, cy) with circumradius r
function hexVertsFlat(cx, cy, r) {
  const v = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    v.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return v;
}

// Pointy-top hex helper
function hexVertsPointy(cx, cy, r) {
  const v = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    v.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return v;
}

function setPx(pixels, x, y, c) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  pixels[i] = c[0]; pixels[i+1] = c[1]; pixels[i+2] = c[2]; pixels[i+3] = c[3];
}

function blendPx(pixels, x, y, c, alpha) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  pixels[i]   = Math.round(pixels[i]   * (1 - alpha) + c[0] * alpha);
  pixels[i+1] = Math.round(pixels[i+1] * (1 - alpha) + c[1] * alpha);
  pixels[i+2] = Math.round(pixels[i+2] * (1 - alpha) + c[2] * alpha);
  pixels[i+3] = 255;
}

// Anti-aliased filled hexagon
function fillHex(pixels, cx, cy, r, c, alpha = 1) {
  for (let y = cy - r - 1; y <= cy + r + 1; y++) {
    for (let x = cx - r - 1; x <= cx + r + 1; x++) {
      // Pointy-top point-in-hex test
      const dx = Math.abs(x - cx) / r;
      const dy = Math.abs(y - cy) / r;
      if (dy + dx * 0.577 <= 1) {
        // edge fade for AA
        const dist = Math.hypot((x - cx) / r, (y - cy) / r);
        const aa = Math.max(0, Math.min(1, 1 - (dist - 0.97) * 8));
        blendPx(pixels, x, y, c, alpha * Math.max(0.3, aa));
      }
    }
  }
}

// Anti-aliased stroked hexagon
function strokeHex(pixels, cx, cy, r, c, width = 4, alpha = 1) {
  const verts = hexVertsPointy(cx, cy, r);
  for (let i = 0; i < 6; i++) {
    const [x1, y1] = verts[i];
    const [x2, y2] = verts[(i + 1) % 6];
    const len = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.ceil(len * 2);
    const nx = -(y2 - y1) / len;
    const ny = (x2 - x1) / len;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const px = x1 + (x2 - x1) * t;
      const py = y1 + (y2 - y1) * t;
      for (let w = -width; w <= width; w++) {
        const off = Math.abs(w) / width;
        const aa = Math.max(0, 1 - off) * alpha;
        blendPx(pixels, px + nx * w, py + ny * w, c, aa);
      }
    }
  }
}

// Anti-aliased stroked line between two points
function strokeLine(pixels, x1, y1, x2, y2, c, width = 3, alpha = 1) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.ceil(len * 2);
  const nx = -(y2 - y1) / len;
  const ny = (x2 - x1) / len;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const px = x1 + (x2 - x1) * t;
    const py = y1 + (y2 - y1) * t;
    for (let w = -width; w <= width; w++) {
      const off = Math.abs(w) / width;
      const aa = Math.max(0, 1 - off) * alpha;
      blendPx(pixels, px + nx * w, py + ny * w, c, aa);
    }
  }
}

// Anti-aliased dashed line (for hive perimeter between satellites)
function strokeDashedLine(pixels, x1, y1, x2, y2, c, width = 2, alpha = 1, dashLen = 4, gapLen = 4) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  const ux = dx / len, uy = dy / len;
  const nx = -uy, ny = ux;
  let travelled = 0;
  let drawing = true;
  while (travelled < len) {
    const segLen = drawing ? dashLen : gapLen;
    const end = Math.min(travelled + segLen, len);
    if (drawing) {
      strokeLine(pixels,
        x1 + ux * travelled, y1 + uy * travelled,
        x1 + ux * end,       y1 + uy * end,
        c, width, alpha);
    }
    travelled = end;
    drawing = !drawing;
  }
}

// Anti-aliased filled circle
function fillCircle(pixels, cx, cy, r, c, alpha = 1) {
  for (let y = cy - r - 1; y <= cy + r + 1; y++) {
    for (let x = cx - r - 1; x <= cx + r + 1; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= r) blendPx(pixels, x, y, c, alpha);
      else if (d <= r + 1) blendPx(pixels, x, y, c, alpha * Math.max(0, 1 - (d - r)));
    }
  }
}

// Linear-gradient background
function fillBackground(pixels) {
  const top = [0x1c, 0x1b, 0x18];
  const bot = [0x10, 0x0f, 0x0d];
  for (let y = 0; y < H; y++) {
    const t = y / (H - 1);
    const r = Math.round(top[0] + (bot[0] - top[0]) * t);
    const g = Math.round(top[1] + (bot[1] - top[1]) * t);
    const b = Math.round(top[2] + (bot[2] - top[2]) * t);
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      pixels[i] = r; pixels[i+1] = g; pixels[i+2] = b; pixels[i+3] = 255;
    }
  }
}

// Diagonal accent gradient — sample per-pixel from (0,0)→(255,255)
function accentColor(x, y) {
  const t = Math.min(1, Math.max(0, (x + y) / (W + H)));
  // e08868 → d97757
  const r = Math.round(0xe0 + (0xd9 - 0xe0) * t);
  const g = Math.round(0x88 + (0x77 - 0x88) * t);
  const b = Math.round(0x68 + (0x57 - 0x68) * t);
  return [r, g, b, 255];
}

// Approximation: sample accent by averaging ends at edges. For per-pixel-accurate
// behaviour we recompute the gradient by reading the line colour at the closest
// endpoint — for small icons this looks fine. To get a true gradient here we'd
// need to interpolate from each pixel's position; we'll fake it with two
// representative colours used per region.

// Actually: emit the gradient procedurally. For each pixel drawn by stroke*/fill*
// helpers, compute the colour by sampling the line segment's parametric position.

const COLOR_NEAR = [0xe6, 0x90, 0x78, 0xff]; // light end
const COLOR_FAR  = [0xd9, 0x77, 0x57, 0xff]; // dark end

function sampleAccent(p) {
  // p ∈ [0,1] along the (0,0)→(W,H) gradient
  return [
    Math.round(COLOR_NEAR[0] + (COLOR_FAR[0] - COLOR_NEAR[0]) * p),
    Math.round(COLOR_NEAR[1] + (COLOR_FAR[1] - COLOR_NEAR[1]) * p),
    Math.round(COLOR_NEAR[2] + (COLOR_FAR[2] - COLOR_NEAR[2]) * p),
    255
  ];
}

// Replace blendPx / fill helpers with gradient-aware ones (since the SVG uses
// an x1,y1→x2,y2 gradient we approximate by per-element t).
function strokeHexGradient(pixels, cx, cy, r, width = 4, alpha = 1, tFunc = () => 0.5) {
  const verts = hexVertsPointy(cx, cy, r);
  for (let i = 0; i < 6; i++) {
    const [x1, y1] = verts[i];
    const [x2, y2] = verts[(i + 1) % 6];
    const len = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.ceil(len * 2);
    const nx = -(y2 - y1) / len;
    const ny = (x2 - x1) / len;
    for (let s = 0; s <= steps; s++) {
      const tt = s / steps;
      const px = x1 + (x2 - x1) * tt;
      const py = y1 + (y2 - y1) * tt;
      const c = sampleAccent(tFunc(px, py));
      for (let w = -width; w <= width; w++) {
        const off = Math.abs(w) / width;
        const aa = Math.max(0, 1 - off) * alpha;
        blendPx(pixels, px + nx * w, py + ny * w, c, aa);
      }
    }
  }
}

function strokeLineGradient(pixels, x1, y1, x2, y2, width = 3, alpha = 1) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.ceil(len * 2);
  const nx = -(y2 - y1) / len;
  const ny = (x2 - x1) / len;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const px = x1 + (x2 - x1) * t;
    const py = y1 + (y2 - y1) * t;
    const c = sampleAccent(t);
    for (let w = -width; w <= width; w++) {
      const off = Math.abs(w) / width;
      const aa = Math.max(0, 1 - off) * alpha;
      blendPx(pixels, px + nx * w, py + ny * w, c, aa);
    }
  }
}

function strokeDashedHex(pixels, cx, cy, r, width = 2, alpha = 1) {
  const verts = hexVertsPointy(cx, cy, r);
  for (let i = 0; i < 6; i++) {
    const [x1, y1] = verts[i];
    const [x2, y2] = verts[(i + 1) % 6];
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    let travelled = 0;
    let drawing = true;
    const nx = -dy / len, ny = dx / len;
    while (travelled < len) {
      const segLen = drawing ? 5 : 4;
      const end = Math.min(travelled + segLen, len);
      if (drawing) {
        strokeLineGradient(pixels,
          x1 + (dx / len) * travelled, y1 + (dy / len) * travelled,
          x1 + (dx / len) * end,       y1 + (dy / len) * end,
          width, alpha);
      }
      travelled = end;
      drawing = !drawing;
    }
  }
}

function fillHexGradient(pixels, cx, cy, r, alpha = 1) {
  for (let y = cy - r - 1; y <= cy + r + 1; y++) {
    for (let x = cx - r - 1; x <= cx + r + 1; x++) {
      const dx = Math.abs(x - cx) / r;
      const dy = Math.abs(y - cy) / r;
      if (dy + dx * 0.577 <= 1) {
        const t = Math.min(1, Math.max(0, (x + y) / (W + H)));
        const c = sampleAccent(t);
        const dist = Math.hypot((x - cx) / r, (y - cy) / r);
        const aa = Math.max(0.3, Math.min(1, 1 - (dist - 0.97) * 8));
        blendPx(pixels, x, y, c, alpha * aa);
      }
    }
  }
}

function draw() {
  const { pixels } = makeCanvas();

  // 1. Background
  fillBackground(pixels);

  const cx = W / 2, cy = H / 2;
  const accent = [0xd9, 0x77, 0x57, 0xff];
  const accentHi = [0xe6, 0x90, 0x78, 0xff];
  const bgDark = [0x1c, 0x1b, 0x18, 0xff];
  const accentMid = [0xdc, 0x80, 0x60, 0xff];

  // 2. Subtle inner hex echo (depth)
  strokeHexGradient(pixels, cx, cy, 100, 1.5, 0.22);

  // 3. Hive perimeter (dashed) connecting the 6 satellites at distance 64 from center
  const satDist = 64;
  const satR = 12;
  const satPos = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    satPos.push([cx + satDist * Math.cos(a), cy + satDist * Math.sin(a)]);
  }
  strokeDashedHex(pixels, cx, cy, satDist, 2, 0.55);

  // 4. 6 satellite hexagons (filled, semi-opaque) and tiny inner dots
  for (const [sx, sy] of satPos) {
    fillHex(pixels, sx, sy, satR, accent, 0.92);
    fillCircle(pixels, sx, sy, 2.5, bgDark, 1);
  }

  // 5. Thought-flow lines from center to each satellite
  for (const [sx, sy] of satPos) {
    strokeLineGradient(pixels, cx, cy, sx, sy, 3.5, 0.85);
  }

  // 6. Outer hex frame (the hive enclosure), pointy-top, R=110
  strokeHexGradient(pixels, cx, cy, 110, 6, 1, (x, y) => Math.min(1, Math.max(0, (x + y) / (W + H))));

  // 7. Central "queen mind": hex donut
  fillHexGradient(pixels, cx, cy, 30, 1);
  // Inner hollow hex
  const innerVerts = hexVertsPointy(cx, cy, 13);
  for (let i = 0; i < 6; i++) {
    const [x1, y1] = innerVerts[i];
    const [x2, y2] = innerVerts[(i + 1) % 6];
    strokeLine(pixels, x1, y1, x2, y2, bgDark, 7, 1);
  }
  // Tiny solid hex core (the seed of the mind)
  fillHexGradient(pixels, cx, cy, 5, 1);

  return pixels;
}

function makePng(pixels) {
  function crc32(buf) {
    let c;
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) crc = t[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, 'ascii');
    const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
    return Buffer.concat([len, t, data, c]);
  }
  const sig = Buffer.from([137,80,78,71,13,10,26,10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(H * (1 + W * 4));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 4)] = 0;
    pixels.copy(raw, y * (1 + W * 4) + 1, y * W * 4, (y + 1) * W * 4);
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function makeIco(pngBuf) {
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry[0] = 0; entry[1] = 0; // 256 means 0 byte
  entry[2] = 0; entry[3] = 0;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(pngBuf.length, 8);
  entry.writeUInt32LE(22, 12);
  return Buffer.concat([dir, entry, pngBuf]);
}

const pixels = draw();
const png = makePng(pixels);
const ico = makeIco(png);
const out = path.join(__dirname, 'icon.ico');
fs.writeFileSync(out, ico);
console.log('Wrote', out, ico.length, 'bytes');

// Also drop a standalone PNG for visual inspection
const pngOut = path.join(__dirname, 'icon-preview.png');
fs.writeFileSync(pngOut, png);
console.log('Wrote', pngOut, png.length, 'bytes');