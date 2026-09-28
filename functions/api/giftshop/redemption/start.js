// Visitor-initiated: begins redeeming a gift shop item. No trophies are debited here
// — only a pre-flight balance check — so an abandoned/expired redemption never
// strands spent trophies (see redemption/complete.js for the actual deduction).
// Snapshots the item's name/kind/cost onto the Redemption record so a later catalog
// edit can't retroactively change an in-flight commitment.

import { ckFetchRecord, getS2SCreds, jsonResponse } from '../../../_shared/cloudkit.js';
import { requireVisitorSession } from '../../../_shared/visitorSession.js';
import { getBalance, commerceDB, nonnegativeInteger } from '../../../_shared/trophyLedger.js';
import { checkRedemptionLimits } from '../../../_shared/redemptionLimits.js';
import { deriveCode, generateCodeSecret, windowIndexForTime, WINDOW_SECONDS } from '../../../_shared/redemptionCode.js';

const REDEMPTION_TTL_SECONDS = 5 * 60;

export async function onRequestPost({ request, env }) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'bad_request' }, 400);
  }

  const { itemId } = payload || {};
  if (!itemId) return jsonResponse({ ok: false, error: 'bad_request' }, 400);

  if (!env.CLOUDKIT_S2S_PRIVATE_KEY_PKCS8_B64 || !env.CLOUDKIT_S2S_KEY_ID) {
    console.error('giftshop/redemption/start: missing S2S env vars');
    return jsonResponse({ ok: false, error: 'server_misconfigured' }, 500);
  }

  const visitorId = await requireVisitorSession(request, env);
  if (!visitorId) return jsonResponse({ ok: false, error: 'unauthorized' }, 401);

  const creds = await getS2SCreds(env);
  const db = commerceDB(env);

  const item = await ckFetchRecord({ ...creds, recordName: itemId });
  if (!item || (item.fields.isActive && item.fields.isActive.value) !== 1) {
    return jsonResponse({ ok: false, error: 'not_found' }, 404);
  }
  const venueRef = item.fields.venueReference && item.fields.venueReference.value;
  const venueId = venueRef && venueRef.recordName;
  if (!venueId) return jsonResponse({ ok: false, error: 'not_found' }, 404);

  const venue = await ckFetchRecord({ ...creds, recordName: venueId });
  if (!venue || (venue.fields.giftShopEnabled && venue.fields.giftShopEnabled.value) !== 1) {
    return jsonResponse({ ok: false, error: 'giftshop_disabled' }, 403);
  }

  const trophyCost = nonnegativeInteger(item.fields.trophyCost?.value);
  const balance = await getBalance(db, creds, visitorId, venueId);
  if (balance < trophyCost) {
    return jsonResponse({ ok: false, error: 'insufficient_balance', balance, trophyCost }, 400);
  }

  // Soft pre-flight check only — nothing is reserved yet, same reasoning as the
  // balance check above. Re-checked and actually recorded at complete-time.
  const limitCheck = await checkRedemptionLimits(db, creds, item, visitorId);
  if (!limitCheck.ok) {
    return jsonResponse({ ok: false, error: limitCheck.error }, 400);
  }

  const codeSecret = generateCodeSecret();
  const nowSec = Math.floor(Date.now() / 1000);
  const expiresAt = nowSec + REDEMPTION_TTL_SECONDS;
  const startWindow = windowIndexForTime(nowSec);
  const endWindow = windowIndexForTime(expiresAt);

  const codes = [];
  for (let w = startWindow; w <= endWindow; w++) {
    codes.push({
      code: await deriveCode(codeSecret, w),
      validFrom: w * WINDOW_SECONDS,
      validUntil: (w + 1) * WINDOW_SECONDS,
    });
  }

  const redemptionId = crypto.randomUUID();
  await db.prepare(`INSERT INTO redemptions(id,visitor_id,venue_id,item_id,item_name,item_kind,cost,code_secret,expires_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).bind(redemptionId, visitorId, venueId, itemId,
      item.fields.name?.value || '', item.fields.kind?.value || 'item', trophyCost, codeSecret, expiresAt).run();

  return jsonResponse({
    ok: true,
    redemptionId,
    expiresAt,
    item: { name: item.fields.name?.value || '', kind: item.fields.kind?.value || 'item', trophyCost },
    codes,
  });
}
