// Deterministic 5-uppercase-letter code derived from a per-redemption secret plus a
// 15-second time window, so the code visibly rotates without either side needing to
// communicate anything beyond the original secret (kept server-side only, never sent
// to any client) and the current time. Server is the sole source of truth: the
// visitor's app gets a precomputed list of codes up front (see redemption/start.js)
// rather than the secret itself, and the console's redemption/complete.js recomputes
// the same codes to verify a match.

const CODE_LENGTH = 5;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const WINDOW_SECONDS = 15;

export function windowIndexForTime(epochSeconds) {
  return Math.floor(epochSeconds / WINDOW_SECONDS);
}

export async function deriveCode(codeSecret, windowIndex) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(codeSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(String(windowIndex)));
  const bytes = new Uint8Array(sig);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[bytes[i] % ALPHABET.length];
  return code;
}

export function generateCodeSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '');
}
