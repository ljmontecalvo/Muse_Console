// Returns a single venue if the caller manages it or is an admin — used when opening
// a venue's hunts, and internally by assignManager/unassignManager (admin-only writes,
// which still go direct to CloudKit under the Muse Administrators role; this only
// covers the read).

import { ckFetchRecord, getS2SCreds, jsonResponse } from '../../_shared/cloudkit.js';
import { isAdmin } from '../../_shared/auth.js';

function recordToVenue(r) {
  return {
    id: r.recordName,
    recordChangeTag: r.recordChangeTag,
    name: r.fields.name && r.fields.name.value,
    address: r.fields.address && r.fields.address.value,
    managers: (r.fields.managers && r.fields.managers.value) || [],
    giftShopEnabled: (r.fields.giftShopEnabled && r.fields.giftShopEnabled.value) === 1,
  };
}

export async function onRequestPost({ request, env }) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'bad_request' }, 400);
  }

  const { callerUserRecordName, venueId } = payload || {};
  if (!callerUserRecordName || !venueId) {
    return jsonResponse({ ok: false, error: 'bad_request' }, 400);
  }

  if (!env.CLOUDKIT_S2S_PRIVATE_KEY_PKCS8_B64 || !env.CLOUDKIT_S2S_KEY_ID) {
    console.error('venues/get: missing S2S env vars');
    return jsonResponse({ ok: false, error: 'server_misconfigured' }, 500);
  }
  const creds = await getS2SCreds(env);

  const record = await ckFetchRecord({ ...creds, recordName: venueId });
  if (!record) return jsonResponse({ ok: false, error: 'not_found' }, 404);

  const managers = (record.fields.managers && record.fields.managers.value) || [];
  const authorized = managers.includes(callerUserRecordName) || (await isAdmin(creds, callerUserRecordName));
  if (!authorized) return jsonResponse({ ok: false, error: 'forbidden' }, 403);

  return jsonResponse({ ok: true, venue: recordToVenue(record) });
}
