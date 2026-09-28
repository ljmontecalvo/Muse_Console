# NFC tag security fix — manual setup

Code changes (this repo + the iOS app) are done. These steps have to be done by hand
in Apple's CloudKit Dashboard and Cloudflare's dashboard — no CLI/API access exists
for either from here.

**Status as of 2026-07-28: steps 1–3 below are already done in the Dashboard** (verified
live — `ClueTag` exists, roles are configured correctly, the `TagValidator` S2S key is
created and its public key matches the one generated locally). Field name confirmed
live as `nfcTagID` (matches the code as originally written — an earlier check briefly
saw `nfcID` before this field was renamed back). Steps 4–7 are what's left.

## 1. CloudKit Dashboard — new `ClueTag` record type — DONE

Dashboard → your container (`iCloud.com.MuseApplications.Muse`) → **Schema → Record Types → New Type** → `ClueTag`

Fields:
- `nfcTagID` — String, Queryable ✓ (confirmed).
- `clueReference` — Reference (action: None), target type `Clue` (confirmed).

Security Roles for `ClueTag` (Schema → Security Roles, or the per-type Security tab):
- `World` — no access (confirmed — not listed under `_world` at all).
- `Authenticated` (`_icloud`) — **Write** only (Create + Update). No Read (confirmed). (This matches today's trust level for `Clue`/`Hunt` — any signed-in Apple ID can write. That's a separate, already-flagged issue, not addressed by this fix.)

`Clue`'s existing fields and roles are untouched, as intended (its old `nfcTagID` field is still there — that's expected until step 5's scrub).

## 2. Manager access role — DONE (existing "Museum Managers" role reused)

You already had a custom role called **Museum Managers** (used for `Clue`/`Hunt`/`Venue` too) —
`ClueTag` was added to it with **Read only** (Create/Write unchecked, confirmed). That's
exactly the `VenueManagers` role this guide originally described; no need for a second
role with the same purpose.

Membership: your own account (`_4c82e7150cb1a4c41174dff30c1c134e`) is already in this
role. For any other manager, once they've signed in at least once (which creates their
Users record): Dashboard → **Data → query the `Users` record type** → click their record
→ **Security Roles** section → check `Museum Managers`.

## 3. Server-to-Server key — DONE

A keypair was generated locally (never committed, never printed to any log):
```
/private/tmp/claude-501/-Users-ljmon-Desktop-Muse-WebConsole/abeb37be-df00-410e-bd73-1d7555ecb6db/scratchpad/cloudkit-s2s-key/
  muse_s2s_public.pem              <- already uploaded to the Dashboard
  muse_s2s_private_pkcs8.b64       <- this becomes a Cloudflare secret (below)
  muse_s2s_private.pem             <- delete once step 4 is done; only needed for the conversion already done
  muse_s2s_private_pkcs8.der       <- delete once step 4 is done
```
This directory is temporary/session-scoped — copy what you need out of it before it's cleaned up.

Confirmed live in Dashboard → **API Access → Server-to-Server Keys**: a key named
`TagValidator` exists, and its stored public key was verified (exact string match, not
eyeballed) against `muse_s2s_public.pem` above — they're the same key pair, so the
private key you already have is the right one.

**Key ID: `b6de336a6a52b0816040fbdeaf0b78ccd5c015af924901830aabab44baac9dc6`** — this is
the value for the `CLOUDKIT_S2S_KEY_ID` Cloudflare secret in step 4. (Key IDs aren't
secret — they're sent as a plaintext header on every request, same idea as a username.)

One correction from the original draft of this doc: CloudKit server-to-server keys don't
get their own separately-assigned role. They **inherit the privileges of whichever
account created them** in the Dashboard. Since you created this key while signed in as
your own account, and your account is already in **Museum Managers** (which has Read on
`ClueTag` per step 2), the key should already be able to read `ClueTag` — no extra
"TagValidator role" needs to be created. This is exactly what step 4's `curl` smoke test
will confirm empirically.

## 4. Cloudflare Pages secrets

In the WebConsole Cloudflare Pages project (same place `CLOUDKIT_API_TOKEN` already lives):
```
wrangler pages secret put CLOUDKIT_S2S_KEY_ID
wrangler pages secret put CLOUDKIT_S2S_PRIVATE_KEY_PKCS8_B64
```
- `CLOUDKIT_S2S_KEY_ID` = the Key ID from step 3.
- `CLOUDKIT_S2S_PRIVATE_KEY_PKCS8_B64` = the single-line contents of `muse_s2s_private_pkcs8.b64`.

Deploy, then smoke-test the new endpoint directly before touching anything else:
```bash
curl -s -X POST https://console.muse-apps.com/api/validate-tag \
  -H "Content-Type: application/json" \
  -d '{"nfcTagID":"<a real existing tag code>","latitude":<venue lat>,"longitude":<venue lon>,"horizontalAccuracy":10}'
```
Expect `{"ok":true,"clueId":"..."}`. If you get a 401/403 from Apple's side (visible if you temporarily add logging, or via CloudKit Dashboard's request logs), the most likely cause is the ECDSA raw→DER signature conversion — see the comment in `functions/api/validate-tag.js`.

Also test the "should fail" cases:
```bash
# far from the venue -> 403 too_far
curl -s -X POST https://console.muse-apps.com/api/validate-tag -H "Content-Type: application/json" \
  -d '{"nfcTagID":"<real tag>","latitude":0,"longitude":0,"horizontalAccuracy":10}'
# bogus tag -> 404 no_match
curl -s -X POST https://console.muse-apps.com/api/validate-tag -H "Content-Type: application/json" \
  -d '{"nfcTagID":"NOTAREALTAG","latitude":<venue lat>,"longitude":<venue lon>,"horizontalAccuracy":10}'
```

## 5. Backfill existing test data + scrub the old field

For each existing `Clue` record (there are only 3 right now — "Kitchen Island", "Piano", "Sofa"):
1. Create a `ClueTag` record with `recordName` = `cluetag_<that Clue's recordName>`, `nfcTagID` = the clue's current tag value (uppercase), `clueReference` → that clue.
2. **Clear the `nfcTagID` field value on the `Clue` record itself.** This is the step that actually closes the hole for data that already exists — splitting the schema alone doesn't retroactively scrub old records.

Only do this after step 4's `curl` tests pass, so you're not scrubbing data you can't yet re-validate.

Once done and confirmed nothing depends on it, delete the `nfcTagID` field definition from `Clue`'s schema entirely so it can't be accidentally repopulated.

## 6. Verify the hole is actually closed

Re-run the original proof-of-concept, unauthenticated, no S2S key:
```bash
curl -s -X POST "https://api.apple-cloudkit.com/database/1/iCloud.com.MuseApplications.Muse/development/public/records/query?ckAPIToken=<the public client token from /config.js>" \
  -H "Content-Type: application/json" -H "Origin: https://console.muse-apps.com" \
  -d '{"query":{"recordType":"ClueTag"}}'
```
Expect `ACCESS_DENIED`. And re-query `Clue` the same way — the `nfcTagID` field should no longer appear in the response at all once step 5 runs.

## 7. Ship the apps

- Deploy the WebConsole (`app.js` changes) — existing hunts should still show tag codes for managers in `Museum Managers`, and "Unavailable — ask an admin for Museum Managers access" for anyone else.
- Build and ship the iOS app update. Scanning now requires Location permission; the scan button shows "Getting your location…" until a fresh GPS fix lands, and the server rejects scans reported too far from the clue's venue.
