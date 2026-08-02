// Visitor Sign in with Apple exchange. Verifies the identityToken independently of
// CloudKit (see _shared/appleAuth.js), upserts a Visitor record keyed on Apple's
// stable `sub`, and issues our own signed session token for subsequent visitor calls
// — this endpoint is the one place a client-supplied identity gets turned into
// something verified, unlike the rest of this app's callerUserRecordName convention.

import { ckFetchRecord, ckModifyRecords, getS2SCreds, jsonResponse } from '../../_shared/cloudkit.js';
import { verifyAppleIdentityToken } from '../../_shared/appleAuth.js';
import { issueVisitorSessionToken } from '../../_shared/visitorSession.js';

export async function onRequestPost({ request, env }) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'bad_request' }, 400);
  }

  const { identityToken, displayName, email } = payload || {};
  if (!identityToken) return jsonResponse({ ok: false, error: 'bad_request' }, 400);

  if (!env.CLOUDKIT_S2S_PRIVATE_KEY_PKCS8_B64 || !env.CLOUDKIT_S2S_KEY_ID) {
    console.error('visitor/signin: missing S2S env vars');
    return jsonResponse({ ok: false, error: 'server_misconfigured' }, 500);
  }
  if (!env.VISITOR_SESSION_JWT_SECRET) {
    console.error('visitor/signin: missing VISITOR_SESSION_JWT_SECRET');
    return jsonResponse({ ok: false, error: 'server_misconfigured' }, 500);
  }

  const appleUserID = await verifyAppleIdentityToken(identityToken, env);
  if (!appleUserID) return jsonResponse({ ok: false, error: 'invalid_token' }, 401);

  const creds = await getS2SCreds(env);
  const recordName = 'visitor_' + appleUserID;
  const existing = await ckFetchRecord({ ...creds, recordName });

  const fields = { appleUserID: { value: appleUserID } };
  // Apple only sends displayName/email on the visitor's very first authorization —
  // subsequent sign-ins omit them, so never overwrite a stored value with a blank one.
  if (displayName) fields.displayName = { value: displayName };
  if (email) fields.email = { value: email };

  const resp = await ckModifyRecords({
    ...creds,
    operations: [{
      operationType: existing ? 'update' : 'create',
      record: {
        recordName,
        ...(existing ? { recordChangeTag: existing.recordChangeTag } : {}),
        recordType: 'Visitor',
        fields,
      },
    }],
  });
  const failed = (resp.records || []).find((r) => r.serverErrorCode);
  if (failed) return jsonResponse({ ok: false, error: 'save_failed', message: failed.reason || failed.serverErrorCode }, 500);

  const sessionToken = await issueVisitorSessionToken(recordName, env);
  const resolvedName = displayName
    || (existing && existing.fields.displayName && existing.fields.displayName.value)
    || '';

  return jsonResponse({ ok: true, sessionToken, visitor: { displayName: resolvedName } });
}
