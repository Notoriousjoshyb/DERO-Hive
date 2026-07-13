import assert from 'node:assert';

// ── helpers from theme.ts ──────────────────────────────────────────
function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.replace('#', '');
  if (!/^[0-9A-Fa-f]{6}$/.test(clean)) return null;
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}
function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
function getContrastColor(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#000000';
  const [r, g, b] = rgb;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#000000' : '#FFFFFF';
}
function generateColorPalette(base: string, count: number): string[] {
  const rgb = hexToRgb(base);
  if (!rgb) return [];
  const palette = [base];
  for (let i = 1; i < count; i++) {
    const factor = 1 - (i / count) * 0.7;
    palette.push(rgbToHex(rgb[0] * factor, rgb[1] * factor, rgb[2] * factor));
  }
  return palette;
}
function adjustBrightness(hex: string, percent: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const factor = 1 + percent / 100;
  return rgbToHex(rgb[0] * factor, rgb[1] * factor, rgb[2] * factor);
}

// ── tests ──────────────────────────────────────────────────────────
const BLACK = hexToRgb('#000000');
assert.deepEqual(BLACK, [0, 0, 0]);

const WHITE = hexToRgb('#FFFFFF');
assert.deepEqual(WHITE, [255, 255, 255]);

const MID = hexToRgb('#AABBCC');
assert.deepEqual(MID, [170, 187, 204]);

const INVALID = hexToRgb('#GGG');
assert.equal(INVALID, null);

const HASH_STRIP = hexToRgb('112233');
assert.deepEqual(HASH_STRIP, [17, 34, 51]);

assert.equal(rgbToHex(0, 0, 0), '#000000');
assert.equal(rgbToHex(255, 255, 255), '#ffffff');
assert.equal(rgbToHex(170, 187, 204), '#aabbcc');
assert.equal(rgbToHex(300, -10, 128), '#ff0080'); // clamp r to 255, g to 0, b to 128
assert.equal(rgbToHex(170, 187, 204), '#aabbcc');

assert.equal(getContrastColor('#000000'), '#FFFFFF');
assert.equal(getContrastColor('#FFFFFF'), '#000000');
assert.equal(getContrastColor('#FFFF00'), '#000000'); // yellow is bright
assert.equal(getContrastColor('#0000FF'), '#FFFFFF'); // blue is dark
assert.equal(getContrastColor('#invalid'), '#000000');

const palette5 = generateColorPalette('#FF0000', 5);
assert.equal(palette5.length, 5);
assert.equal(palette5[0], '#FF0000');
assert.equal(palette5[4] !== '#FF0000', true);

const emptyPalette = generateColorPalette('#invalid', 3);
assert.deepEqual(emptyPalette, []);

const brighter = adjustBrightness('#808080', 50);
assert(brighter !== '#808080');
const darker = adjustBrightness('#808080', -50);
assert(darker !== '#808080');
assert.equal(adjustBrightness('#invalid', 10), '#invalid');

console.log('theme.test.ts — all assertions passed');
