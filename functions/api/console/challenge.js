import { jsonResponse } from '../../_shared/cloudkit.js';
import { signToken, sha256 } from '../../_shared/signedToken.js';
export async function onRequestPost({ env }) {
  const recordName = `console_auth_${crypto.randomUUID()}`;
  const secret = crypto.randomUUID() + crypto.randomUUID();
  const proofHash = await sha256(secret);
  const challenge = await signToken({ recordName, proofHash, secret }, 'console-challenge', env.CONSOLE_SESSION_SECRET, 120);
  return jsonResponse({ ok: true, recordName, proofHash, challenge });
}
