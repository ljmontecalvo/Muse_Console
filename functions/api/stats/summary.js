// Aggregated hunt start/completion stats for the console's Statistics screen.
// Admins see every venue (or one, if venueId is passed); managers only ever see venues
// they actually manage, verified server-side — never trusted from the client, same
// pattern as venues/list. Raw HuntEvent rows are never returned to the browser, only
// pre-aggregated numbers.
//
// Hunts and events are fetched per-venue (not one unfiltered query) so every request
// only pulls the rows it's actually scoped to, rather than every venue's data filtered
// client-side in this function.

import { ckQuery, getS2SCreds, jsonResponse } from '../../_shared/cloudkit.js';
import { isAdmin } from '../../_shared/auth.js';

const DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function venueRefFilter(venueId) {
  return [{ fieldName: 'venueReference', comparator: 'EQUALS', fieldValue: { value: { recordName: venueId } } }];
}

export async function onRequestPost({ request, env }) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'bad_request' }, 400);
  }

  const { callerUserRecordName, venueId } = payload || {};
  if (!callerUserRecordName) {
    return jsonResponse({ ok: false, error: 'bad_request' }, 400);
  }

  if (!env.CLOUDKIT_S2S_PRIVATE_KEY_PKCS8_B64 || !env.CLOUDKIT_S2S_KEY_ID) {
    console.error('stats/summary: missing S2S env vars');
    return jsonResponse({ ok: false, error: 'server_misconfigured' }, 500);
  }
  const creds = await getS2SCreds(env);

  const callerIsAdmin = await isAdmin(creds, callerUserRecordName);

  let venueIds;
  if (callerIsAdmin) {
    if (venueId) {
      venueIds = [venueId];
    } else {
      const allVenues = await ckQuery({ ...creds, recordType: 'Venue' });
      venueIds = allVenues.map((v) => v.recordName);
    }
  } else {
    const managed = await ckQuery({
      ...creds,
      recordType: 'Venue',
      filterBy: [{ fieldName: 'managers', comparator: 'LIST_CONTAINS', fieldValue: { value: callerUserRecordName } }],
    });
    const managedIds = managed.map((v) => v.recordName);
    if (venueId) {
      if (!managedIds.includes(venueId)) return jsonResponse({ ok: false, error: 'forbidden' }, 403);
      venueIds = [venueId];
    } else {
      venueIds = managedIds;
    }
  }

  if (venueIds.length === 0) {
    return jsonResponse({ ok: true, totals: { starts: 0, completions: 0, completionRate: 0 }, timeSeries: [], perHunt: [] });
  }

  const [huntsByVenue, eventsByVenue] = await Promise.all([
    Promise.all(venueIds.map((vId) => ckQuery({ ...creds, recordType: 'Hunt', filterBy: venueRefFilter(vId) }))),
    Promise.all(venueIds.map((vId) => ckQuery({ ...creds, recordType: 'HuntEvent', filterBy: venueRefFilter(vId) }))),
  ]);
  const hunts = huntsByVenue.flat();
  const events = eventsByVenue.flat();

  const huntById = new Map(hunts.map((h) => [h.recordName, h]));
  const startsByHunt = new Map();
  const completionsByHunt = new Map();
  const dailyCounts = new Map();

  const now = Date.now();
  const rangeStart = now - DAYS * DAY_MS;
  let totalStarts = 0;
  let totalCompletions = 0;

  for (const e of events) {
    const eventType = e.fields.eventType && e.fields.eventType.value;
    const ref = e.fields.huntReference && e.fields.huntReference.value;
    const huntId = ref && ref.recordName;
    if (!huntId || !huntById.has(huntId)) continue;
    if (eventType !== 'started' && eventType !== 'completed') continue;

    const bucket = eventType === 'started' ? startsByHunt : completionsByHunt;
    bucket.set(huntId, (bucket.get(huntId) || 0) + 1);
    if (eventType === 'started') totalStarts++; else totalCompletions++;

    const createdMs = e.created && e.created.timestamp;
    if (createdMs && createdMs >= rangeStart) {
      const day = new Date(createdMs).toISOString().slice(0, 10);
      const dayBucket = dailyCounts.get(day) || { starts: 0, completions: 0 };
      if (eventType === 'started') dayBucket.starts++; else dayBucket.completions++;
      dailyCounts.set(day, dayBucket);
    }
  }

  // Every day in the range gets an entry, even at zero, so the chart has a
  // continuous x-axis instead of gaps where nothing happened.
  const timeSeries = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const day = new Date(now - i * DAY_MS).toISOString().slice(0, 10);
    const bucket = dailyCounts.get(day) || { starts: 0, completions: 0 };
    timeSeries.push({ date: day, starts: bucket.starts, completions: bucket.completions });
  }

  const perHunt = hunts
    .map((h) => {
      const starts = startsByHunt.get(h.recordName) || 0;
      const completions = completionsByHunt.get(h.recordName) || 0;
      return {
        huntId: h.recordName,
        title: (h.fields.title && h.fields.title.value) || 'Untitled Hunt',
        starts,
        completions,
        completionRate: starts > 0 ? Math.round((completions / starts) * 100) : 0,
      };
    })
    .sort((a, b) => b.starts - a.starts);

  const totals = {
    starts: totalStarts,
    completions: totalCompletions,
    completionRate: totalStarts > 0 ? Math.round((totalCompletions / totalStarts) * 100) : 0,
  };

  return jsonResponse({ ok: true, totals, timeSeries, perHunt });
}
