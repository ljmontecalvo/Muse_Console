// Creates/updates a GiftShopItem. Same authorization shape as hunts/save.js: for
// updates, the venue is resolved from the EXISTING record server-side, never trusted
// from the client. GiftShopItem itself is World/Authenticated-readable (visitors and
// the console both read the catalog directly via CloudKit), so this endpoint only
// exists for the write path.

import { ckModifyRecords, getS2SCreds, jsonResponse } from '../../../_shared/cloudkit.js';
import { authorizeVenueOrAdmin, resolveGiftShopItemVenue } from '../../../_shared/auth.js';

const VALID_KINDS = new Set(['item', 'discount']);

export async function onRequestPost({ request, env }) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'bad_request' }, 400);
  }

  const { callerUserRecordName, itemId, venueId, itemChangeTag, data } = payload || {};
  if (!callerUserRecordName || !venueId || !data || !data.name) {
    return jsonResponse({ ok: false, error: 'bad_request' }, 400);
  }

  if (!env.CLOUDKIT_S2S_PRIVATE_KEY_PKCS8_B64 || !env.CLOUDKIT_S2S_KEY_ID) {
    console.error('giftshop/items/save: missing S2S env vars');
    return jsonResponse({ ok: false, error: 'server_misconfigured' }, 500);
  }
  const creds = await getS2SCreds(env);

  const authoritativeVenueId = itemId ? await resolveGiftShopItemVenue(creds, itemId) : venueId;
  if (!authoritativeVenueId) return jsonResponse({ ok: false, error: 'not_found' }, 404);

  const authorized = await authorizeVenueOrAdmin(creds, authoritativeVenueId, callerUserRecordName);
  if (!authorized) return jsonResponse({ ok: false, error: 'forbidden' }, 403);

  const trophyCost = Math.max(0, Math.floor(Number(data.trophyCost) || 0));
  const kind = VALID_KINDS.has(data.kind) ? data.kind : 'item';
  const fields = {
    name: { value: data.name },
    description: { value: data.description || '' },
    trophyCost: { value: trophyCost },
    kind: { value: kind },
    isActive: { value: data.isActive === false ? 0 : 1 },
    sortOrder: { value: Math.floor(Number(data.sortOrder) || 0) },
  };
  if (!itemId) fields.venueReference = { value: { recordName: authoritativeVenueId, action: 'NONE' } };

  const resp = await ckModifyRecords({
    ...creds,
    operations: [{
      operationType: itemId ? 'update' : 'create',
      record: {
        ...(itemId ? { recordName: itemId, recordChangeTag: itemChangeTag } : {}),
        recordType: 'GiftShopItem',
        fields,
      },
    }],
  });
  const savedItem = resp.records && resp.records[0];
  if (!savedItem || savedItem.serverErrorCode) {
    return jsonResponse({ ok: false, error: 'save_failed', message: (savedItem && savedItem.reason) || 'Could not save item' }, 500);
  }

  return jsonResponse({ ok: true, itemId: savedItem.recordName });
}
