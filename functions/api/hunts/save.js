// Creates/updates a Hunt plus its Clue + ClueTag records. Authorization: the caller
// must be a manager of the hunt's venue (or an admin). For updates, the venue is
// resolved from the EXISTING Hunt record via the S2S key, never trusted from the
// client — otherwise a caller could pass a venueId they do manage while huntId
// belongs to a venue they don't.

import { ckFetchRecord, ckModifyRecords, ckQuery, getS2SCreds, jsonResponse } from '../../_shared/cloudkit.js';
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

  const { callerUserRecordName, huntId, venueId, huntChangeTag, data, clues } = payload || {};
  if (!callerUserRecordName || !venueId || !data || !Array.isArray(clues)) {
    return jsonResponse({ ok: false, error: 'bad_request' }, 400);
  }

  if (!env.CLOUDKIT_S2S_PRIVATE_KEY_PKCS8_B64 || !env.CLOUDKIT_S2S_KEY_ID) {
    console.error('hunts/save: missing S2S env vars');
    return jsonResponse({ ok: false, error: 'server_misconfigured' }, 500);
  }
  const creds = await getS2SCreds(env);

  const authoritativeVenueId = huntId ? await resolveHuntVenue(creds, huntId) : venueId;
  if (!authoritativeVenueId) return jsonResponse({ ok: false, error: 'not_found' }, 404);

  const authorized = await authorizeVenueOrAdmin(creds, authoritativeVenueId, callerUserRecordName);
  if (!authorized) return jsonResponse({ ok: false, error: 'forbidden' }, 403);

  // Server-verified source of truth for which clues currently belong to this hunt —
  // Clue recordNames/changeTags are World-readable (any venue's), so the client's
  // `clues` list can never be trusted to say what it's allowed to touch. A brand new
  // hunt (no huntId yet) legitimately owns zero existing clues.
  const actualClues = huntId ? await ckQuery({
    ...creds,
    recordType: 'Clue',
    filterBy: [{ fieldName: 'huntReference', comparator: 'EQUALS', fieldValue: { value: { recordName: huntId } } }],
  }) : [];
  const actualClueIds = new Set(actualClues.map((c) => c.recordName));

  const invalidClueRef = clues.find((c) => c.id && !c.id.startsWith('draft_') && !actualClueIds.has(c.id));
  if (invalidClueRef) {
    return jsonResponse({ ok: false, error: 'forbidden', message: 'One or more clues do not belong to this hunt' }, 403);
  }

  const huntOp = huntId
    ? {
        operationType: 'update',
        record: {
          recordName: huntId,
          recordChangeTag: huntChangeTag,
          recordType: 'Hunt',
          fields: {
            title: { value: data.title },
            description: { value: data.description },
            folder: { value: data.folder || '' },
          },
        },
      }
    : {
        operationType: 'create',
        record: {
          recordType: 'Hunt',
          fields: {
            title: { value: data.title },
            description: { value: data.description },
            folder: { value: data.folder || '' },
            venueReference: { value: { recordName: authoritativeVenueId, action: 'NONE' } },
          },
        },
      };

  const huntResp = await ckModifyRecords({ ...creds, operations: [huntOp] });
  const savedHunt = huntResp.records && huntResp.records[0];
  if (!savedHunt || savedHunt.recordName === undefined) {
    return jsonResponse({ ok: false, error: 'save_failed', message: (huntResp.records && huntResp.records[0] && huntResp.records[0].reason) || 'Could not save hunt' }, 500);
  }
  const finalHuntId = savedHunt.recordName;

  const currentIds = new Set(clues.filter((c) => c.id && !c.id.startsWith('draft_')).map((c) => c.id));
  // Derived from the server-verified set, not client input — see actualClueIds above.
  const toDelete = [...actualClueIds].filter((id) => !currentIds.has(id));

  const clueOps = [];
  clues.forEach((c, i) => {
    const isNew = !c.id || c.id.startsWith('draft_');
    const clueRecordName = isNew ? ('clue_' + crypto.randomUUID()) : c.id;

    clueOps.push({
      operationType: isNew ? 'create' : 'update',
      record: {
        recordName: clueRecordName,
        ...(isNew ? {} : { recordChangeTag: c.recordChangeTag }),
        recordType: 'Clue',
        fields: {
          title: { value: c.title },
          body: { value: c.body },
          tagStatus: { value: c.tagStatus || 'pending' },
          order: { value: i },
          huntReference: { value: { recordName: finalHuntId, action: 'NONE' } },
        },
      },
    });

    clueOps.push({
      operationType: c.tagRecordChangeTag ? 'update' : 'create',
      record: {
        recordName: clueTagRecordName(clueRecordName),
        ...(c.tagRecordChangeTag ? { recordChangeTag: c.tagRecordChangeTag } : {}),
        recordType: 'ClueTag',
        fields: {
          nfcTagID: { value: c.nfcTagID },
          clueReference: { value: { recordName: clueRecordName, action: 'NONE' } },
        },
      },
    });
  });

  if (clueOps.length) {
    const clueResp = await ckModifyRecords({ ...creds, operations: clueOps });
    const failed = (clueResp.records || []).find((r) => r.serverErrorCode);
    if (failed) return jsonResponse({ ok: false, error: 'save_failed', message: failed.reason || failed.serverErrorCode }, 500);
  }

  if (toDelete.length) {
    const deleteOps = [...toDelete, ...toDelete.map(clueTagRecordName)].map((recordName) => ({
      operationType: 'forceDelete',
      record: { recordName },
    }));
    await ckModifyRecords({ ...creds, operations: deleteOps });
  }

  return jsonResponse({ ok: true, huntId: finalHuntId });
}
