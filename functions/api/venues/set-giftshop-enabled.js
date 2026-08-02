// Admin-only toggle for a venue's gift shop feature. Deliberately isAdmin-only (not
// authorizeVenueOrAdmin) — the feature request specifies this is enabled by an
// administrator, not by the venue's own managers.

import { ckFetchRecord, ckModifyRecords, getS2SCreds, jsonResponse } from '../../_shared/cloudkit.js';
import { isAdmin } from '../../_shared/auth.js';

export async function onRequestPost({ request, env }) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'bad_request' }, 400);
  }

  const { callerUserRecordName, venueId, enabled } = payload || {};
  if (!callerUserRecordName || !venueId || typeof enabled !== 'boolean') {
    return jsonResponse({ ok: false, error: 'bad_request' }, 400);
  }

  if (!env.CLOUDKIT_S2S_PRIVATE_KEY_PKCS8_B64 || !env.CLOUDKIT_S2S_KEY_ID) {
    console.error('venues/set-giftshop-enabled: missing S2S env vars');
    return jsonResponse({ ok: false, error: 'server_misconfigured' }, 500);
  }
  const creds = await getS2SCreds(env);

  if (!(await isAdmin(creds, callerUserRecordName))) {
    return jsonResponse({ ok: false, error: 'forbidden' }, 403);
  }

  const existing = await ckFetchRecord({ ...creds, recordName: venueId });
  if (!existing) return jsonResponse({ ok: false, error: 'not_found' }, 404);

  const resp = await ckModifyRecords({
    ...creds,
    operations: [{
      operationType: 'update',
      record: {
        recordName: venueId,
        recordChangeTag: existing.recordChangeTag,
        recordType: 'Venue',
        fields: { giftShopEnabled: { value: enabled ? 1 : 0 } },
      },
    }],
  });
  const failed = (resp.records || []).find((r) => r.serverErrorCode);
  if (failed) return jsonResponse({ ok: false, error: 'save_failed', message: failed.reason || failed.serverErrorCode }, 500);

  return jsonResponse({ ok: true });
}
