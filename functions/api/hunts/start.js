import { ckFetchRecord, ckQuery, getS2SCreds, jsonResponse } from '../../_shared/cloudkit.js';
import { signToken } from '../../_shared/signedToken.js';
import { nonnegativeInteger } from '../../_shared/trophyLedger.js';
export async function onRequestPost({ request, env }) {
  const { huntId } = await request.json();
  if (typeof huntId !== 'string') return jsonResponse({ ok: false, error: 'bad_request' }, 400);
  const creds = await getS2SCreds(env);
  const hunt = await ckFetchRecord({ ...creds, recordName: huntId });
  if (hunt?.recordType !== 'Hunt') return jsonResponse({ ok: false, error: 'not_found' }, 404);
  const clues = await ckQuery({ ...creds, recordType: 'Clue', filterBy: [
    { fieldName: 'huntReference', comparator: 'EQUALS', fieldValue: { value: { recordName: huntId } } }
  ] });
  clues.sort((a,b) => a.fields.order.value - b.fields.order.value || a.recordName.localeCompare(b.recordName));
  if (!clues.length) return jsonResponse({ ok: false, error: 'no_clues' }, 400);
  const attemptId = crypto.randomUUID();
  const progressToken = await signToken({ attemptId, huntId, venueId: hunt.fields.venueReference.value.recordName,
    amount: nonnegativeInteger(hunt.fields.trophies?.value), clueIds: clues.map(c => c.recordName), next: 0 },
    'hunt-progress', env.HUNT_PROGRESS_SECRET, 12 * 3600);
  if (progressToken.length > 64000) return jsonResponse({ ok: false, error: 'hunt_too_large' }, 400);
  return jsonResponse({ ok: true, attemptId, progressToken, clueIds: clues.map(c => c.recordName) });
}
