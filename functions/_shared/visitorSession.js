// Issues and verifies the backend's own signed session token for visitor-facing
// endpoints, handed out once at /api/visitor/signin after Apple's identityToken has
// been verified (see appleAuth.js). Hand-rolled HMAC-SHA256, not a full JWT library —
// same convention as the CloudKit S2S signing in _shared/cloudkit.js.

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

function base64UrlEncode(bytes) {
  let bin = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToUint8Array(b64url) {
  const padded = b64url + '='.repeat((4 - (b64url.length % 4)) % 4);
  const b64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function importHmacKey(env) {
  const secret = env.VISITOR_SESSION_JWT_SECRET;
  if (!secret) throw new Error('missing VISITOR_SESSION_JWT_SECRET');
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign', 'verify']
  );
}

export async function issueVisitorSessionToken(visitorId, env) {
  const key = await importHmacKey(env);
  const payload = { visitorId, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS };
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
  return `${payloadB64}.${base64UrlEncode(sig)}`;
}

// Returns the verified visitorId, or null if the token is missing, malformed,
// tampered with, or expired.
export async function verifyVisitorSessionToken(token, env) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;

  const key = await importHmacKey(env);
  const valid = await crypto.subtle.verify(
    'HMAC', key,
    base64UrlToUint8Array(sigB64),
    new TextEncoder().encode(payloadB64)
  );
  if (!valid) return null;

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlToUint8Array(payloadB64)));
  } catch {
    return null;
  }
  if (!payload.visitorId) return null;
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload.visitorId;
}

// Extracts + verifies the Bearer token from a request; returns the visitorId or null.
export async function requireVisitorSession(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  return verifyVisitorSessionToken(match[1], env);
}
