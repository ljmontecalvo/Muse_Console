import test from 'node:test';
import assert from 'node:assert/strict';
import { testDB, environment, cloudKitMock, record, request } from './helpers.js';
import { awardTrophies } from '../functions/_shared/trophyLedger.js';
import { onRequestPost as complete } from '../functions/api/giftshop/redemption/complete.js';
import { onRequestPost as cancel } from '../functions/api/giftshop/redemption/cancel.js';
import { onRequestPost as status } from '../functions/api/giftshop/redemption/status.js';
import { deriveCode, windowIndexForTime } from '../functions/_shared/redemptionCode.js';
import { issueVisitorSessionToken } from '../functions/_shared/visitorSession.js';

function seed(db, id='r1', visitor='v1', item='i1') {
  db.sql.prepare('INSERT OR IGNORE INTO balances VALUES(?,?,?)').run(visitor,'venue',20);
  db.sql.prepare('INSERT OR IGNORE INTO item_counts VALUES(?,0)').run(item);
  db.sql.prepare('INSERT OR IGNORE INTO visitor_item_counts VALUES(?,?,0)').run(visitor,item);
  db.sql.prepare('INSERT INTO redemptions(id,visitor_id,venue_id,item_id,item_name,item_kind,cost,code_secret,expires_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(id,visitor,'venue',item,'Toy','item',20,`secret-${id}`,Math.floor(Date.now()/1000)+300);
}
function finish(db,id,total=0,personal=0) {
  return db.sql.prepare("UPDATE redemptions SET status='completed',total_limit=?,visitor_limit=? WHERE id=? AND status='pending'").run(total,personal,id);
}
test('award retries credit once and return the receipt, even with a new claimed amount', async () => {
  const db=testDB(); db.sql.exec("INSERT INTO balances VALUES('visitor','venue',10)");
  const input={visitorId:'visitor',venueId:'venue',amount:20,huntId:'hunt',attemptId:'attempt'};
  const results=await Promise.all([awardTrophies(db,{},input),awardTrophies(db,{}, {...input,amount:200})]);
  assert.deepEqual(results.map(r=>r.awarded),[20,20]);
  assert.equal(db.sql.prepare('SELECT balance FROM balances').get().balance,30);
  assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM awards').get().n,1);
});
test('an interrupted award rolls back its receipt and can be retried', async () => {
  const db=testDB(); db.sql.exec("INSERT INTO balances VALUES('v','venue',0); CREATE TRIGGER fail_balance BEFORE UPDATE ON balances BEGIN SELECT RAISE(ABORT,'injected failure'); END;");
  const input={visitorId:'v',venueId:'venue',amount:20,huntId:'h',attemptId:'a'};
  await assert.rejects(awardTrophies(db,{},input),/injected failure/);
  assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM awards').get().n,0);
  db.sql.exec('DROP TRIGGER fail_balance');
  assert.equal((await awardTrophies(db,{},input)).balance,20);
});
test('one completion cannot be claimed by two visitor accounts', async () => {
  const db=testDB(); db.sql.exec("INSERT INTO balances VALUES('one','venue',0),('two','venue',0)");
  const input={visitorId:'one',venueId:'venue',amount:20,huntId:'h',attemptId:'a'};
  await awardTrophies(db,{},input);
  assert.equal((await awardTrophies(db,{}, {...input,visitorId:'two'})).error,'already_claimed');
  assert.equal(db.sql.prepare("SELECT balance FROM balances WHERE visitor_id='two'").get().balance,0);
});
test('redemption debit, status, and counters roll back together on any write failure', () => {
  const db=testDB(); seed(db);
  db.sql.exec("CREATE TRIGGER fail_count BEFORE UPDATE ON visitor_item_counts BEGIN SELECT RAISE(ABORT,'injected count failure'); END;");
  assert.throws(()=>finish(db,'r1'),/injected count failure/);
  assert.equal(db.sql.prepare('SELECT status FROM redemptions').get().status,'pending');
  assert.equal(db.sql.prepare('SELECT balance FROM balances').get().balance,20);
  assert.equal(db.sql.prepare('SELECT count FROM item_counts').get().count,0);
  db.sql.exec('DROP TRIGGER fail_count'); finish(db,'r1'); finish(db,'r1');
  assert.equal(db.sql.prepare('SELECT balance FROM balances').get().balance,0);
  assert.equal(db.sql.prepare('SELECT count FROM item_counts').get().count,1);
});
test('two visitors who saw the last item cannot both complete', () => {
  const db=testDB(); seed(db,'r1','v1'); seed(db,'r2','v2');
  finish(db,'r1',1);
  assert.throws(()=>finish(db,'r2',1),/item_limit_reached/);
  assert.equal(db.sql.prepare("SELECT balance FROM balances WHERE visitor_id='v2'").get().balance,20);
});
test('per-visitor limit is enforced inside the commit, not just at preflight', () => {
  const db=testDB(); seed(db,'r1'); seed(db,'r2');
  db.sql.exec('UPDATE balances SET balance=100');
  finish(db,'r1',0,1); assert.throws(()=>finish(db,'r2',0,1),/visitor_limit_reached/);
  assert.equal(db.sql.prepare('SELECT balance FROM balances').get().balance,80);
});
test('cancellation and insufficient funds never change counters', () => {
  const db=testDB(); seed(db); db.sql.exec("UPDATE redemptions SET status='cancelled'");
  finish(db,'r1'); assert.equal(db.sql.prepare('SELECT balance FROM balances').get().balance,20);
  seed(db,'r2'); db.sql.exec('UPDATE balances SET balance=0');
  assert.throws(()=>finish(db,'r2'),/insufficient_balance/);
  assert.equal(db.sql.prepare('SELECT count FROM item_counts').get().count,0);
});
test('expired redemption is rejected at commit time', () => {
  const db=testDB(); seed(db); db.sql.exec('UPDATE redemptions SET expires_at=0');
  assert.throws(()=>finish(db,'r1'),/expired/);
});
test('staff retry after a lost response succeeds with zero remaining balance', async t => {
  const env=await environment(); seed(env.MUSE_COMMERCE);
  cloudKitMock(t,{
    venue:record('venue','Venue',{managers:['staff'],giftShopEnabled:1}),
    staff:record('staff','Users',{isMuseAdministrator:0}),
    i1:record('i1','GiftShopItem',{isActive:1,totalRedemptionLimit:1,perVisitorRedemptionLimit:1}),
    v1:record('v1','Visitor',{displayName:'Visitor'}),
  });
  const code=await deriveCode('secret-r1',windowIndexForTime(Math.floor(Date.now()/1000)));
  const invoke=()=>complete({env,request:request('giftshop/redemption/complete',{callerUserRecordName:'staff',venueId:'venue',code})});
  const first=await invoke(); assert.equal(first.status,200);
  const retry=await invoke(); assert.equal(retry.status,200);
  assert.equal((await retry.json()).remainingBalance,0);
  assert.equal(env.MUSE_COMMERCE.sql.prepare('SELECT count FROM item_counts').get().count,1);
});
test('visitor cannot cancel another account, and cannot cancel a committed redemption', async () => {
  const env=await environment(); seed(env.MUSE_COMMERCE);
  const wrong=await issueVisitorSessionToken('other',env);
  assert.equal((await cancel({env,request:request('giftshop/redemption/cancel',{redemptionId:'r1'},wrong)})).status,404);
  finish(env.MUSE_COMMERCE,'r1');
  const token=await issueVisitorSessionToken('v1',env);
  assert.equal((await cancel({env,request:request('giftshop/redemption/cancel',{redemptionId:'r1'},token)})).status,409);
  assert.equal((await (await status({env,request:request('giftshop/redemption/status',{redemptionId:'r1'},token)})).json()).status,'completed');
});
