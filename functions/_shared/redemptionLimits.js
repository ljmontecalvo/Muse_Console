import { ckFetchRecord } from './cloudkit.js';
import { nonnegativeInteger } from './trophyLedger.js';

export async function ensureItemCounts(db, creds, item, visitorId) {
  const itemId = item.recordName;
  await db.prepare('INSERT OR IGNORE INTO item_counts(item_id,count) VALUES(?,?)')
    .bind(itemId, nonnegativeInteger(item.fields.totalRedeemedCount?.value)).run();
  const existing = await db.prepare('SELECT count FROM visitor_item_counts WHERE visitor_id=? AND item_id=?').bind(visitorId, itemId).first();
  if (!existing) {
    const legacy = await ckFetchRecord({ ...creds, recordName: `itemcount_${itemId}_${visitorId}` });
    await db.prepare('INSERT OR IGNORE INTO visitor_item_counts(visitor_id,item_id,count) VALUES(?,?,?)')
      .bind(visitorId, itemId, nonnegativeInteger(legacy?.fields?.count?.value)).run();
  }
}
export async function checkRedemptionLimits(db, creds, item, visitorId) {
  await ensureItemCounts(db, creds, item, visitorId);
  const totalLimit = nonnegativeInteger(item.fields.totalRedemptionLimit?.value);
  const visitorLimit = nonnegativeInteger(item.fields.perVisitorRedemptionLimit?.value);
  const total = await db.prepare('SELECT count FROM item_counts WHERE item_id=?').bind(item.recordName).first();
  const personal = await db.prepare('SELECT count FROM visitor_item_counts WHERE visitor_id=? AND item_id=?').bind(visitorId, item.recordName).first();
  if (totalLimit && total.count >= totalLimit) return { ok: false, error: 'item_limit_reached' };
  if (visitorLimit && personal.count >= visitorLimit) return { ok: false, error: 'visitor_limit_reached' };
  return { ok: true };
}
