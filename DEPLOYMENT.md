# Muse reliability update — deployment and verification

The iOS and console changes must ship together. They are local code changes; no CloudKit schema, Cloudflare binding, live data, or deployed app has been changed by this work.

## Required configuration

1. Create a Cloudflare D1 database and bind it to this Pages project as **MUSE_COMMERCE**, separately for development/preview and production. Run `migrations/0001_commerce.sql` against each empty database using the D1 dashboard SQL console or `wrangler d1 execute <database-name> --remote --file=migrations/0001_commerce.sql`. Apply it once; do not run it against an existing initialized database. The schema contains the transaction triggers, not just tables.
2. Add two independent, randomly generated secrets of at least 32 bytes: **CONSOLE_SESSION_SECRET** and **HUNT_PROGRESS_SECRET**. Keep **VISITOR_SESSION_JWT_SECRET**, **CLOUDKIT_S2S_KEY_ID**, and **CLOUDKIT_S2S_PRIVATE_KEY_PKCS8_B64** configured. Set **APPLE_SIGNIN_AUDIENCE** to `com.MuseApplications.Muse`; sign-in now fails closed when it is absent. Do not put signing secrets in `config.js`.
3. In the matching CloudKit environment, create **ConsoleAuthProof**, with a String field **proofHash**. Permit authenticated users to CREATE, but not UPDATE other users' records. Give the S2S account READ. World must have no read or write access. A creator-only read role is fine; all-user read is unnecessary. No custom index is needed: verification looks up an unguessable record name. Proof records can be deleted after their two-minute lifetime by an administrator; they contain hashes, not session tokens.
4. Confirm privileged CloudKit roles: ordinary authenticated accounts must not directly write Hunt, Clue, ClueTag, FolderRegistry, GiftShopItem, AppUser, or legacy reward records. The S2S identity needs their appropriate permissions. Venue creation/manager assignment still use the authenticated CloudKit SDK and require the existing administrator-only Venue write role. ClueTag reads still use the existing Museum Managers role. Application-level authentication cannot compensate for independently public CloudKit write permissions.
5. Confirm existing query indexes, including **GiftShopItem.isActive** and **venueReference**, **Clue.huntReference**, **Clue.order** (sortable), and **VisitorTrophyBalance.visitorReference**. Both CloudKit clients and the backend must target the same environment.

## Cutover and existing rewards

- Stop the old reward endpoints before accepting traffic on the new version. Disable old deployment/preview URLs that can still write the same CloudKit database. Do not operate old and new commerce implementations concurrently.
- Allow the previous five-minute redemption window to drain while old award/redemption-start endpoints are blocked. Complete or cancel pending redemptions before cutting over. Old CloudKit redemption IDs are deliberately not imported into D1: the new backend cannot safely infer whether an old partially failed redemption already deducted trophies.
- Inspect and reconcile any historic partially applied awards/redemptions before cutover. The new code does not guess whether an old transaction-without-balance-update should be credited.
- Existing CloudKit balances, item totals, and per-visitor counts are imported lazily on first use with INSERT OR IGNORE. Imports cannot overwrite a D1 balance/counter that already exists. CloudKit lookup errors fail the import rather than inventing a zero balance.
- After cutover, **D1 is authoritative** for balances, awards, redemption receipts/status, and redemption counts. The old CloudKit reward records are retained as the migration baseline/history; they are not updated. Both clients obtain current catalog counts from `/api/giftshop/counts`.
- Do not roll back to the old backend after D1 has accepted transactions without a deliberate reverse migration; doing so would restore stale CloudKit balances.
- Old iOS versions cannot claim trophies or validate scans under the new protocol. Release the updated app with this backend change and provide an update requirement for any distributed older builds.

## Behavior changes

- Console sign-in creates a short-lived proof through the user's authenticated CloudKit SDK session. The backend verifies Apple's immutable `created.userRecordName` metadata and the signed challenge, then issues a one-hour console token. Middleware replaces all caller IDs with the verified identity. Requests without that token fail closed. The browser refreshes an expired console token using a new proof.
- Starting a hunt obtains a signed attempt with the ordered clue IDs. Only matching, location-checked scans advance it. A completed proof can be claimed once globally, even across accounts. Guests may still play and sign in afterward. Proofs last 12 hours; copied static tags and client-reported GPS are not physical-device attestation.
- Award insertion and balance credit happen in one SQL statement/trigger transaction. Retry returns the existing committed amount. Redemption status, balance debit, and both limits/counters likewise commit together. A repeat code within its valid window returns the receipt without charging again. Status polling remains available after code expiry.
- Starting a redemption reserves neither balance nor inventory. Limits are enforced again inside the final transaction. Simultaneous attempts cannot exceed those committed limits.
- Pending iOS trophy proofs are saved separately in Keychain and can be retried from Trophies, including after relaunch. Claims started by a signed-in visitor remain associated with that account. Expired proofs cannot create a new award.
- Expired visitor sessions are cleared on 401. A delayed 401 for an old token cannot clear a newer session. Sign Out is available on Trophies.
- Venue creation requires valid coordinates. Venue Settings can repair coordinates on existing venues.
- Query pagination is followed in the iOS client, console, and backend. A failed page is surfaced as an error rather than silently returning partial data.

## Local checks

`npm test` with Node 22.13+ (tested with Node 24) runs the regression suite using Node's SQLite implementation and mocked CloudKit responses. It does not contact live services. Tests cover forged identities, token substitution, scan order, unproven claims, duplicate awards, rollback after an injected write failure, redemption retries, stock/per-visitor limits, cancellation, expiry, migration, and pagination.

`node tests/console-smoke.mjs` runs an optional Playwright/Chromium browser smoke test using mock data only. Install Playwright in your development environment, or point `PLAYWRIGHT_MODULE` to its module and `CHROME_PATH` to a browser executable. It covers coordinate validation, venue creation, hunt editing, statistics, redemption, and themes.

The Swift sources passed syntax parsing. Models, view models, and non-device services also passed macOS SDK type checking with NFC/location test stubs. This is **not an iOS build**: this machine has Command Line Tools but no Xcode/iOS SDK. An Xcode build and device run remain required.

## Device and deployed acceptance checks

- Sign in as a manager and verify allowed/forbidden venues. Verify an unauthenticated POST with a valid manager ID is rejected. Confirm the new proof record's creator metadata in the actual CloudKit environment.
- Create a venue with coordinates, assign a hunt, and confirm the iOS app can load it. Repair a location through Venue Settings.
- Force a hunt-loading network failure, then retry successfully; the error screen should disappear.
- Complete the clue sequence as a guest, sign in, and claim trophies. Retry a lost response and confirm only one award. Interrupt the award, relaunch, and retry through Trophies.
- Expire/revoke a visitor token, verify sign-in reappears, and sign in again.
- With enough balance for exactly one item, redeem and repeat the staff request; the same receipt should return with one debit. With a total limit of one, complete two visitors' pending redemptions concurrently; only one should succeed.
- Disconnect the network during cancellation; the app must not report cancelled until the server confirms it. Complete from staff while the app is cancelling and verify the completed status wins.
- Load more than one CloudKit page of hunts/clues/balances/events and verify full results.

## API references consulted

- [Apple record metadata](https://developer.apple.com/library/archive/documentation/DataManagement/Conceptual/CloudKitWebServicesReference/Types.html)
- [Apple query continuation](https://developer.apple.com/library/archive/documentation/DataManagement/Conceptual/CloudKitWebServicesReference/QueryingRecords.html)
- [Cloudflare Pages middleware API](https://developers.cloudflare.com/pages/functions/api-reference/)
- [Cloudflare D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/)
