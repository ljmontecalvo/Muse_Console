// Visitor-initiated cancel of a pending redemption. No balance change — nothing was
// debited at redemption/start, only pre-flight checked, so cancelling costs nothing.

import { ckFetchRecord, ckModifyRecords, getS2SCreds, jsonResponse } from '../../../_shared/cloudkit.js';
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
    console.error('giftshop/redemption/cancel: missing S2S env vars');
    return jsonResponse({ ok: false, error: 'server_misconfigured' }, 500);
  }

  const visitorId = await requireVisitorSession(request, env);
  if (!visitorId) return jsonResponse({ ok: false, error: 'unauthorized' }, 401);

  const creds = await getS2SCreds(env);
  const redemption = await ckFetchRecord({ ...creds, recordName: redemptionId });
  if (!redemption) return jsonResponse({ ok: false, error: 'not_found' }, 404);

  const owner = redemption.fields.visitorReference && redemption.fields.visitorReference.value;
  if (!owner || owner.recordName !== visitorId) return jsonResponse({ ok: false, error: 'forbidden' }, 403);

  const status = redemption.fields.status && redemption.fields.status.value;
  if (status !== 'pending') return jsonResponse({ ok: false, error: 'not_pending' }, 400);

  const resp = await ckModifyRecords({
    ...creds,
    operations: [{
      operationType: 'update',
      record: {
        recordName: redemptionId,
        recordChangeTag: redemption.recordChangeTag,
        recordType: 'Redemption',
        fields: { status: { value: 'cancelled' } },
      },
    }],
  });
  const failed = (resp.records || []).find((r) => r.serverErrorCode);
  if (failed) return jsonResponse({ ok: false, error: 'save_failed', message: failed.reason || failed.serverErrorCode }, 500);

  return jsonResponse({ ok: true });
}
