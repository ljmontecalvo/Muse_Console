// Authorization checks for the write endpoints. None of this verifies WHO is calling —
// see the plan's "residual risk" note — it only checks whether the claimed
// userRecordName is a manager of the relevant venue, or an admin, before a write
// proceeds. `creds` is the {privateKey, keyId, base} shape from getS2SCreds(env).

import { ckFetchRecord } from './cloudkit.js';

export async function resolveHuntVenue(creds, huntId) {
  const hunt = await ckFetchRecord({ ...creds, recordName: huntId });
  if (!hunt) return null;
  const ref = hunt.fields.venueReference && hunt.fields.venueReference.value;
  return ref ? ref.recordName : null;
}

export async function isVenueManager(creds, venueId, userRecordName) {
  if (!venueId || !userRecordName) return false;
  const venue = await ckFetchRecord({ ...creds, recordName: venueId });
  if (!venue) return false;
  const managers = (venue.fields.managers && venue.fields.managers.value) || [];
  return managers.includes(userRecordName);
}

// Reads the built-in Users record type's isMuseAdministrator flag — the same check
// app.js's own CloudKitStore.checkIsAdmin performs client-side, done here server-side
// against the S2S-readable copy so it can't be spoofed by skipping the client check.
export async function isAdmin(creds, userRecordName) {
  if (!userRecordName) return false;
  const user = await ckFetchRecord({ ...creds, recordName: userRecordName });
  if (!user) return false;
  const val = user.fields.isMuseAdministrator && user.fields.isMuseAdministrator.value;
  return val === 1;
}

export async function authorizeVenueOrAdmin(creds, venueId, userRecordName) {
  if (!venueId || !userRecordName) return false;
  const [manager, admin] = await Promise.all([
    isVenueManager(creds, venueId, userRecordName),
    isAdmin(creds, userRecordName),
  ]);
  return manager || admin;
}
