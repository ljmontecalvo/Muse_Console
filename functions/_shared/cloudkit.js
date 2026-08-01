// Shared CloudKit Server-to-Server signing + request helpers. Files/dirs prefixed with
// `_` are excluded from Cloudflare Pages Functions routing, making this a safe place
// for code shared between route handlers under functions/api/.

export const CONTAINER = 'iCloud.com.MuseApplications.Muse';

export function ckBase(env) {
  return `/database/1/${CONTAINER}/${env.CLOUDKIT_ENVIRONMENT || 'development'}/public`;
}

export async function importS2SPrivateKey(base64Pkcs8) {
  const der = Uint8Array.from(atob(base64Pkcs8), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8',
    der.buffer,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
}

// Web Crypto's ECDSA sign() returns raw IEEE-P1363 r||s (64 bytes for P-256).
// CloudKit's server-to-server signature verification expects DER (ASN.1
// SEQUENCE{INTEGER r, INTEGER s}), the SHA256withECDSA convention — must convert.
export function rawEcdsaSigToDer(rawSig) {
  const raw = new Uint8Array(rawSig);
  const encodeInt = (bytes) => {
    let i = 0;
    while (i < bytes.length - 1 && bytes[i] === 0) i++;
    let trimmed = bytes.slice(i);
    if (trimmed[0] & 0x80) trimmed = new Uint8Array([0, ...trimmed]);
    return new Uint8Array([0x02, trimmed.length, ...trimmed]);
  };
  const r = encodeInt(raw.slice(0, 32));
  const s = encodeInt(raw.slice(32, 64));
  const body = new Uint8Array([...r, ...s]);
  return new Uint8Array([0x30, body.length, ...body]);
}

export function toBase64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

export async function signCloudKitRequest({ privateKey, keyId, path, bodyString }) {
  const date = new Date().toISOString().split('.')[0] + 'Z';
  const bodyHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bodyString || ''));
  const bodyHashB64 = toBase64(bodyHash);
  const toSign = `${date}:${bodyHashB64}:${path}`;
  const rawSig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: { name: 'SHA-256' } },
    privateKey,
    new TextEncoder().encode(toSign)
  );
  return {
    'X-Apple-CloudKit-Request-KeyID': keyId,
    'X-Apple-CloudKit-Request-ISO8601Date': date,
    'X-Apple-CloudKit-Request-SignatureV1': toBase64(rawEcdsaSigToDer(rawSig)),
  };
}

export async function ckPost({ privateKey, keyId, path, body }) {
  const bodyString = JSON.stringify(body);
  const headers = await signCloudKitRequest({ privateKey, keyId, path, bodyString });
  const resp = await fetch(`https://api.apple-cloudkit.com${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain; charset=UTF-8', ...headers },
    body: bodyString,
  });
  return resp.json();
}

export async function ckFetchRecord({ privateKey, keyId, base, recordName }) {
  const json = await ckPost({
    privateKey, keyId,
    path: `${base}/records/lookup`,
    body: { records: [{ recordName }] },
  });
  const rec = json.records && json.records[0];
  if (!rec || rec.serverErrorCode) return null;
  return rec;
}

export async function ckQuery({ privateKey, keyId, base, recordType, filterBy, sortBy }) {
  const query = { recordType };
  if (filterBy) query.filterBy = filterBy;
  if (sortBy) query.sortBy = sortBy;
  const json = await ckPost({ privateKey, keyId, path: `${base}/records/query`, body: { query } });
  return json.records || [];
}

// operations: [{ operationType: 'create'|'update'|'delete', record: {...} }]
// `atomic` is omitted by default — CloudKit rejects atomic:true for the default zone
// ("atomic operations not supported in default zone"), which is where every record
// type in this app lives. Only pass `atomic` explicitly if a caller ever needs a
// custom-zone batch.
export async function ckModifyRecords({ privateKey, keyId, base, operations, atomic }) {
  const body = { operations };
  if (typeof atomic === 'boolean') body.atomic = atomic;
  return ckPost({
    privateKey, keyId,
    path: `${base}/records/modify`,
    body,
  });
}

export async function getS2SCreds(env) {
  return {
    privateKey: await importS2SPrivateKey(env.CLOUDKIT_S2S_PRIVATE_KEY_PKCS8_B64),
    keyId: env.CLOUDKIT_S2S_KEY_ID,
    base: ckBase(env),
  };
}

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
