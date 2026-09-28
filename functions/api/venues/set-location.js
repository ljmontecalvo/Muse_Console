import { ckFetchRecord, ckModifyRecords, getS2SCreds, jsonResponse } from '../../_shared/cloudkit.js';
import { isAdmin } from '../../_shared/auth.js';
export async function onRequestPost({ request, env }) {
  const { callerUserRecordName, venueId, latitude, longitude } = await request.json();
  if (typeof venueId !== 'string' || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude)>90 || Math.abs(longitude)>180) return jsonResponse({ ok: false, error: 'bad_request' }, 400);
  const creds = await getS2SCreds(env);
  if (!await isAdmin(creds, callerUserRecordName)) return jsonResponse({ ok: false, error: 'forbidden' }, 403);
  const venue = await ckFetchRecord({ ...creds, recordName: venueId });
  if (venue?.recordType !== 'Venue') return jsonResponse({ ok: false, error: 'not_found' }, 404);
  const result = await ckModifyRecords({ ...creds, operations: [{ operationType: 'update', record: {
    recordName: venueId, recordType: 'Venue', recordChangeTag: venue.recordChangeTag,
    fields: { location: { value: { latitude, longitude }, type: 'LOCATION' } }
  } }] });
  if (!result.records?.[0] || result.records[0].serverErrorCode) throw new Error('venue_save_failed');
  return jsonResponse({ ok: true });
}
