// Deterministic, network-free address fingerprint — the [R3] replacement for the
// Villager identicon, which cannot render offline (it needs a daemon SC fetch).
//
// A cold wallet must be verifiable on an air-gapped machine, so the
// substitution-detection signal must be computable from the address ALONE, with
// no network. This produces:
//   - a truncated address (first 8 … last 8)
//   - a short deterministic "checkword" pair derived from a hash of the address
//
// Same address ⇒ same fingerprint, on any device, online or offline — which is
// exactly the guarantee DCSP's identicon was supposed to provide. It is weaker
// than a rich visual, but it is HONEST: it actually works air-gapped.

// A small, dependency-free FNV-1a 32-bit hash. Deterministic across devices.
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    // h *= 16777619, kept in 32-bit range via Math.imul
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0; // unsigned
}

// A compact, pronounceable wordlist for the checkwords. Not a wallet wordlist —
// purely for visual recognition. 64 words ⇒ 6 bits each.
const CHECKWORDS = [
  'amber', 'azure', 'basalt', 'birch', 'cobalt', 'coral', 'crimson', 'cyan',
  'delta', 'ember', 'flint', 'frost', 'garnet', 'glacier', 'gold', 'granite',
  'haze', 'indigo', 'iron', 'ivory', 'jade', 'jasper', 'kelp', 'lake',
  'lava', 'lemon', 'lilac', 'lunar', 'maple', 'mauve', 'mint', 'moss',
  'nadir', 'nova', 'ocean', 'olive', 'onyx', 'opal', 'pearl', 'pine',
  'pixel', 'plume', 'quartz', 'quill', 'raven', 'reef', 'rust', 'sable',
  'sage', 'salt', 'sand', 'shale', 'slate', 'solar', 'spark', 'steel',
  'storm', 'tidal', 'topaz', 'umber', 'vapor', 'verde', 'vivid', 'zephyr',
];

function word(n) {
  return CHECKWORDS[n & 0x3f]; // low 6 bits
}

// truncateAddress → "dero1qy…gx3n4pl" (first 8, last 8).
export function truncateAddress(address) {
  if (!address || address.length <= 18) return address || '';
  return `${address.slice(0, 8)}…${address.slice(-8)}`;
}

// addressFingerprint returns a stable verification object for an address:
//   { short, checkwords }  e.g. { short: "dero1qy…gx3n4pl", checkwords: "iron-sage" }
// Compare the checkwords across the cold and hot device — a mismatch means the
// address was substituted.
export function addressFingerprint(address) {
  if (!address) return { short: '', checkwords: '' };
  const h = fnv1a(address);
  const w1 = word(h);
  const w2 = word(h >>> 6);
  return {
    short: truncateAddress(address),
    checkwords: `${w1}-${w2}`,
  };
}
