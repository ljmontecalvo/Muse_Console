import { commerceDB, ensureBalance } from '../../_shared/trophyLedger.js';
// Returns the signed-in visitor's trophy balance at every venue they've earned
// trophies at, joined with venue names — feeds the iOS app's Venues screen.

import { ckFetchRecord, ckQuery, getS2SCreds, jsonResponse } from '../../_shared/cloudkit.js';
import { requireVisitorSession } from '../../_shared/visitorSession.js';

export async function onRequestPost({ request, env }) {
  if (!env.CLOUDKIT_S2S_PRIVATE_KEY_PKCS8_B64 || !env.CLOUDKIT_S2S_KEY_ID) {
    console.error('visitor/balances: missing S2S env vars');
    return jsonResponse({ ok: false, error: 'server_misconfigured' }, 500);
  }

  const visitorId = await requireVisitorSession(request, env);
  if (!visitorId) return jsonResponse({ ok: false, error: 'unauthorized' }, 401);

  const creds = await getS2SCreds(env);
  const balanceRecords = await ckQuery({
    ...creds,
    recordType: 'VisitorTrophyBalance',
    filterBy: [{ fieldName: 'visitorReference', comparator: 'EQUALS', fieldValue: { value: { recordName: visitorId } } }],
  });

  const db = commerceDB(env);
  for (const rec of balanceRecords) {
    const venueId = rec.fields.venueReference?.value?.recordName;
    if (venueId) await ensureBalance(db, creds, visitorId, venueId);
  }
  const { results: rows } = await db.prepare('SELECT venue_id,balance FROM balances WHERE visitor_id=?').bind(visitorId).all();
  const balances = await Promise.all(rows.map(async (rec) => {
    const venueId = rec.venue_id;
    const venue = venueId ? await ckFetchRecord({ ...creds, recordName: venueId }) : null;
    return {
      venueId,
      venueName: (venue && venue.fields.name && venue.fields.name.value) || 'Unknown Venue',
      giftShopEnabled: !!(venue && venue.fields.giftShopEnabled && venue.fields.giftShopEnabled.value === 1),
      balance: rec.balance,
    };
  }));

  return jsonResponse({ ok: true, balances });
}
