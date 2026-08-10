// Deletes a folder from a venue's FolderRegistry and reassigns any hunts currently
// filed under it to Uncategorized (folder: '') — a folder is just an organizational
// label, so deleting it should never delete or hide the hunts inside it.

import { ckFetchRecord, ckModifyRecords, ckQuery, getS2SCreds, jsonResponse } from '../../_shared/cloudkit.js';
import { authorizeVenueOrAdmin } from '../../_shared/auth.js';

function folderRegistryRecordName(venueId) {
  return 'folder_registry_' + venueId;
}

export async function onRequestPost({ request, env }) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'bad_request' }, 400);
  }

  const { callerUserRecordName, venueId, name } = payload || {};
  const trimmed = (name || '').trim();
  if (!callerUserRecordName || !venueId || !trimmed) {
    return jsonResponse({ ok: false, error: 'bad_request' }, 400);
  }

  if (!env.CLOUDKIT_S2S_PRIVATE_KEY_PKCS8_B64 || !env.CLOUDKIT_S2S_KEY_ID) {
    console.error('folders/delete: missing S2S env vars');
    return jsonResponse({ ok: false, error: 'server_misconfigured' }, 500);
  }
  const creds = await getS2SCreds(env);

  const authorized = await authorizeVenueOrAdmin(creds, venueId, callerUserRecordName);
  if (!authorized) return jsonResponse({ ok: false, error: 'forbidden' }, 403);

  const recordName = folderRegistryRecordName(venueId);
  const existing = await ckFetchRecord({ ...creds, recordName });
  if (existing) {
    const current = (existing.fields.names && existing.fields.names.value) || [];
    const updated = current.filter((f) => f.toLowerCase() !== trimmed.toLowerCase());
    if (updated.length !== current.length) {
      const resp = await ckModifyRecords({
        ...creds,
        operations: [{
          operationType: 'update',
          record: {
            recordName,
            recordChangeTag: existing.recordChangeTag,
            recordType: 'FolderRegistry',
            fields: { names: { value: updated } },
          },
        }],
      });
      const failed = (resp.records || []).find((r) => r.serverErrorCode);
      if (failed) return jsonResponse({ ok: false, error: 'save_failed', message: failed.reason || failed.serverErrorCode }, 500);
    }
  }

  // Filtered client-side (here) on the venue's already-fetched hunts rather than a
  // CloudKit filterBy on `folder` -- that field was never set up as Queryable (only
  // venueReference was, which is all the client-side reads ever needed), and adding
  // an unindexed filter would just reproduce the same silent-empty-result class of bug
  // this app has hit before (see functions/_shared/cloudkit.js's ckQuery comment).
  const venueHunts = await ckQuery({
    ...creds,
    recordType: 'Hunt',
    filterBy: [{ fieldName: 'venueReference', comparator: 'EQUALS', fieldValue: { value: { recordName: venueId } } }],
  });
  const toReassign = venueHunts.filter((h) => ((h.fields.folder && h.fields.folder.value) || '').trim().toLowerCase() === trimmed.toLowerCase());

  if (toReassign.length) {
    const ops = toReassign.map((h) => ({
      operationType: 'update',
      record: {
        recordName: h.recordName,
        recordChangeTag: h.recordChangeTag,
        recordType: 'Hunt',
        fields: { folder: { value: '' } },
      },
    }));
    const resp = await ckModifyRecords({ ...creds, operations: ops });
    const failed = (resp.records || []).find((r) => r.serverErrorCode);
    if (failed) return jsonResponse({ ok: false, error: 'save_failed', message: failed.reason || failed.serverErrorCode }, 500);
  }

  return jsonResponse({ ok: true, movedCount: toReassign.length });
}
