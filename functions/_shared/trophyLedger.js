import { ckFetchRecord } from './cloudkit.js';

export function commerceDB(env) {
  if (!env.MUSE_COMMERCE) throw new Error('missing MUSE_COMMERCE D1 binding');
  return env.MUSE_COMMERCE.withSession ? env.MUSE_COMMERCE.withSession('first-primary') : env.MUSE_COMMERCE;
}
export function nonnegativeInteger(value) {
  const n = Number(value ?? 0);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('invalid_commerce_amount');
  return n;
}
// One-time import. Stop old writers at cutover; racing imports cannot overwrite new awards.
export async function ensureBalance(db, creds, visitorId, venueId) {
  if (await db.prepare('SELECT 1 FROM balances WHERE visitor_id=? AND venue_id=?').bind(visitorId, venueId).first()) return;
  const legacy = await ckFetchRecord({ ...creds, recordName: `balance_${visitorId}_${venueId}` });
  await db.prepare('INSERT OR IGNORE INTO balances(visitor_id,venue_id,balance) VALUES(?,?,?)')
    .bind(visitorId, venueId, nonnegativeInteger(legacy?.fields?.balance?.value)).run();
}
export async function getBalance(db, creds, visitorId, venueId) {
  await ensureBalance(db, creds, visitorId, venueId);
  return (await db.prepare('SELECT balance FROM balances WHERE visitor_id=? AND venue_id=?').bind(visitorId, venueId).first()).balance;
}
export async function awardTrophies(db, creds, { visitorId, venueId, amount, huntId, attemptId }) {
  amount = nonnegativeInteger(amount);
  await ensureBalance(db, creds, visitorId, venueId);
  await db.prepare('INSERT INTO awards(attempt_id,visitor_id,venue_id,hunt_id,amount) VALUES(?,?,?,?,?) ON CONFLICT(attempt_id) DO NOTHING')
    .bind(attemptId, visitorId, venueId, huntId, amount).run();
  const receipt = await db.prepare('SELECT * FROM awards WHERE attempt_id=?').bind(attemptId).first();
  if (receipt.visitor_id !== visitorId || receipt.hunt_id !== huntId || receipt.venue_id !== venueId) return { ok: false, error: 'already_claimed' };
  // Return the committed amount even when the first HTTP response was lost.
  return { ok: true, awarded: receipt.amount, balance: await getBalance(db, creds, visitorId, venueId) };
}
