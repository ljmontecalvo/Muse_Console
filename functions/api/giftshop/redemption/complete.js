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
import { deductTrophies } from '../../../_shared/trophyLedger.js';
import { checkRedemptionLimits, recordRedemptionForLimits } from '../../../_shared/redemptionLimits.js';
import { deriveCode, windowIndexForTime } from '../../../_shared/redemptionCode.js';

export async function onRequestPost(context) {
  const started = performance.now();
  let previous = started;
  const timings = [];
  const mark = (name) => {
    const now = performance.now();
    timings.push({ name, ms: Math.round(now - previous) });
    previous = now;
  };
  try {
    const response = await completeRedemption(context, mark);
    response.headers?.set('Server-Timing', timings.map(t => `${t.name};dur=${t.ms}`).join(', '));
    return response;
  } finally {
    // Durations only: never log visitor identities, redemption codes or credentials.
    console.info('redemption-timing', JSON.stringify({ totalMs: Math.round(performance.now() - started), stages: timings }));
  }
}

async function completeRedemption({ request, env }, mark) {
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

  mark('credentials');
  const authorized = await authorizeVenueOrAdmin(creds, venueId, callerUserRecordName);
  mark('authorization');
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

  mark('find_pending');
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

  mark('match_code');
  if (matches.length === 0) return jsonResponse({ ok: false, error: 'no_match' }, 404);
  if (matches.length > 1) return jsonResponse({ ok: false, error: 'ambiguous_match' }, 409);

  const redemption = matches[0];
  const visitorRef = redemption.fields.visitorReference && redemption.fields.visitorReference.value;
  const visitorId = visitorRef && visitorRef.recordName;
  const itemRef = redemption.fields.itemReference && redemption.fields.itemReference.value;
  const itemId = itemRef && itemRef.recordName;
  const trophyCost = (redemption.fields.itemTrophyCostSnapshot && redemption.fields.itemTrophyCostSnapshot.value) || 0;

  // These reads are independent. Keep the balance record/change tag for the
  // debit so we do not immediately fetch the same record again.
  const [balanceRecord, item, visitor] = await Promise.all([
    ckFetchRecord({ ...creds, recordName: `balance_${visitorId}_${venueId}` }),
    itemId ? ckFetchRecord({ ...creds, recordName: itemId }) : null,
    visitorId ? ckFetchRecord({ ...creds, recordName: visitorId }).catch(() => null) : null,
  ]);
  mark('read_records');
  const currentBalance = balanceRecord?.fields.balance?.value || 0;
  if (currentBalance < trophyCost) {
    return jsonResponse({ ok: false, error: 'insufficient_balance', balance: currentBalance, trophyCost }, 400);
  }

  // Re-check right before completing — the pre-flight check at redemption/start was a
  // soft check with nothing reserved, so another visitor's redemption could have
  // consumed the last slot in the meantime.
  if (itemId) {
    if (item) {
      const limitCheck = await checkRedemptionLimits(creds, item, visitorId);
      if (!limitCheck.ok) {
        return jsonResponse({ ok: false, error: limitCheck.error }, 400);
      }
    }
  }

  mark('check_limits');
  const deductResult = await deductTrophies(creds, {
    visitorId, venueId, amount: trophyCost,
    redemptionId: redemption.recordName,
    idempotencyKey: `redeem_${redemption.recordName}`,
    balanceRecord,
  });
  mark('deduct_balance');
  if (!deductResult.ok) {
    return jsonResponse({ ok: false, error: deductResult.error || 'deduction_failed' }, 400);
  }
  if (itemId) {
    await recordRedemptionForLimits(creds, itemId, visitorId, item);
  }

  mark('update_counters');
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
  mark('save_completion');
  const failed = (updateResp.records || []).find((r) => r.serverErrorCode);
  if (failed) return jsonResponse({ ok: false, error: 'save_failed', message: failed.reason || failed.serverErrorCode }, 500);

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
