import { ckFetchRecord, ckModifyRecords, getS2SCreds, jsonResponse } from '../../_shared/cloudkit.js';
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
    console.error('folders/add: missing S2S env vars');
    return jsonResponse({ ok: false, error: 'server_misconfigured' }, 500);
  }
  const creds = await getS2SCreds(env);

  const authorized = await authorizeVenueOrAdmin(creds, venueId, callerUserRecordName);
  if (!authorized) return jsonResponse({ ok: false, error: 'forbidden' }, 403);

  const recordName = folderRegistryRecordName(venueId);
  const existing = await ckFetchRecord({ ...creds, recordName });
  const current = (existing && existing.fields.names && existing.fields.names.value) || [];
  if (current.some((f) => f.toLowerCase() === trimmed.toLowerCase())) {
    return jsonResponse({ ok: true });
  }
  const updated = [...current, trimmed];

  const resp = await ckModifyRecords({
    ...creds,
    operations: [{
      operationType: existing ? 'update' : 'create',
      record: {
        recordName,
        ...(existing ? { recordChangeTag: existing.recordChangeTag } : {}),
        recordType: 'FolderRegistry',
        fields: { names: { value: updated } },
      },
    }],
  });
  const failed = (resp.records || []).find((r) => r.serverErrorCode);
  if (failed) return jsonResponse({ ok: false, error: 'save_failed', message: failed.reason || failed.serverErrorCode }, 500);

  return jsonResponse({ ok: true });
}
