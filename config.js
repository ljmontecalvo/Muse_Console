/* ---------------------------------------------------------------
   Muse Console — CloudKit configuration

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
------------------------------------------------------------------ */

const CLOUDKIT_CONFIG = {
  containerIdentifier: 'iCloud.com.MuseApplications.Muse',
  apiToken: '02c63961ddac3b3f0eaa070047dcc7794bec29a9cf4a36268dcc8e5aa063336d', // <-- paste your Development Client API Token here
  environment: 'development',
};

// Where "Request Tag" emails go — you, since physical NFC tags have to be
// manufactured and shipped to a venue before a clue's tag can go live.
const TAG_REQUEST_EMAIL = 'landonjmontecalvo@gmail.com';
