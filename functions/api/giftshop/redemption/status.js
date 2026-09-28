import { jsonResponse } from '../../../_shared/cloudkit.js';
import { requireVisitorSession } from '../../../_shared/visitorSession.js';
import { commerceDB } from '../../../_shared/trophyLedger.js';
export async function onRequestPost({ request, env }) {
  const visitorId = await requireVisitorSession(request, env);
  if (!visitorId) return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
  const { redemptionId } = await request.json();
  if (typeof redemptionId !== 'string') return jsonResponse({ ok: false, error: 'bad_request' }, 400);
  const db = commerceDB(env);
  let row = await db.prepare('SELECT * FROM redemptions WHERE id=? AND visitor_id=?').bind(redemptionId, visitorId).first();
  if (!row) return jsonResponse({ ok: false, error: 'not_found' }, 404);
  const status = row.status === 'pending' && row.expires_at <= Date.now() / 1000 ? 'expired' : row.status;
  return jsonResponse({ ok: true, status });
}
