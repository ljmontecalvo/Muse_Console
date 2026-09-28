// Called by the iOS app on hunt completion. Deliberately separate from
// functions/api/events/log.js: analytics stays best-effort/fire-and-forget, but
// trophy crediting must be reliable and tied to a verified visitor identity, which
// events/log.js has no concept of.
//
// idempotencyKey includes sessionId (not just huntId+visitorId) so a visitor CAN earn
// trophies again by completing the same hunt on a later, separate visit — only a
// retried/duplicate call within the same attempt is deduped, mirroring exactly how
// events/log.js already dedupes started/completed per sessionId.

import { ckFetchRecord, getS2SCreds, jsonResponse } from '../../_shared/cloudkit.js';
import { requireVisitorSession } from '../../_shared/visitorSession.js';
import { awardTrophies } from '../../_shared/trophyLedger.js';

export async function onRequestPost({ request, env }) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'bad_request' }, 400);
  }

  const { huntId, sessionId } = payload || {};
  if (!huntId || !sessionId) return jsonResponse({ ok: false, error: 'bad_request' }, 400);

  if (!env.CLOUDKIT_S2S_PRIVATE_KEY_PKCS8_B64 || !env.CLOUDKIT_S2S_KEY_ID) {
    console.error('giftshop/award-trophies: missing S2S env vars');
    return jsonResponse({ ok: false, error: 'server_misconfigured' }, 500);
  }

  const visitorId = await requireVisitorSession(request, env);
  if (!visitorId) return jsonResponse({ ok: false, error: 'unauthorized' }, 401);

  const creds = await getS2SCreds(env);
  const hunt = await ckFetchRecord({ ...creds, recordName: huntId });
  if (!hunt) return jsonResponse({ ok: false, error: 'not_found' }, 404);

  const venueRef = hunt.fields.venueReference && hunt.fields.venueReference.value;
  const venueId = venueRef && venueRef.recordName;
  const trophies = (hunt.fields.trophies && hunt.fields.trophies.value) || 0;
  if (!venueId || trophies <= 0) {
    return jsonResponse({ ok: true, awarded: 0 });
  }

  const result = await awardTrophies(creds, {
    visitorId, venueId, amount: trophies, huntId,
    idempotencyKey: `award_${huntId}_${visitorId}_${sessionId}`,
  });
  if (!result.ok) return jsonResponse({ ok: false, error: result.error || 'award_failed' }, 500);

  return jsonResponse({ ok: true, awarded: result.alreadyProcessed ? 0 : trophies, balance: result.balance });
}
