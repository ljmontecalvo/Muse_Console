// Logs a hunt-progress event (started/completed) from the iOS app. Public and
// unauthenticated, same posture as validate-tag.js — visitors never sign in to
// CloudKit, so there's no caller identity to check here. venueId is always resolved
// server-side from huntId, never trusted from the client. A 'completed' event is only
// accepted if a matching 'started' event (same huntId + sessionId) was already logged —
// a cheap integrity check against pure completion-spam, not a defense against a
// determined attacker forging both calls (same residual-risk posture as the rest of
// this backend — see functions/_shared/auth.js).

import { ckModifyRecords, ckQuery, getS2SCreds, jsonResponse } from '../../_shared/cloudkit.js';
import { resolveHuntVenue } from '../../_shared/auth.js';

const VALID_TYPES = new Set(['started', 'completed']);

export async function onRequestPost({ request, env }) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'bad_request' }, 400);
  }

  const { eventType, huntId, sessionId } = payload || {};
  if (!VALID_TYPES.has(eventType) || !huntId || !sessionId) {
    return jsonResponse({ ok: false, error: 'bad_request' }, 400);
  }

  if (!env.CLOUDKIT_S2S_PRIVATE_KEY_PKCS8_B64 || !env.CLOUDKIT_S2S_KEY_ID) {
    console.error('events/log: missing S2S env vars');
    return jsonResponse({ ok: false, error: 'server_misconfigured' }, 500);
  }
  const creds = await getS2SCreds(env);

  const venueId = await resolveHuntVenue(creds, huntId);
  if (!venueId) return jsonResponse({ ok: false, error: 'not_found' }, 404);

  if (eventType === 'completed') {
    const priorStarts = await ckQuery({
      ...creds,
      recordType: 'HuntEvent',
      filterBy: [
        { fieldName: 'sessionId', comparator: 'EQUALS', fieldValue: { value: sessionId } },
        { fieldName: 'eventType', comparator: 'EQUALS', fieldValue: { value: 'started' } },
      ],
    });
    const hasMatchingStart = priorStarts.some((r) => {
      const ref = r.fields.huntReference && r.fields.huntReference.value;
      return ref && ref.recordName === huntId;
    });
    if (!hasMatchingStart) {
      return jsonResponse({ ok: false, error: 'no_matching_start' }, 400);
    }
  }

  const resp = await ckModifyRecords({
    ...creds,
    operations: [{
      operationType: 'create',
      record: {
        recordType: 'HuntEvent',
        fields: {
          eventType: { value: eventType },
          huntReference: { value: { recordName: huntId, action: 'NONE' } },
          venueReference: { value: { recordName: venueId, action: 'NONE' } },
          sessionId: { value: sessionId },
        },
      },
    }],
  });
  const failed = (resp.records || []).find((r) => r.serverErrorCode);
  if (failed) {
    return jsonResponse({ ok: false, error: 'save_failed', message: failed.reason || failed.serverErrorCode }, 500);
  }

  return jsonResponse({ ok: true });
}
