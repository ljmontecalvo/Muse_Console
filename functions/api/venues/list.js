// Returns venues scoped to the caller: admins get every venue, everyone else gets
// only venues they actually manage. This replaces a direct CloudKit read — Venue was
// Authenticated-Read (any signed-in user), so any manager could call allVenues()
// directly (bypassing the app's own UI-level filtering) and see every OTHER venue's
// `managers` list too, leaking other users' CloudKit IDs. Scoping happens here instead.

import { ckQuery, getS2SCreds, jsonResponse } from '../../_shared/cloudkit.js';
import { isAdmin } from '../../_shared/auth.js';

function recordToVenue(r) {
  return {
    id: r.recordName,
    recordChangeTag: r.recordChangeTag,
    name: r.fields.name && r.fields.name.value,
    address: r.fields.address && r.fields.address.value,
    managers: (r.fields.managers && r.fields.managers.value) || [],
  };
}

export async function onRequestPost({ request, env }) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'bad_request' }, 400);
  }

  const { callerUserRecordName } = payload || {};
  if (!callerUserRecordName) {
    return jsonResponse({ ok: false, error: 'bad_request' }, 400);
  }

  if (!env.CLOUDKIT_S2S_PRIVATE_KEY_PKCS8_B64 || !env.CLOUDKIT_S2S_KEY_ID) {
    console.error('venues/list: missing S2S env vars');
    return jsonResponse({ ok: false, error: 'server_misconfigured' }, 500);
  }
  const creds = await getS2SCreds(env);

  const callerIsAdmin = await isAdmin(creds, callerUserRecordName);

  const records = callerIsAdmin
    ? await ckQuery({ ...creds, recordType: 'Venue' })
    : await ckQuery({
        ...creds,
        recordType: 'Venue',
        filterBy: [{ fieldName: 'managers', comparator: 'LIST_CONTAINS', fieldValue: { value: callerUserRecordName } }],
      });

  return jsonResponse({ ok: true, venues: records.map(recordToVenue) });
}
