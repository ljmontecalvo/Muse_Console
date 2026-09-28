import test from 'node:test';
import assert from 'node:assert/strict';
import { environment, record, cloudKitMock } from './helpers.js';
import { getS2SCreds, ckQuery, ckFetchRecord } from '../functions/_shared/cloudkit.js';
import { getBalance } from '../functions/_shared/trophyLedger.js';

test('CloudKit queries follow every continuation marker', async t => {
  const creds=await getS2SCreds(await environment()); const markers=[];
  cloudKitMock(t,{},body=>{markers.push(body.continuationMarker); return body.continuationMarker ? {records:[record('second','Hunt',{})]} : {records:[record('first','Hunt',{})],continuationMarker:'next'};});
  assert.deepEqual((await ckQuery({...creds,recordType:'Hunt'})).map(r=>r.recordName),['first','second']);
  assert.deepEqual(markers,[undefined,'next']);
});
test('an error on a later page is not returned as a truncated success', async t => {
  const creds=await getS2SCreds(await environment());
  cloudKitMock(t,{},body=>body.continuationMarker ? {serverErrorCode:'THROTTLED'} : {records:[],continuationMarker:'next'});
  await assert.rejects(ckQuery({...creds,recordType:'Hunt'}),/THROTTLED/);
});
test('permission/network lookup failures are not treated as a missing zero balance', async t => {
  const env=await environment(); const creds=await getS2SCreds(env);
  cloudKitMock(t,{'balance_v_venue':{serverErrorCode:'ACCESS_DENIED'}});
  await assert.rejects(getBalance(env.MUSE_COMMERCE,creds,'v','venue'),/ACCESS_DENIED/);
  assert.equal(env.MUSE_COMMERCE.sql.prepare('SELECT count(*) n FROM balances').get().n,0);
});
test('legacy balance imports once and cannot overwrite new rewards', async t => {
  const env=await environment(); const creds=await getS2SCreds(env);
  const records={'balance_v_venue':record('balance_v_venue','VisitorTrophyBalance',{balance:25})};
  cloudKitMock(t,records);
  assert.equal(await getBalance(env.MUSE_COMMERCE,creds,'v','venue'),25);
  env.MUSE_COMMERCE.sql.exec('UPDATE balances SET balance=45');
  assert.equal(await getBalance(env.MUSE_COMMERCE,creds,'v','venue'),45);
});
