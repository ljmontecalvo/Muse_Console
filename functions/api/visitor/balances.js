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

  const balances = await Promise.all(balanceRecords.map(async (rec) => {
    const venueRef = rec.fields.venueReference && rec.fields.venueReference.value;
    const venueId = venueRef && venueRef.recordName;
    const venue = venueId ? await ckFetchRecord({ ...creds, recordName: venueId }) : null;
    return {
      venueId,
      venueName: (venue && venue.fields.name && venue.fields.name.value) || 'Unknown Venue',
      giftShopEnabled: !!(venue && venue.fields.giftShopEnabled && venue.fields.giftShopEnabled.value === 1),
      balance: (rec.fields.balance && rec.fields.balance.value) || 0,
    };
  }));

  return jsonResponse({ ok: true, balances });
}
