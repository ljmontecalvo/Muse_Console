import { ckModifyRecords, ckQuery, getS2SCreds, jsonResponse } from '../../_shared/cloudkit.js';
import { authorizeVenueOrAdmin, resolveHuntVenue } from '../../_shared/auth.js';

function clueTagRecordName(clueRecordName) {
  return 'cluetag_' + clueRecordName;
}

export async function onRequestPost({ request, env }) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'bad_request' }, 400);
  }

  const { callerUserRecordName, huntId } = payload || {};
  if (!callerUserRecordName || !huntId) {
    return jsonResponse({ ok: false, error: 'bad_request' }, 400);
  }

  if (!env.CLOUDKIT_S2S_PRIVATE_KEY_PKCS8_B64 || !env.CLOUDKIT_S2S_KEY_ID) {
    console.error('hunts/delete: missing S2S env vars');
    return jsonResponse({ ok: false, error: 'server_misconfigured' }, 500);
  }
  const creds = await getS2SCreds(env);

  const venueId = await resolveHuntVenue(creds, huntId);
  if (!venueId) return jsonResponse({ ok: false, error: 'not_found' }, 404);

  const authorized = await authorizeVenueOrAdmin(creds, venueId, callerUserRecordName);
  if (!authorized) return jsonResponse({ ok: false, error: 'forbidden' }, 403);

  const clues = await ckQuery({
    ...creds,
    recordType: 'Clue',
    filterBy: [{ fieldName: 'huntReference', comparator: 'EQUALS', fieldValue: { value: { recordName: huntId } } }],
  });

  const toDelete = [huntId, ...clues.map((c) => c.recordName), ...clues.map((c) => clueTagRecordName(c.recordName))];
  const deleteOps = toDelete.map((recordName) => ({ operationType: 'forceDelete', record: { recordName } }));
  await ckModifyRecords({ ...creds, operations: deleteOps });

  return jsonResponse({ ok: true });
}
