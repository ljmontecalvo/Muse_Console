// Validates a scanned NFC tag ID against CloudKit's ClueTag record type (never exposed
// to World/Authenticated — only this function's Server-to-Server key can read it) and
// checks the caller-reported GPS location against the clue's venue before confirming a
// match. Never returns any tag code, only a clue identity on success.

const CONTAINER = 'iCloud.com.MuseApplications.Muse';

function ckBase(env) {
  return `/database/1/${CONTAINER}/${env.CLOUDKIT_ENVIRONMENT || 'development'}/public`;
}

async function importS2SPrivateKey(base64Pkcs8) {
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
function rawEcdsaSigToDer(rawSig) {
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

function toBase64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

async function signCloudKitRequest({ privateKey, keyId, path, bodyString }) {
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

async function ckPost({ privateKey, keyId, path, body }) {
  const bodyString = JSON.stringify(body);
  const headers = await signCloudKitRequest({ privateKey, keyId, path, bodyString });
  const resp = await fetch(`https://api.apple-cloudkit.com${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain; charset=UTF-8', ...headers },
    body: bodyString,
  });
  return resp.json();
}

async function ckFetchRecord({ privateKey, keyId, base, recordName }) {
  const json = await ckPost({
    privateKey, keyId,
    path: `${base}/records/lookup`,
    body: { records: [{ recordName }] },
  });
  const rec = json.records && json.records[0];
  if (!rec || rec.serverErrorCode) return null;
  return rec;
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const BASE_RADIUS_METERS = 150;
const ACCURACY_CAP_METERS = 100;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestPost({ request, env }) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'bad_request' }, 400);
  }

  const { nfcTagID, latitude, longitude, horizontalAccuracy } = payload || {};
  if (!nfcTagID || typeof nfcTagID !== 'string' ||
      typeof latitude !== 'number' || typeof longitude !== 'number') {
    return jsonResponse({ ok: false, error: 'bad_request' }, 400);
  }

  if (!env.CLOUDKIT_S2S_PRIVATE_KEY_PKCS8_B64 || !env.CLOUDKIT_S2S_KEY_ID) {
    console.error('validate-tag: missing CLOUDKIT_S2S_PRIVATE_KEY_PKCS8_B64 / CLOUDKIT_S2S_KEY_ID env vars');
    return jsonResponse({ ok: false, error: 'server_misconfigured' }, 500);
  }

  const privateKey = await importS2SPrivateKey(env.CLOUDKIT_S2S_PRIVATE_KEY_PKCS8_B64);
  const keyId = env.CLOUDKIT_S2S_KEY_ID;
  const base = ckBase(env);

  const queryResp = await ckPost({
    privateKey, keyId,
    path: `${base}/records/query`,
    body: {
      query: {
        recordType: 'ClueTag',
        filterBy: [{
          fieldName: 'nfcTagID',
          comparator: 'EQUALS',
          fieldValue: { value: nfcTagID.toUpperCase(), type: 'STRING' },
        }],
      },
    },
  });

  const match = queryResp.records && queryResp.records[0];
  if (!match) return jsonResponse({ ok: false, error: 'no_match' }, 404);

  const clueRecordName = match.fields.clueReference && match.fields.clueReference.value &&
    match.fields.clueReference.value.recordName;
  const clue = clueRecordName && await ckFetchRecord({ privateKey, keyId, base, recordName: clueRecordName });
  const huntRecordName = clue && clue.fields.huntReference && clue.fields.huntReference.value &&
    clue.fields.huntReference.value.recordName;
  const hunt = huntRecordName && await ckFetchRecord({ privateKey, keyId, base, recordName: huntRecordName });
  const venueRecordName = hunt && hunt.fields.venueReference && hunt.fields.venueReference.value &&
    hunt.fields.venueReference.value.recordName;
  const venue = venueRecordName && await ckFetchRecord({ privateKey, keyId, base, recordName: venueRecordName });

  if (!venue || !venue.fields.location || !venue.fields.location.value) {
    console.error('validate-tag: data integrity failure resolving ClueTag -> Clue -> Hunt -> Venue', { clueRecordName, huntRecordName, venueRecordName });
    return jsonResponse({ ok: false, error: 'data_integrity' }, 500);
  }

  const venueLoc = venue.fields.location.value;
  const distance = haversineMeters(latitude, longitude, venueLoc.latitude, venueLoc.longitude);
  const allowedRadius = BASE_RADIUS_METERS + Math.min(Math.max(Number(horizontalAccuracy) || 0, 0), ACCURACY_CAP_METERS);

  if (distance > allowedRadius) {
    return jsonResponse({ ok: false, error: 'too_far', distanceMeters: Math.round(distance) }, 403);
  }

  return jsonResponse({ ok: true, clueId: clueRecordName });
}
