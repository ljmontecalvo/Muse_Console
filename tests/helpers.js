import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
export function testDB() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../migrations/0001_commerce.sql', import.meta.url), 'utf8'));
  return {
    sql,
    prepare(query) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async first() { return sql.prepare(query).get(...args) ?? null; },
        async all() { return { results: sql.prepare(query).all(...args) }; },
        async run() { const result = sql.prepare(query).run(...args); return { success: true, meta: { changes: Number(result.changes) } }; },
      };
    },
  };
}
export async function environment(db = testDB()) {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign','verify']);
  return { MUSE_COMMERCE: db, CLOUDKIT_S2S_KEY_ID: 'test',
    CLOUDKIT_S2S_PRIVATE_KEY_PKCS8_B64: Buffer.from(await crypto.subtle.exportKey('pkcs8', keys.privateKey)).toString('base64'),
    CONSOLE_SESSION_SECRET: 'test-console-secret', HUNT_PROGRESS_SECRET: 'test-progress-secret', VISITOR_SESSION_JWT_SECRET: 'test-visitor-secret' };
}
export const record = (recordName, recordType, fields, other = {}) => ({ recordName, recordType,
  fields: Object.fromEntries(Object.entries(fields).map(([k,v]) => [k,{value:v}])), ...other });
export function cloudKitMock(t, records, queryHandler) {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = JSON.parse(options.body);
    if (String(url).endsWith('/records/lookup')) return Response.json({ records: body.records.map(r => records[r.recordName] ?? { recordName: r.recordName, serverErrorCode: 'NOT_FOUND' }) });
    if (String(url).endsWith('/records/query') && queryHandler) return Response.json(await queryHandler(body));
    throw new Error(`Unexpected network call: ${url}`);
  });
}
export function request(path, body, token) {
  return new Request(`https://console.example/api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
}
