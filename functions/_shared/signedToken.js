// Domain-separated tokens: a progress/challenge token cannot be used as a session.
const encoder = new TextEncoder();
function encode(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decode(value) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0));
}
async function key(secret) {
  if (!secret) throw new Error('missing signing secret');
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export async function signToken(payload, purpose, secret, ttl) {
  const body = encode(encoder.encode(JSON.stringify({ ...payload, purpose, exp: Math.floor(Date.now() / 1000) + ttl })));
  return `${body}.${encode(await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(body)))}`;
}
export async function verifyToken(token, purpose, secret) {
  if (!secret) throw new Error('missing signing secret');
  try {
    if (typeof token !== 'string' || token.length > 64000) return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    if (!await crypto.subtle.verify('HMAC', await key(secret), decode(parts[1]), encoder.encode(parts[0]))) return null;
    const payload = JSON.parse(new TextDecoder().decode(decode(parts[0])));
    return payload.purpose === purpose && Number.isFinite(payload.exp) && payload.exp > Date.now() / 1000 ? payload : null;
  } catch { return null; }
}
export async function sha256(value) {
  return encode(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}
