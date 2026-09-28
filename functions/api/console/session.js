import { ckFetchRecord, getS2SCreds, jsonResponse } from '../../_shared/cloudkit.js';
import { signToken, verifyToken } from '../../_shared/signedToken.js';
export async function onRequestPost({ request, env }) {
  const { challenge } = await request.json();
  const proof = await verifyToken(challenge, 'console-challenge', env.CONSOLE_SESSION_SECRET);
  if (!proof) return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
  const record = await ckFetchRecord({ ...await getS2SCreds(env), recordName: proof.recordName });
  // Apple's immutable creator metadata is the identity, never a field supplied by the browser.
  const userRecordName = record?.created?.userRecordName;
  if (record?.recordType !== 'ConsoleAuthProof' || !userRecordName ||
      record.fields?.proofHash?.value !== proof.proofHash ||
      !Number.isFinite(record.created.timestamp) || record.created.timestamp < Date.now() - 120000) {
    return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
  }
  const sessionToken = await signToken({ userRecordName }, 'console-session', env.CONSOLE_SESSION_SECRET, 3600);
  return jsonResponse({ ok: true, sessionToken, userRecordName });
}
