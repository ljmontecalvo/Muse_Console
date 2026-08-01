import { ckModifyRecords, getS2SCreds, jsonResponse } from '../../_shared/cloudkit.js';
import { authorizeVenueOrAdmin, resolveHuntVenue } from '../../_shared/auth.js';

export async function onRequestPost({ request, env }) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'bad_request' }, 400);
  }

  const { callerUserRecordName, huntId, recordChangeTag, folder } = payload || {};
  if (!callerUserRecordName || !huntId) {
    return jsonResponse({ ok: false, error: 'bad_request' }, 400);
  }

  if (!env.CLOUDKIT_S2S_PRIVATE_KEY_PKCS8_B64 || !env.CLOUDKIT_S2S_KEY_ID) {
    console.error('hunts/set-folder: missing S2S env vars');
    return jsonResponse({ ok: false, error: 'server_misconfigured' }, 500);
  }
  const creds = await getS2SCreds(env);

  const venueId = await resolveHuntVenue(creds, huntId);
  if (!venueId) return jsonResponse({ ok: false, error: 'not_found' }, 404);

  const authorized = await authorizeVenueOrAdmin(creds, venueId, callerUserRecordName);
  if (!authorized) return jsonResponse({ ok: false, error: 'forbidden' }, 403);

  const resp = await ckModifyRecords({
    ...creds,
    operations: [{
      operationType: 'update',
      record: {
        recordName: huntId,
        recordChangeTag,
        recordType: 'Hunt',
        fields: { folder: { value: folder || '' } },
      },
    }],
  });
  const failed = (resp.records || []).find((r) => r.serverErrorCode);
  if (failed) return jsonResponse({ ok: false, error: 'save_failed', message: failed.reason || failed.serverErrorCode }, 500);

  return jsonResponse({ ok: true });
}
