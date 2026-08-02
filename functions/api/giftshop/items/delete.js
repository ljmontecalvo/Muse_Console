import { ckModifyRecords, getS2SCreds, jsonResponse } from '../../../_shared/cloudkit.js';
import { authorizeVenueOrAdmin, resolveGiftShopItemVenue } from '../../../_shared/auth.js';

export async function onRequestPost({ request, env }) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'bad_request' }, 400);
  }

  const { callerUserRecordName, itemId } = payload || {};
  if (!callerUserRecordName || !itemId) {
    return jsonResponse({ ok: false, error: 'bad_request' }, 400);
  }

  if (!env.CLOUDKIT_S2S_PRIVATE_KEY_PKCS8_B64 || !env.CLOUDKIT_S2S_KEY_ID) {
    console.error('giftshop/items/delete: missing S2S env vars');
    return jsonResponse({ ok: false, error: 'server_misconfigured' }, 500);
  }
  const creds = await getS2SCreds(env);

  const venueId = await resolveGiftShopItemVenue(creds, itemId);
  if (!venueId) return jsonResponse({ ok: false, error: 'not_found' }, 404);

  const authorized = await authorizeVenueOrAdmin(creds, venueId, callerUserRecordName);
  if (!authorized) return jsonResponse({ ok: false, error: 'forbidden' }, 403);

  await ckModifyRecords({ ...creds, operations: [{ operationType: 'forceDelete', record: { recordName: itemId } }] });

  return jsonResponse({ ok: true });
}
