const HEX_RE = /^[0-9a-fA-F]+$/;
const PRINTABLE_TEXT_RE = /^[\t\n\r -~]*$/;

function toDisplayString(value) {
  return value == null ? '' : String(value);
}

function decodePrintableHexString(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length % 2 !== 0) {
    return null;
  }

  if (!HEX_RE.test(value)) {
    return null;
  }

  const bytes = value.match(/.{2}/g).map((pair) => parseInt(pair, 16));
  let decoded;

  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return null;
  }

  decoded = decoded.replace(/\0+$/, '');

  if (decoded.length === 0 || !PRINTABLE_TEXT_RE.test(decoded)) {
    return null;
  }

  // Scores/counters such as "40", "50", and "60" are valid one-byte hex too.
  if (/^\d+$/.test(value) && decoded.length === 1) {
    return null;
  }

  return decoded;
}

function formatSCDisplayString(value) {
  const raw = toDisplayString(value);
  const decoded = decodePrintableHexString(value);

  if (decoded == null || decoded === raw) {
    return {
      display: raw,
      raw,
      wasDecoded: false,
    };
  }

  return {
    display: decoded,
    raw,
    wasDecoded: true,
  };
}

export function formatSCDisplayValue(value) {
  if (typeof value !== 'string') {
    const raw = toDisplayString(value);
    return {
      display: raw,
      raw,
      wasDecoded: false,
    };
  }

  return formatSCDisplayString(value);
}

export function formatSCDisplayKey(key) {
  return formatSCDisplayString(toDisplayString(key));
}
