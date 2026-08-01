// Checks whether a given user is an admin. Self-checks are always allowed (every
// signed-in user needs to know their own status). Checking someone ELSE's status is
// only allowed if the caller is themselves an admin — this is what closes off the
// enumeration issue: previously any signed-in user could query an arbitrary user's
// admin flag directly against CloudKit from the browser console.

import { getS2SCreds, jsonResponse } from '../../_shared/cloudkit.js';
import { isAdmin } from '../../_shared/auth.js';

export async function onRequestPost({ request, env }) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'bad_request' }, 400);
  }

  const { callerUserRecordName, targetUserRecordName } = payload || {};
  if (!callerUserRecordName || !targetUserRecordName) {
    return jsonResponse({ ok: false, error: 'bad_request' }, 400);
  }

  if (!env.CLOUDKIT_S2S_PRIVATE_KEY_PKCS8_B64 || !env.CLOUDKIT_S2S_KEY_ID) {
    console.error('users/check-admin: missing S2S env vars');
    return jsonResponse({ ok: false, error: 'server_misconfigured' }, 500);
  }
  const creds = await getS2SCreds(env);

  const isSelf = targetUserRecordName === callerUserRecordName;
  if (!isSelf) {
    const callerIsAdmin = await isAdmin(creds, callerUserRecordName);
    if (!callerIsAdmin) return jsonResponse({ ok: false, error: 'forbidden' }, 403);
  }

  const targetIsAdmin = await isAdmin(creds, targetUserRecordName);
  return jsonResponse({ ok: true, isAdmin: targetIsAdmin });
}
