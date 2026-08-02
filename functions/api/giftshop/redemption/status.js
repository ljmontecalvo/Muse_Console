// Lightweight single-record poll so the visitor's redemption screen can auto-advance
// to "Redeemed!" once staff completes it on the console, without the client ever
// needing to recompute or request a fresh code (the code list from redemption/start
// already covers the whole 5-minute window locally).

import { ckFetchRecord, getS2SCreds, jsonResponse } from '../../../_shared/cloudkit.js';
import { requireVisitorSession } from '../../../_shared/visitorSession.js';

export async function onRequestPost({ request, env }) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'bad_request' }, 400);
  }

  const { redemptionId } = payload || {};
  if (!redemptionId) return jsonResponse({ ok: false, error: 'bad_request' }, 400);

  if (!env.CLOUDKIT_S2S_PRIVATE_KEY_PKCS8_B64 || !env.CLOUDKIT_S2S_KEY_ID) {
    console.error('giftshop/redemption/status: missing S2S env vars');
    return jsonResponse({ ok: false, error: 'server_misconfigured' }, 500);
  }

  const visitorId = await requireVisitorSession(request, env);
  if (!visitorId) return jsonResponse({ ok: false, error: 'unauthorized' }, 401);

  const creds = await getS2SCreds(env);
  const redemption = await ckFetchRecord({ ...creds, recordName: redemptionId });
  if (!redemption) return jsonResponse({ ok: false, error: 'not_found' }, 404);

  const owner = redemption.fields.visitorReference && redemption.fields.visitorReference.value;
  if (!owner || owner.recordName !== visitorId) return jsonResponse({ ok: false, error: 'forbidden' }, 403);

  return jsonResponse({ ok: true, status: redemption.fields.status && redemption.fields.status.value });
}
