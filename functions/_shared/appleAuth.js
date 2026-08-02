// Verifies a Sign in with Apple `identityToken` (a JWT) server-side, independent of
// CloudKit — this is what lets visitor-facing endpoints trust a real, unforgeable
// identity instead of an unverified client-supplied string. Deliberately a higher bar
// than functions/_shared/auth.js's documented callerUserRecordName trust model, since
// visitor endpoints move real redeemable trophy value.

function base64UrlToUint8Array(b64url) {
  const padded = b64url + '='.repeat((4 - (b64url.length % 4)) % 4);
  const b64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function base64UrlDecodeJSON(b64url) {
  return JSON.parse(new TextDecoder().decode(base64UrlToUint8Array(b64url)));
}

let cachedKeys = null;
let cachedKeysAt = 0;
const KEYS_CACHE_MS = 60 * 60 * 1000;

async function fetchApplePublicKeys() {
  const now = Date.now();
  if (cachedKeys && now - cachedKeysAt < KEYS_CACHE_MS) return cachedKeys;
  const resp = await fetch('https://appleid.apple.com/auth/keys');
  const json = await resp.json();
  cachedKeys = json.keys || [];
  cachedKeysAt = now;
  return cachedKeys;
}

// Returns the verified `sub` claim (Apple's stable, opaque per-app user identifier),
// or null if the token is missing, malformed, expired, mis-signed, or not issued for
// this app.
export async function verifyAppleIdentityToken(identityToken, env) {
  const parts = (identityToken || '').split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  let header, payload;
  try {
    header = base64UrlDecodeJSON(headerB64);
    payload = base64UrlDecodeJSON(payloadB64);
  } catch {
    return null;
  }
  if (header.alg !== 'RS256') return null;

  const keys = await fetchApplePublicKeys();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return null;

  let publicKey;
  try {
    publicKey = await crypto.subtle.importKey(
      'jwk', jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false, ['verify']
    );
  } catch {
    return null;
  }

  const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64UrlToUint8Array(sigB64);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, signature, signedData);
  if (!valid) return null;

  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== 'https://appleid.apple.com') return null;
  if (payload.exp && payload.exp < now) return null;
  if (env.APPLE_SIGNIN_AUDIENCE && payload.aud !== env.APPLE_SIGNIN_AUDIENCE) return null;
  if (!payload.sub) return null;

  return payload.sub;
}
