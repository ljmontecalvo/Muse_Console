// Console-side: staff types the visitor's rotating code at checkout. Searches pending,
// unexpired Redemptions scoped to the venue the caller is authorized for, recomputes
// each candidate's code across a +-15s window (covering read/type delay), matches,
// re-verifies the visitor still has enough balance, deducts, and marks it completed.
//
// Authorization here intentionally stays on the same callerUserRecordName trust model
// as every other console write (see functions/_shared/auth.js) rather than the
// verified-session model used for visitor endpoints — a deliberate, documented choice
// (see the plan's "residual trust gap" note), not an oversight.

import { ckFetchRecord, ckModifyRecords, ckQuery, getS2SCreds, jsonResponse } from '../../../_shared/cloudkit.js';
import { authorizeVenueOrAdmin } from '../../../_shared/auth.js';
import { deductTrophies, getBalance } from '../../../_shared/trophyLedger.js';
import { deriveCode, windowIndexForTime } from '../../../_shared/redemptionCode.js';

export async function onRequestPost({ request, env }) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'bad_request' }, 400);
  }

  const { callerUserRecordName, venueId, code } = payload || {};
  const normalizedCode = (code || '').trim().toUpperCase();
  if (!callerUserRecordName || !venueId || !normalizedCode) {
    return jsonResponse({ ok: false, error: 'bad_request' }, 400);
  }

  if (!env.CLOUDKIT_S2S_PRIVATE_KEY_PKCS8_B64 || !env.CLOUDKIT_S2S_KEY_ID) {
    console.error('giftshop/redemption/complete: missing S2S env vars');
    return jsonResponse({ ok: false, error: 'server_misconfigured' }, 500);
  }
  const creds = await getS2SCreds(env);

  const authorized = await authorizeVenueOrAdmin(creds, venueId, callerUserRecordName);
  if (!authorized) return jsonResponse({ ok: false, error: 'forbidden' }, 403);

  const nowSec = Math.floor(Date.now() / 1000);
  const candidates = await ckQuery({
    ...creds,
    recordType: 'Redemption',
    filterBy: [
      { fieldName: 'venueReference', comparator: 'EQUALS', fieldValue: { value: { recordName: venueId } } },
      { fieldName: 'status', comparator: 'EQUALS', fieldValue: { value: 'pending' } },
    ],
  });

  const currentWindow = windowIndexForTime(nowSec);
  const windowsToCheck = [currentWindow - 1, currentWindow, currentWindow + 1];

  const matches = [];
  for (const candidate of candidates) {
    const expiresAt = candidate.fields.expiresAt && candidate.fields.expiresAt.value;
    if (!expiresAt || expiresAt < nowSec) continue;
    const codeSecret = candidate.fields.codeSecret && candidate.fields.codeSecret.value;
    if (!codeSecret) continue;
    for (const w of windowsToCheck) {
      const candidateCode = await deriveCode(codeSecret, w);
      if (candidateCode === normalizedCode) {
        matches.push(candidate);
        break;
      }
    }
  }

  if (matches.length === 0) return jsonResponse({ ok: false, error: 'no_match' }, 404);
  if (matches.length > 1) return jsonResponse({ ok: false, error: 'ambiguous_match' }, 409);

  const redemption = matches[0];
  const visitorRef = redemption.fields.visitorReference && redemption.fields.visitorReference.value;
  const visitorId = visitorRef && visitorRef.recordName;
  const trophyCost = (redemption.fields.itemTrophyCostSnapshot && redemption.fields.itemTrophyCostSnapshot.value) || 0;

  const currentBalance = await getBalance(creds, visitorId, venueId);
  if (currentBalance < trophyCost) {
    return jsonResponse({ ok: false, error: 'insufficient_balance', balance: currentBalance, trophyCost }, 400);
  }

  const deductResult = await deductTrophies(creds, {
    visitorId, venueId, amount: trophyCost,
    redemptionId: redemption.recordName,
    idempotencyKey: `redeem_${redemption.recordName}`,
  });
  if (!deductResult.ok) {
    return jsonResponse({ ok: false, error: deductResult.error || 'deduction_failed' }, 400);
  }

  const updateResp = await ckModifyRecords({
    ...creds,
    operations: [{
      operationType: 'update',
      record: {
        recordName: redemption.recordName,
        recordChangeTag: redemption.recordChangeTag,
        recordType: 'Redemption',
        fields: {
          status: { value: 'completed' },
          completedAt: { value: nowSec },
          redeemedByStaffUserRecordName: { value: callerUserRecordName },
        },
      },
    }],
  });
  const failed = (updateResp.records || []).find((r) => r.serverErrorCode);
  if (failed) return jsonResponse({ ok: false, error: 'save_failed', message: failed.reason || failed.serverErrorCode }, 500);

  const visitor = visitorId ? await ckFetchRecord({ ...creds, recordName: visitorId }) : null;
  const visitorDisplayName = (visitor && visitor.fields.displayName && visitor.fields.displayName.value) || '';

  return jsonResponse({
    ok: true,
    item: {
      name: redemption.fields.itemNameSnapshot && redemption.fields.itemNameSnapshot.value,
      kind: redemption.fields.itemKindSnapshot && redemption.fields.itemKindSnapshot.value,
      trophyCost,
    },
    visitorDisplayName,
    remainingBalance: deductResult.balance,
  });
}
