// Enforces optional per-item redemption limits: a cap on total redemptions across all
// visitors, and/or a cap per individual visitor. Both are optional per catalog item —
// 0/absent means unlimited, matching the existing 0-as-unset convention (e.g.
// Hunt.trophies).
//
// The total counter lives directly on GiftShopItem (totalRedeemedCount), updated via
// the same fetch -> compute -> save-with-recordChangeTag -> retry pattern trophyLedger
// uses for balances. The per-visitor counter lives on a new record type with a
// deterministic recordName (itemcount_<itemId>_<visitorId>), the same convention as
// VisitorTrophyBalance's balance_<visitorId>_<venueId> — both avoid needing any new
// Queryable index.
//
// Counts are only ever incremented at redemption *completion*, never at start, so an
// abandoned/expired redemption never consumes a slot from either limit — mirroring why
// deductTrophies() also only runs at complete-time.

import { ckFetchRecord, ckModifyRecords } from './cloudkit.js';

const MAX_RETRIES = 5;

function visitorItemCountRecordName(itemId, visitorId) {
  return `itemcount_${itemId}_${visitorId}`;
}

export async function getVisitorItemRedemptionCount(creds, itemId, visitorId) {
  const rec = await ckFetchRecord({ ...creds, recordName: visitorItemCountRecordName(itemId, visitorId) });
  return (rec && rec.fields.count && rec.fields.count.value) || 0;
}

async function incrementTotalRedeemedCount(creds, itemId) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const item = await ckFetchRecord({ ...creds, recordName: itemId });
    if (!item) throw new Error('Item not found while incrementing redemption count');
    const current = (item.fields.totalRedeemedCount && item.fields.totalRedeemedCount.value) || 0;
    const resp = await ckModifyRecords({
      ...creds,
      operations: [{
        operationType: 'update',
        record: { recordName: itemId, recordChangeTag: item.recordChangeTag, recordType: 'GiftShopItem', fields: { totalRedeemedCount: { value: current + 1 } } },
      }],
    });
    const updated = resp.records && resp.records[0];
    if (updated && !updated.serverErrorCode) return current + 1;
    // Conflict — someone else updated the item between our fetch and save. Retry.
  }
  throw new Error('conflict_retry_exhausted');
}

async function incrementVisitorItemCount(creds, itemId, visitorId) {
  const recordName = visitorItemCountRecordName(itemId, visitorId);
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const existing = await ckFetchRecord({ ...creds, recordName });
    if (!existing) {
      const resp = await ckModifyRecords({
        ...creds,
        operations: [{
          operationType: 'create',
          record: {
            recordName, recordType: 'VisitorItemRedemptionCount',
            fields: {
              itemReference: { value: { recordName: itemId, action: 'NONE' } },
              visitorReference: { value: { recordName: visitorId, action: 'NONE' } },
              count: { value: 1 },
            },
          },
        }],
      });
      const created = resp.records && resp.records[0];
      if (created && !created.serverErrorCode) return 1;
      continue; // Lost the create race — next attempt will find it via the fetch branch.
    }
    const current = (existing.fields.count && existing.fields.count.value) || 0;
    const resp = await ckModifyRecords({
      ...creds,
      operations: [{
        operationType: 'update',
        record: { recordName, recordChangeTag: existing.recordChangeTag, recordType: 'VisitorItemRedemptionCount', fields: { count: { value: current + 1 } } },
      }],
    });
    const updated = resp.records && resp.records[0];
    if (updated && !updated.serverErrorCode) return current + 1;
    // Conflict — retry.
  }
  throw new Error('conflict_retry_exhausted');
}

// `item` is the full GiftShopItem CKRecord — the caller already has it (fetched at
// redemption/start or resolved from the Redemption's itemReference at complete).
// Returns { ok: true } or { ok: false, error }.
export async function checkRedemptionLimits(creds, item, visitorId) {
  const totalLimit = (item.fields.totalRedemptionLimit && item.fields.totalRedemptionLimit.value) || 0;
  const perVisitorLimit = (item.fields.perVisitorRedemptionLimit && item.fields.perVisitorRedemptionLimit.value) || 0;

  if (totalLimit > 0) {
    const totalCount = (item.fields.totalRedeemedCount && item.fields.totalRedeemedCount.value) || 0;
    if (totalCount >= totalLimit) return { ok: false, error: 'item_limit_reached' };
  }
  if (perVisitorLimit > 0) {
    const visitorCount = await getVisitorItemRedemptionCount(creds, item.recordName, visitorId);
    if (visitorCount >= perVisitorLimit) return { ok: false, error: 'visitor_limit_reached' };
  }
  return { ok: true };
}

export async function recordRedemptionForLimits(creds, itemId, visitorId) {
  await incrementTotalRedeemedCount(creds, itemId);
  await incrementVisitorItemCount(creds, itemId, visitorId);
}
