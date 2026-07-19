/* ---------------------------------------------------------------
   Muse Console — CloudKit configuration (TEMPLATE)

   Copy this file to config.js (which is gitignored — see .gitignore)
   and fill in your real apiToken there. Never commit config.js itself;
   that's exactly how the previous token ended up in git history.

   Leave apiToken blank to keep running against mock data (useful
   for UI work without touching CloudKit). Fill it in once you've
   done the CloudKit Dashboard setup (see the console's design notes):

     1. Add a `managers` field (List<String>) to the Venue record type.
        Schema is edited directly in Development, so no deploy step
        is needed to use it here.
     2. Grant the Authenticated security role Create/Read/Write on
        the Hunt and Clue record types, in Development (leave World
        as-is so the iOS app's anonymous reads keep working).
     3. API Access -> Development -> create a Client API Token, add
        every origin this console will be served from, and when it
        asks for the auth callback method, pick "Post Message" (see
        chat for why).
     4. Add a `tagStatus` field (String) to the Clue record type, also
        in Development. No Queryable index needed — it's never filtered
        on, just read/written. Existing Clue records without this field
        are treated as "pending" (see recordToClue in app.js).

   Admin feature (isMuseAdministrator on the built-in Users type):
     5. Add a new custom record type `AppUser` with fields `userRecordName`
        (String), `name` (String), and `email` (String). Every sign-in
        upserts one of these — this is the "directory" the admin Users
        page lists, since CloudKit deliberately won't let client code
        query/list every record of its built-in Users type (privacy), only
        fetch one by a recordName you already have. Note the AppUser
        record's own recordName is NOT the person's userRecordName (it's
        `appuser_<userRecordName>`) — recordName has to be unique across
        the whole database, not per type, and that name is already taken
        by their built-in Users record. userRecordName is stored as a
        plain field instead, which is why the field needs to exist.
     6. Security Roles -> AppUser -> grant Authenticated Create + Write
        (same coarse trust-your-team posture as Hunt/Clue — see chat).
     7. Security Roles -> Venue -> create a NEW custom role, e.g. "Muse
        Administrators", grant it Write, and manually add your own user
        record to it (Copy My Manager ID from the console's account menu
        once signed in, then add that ID to the role's member list). Do
        NOT grant Venue write to Authenticated or to Museum Managers —
        that would let any manager add themselves/anyone to any venue.
     8. Security Roles -> Users (the built-in type, now that it has your
        custom isMuseAdministrator field) -> confirm Authenticated has at
        least Read. If admin-status checks fail after sign-in, this is
        the first thing to check in CloudKit Dashboard.
     9. isMuseAdministrator itself is set by you, by hand, by editing a
        specific person's Users record in CloudKit Dashboard's data
        browser — the console only ever reads this flag, it has no UI
        for granting admin status to someone else.
------------------------------------------------------------------ */

const CLOUDKIT_CONFIG = {
  containerIdentifier: 'iCloud.com.MuseApplications.Muse',
  apiToken: '', // <-- paste your Development Client API Token here (local file only, gitignored)
  environment: 'development',
};

// Where "Request Tag" emails go — you, since physical NFC tags have to be
// manufactured and shipped to a venue before a clue's tag can go live.
const TAG_REQUEST_EMAIL = 'tech@muse-apps.com';
