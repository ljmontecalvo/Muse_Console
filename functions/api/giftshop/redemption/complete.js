// The D1 status update, debit, and both counters are one transaction (SQL triggers).
// Repeating a completed code returns its receipt without rechecking/debiting the balance.
import { ckFetchRecord, getS2SCreds, jsonResponse } from '../../../_shared/cloudkit.js';
import { authorizeVenueOrAdmin } from '../../../_shared/auth.js';
import { commerceDB, ensureBalance, nonnegativeInteger } from '../../../_shared/trophyLedger.js';
import { ensureItemCounts } from '../../../_shared/redemptionLimits.js';
import { deriveCode, windowIndexForTime } from '../../../_shared/redemptionCode.js';

export async function onRequestPost({ request, env }) {
  const { callerUserRecordName, venueId, code } = await request.json();
  if (typeof code !== 'string' || !/^[A-Z]{5}$/.test(code.trim().toUpperCase()) || !venueId) return jsonResponse({ ok: false, error: 'bad_request' }, 400);
  const creds = await getS2SCreds(env);
  if (!await authorizeVenueOrAdmin(creds, venueId, callerUserRecordName)) return jsonResponse({ ok: false, error: 'forbidden' }, 403);
  const db = commerceDB(env);
  const now = Math.floor(Date.now() / 1000);
  const { results: candidates } = await db.prepare("SELECT * FROM redemptions WHERE venue_id=? AND expires_at>? AND status IN ('pending','completed')").bind(venueId, now).all();
  const current = windowIndexForTime(now);
  const matches = [];
  for (const candidate of candidates) {
    for (const w of [current - 1, current, current + 1]) {
      if (await deriveCode(candidate.code_secret, w) === code.trim().toUpperCase()) { matches.push(candidate); break; }
    }
  }
  if (!matches.length) return jsonResponse({ ok: false, error: 'no_match' }, 404);
  if (matches.length !== 1) return jsonResponse({ ok: false, error: 'ambiguous_match' }, 409);
  let redemption = matches[0];
  if (redemption.status === 'pending') {
    const item = await ckFetchRecord({ ...creds, recordName: redemption.item_id });
    const venue = await ckFetchRecord({ ...creds, recordName: venueId });
    if (!item || item.fields.isActive?.value !== 1) return jsonResponse({ ok: false, error: 'item_unavailable' }, 400);
    if (venue?.fields.giftShopEnabled?.value !== 1) return jsonResponse({ ok: false, error: 'giftshop_disabled' }, 400);
    await ensureBalance(db, creds, redemption.visitor_id, venueId);
    await ensureItemCounts(db, creds, item, redemption.visitor_id);
    try {
      await db.prepare("UPDATE redemptions SET status='completed',completed_at=?,staff_id=?,total_limit=?,visitor_limit=? WHERE id=? AND status='pending'")
        .bind(now, callerUserRecordName, nonnegativeInteger(item.fields.totalRedemptionLimit?.value),
          nonnegativeInteger(item.fields.perVisitorRedemptionLimit?.value), redemption.id).run();
    } catch (error) {
      const code = ['insufficient_balance','item_limit_reached','visitor_limit_reached','expired'].find(c => error.message.includes(c));
      if (code) return jsonResponse({ ok: false, error: code }, 409);
      throw error;
    }
    redemption = await db.prepare('SELECT * FROM redemptions WHERE id=?').bind(redemption.id).first();
    if (redemption.status !== 'completed') return jsonResponse({ ok: false, error: 'not_pending' }, 409);
  }
  // Optional display information must not turn a committed redemption into a failed request.
  let visitor;
  try { visitor = await ckFetchRecord({ ...creds, recordName: redemption.visitor_id }); } catch { /* Receipt remains valid. */ }
  return jsonResponse({ ok: true, item: { name: redemption.item_name, kind: redemption.item_kind, trophyCost: redemption.cost },
    visitorDisplayName: visitor?.fields.displayName?.value || '', remainingBalance: redemption.remaining_balance });
}
