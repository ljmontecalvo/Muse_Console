import test from 'node:test';
import assert from 'node:assert/strict';
import { environment, cloudKitMock, record, request } from './helpers.js';
import { signToken, verifyToken } from '../functions/_shared/signedToken.js';
import { onRequest as middleware } from '../functions/api/_middleware.js';
import { onRequestPost as challenge } from '../functions/api/console/challenge.js';
import { onRequestPost as session } from '../functions/api/console/session.js';
import { onRequestPost as start } from '../functions/api/hunts/start.js';
import { onRequestPost as validate } from '../functions/api/validate-tag.js';
import { onRequestPost as award } from '../functions/api/giftshop/award-trophies.js';
import { issueVisitorSessionToken } from '../functions/_shared/visitorSession.js';

test('console endpoints reject a claimed admin ID without authentication', async () => {
  const env=await environment(); let called=false;
  const response=await middleware({env,request:request('hunts/delete',{callerUserRecordName:'admin'}),next:()=>{called=true;}});
  assert.equal(response.status,401); assert.equal(called,false);
});
test('middleware replaces a forged body identity with the signed identity', async () => {
  const env=await environment(); const token=await signToken({userRecordName:'manager'},'console-session',env.CONSOLE_SESSION_SECRET,60);
  const response=await middleware({env,request:request('hunts/save',{callerUserRecordName:'admin',title:'hello'},token),next:async req=>Response.json(await req.json())});
  assert.equal((await response.json()).callerUserRecordName,'manager');
});
test('tokens cannot be tampered with, expired, or substituted across purposes', async () => {
  const secret='secret'; const token=await signToken({userRecordName:'admin'},'console-challenge',secret,60);
  assert.equal(await verifyToken(token,'console-session',secret),null);
  assert.equal(await verifyToken(token+'x','console-challenge',secret),null);
  assert.equal(await verifyToken(await signToken({},'console-session',secret,-1),'console-session',secret),null);
});
test('console session identity comes from Apple creator metadata, not record fields', async t => {
  const env=await environment(); const ch=await (await challenge({env})).json();
  const records={ [ch.recordName]:record(ch.recordName,'ConsoleAuthProof',{proofHash:ch.proofHash,userRecordName:'admin'},
    {created:{timestamp:Date.now(),userRecordName:'actual-user'}}) };
  cloudKitMock(t,records);
  const result=await (await session({env,request:request('console/session',{challenge:ch.challenge,callerUserRecordName:'admin'})})).json();
  assert.equal(result.userRecordName,'actual-user');
  assert.equal((await verifyToken(result.sessionToken,'console-session',env.CONSOLE_SESSION_SECRET)).userRecordName,'actual-user');
  records[ch.recordName].fields.proofHash.value='wrong';
  assert.equal((await session({env,request:request('console/session',{challenge:ch.challenge})})).status,401);
});
test('trophy claim rejects arbitrary session IDs and unsigned completion data', async () => {
  const env=await environment(); const token=await issueVisitorSessionToken('v',env);
  const response=await award({env,request:request('giftshop/award-trophies',{huntId:'h',sessionId:'made-up',completionProof:'fake'},token)});
  assert.equal(response.status,403);
});
test('ordered valid scans are required; proof works once, including anonymous play then sign-in', async t => {
  const env=await environment();
  const records={
    h:record('h','Hunt',{venueReference:{recordName:'venue'},trophies:20}),
    venue:record('venue','Venue',{location:{latitude:43,longitude:-77}}),
    c1:record('c1','Clue',{huntReference:{recordName:'h'},order:0}),
    c2:record('c2','Clue',{huntReference:{recordName:'h'},order:1}),
    t1:record('t1','ClueTag',{clueReference:{recordName:'c1'},nfcTagID:'TAG1'}),
    t2:record('t2','ClueTag',{clueReference:{recordName:'c2'},nfcTagID:'TAG2'}),
  };
  cloudKitMock(t,records,({query})=>({records:query.recordType==='Clue' ? [records.c2,records.c1] :
    [records.t1,records.t2].filter(r=>r.fields.nfcTagID.value===query.filterBy[0].fieldValue.value)}));
  const attempt=await (await start({env,request:request('hunts/start',{huntId:'h'})})).json();
  const visitorToken=await issueVisitorSessionToken('v',env);
  const claim=proof=>award({env,request:request('giftshop/award-trophies',{huntId:'h',completionProof:proof},visitorToken)});
  assert.equal((await claim(attempt.progressToken)).status,403);
  const scan=(tag,proof,lat=43)=>validate({env,request:request('validate-tag',{nfcTagID:tag,progressToken:proof,latitude:lat,longitude:-77,horizontalAccuracy:10})});
  assert.equal((await scan('TAG2',attempt.progressToken)).status,404);
  assert.equal((await scan('TAG1',attempt.progressToken,0)).status,403);
  const first=await (await scan('TAG1',attempt.progressToken)).json();
  assert.equal((await claim(first.progressToken)).status,403);
  const last=await (await scan('TAG2',first.progressToken)).json();
  const result=await (await claim(last.progressToken)).json(); assert.equal(result.awarded,20);
  assert.equal((await (await claim(last.progressToken)).json()).awarded,20);
  assert.equal(env.MUSE_COMMERCE.sql.prepare('SELECT balance FROM balances').get().balance,20);
});
