import { consoleIdentity } from '../_shared/consoleSession.js';
import { jsonResponse } from '../_shared/cloudkit.js';

// New API routes are protected by default; public visitor routes authenticate themselves.
const publicRoutes = new Set([
  'console/challenge', 'console/session', 'visitor/signin', 'visitor/balances',
  'hunts/start', 'validate-tag', 'events/log', 'giftshop/award-trophies', 'giftshop/counts',
  'giftshop/redemption/start', 'giftshop/redemption/status', 'giftshop/redemption/cancel',
]);
export async function onRequest(context) {
  try {
    const route = decodeURIComponent(new URL(context.request.url).pathname).replace(/^\/api\//, '').replace(/\/$/, '');
    if (!publicRoutes.has(route)) {
      const userRecordName = await consoleIdentity(context.request, context.env);
      if (!userRecordName) return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
      const body = await context.request.json();
      // Every existing handler receives the authenticated identity. Ignore spoofed body IDs.
      const request = new Request(context.request, { body: JSON.stringify({ ...body, callerUserRecordName: userRecordName }) });
      return await context.next(request);
    }
    return await context.next();
  } catch (error) {
    if (error instanceof SyntaxError) return jsonResponse({ ok: false, error: 'bad_request' }, 400);
    console.error('api request failed', error);
    return jsonResponse({ ok: false, error: 'request_failed' }, 503);
  }
}
