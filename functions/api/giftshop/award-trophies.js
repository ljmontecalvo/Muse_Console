import { getS2SCreds, jsonResponse } from '../../_shared/cloudkit.js';
import { requireVisitorSession } from '../../_shared/visitorSession.js';
import { verifyToken } from '../../_shared/signedToken.js';
import { awardTrophies, commerceDB } from '../../_shared/trophyLedger.js';
export async function onRequestPost({ request, env }) {
  const visitorId = await requireVisitorSession(request, env);
  if (!visitorId) return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
  const { huntId, completionProof } = await request.json();
  const progress = await verifyToken(completionProof, 'hunt-progress', env.HUNT_PROGRESS_SECRET);
  if (!progress || progress.huntId !== huntId || !progress.clueIds?.length || progress.next !== progress.clueIds.length) {
    return jsonResponse({ ok: false, error: 'completion_required' }, 403);
  }
  const result = await awardTrophies(commerceDB(env), await getS2SCreds(env), {
    visitorId, venueId: progress.venueId, amount: progress.amount, huntId, attemptId: progress.attemptId,
  });
  return jsonResponse(result, result.ok ? 200 : 409);
}
