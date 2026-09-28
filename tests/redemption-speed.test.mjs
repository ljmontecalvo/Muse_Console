import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function load(path, dependencies, exported) {
  const source = readFileSync(new URL('../' + path, import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '').replace(/export /g, '');
  return new Function(...Object.keys(dependencies), source + `\nreturn { ${exported} };`)(...Object.values(dependencies));
}
const balance = (amount, tag) => ({recordName:'balance_v_venue', recordChangeTag:tag, fields:{balance:{value:amount}}});

test('debit reuses preflight balance; a conflict refetches before retrying', async () => {
  let reads = 0;
  const writes = [];
  const api = load('functions/_shared/trophyLedger.js', {
    ckFetchRecord: async () => { reads++; return balance(9, 'fresh'); },
    ckModifyRecords: async ({operations}) => {
      const {record} = operations[0];
      if (record.recordType === 'TrophyTransaction') return {records:[record]};
      writes.push(record);
      return {records:[writes.length === 1 ? {serverErrorCode:'CONFLICT'} : record]};
    },
  }, 'deductTrophies');
  const result = await api.deductTrophies({}, {visitorId:'v', venueId:'venue', amount:2,
    redemptionId:'r', idempotencyKey:'r', balanceRecord:balance(10, 'old')});
  assert.equal(reads, 1);
  assert.equal(writes[0].recordChangeTag, 'old');
  assert.equal(writes[1].recordChangeTag, 'fresh');
  assert.equal(result.balance, 7);
});

test('counter reuses item snapshot and refetches after a conflict', async () => {
  let itemReads = 0;
  const writes = [];
  const item = (count, tag) => ({recordName:'item',recordChangeTag:tag,fields:{totalRedeemedCount:{value:count}}});
  const api = load('functions/_shared/redemptionLimits.js', {
    ckFetchRecord: async ({recordName}) => {
      if (recordName === 'item') { itemReads++; return item(4, 'fresh'); }
      return null;
    },
    ckModifyRecords: async ({operations}) => {
      const {record} = operations[0];
      if (record.recordName !== 'item') return {records:[record]};
      writes.push(record);
      return {records:[writes.length === 1 ? {serverErrorCode:'CONFLICT'} : record]};
    },
  }, 'recordRedemptionForLimits');
  await api.recordRedemptionForLimits({}, 'item', 'v', item(3, 'old'));
  assert.equal(itemReads, 1);
  assert.equal(writes[1].recordChangeTag, 'fresh');
  assert.equal(writes[1].fields.totalRedeemedCount.value, 5);
});

test('completion overlaps independent reads and waits for required writes', async () => {
  const events = [];
  const pendingReads = new Map();
  const savedBalance = balance(10, 'b');
  const item = {recordName:'item',fields:{}};
  const redemption = {recordName:'r',recordChangeTag:'r1',fields:{
    expiresAt:{value:Date.now()/1000+300}, codeSecret:{value:'secret'},
    visitorReference:{value:{recordName:'v'}}, itemReference:{value:{recordName:'item'}},
    itemTrophyCostSnapshot:{value:2}, itemNameSnapshot:{value:'Mug'},
  }};
  let releaseSave;
  const saved = new Promise(resolve => { releaseSave = resolve; });
  const api = load('functions/api/giftshop/redemption/complete.js', {
    ckFetchRecord: ({recordName}) => { events.push('read:'+recordName); return new Promise((resolve,reject) => pendingReads.set(recordName,{resolve,reject})); },
    ckQuery: async () => [redemption], getS2SCreds: async () => ({}),
    authorizeVenueOrAdmin: async () => true,
    deriveCode: async () => 'ABCDE', windowIndexForTime: () => 1,
    checkRedemptionLimits: async () => { events.push('limits'); return {ok:true}; },
    deductTrophies: async (_, args) => { assert.equal(args.balanceRecord,savedBalance); events.push('debit'); return {ok:true,balance:8}; },
    recordRedemptionForLimits: async (_, i, v, snapshot) => { assert.equal(snapshot,item); events.push('counters'); },
    ckModifyRecords: async () => { events.push('save'); await saved; return {records:[redemption]}; },
    jsonResponse: (body,status=200) => ({body,status}),
  }, 'onRequestPost');
  let done = false;
  const response = api.onRequestPost({request:{json:async()=>({callerUserRecordName:'staff',venueId:'venue',code:'ABCDE'})},
    env:{CLOUDKIT_S2S_PRIVATE_KEY_PKCS8_B64:'test',CLOUDKIT_S2S_KEY_ID:'test'}}).then(r => {done=true; return r;});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(pendingReads.size,3, 'all independent reads started before any finished');
  pendingReads.get('balance_v_venue').resolve(savedBalance);
  pendingReads.get('item').resolve(item);
  pendingReads.get('v').reject(new Error('optional profile unavailable'));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(done,false,'must wait for completion write');
  assert.deepEqual(events.slice(3),['limits','debit','counters','save']);
  releaseSave();
  const result = await response;
  assert.equal(result.status,200);
  assert.equal(result.body.remainingBalance,8);
  assert.equal(result.body.visitorDisplayName,'');
});
