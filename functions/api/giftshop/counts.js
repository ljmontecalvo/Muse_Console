import { ckQuery, getS2SCreds, jsonResponse } from '../../_shared/cloudkit.js';
import { commerceDB, nonnegativeInteger } from '../../_shared/trophyLedger.js';
export async function onRequestPost({ request, env }) {
  const { venueId } = await request.json();
  if (typeof venueId !== 'string') return jsonResponse({ ok: false, error: 'bad_request' }, 400);
  const items = await ckQuery({ ...await getS2SCreds(env), recordType: 'GiftShopItem', filterBy: [
    { fieldName: 'venueReference', comparator: 'EQUALS', fieldValue: { value: { recordName: venueId } } }
  ] });
  const db = commerceDB(env);
  const counts = Object.create(null);
  for (const item of items) {
    const row = await db.prepare('SELECT count FROM item_counts WHERE item_id=?').bind(item.recordName).first();
    counts[item.recordName] = row?.count ?? nonnegativeInteger(item.fields.totalRedeemedCount?.value);
  }
  return jsonResponse({ ok: true, counts });
}
