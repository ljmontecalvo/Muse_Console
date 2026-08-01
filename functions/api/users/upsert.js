// Creates/updates a directory (AppUser) entry. Two distinct ids on purpose: callers
// upsert their own entry on sign-in, but an admin can also edit someone else's display
// name from the Users page — those are different authorization paths.

import { ckFetchRecord, ckModifyRecords, getS2SCreds, jsonResponse } from '../../_shared/cloudkit.js';
import { isAdmin } from '../../_shared/auth.js';

export async function onRequestPost({ request, env }) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'bad_request' }, 400);
  }

  const { callerUserRecordName, targetUserRecordName, name, email, hasRealName } = payload || {};
  if (!callerUserRecordName || !targetUserRecordName) {
    return jsonResponse({ ok: false, error: 'bad_request' }, 400);
  }

  if (!env.CLOUDKIT_S2S_PRIVATE_KEY_PKCS8_B64 || !env.CLOUDKIT_S2S_KEY_ID) {
    console.error('users/upsert: missing S2S env vars');
    return jsonResponse({ ok: false, error: 'server_misconfigured' }, 500);
  }
  const creds = await getS2SCreds(env);

  const isSelf = targetUserRecordName === callerUserRecordName;
  const authorized = isSelf || (await isAdmin(creds, callerUserRecordName));
  if (!authorized) return jsonResponse({ ok: false, error: 'forbidden' }, 403);

  const recordName = 'appuser_' + targetUserRecordName;
  const existing = await ckFetchRecord({ ...creds, recordName });

  const fields = { userRecordName: { value: targetUserRecordName } };
  if (hasRealName) fields.name = { value: name };
  if (email) fields.email = { value: email };

  const resp = await ckModifyRecords({
    ...creds,
    operations: [{
      operationType: existing ? 'update' : 'create',
      record: {
        recordName,
        ...(existing ? { recordChangeTag: existing.recordChangeTag } : {}),
        recordType: 'AppUser',
        fields,
      },
    }],
  });
  const failed = (resp.records || []).find((r) => r.serverErrorCode);
  if (failed) return jsonResponse({ ok: false, error: 'save_failed', message: failed.reason || failed.serverErrorCode }, 500);

  return jsonResponse({ ok: true });
}
