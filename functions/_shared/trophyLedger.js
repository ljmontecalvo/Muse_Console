// Trophy balance + ledger operations shared by the award and redemption endpoints.
//
// Idempotency: every award/deduction first tries to `create` a TrophyTransaction with
// a deterministic recordName derived from the caller's idempotency key. CloudKit
// rejects a `create` against an existing recordName, so this doubles as an atomic
// distributed lock — a retried or duplicated call sees the create fail and treats the
// operation as already-processed, rather than racing a query-then-write check.
//
// Concurrency: VisitorTrophyBalance has no atomic increment in CloudKit, so balance
// updates are fetch -> compute -> save-with-recordChangeTag, retried on conflict.

import { ckFetchRecord, ckModifyRecords } from './cloudkit.js';

const MAX_BALANCE_RETRIES = 5;

function balanceRecordName(visitorId, venueId) {
  return `balance_${visitorId}_${venueId}`;
}

async function getOrCreateBalanceRecord(creds, visitorId, venueId) {
  const recordName = balanceRecordName(visitorId, venueId);
  const existing = await ckFetchRecord({ ...creds, recordName });
  if (existing) return existing;

  const resp = await ckModifyRecords({
    ...creds,
    operations: [{
      operationType: 'create',
      record: {
        recordName, recordType: 'VisitorTrophyBalance',
        fields: {
          visitorReference: { value: { recordName: visitorId, action: 'NONE' } },
          venueReference: { value: { recordName: venueId, action: 'NONE' } },
          balance: { value: 0 },
        },
      },
    }],
  });
  const created = resp.records && resp.records[0];
  if (created && !created.serverErrorCode) return created;

  // Lost the create race to a concurrent request — the record exists now, fetch it.
  const rec = await ckFetchRecord({ ...creds, recordName });
  if (rec) return rec;
  throw new Error('Could not get or create trophy balance record');
}

async function adjustBalance(creds, visitorId, venueId, delta) {
  const recordName = balanceRecordName(visitorId, venueId);
  for (let attempt = 0; attempt < MAX_BALANCE_RETRIES; attempt++) {
    const rec = await getOrCreateBalanceRecord(creds, visitorId, venueId);
    const current = (rec.fields.balance && rec.fields.balance.value) || 0;
    const next = current + delta;
    if (next < 0) return { ok: false, error: 'insufficient_balance', balance: current };

    const resp = await ckModifyRecords({
      ...creds,
      operations: [{
        operationType: 'update',
        record: { recordName, recordChangeTag: rec.recordChangeTag, recordType: 'VisitorTrophyBalance', fields: { balance: { value: next } } },
      }],
    });
    const updated = resp.records && resp.records[0];
    if (updated && !updated.serverErrorCode) return { ok: true, balance: next };
    // Conflict (someone else updated it between our fetch and save) — retry.
  }
  return { ok: false, error: 'conflict_retry_exhausted' };
}

async function tryCreateLedgerEntry(creds, recordName, fields) {
  const resp = await ckModifyRecords({
    ...creds,
    operations: [{ operationType: 'create', record: { recordName, recordType: 'TrophyTransaction', fields } }],
  });
  const created = resp.records && resp.records[0];
  return !!(created && !created.serverErrorCode);
}

// Credits `amount` (must be > 0) trophies to a visitor at a venue, deduped on
// idempotencyKey. Returns { ok, alreadyProcessed, balance? }.
export async function awardTrophies(creds, { visitorId, venueId, amount, huntId, idempotencyKey }) {
  if (!(amount > 0)) return { ok: true, alreadyProcessed: false, balance: undefined };

  const recordName = `txn_${idempotencyKey}`;
  const created = await tryCreateLedgerEntry(creds, recordName, {
    visitorReference: { value: { recordName: visitorId, action: 'NONE' } },
    venueReference: { value: { recordName: venueId, action: 'NONE' } },
    type: { value: 'award_hunt_completion' },
    amount: { value: amount },
    huntReference: { value: { recordName: huntId, action: 'NONE' } },
    idempotencyKey: { value: idempotencyKey },
  });
  if (!created) return { ok: true, alreadyProcessed: true };

  const result = await adjustBalance(creds, visitorId, venueId, amount);
  return { ok: result.ok, alreadyProcessed: false, balance: result.balance, error: result.error };
}

// Deducts `amount` (must be > 0) trophies from a visitor at a venue, deduped on
// idempotencyKey. If the balance turns out to be insufficient at deduction time (a
// pre-flight check should already have happened at redemption/start), the ledger
// entry is rolled back and { ok: false } is returned.
export async function deductTrophies(creds, { visitorId, venueId, amount, redemptionId, idempotencyKey }) {
  const recordName = `txn_${idempotencyKey}`;
  const created = await tryCreateLedgerEntry(creds, recordName, {
    visitorReference: { value: { recordName: visitorId, action: 'NONE' } },
    venueReference: { value: { recordName: venueId, action: 'NONE' } },
    type: { value: 'redeem_item' },
    amount: { value: -Math.abs(amount) },
    redemptionReference: { value: { recordName: redemptionId, action: 'NONE' } },
    idempotencyKey: { value: idempotencyKey },
  });
  if (!created) return { ok: true, alreadyProcessed: true };

  const result = await adjustBalance(creds, visitorId, venueId, -Math.abs(amount));
  if (!result.ok) {
    // The debit failed after the ledger entry was created (e.g. insufficient balance
    // discovered here) — remove the entry so the ledger doesn't record a deduction
    // that never actually happened.
    await ckModifyRecords({ ...creds, operations: [{ operationType: 'forceDelete', record: { recordName } }] });
    return { ok: false, error: result.error };
  }
  return { ok: true, alreadyProcessed: false, balance: result.balance };
}

export async function getBalance(creds, visitorId, venueId) {
  const rec = await ckFetchRecord({ ...creds, recordName: balanceRecordName(visitorId, venueId) });
  return (rec && rec.fields.balance && rec.fields.balance.value) || 0;
}
