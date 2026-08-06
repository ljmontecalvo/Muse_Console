// Serves config.js dynamically instead of as a static file. Cloudflare Pages Functions
// take precedence over static assets at the same path, so this replaces the old
// approach entirely on the deployed site — the CloudKit client API token now lives in
// exactly one place (Settings -> Environment variables -> CLOUDKIT_API_TOKEN)
// instead of a hardcoded value in a file that can silently go stale. config.js itself
// is (and stays) gitignored for local dev — a plain static file server for local
// testing never executes this Function, so nothing about the existing mock-mode
// workflow changes.
//
// CLOUDKIT_ENVIRONMENT is the same env var functions/_shared/cloudkit.js already reads
// for the S2S backend — reused here so the client and backend always target the same
// CloudKit environment (both development or both production), never a mismatched pair.
//
// Statistics screen needs a new CloudKit record type, `HuntEvent`, added by hand in
// Dashboard (Development): fields `eventType` (String), `huntReference` (Reference ->
// Hunt, action None), `venueReference` (Reference -> Venue, action None), `sessionId`
// (String). Queryable indexes on eventType, venueReference, and sessionId (the backend
// filters on all three — see functions/api/events/log.js and functions/api/stats/
// summary.js). Security Roles -> HuntEvent -> World: no access, Authenticated: no
// access — writes/reads only ever go through the S2S-signed backend endpoints, same
// posture as ClueTag.
//
// Trophy / gift-shop commerce feature needs the following, all added by hand in
// Dashboard (Development):
//
// New fields on existing types:
//   - Venue.giftShopEnabled (Int64, 0/1) — same read posture as Venue's other fields;
//     write only via functions/api/venues/set-giftshop-enabled.js.
//   - Hunt.trophies (Int64, default 0) — same read posture as Hunt's other fields;
//     write only via functions/api/hunts/save.js.
//
// New record types:
//   - GiftShopItem: venueReference (Reference -> Venue, action None), name (String),
//     description (String, optional), trophyCost (Int64), kind (String: "item" or
//     "discount" — free-form metadata, not enforced, so a third kind can be added later
//     without a schema change), isActive (Int64, 0/1), sortOrder (Int64). Same read
//     posture as Hunt/Venue (both iOS and the console read the active catalog directly);
//     writes only via functions/api/giftshop/items/*.js. Queryable index on
//     venueReference.
//   - Visitor: appleUserID (String), displayName (String, optional), email (String,
//     optional). Security Roles -> World: no access, Authenticated: no access — S2S
//     only, same posture as ClueTag/HuntEvent. recordName convention:
//     `visitor_<appleUserID>`. Queryable index on appleUserID.
//   - VisitorTrophyBalance: visitorReference (Reference -> Visitor, action None),
//     venueReference (Reference -> Venue, action None), balance (Int64). S2S only.
//     recordName convention: `balance_<visitorId>_<venueId>`.
//   - TrophyTransaction: visitorReference (Reference -> Visitor, action None),
//     venueReference (Reference -> Venue, action None), type (String:
//     "award_hunt_completion" | "redeem_item" | "admin_adjustment"), amount (Int64,
//     signed), huntReference (Reference -> Hunt, action None, optional), redemptionReference
//     (Reference -> Redemption, action None, optional), idempotencyKey (String). S2S
//     only, append-only ledger — this is the dedup key checked before every trophy
//     award/deduction (see functions/_shared/trophyLedger.js). Queryable index on
//     idempotencyKey.
//   - Redemption: visitorReference (Reference -> Visitor, action None), venueReference
//     (Reference -> Venue, action None), itemReference (Reference -> GiftShopItem,
//     action None), itemNameSnapshot (String), itemKindSnapshot (String),
//     itemTrophyCostSnapshot (Int64), status (String: "pending" | "completed" |
//     "expired" | "cancelled"), codeSecret (String), expiresAt (Int64, epoch seconds),
//     completedAt (Int64, epoch seconds, optional), redeemedByStaffUserRecordName
//     (String, optional). S2S only — never fetched directly by either client. Queryable
//     indexes on venueReference and status.

export async function onRequestGet({ env }) {
  if (!env.CLOUDKIT_API_TOKEN) {
    console.error('functions/config.js: missing CLOUDKIT_API_TOKEN env var');
  }

  const body = `const CLOUDKIT_CONFIG = {
  containerIdentifier: 'iCloud.com.MuseApplications.Muse',
  apiToken: ${JSON.stringify(env.CLOUDKIT_API_TOKEN || '')},
  environment: ${JSON.stringify(env.CLOUDKIT_ENVIRONMENT || 'development')},
};

const TAG_REQUEST_EMAIL = 'tech@muse-apps.com';
`;

  return new Response(body, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
