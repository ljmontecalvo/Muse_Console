// Validates a scanned NFC tag ID against CloudKit's ClueTag record type (never exposed
// to World/Authenticated — only this function's Server-to-Server key can read it) and
// checks the caller-reported GPS location against the clue's venue before confirming a
// match. Never returns any tag code, only a clue identity on success.

import { ckFetchRecord, ckQuery, getS2SCreds, jsonResponse } from '../_shared/cloudkit.js';

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

  const creds = await getS2SCreds(env);

  const matches = await ckQuery({
    ...creds,
    recordType: 'ClueTag',
    filterBy: [{
      fieldName: 'nfcTagID',
      comparator: 'EQUALS',
      fieldValue: { value: nfcTagID.toUpperCase(), type: 'STRING' },
    }],
  });

  const match = matches[0];
  if (!match) return jsonResponse({ ok: false, error: 'no_match' }, 404);

  const clueRecordName = match.fields.clueReference && match.fields.clueReference.value &&
    match.fields.clueReference.value.recordName;
  const clue = clueRecordName && await ckFetchRecord({ ...creds, recordName: clueRecordName });
  const huntRecordName = clue && clue.fields.huntReference && clue.fields.huntReference.value &&
    clue.fields.huntReference.value.recordName;
  const hunt = huntRecordName && await ckFetchRecord({ ...creds, recordName: huntRecordName });
  const venueRecordName = hunt && hunt.fields.venueReference && hunt.fields.venueReference.value &&
    hunt.fields.venueReference.value.recordName;
  const venue = venueRecordName && await ckFetchRecord({ ...creds, recordName: venueRecordName });

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
