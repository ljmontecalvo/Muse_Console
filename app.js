const USE_MOCK = typeof CloudKit === 'undefined' || !CLOUDKIT_CONFIG.apiToken;

let container = null;
let publicDB = null;

if (!USE_MOCK) {
  CloudKit.configure({
    containers: [{
      containerIdentifier: CLOUDKIT_CONFIG.containerIdentifier,
      apiTokenAuth: { apiToken: CLOUDKIT_CONFIG.apiToken, persist: true },
      environment: CLOUDKIT_CONFIG.environment,
    }],
  });
  container = CloudKit.getDefaultContainer();
  publicDB = container.publicCloudDatabase;
}

const CURRENT_MANAGER = { userRecordName: null, name: '', email: '', isAdmin: false, hasRealName: false };

const MockStore = (() => {
  let venues = [
    { id: 'venue_1', name: 'Riverside Natural History Museum', address: '400 Riverside Dr, Springfield', managers: ['mock_manager'], giftShopEnabled: true },
    { id: 'venue_2', name: 'Old Mill Science Center', address: '12 Mill St, Springfield', managers: ['mock_manager'], giftShopEnabled: false },
    { id: 'venue_3', name: 'Harbor Maritime Museum', address: '88 Wharf Rd, Bayport', managers: ['someone_else'], giftShopEnabled: false },
  ];
  let hunts = [
    { id: 'hunt_1', venueId: 'venue_1', title: 'Dinosaur Trail', description: 'Explore the Mesozoic wing and uncover ancient secrets hiding in every hall.', folder: 'Natural History', trophies: 20 },
    { id: 'hunt_2', venueId: 'venue_1', title: 'Gems & Minerals Quest', description: 'A sparkling journey through the earth sciences hall.', folder: 'Natural History', trophies: 15 },
    { id: 'hunt_3', venueId: 'venue_2', title: 'Invention Lab Challenge', description: 'Discover the machines and ideas that changed the world.', folder: '', trophies: 0 },
  ];
  let giftShopItemsSeed = [
    { id: 'item_1', venueId: 'venue_1', name: 'Dinosaur Plush Toy', description: 'A soft, huggable T. rex.', trophyCost: 20, kind: 'item', isActive: true, sortOrder: 0 },
    { id: 'item_2', venueId: 'venue_1', name: '10% Off Gift Shop', description: 'Applies to any single purchase.', trophyCost: 10, kind: 'discount', isActive: true, sortOrder: 1 },
  ];
  // Demo redemption so the "Redeem a Code" panel has something to test against in
  // mock mode, since there's no real iOS device generating live codes here.
  const DEMO_REDEMPTION_CODE = 'DEMOX';
  console.info(`[Mock Mode] Demo gift shop redemption code for Riverside Natural History Museum: ${DEMO_REDEMPTION_CODE}`);
  let pendingRedemptions = [
    {
      id: 'redemption_demo', venueId: 'venue_1', itemName: 'Dinosaur Plush Toy', itemKind: 'item',
      trophyCost: 20, code: DEMO_REDEMPTION_CODE, visitorDisplayName: 'Demo Visitor', status: 'pending',
    },
  ];
  let clues = [
    { id: 'clue_1', huntId: 'hunt_1', order: 0, title: 'Welcome', body: 'Find the massive skeleton greeting visitors at the entrance.', nfcTagID: 'K7$Q2M9!XB4@RT8&WZ3P', tagStatus: 'installed' },
    { id: 'clue_2', huntId: 'hunt_1', order: 1, title: 'Frozen in Time', body: 'Search for the creature preserved mid-stride in solid amber.', nfcTagID: 'H2#N8V5*JD1%LF6+YC9K', tagStatus: 'requested' },
    { id: 'clue_3', huntId: 'hunt_1', order: 2, title: 'Ancient Skies', body: 'Look up — what once soared above the treetops now hangs above you.', nfcTagID: 'T4@W9X2!B7$M3&Q8*NR5', tagStatus: 'pending' },
    { id: 'clue_4', huntId: 'hunt_2', order: 0, title: 'First Light', body: 'Find the crystal that splits sunlight into a rainbow on the wall.', nfcTagID: 'Y3%K6D9#F2!H8@V5*ZQ1', tagStatus: 'installed' },
    { id: 'clue_5', huntId: 'hunt_2', order: 1, title: 'Deep Earth', body: 'Locate the darkest stone in the room, pulled from the deepest mine.', nfcTagID: 'M9&R4T7$C2!K5@N8*XW3', tagStatus: 'pending' },
    { id: 'clue_6', huntId: 'hunt_3', order: 0, title: 'Sparks Fly', body: 'Find the machine that first turned electricity into motion.', nfcTagID: 'D6#Q9M2!W5@H8&Y3*BT4', tagStatus: 'requested' },
  ];
  let seq = 100;
  const nextId = (prefix) => `${prefix}_${seq++}`;

  let folderRegistry = {};

  // Deterministic-but-plausible fake stats for demo mode, generated once and cached so
  // the numbers stay stable across re-renders instead of jumping around. Seeded off each
  // hunt's own id so the same demo hunt always shows the same shape of data.
  let statsCache = null;
  function hashString(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return Math.abs(h);
  }
  function seededRandom(seed) {
    let s = seed || 1;
    return () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  }
  function generateFakeStats() {
    const DAYS = 90;
    const now = Date.now();
    const perHunt = [];
    const perHuntDaily = {};
    hunts.forEach((h) => {
      const rand = seededRandom(hashString(h.id));
      const daily = {};
      let totalStarts = 0, totalCompletions = 0;
      for (let i = DAYS - 1; i >= 0; i--) {
        const d = new Date(now - i * 86400000);
        const date = d.toISOString().slice(0, 10);
        const weekendBoost = (d.getDay() === 0 || d.getDay() === 6) ? 1.6 : 1;
        const starts = Math.round(rand() * 6 * weekendBoost);
        const completions = Math.round(starts * (0.45 + rand() * 0.4));
        daily[date] = { starts, completions };
        totalStarts += starts;
        totalCompletions += completions;
      }
      perHuntDaily[h.id] = daily;
      perHunt.push({
        huntId: h.id,
        title: h.title,
        venueId: h.venueId,
        folder: h.folder || '',
        starts: totalStarts,
        completions: totalCompletions,
        completionRate: totalStarts > 0 ? Math.round((totalCompletions / totalStarts) * 100) : 0,
      });
    });
    return { perHunt, perHuntDaily };
  }

  let appUsers = [
    { userRecordName: 'mock_manager', name: 'Landon Montecalvo', email: 'landonjmontecalvo@gmail.com', isAdmin: true },
    { userRecordName: 'someone_else', name: 'Jordan Reyes', email: 'jordan.reyes@example.com', isAdmin: false },
    { userRecordName: 'mock_user_3', name: 'Casey Nguyen', email: 'casey.nguyen@example.com', isAdmin: false },
  ];

  return {
    async signIn() {
      return { userRecordName: 'mock_manager', name: 'Landon Montecalvo', email: 'landonjmontecalvo@gmail.com', hasRealName: true };
    },
    async checkIsAdmin(userRecordName) {
      const u = appUsers.find(x => x.userRecordName === userRecordName);
      return !!(u && u.isAdmin);
    },
    async upsertDirectoryEntry(userRecordName, name, email, hasRealName) {
      const existing = appUsers.find(x => x.userRecordName === userRecordName);
      if (existing) {
        if (hasRealName) existing.name = name;
        if (email) existing.email = email;
      } else {
        appUsers.push({ userRecordName, name: hasRealName ? name : '', email: email || '', isAdmin: false });
      }
    },
    async allUsers() {
      return appUsers.map(u => ({ ...u }));
    },
    async getDirectoryEntry(userRecordName) {
      const u = appUsers.find(x => x.userRecordName === userRecordName);
      return u ? { name: u.name, email: u.email } : null;
    },
    async allVenues() {
      return venues.map(v => ({ ...v }));
    },
    async createVenue(name, address) {
      const id = nextId('venue');
      venues.push({ id, name, address, managers: [] });
      return id;
    },
    async assignManager(venueId, userRecordName) {
      const v = venues.find(x => x.id === venueId);
      if (v && !v.managers.includes(userRecordName)) v.managers.push(userRecordName);
    },
    async unassignManager(venueId, userRecordName) {
      const v = venues.find(x => x.id === venueId);
      if (v) v.managers = v.managers.filter(id => id !== userRecordName);
    },
    async venuesForManager(managerId) {
      return venues.filter(v => v.managers.includes(managerId)).map(v => ({ ...v }));
    },
    async venue(id) { return venues.find(v => v.id === id); },
    async huntsForVenue(venueId) { return hunts.filter(h => h.venueId === venueId).map(h => ({ ...h })); },
    async hunt(id) { return hunts.find(h => h.id === id); },
    async cluesForHunt(huntId) {
      return clues.filter(c => c.huntId === huntId).sort((a, b) => a.order - b.order).map(c => ({ ...c }));
    },
    async saveHunt(huntId, venueId, data, clueList) {
      if (huntId) {
        Object.assign(hunts.find(x => x.id === huntId), data);
      } else {
        huntId = nextId('hunt');
        hunts.push({ id: huntId, venueId, ...data });
      }
      clues = clues.filter(c => c.huntId !== huntId);
      clueList.forEach((c, i) => {
        clues.push({
          id: c.id && !c.id.startsWith('draft_') ? c.id : nextId('clue'),
          huntId, order: i, title: c.title, body: c.body, nfcTagID: c.nfcTagID,
          tagStatus: c.tagStatus || 'pending',
        });
      });
      return huntId;
    },
    async deleteHunt(huntId) {
      hunts = hunts.filter(h => h.id !== huntId);
      clues = clues.filter(c => c.huntId !== huntId);
    },
    async allFolders(venueId) {
      const fromHunts = hunts.filter(h => h.venueId === venueId).map(h => (h.folder || '').trim()).filter(Boolean);
      const registered = folderRegistry[venueId] || [];
      return [...new Set([...registered, ...fromHunts])].sort((a, b) => a.localeCompare(b));
    },
    async addFolder(venueId, name) {
      const trimmed = (name || '').trim();
      if (!trimmed) return;
      const list = folderRegistry[venueId] || (folderRegistry[venueId] = []);
      if (!list.some(f => f.toLowerCase() === trimmed.toLowerCase())) {
        list.push(trimmed);
      }
    },
    async setHuntFolder(huntId, recordChangeTag, folder) {
      const h = hunts.find(x => x.id === huntId);
      if (h) h.folder = folder || '';
    },
    async getStats(venueId, days) {
      if (!statsCache) statsCache = generateFakeStats();
      // Mirror the real backend's authorization (functions/api/stats/summary.js):
      // "all venues" for a manager means all venues *they* manage, not every venue.
      const allowedVenueIds = new Set(
        CURRENT_MANAGER.isAdmin
          ? venues.map(v => v.id)
          : venues.filter(v => v.managers.includes(CURRENT_MANAGER.userRecordName)).map(v => v.id)
      );
      const scopedHuntIds = new Set(
        hunts.filter(h => allowedVenueIds.has(h.venueId) && (!venueId || h.venueId === venueId)).map(h => h.id)
      );
      const perHunt = statsCache.perHunt.filter(p => scopedHuntIds.has(p.huntId));

      const totals = perHunt.reduce((acc, p) => {
        acc.starts += p.starts;
        acc.completions += p.completions;
        return acc;
      }, { starts: 0, completions: 0 });
      totals.completionRate = totals.starts > 0 ? Math.round((totals.completions / totals.starts) * 100) : 0;

      const allDates = Object.keys(statsCache.perHuntDaily[hunts[0]?.id] || {}).sort();
      const dates = allDates.slice(-(days || 30));
      const timeSeries = dates.map((date) => {
        let starts = 0, completions = 0;
        scopedHuntIds.forEach((huntId) => {
          const day = statsCache.perHuntDaily[huntId] && statsCache.perHuntDaily[huntId][date];
          if (day) { starts += day.starts; completions += day.completions; }
        });
        return { date, starts, completions };
      });

      return { totals, timeSeries, perHunt: [...perHunt].sort((a, b) => b.starts - a.starts) };
    },

    async setGiftShopEnabled(venueId, enabled) {
      const v = venues.find(x => x.id === venueId);
      if (v) v.giftShopEnabled = !!enabled;
    },

    async giftShopItems(venueId) {
      return giftShopItemsSeed.filter(i => i.venueId === venueId).map(i => ({ ...i })).sort((a, b) => a.sortOrder - b.sortOrder);
    },

    async saveGiftShopItem(venueId, itemId, itemChangeTag, data) {
      if (itemId) {
        const existing = giftShopItemsSeed.find(i => i.id === itemId);
        if (existing) Object.assign(existing, data);
        return itemId;
      }
      const id = nextId('item');
      giftShopItemsSeed.push({ id, venueId, sortOrder: giftShopItemsSeed.length, ...data });
      return id;
    },

    async deleteGiftShopItem(itemId) {
      giftShopItemsSeed = giftShopItemsSeed.filter(i => i.id !== itemId);
    },

    // Matches against the demo pendingRedemptions seeded above — see
    // DEMO_REDEMPTION_CODE, logged to the console on load.
    async completeRedemption(venueId, code) {
      const redemption = pendingRedemptions.find(r => r.venueId === venueId && r.status === 'pending' && r.code === code.toUpperCase());
      if (!redemption) throw new Error('no_match');
      redemption.status = 'completed';
      return {
        item: { name: redemption.itemName, kind: redemption.itemKind, trophyCost: redemption.trophyCost },
        visitorDisplayName: redemption.visitorDisplayName,
        remainingBalance: 999,
      };
    },
  };
})();

function ckRefQuery(recordName) {
  return { recordName };
}
function ckRefSave(recordName) {
  return { recordName, action: 'NONE' };
}

function folderRegistryRecordName(venueId) {
  return 'folder_registry_' + venueId;
}

function clueTagRecordName(clueRecordName) {
  return 'cluetag_' + clueRecordName;
}

// Hunt/Clue/ClueTag/AppUser writes go through these backend endpoints instead of
// straight to CloudKit — CloudKit's role model can't express "only this venue's
// managers," so the venue-scoping check happens server-side against the S2S key.
// See functions/api/ and functions/_shared/auth.js.
async function apiPost(path, body) {
  const resp = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let json;
  try { json = await resp.json(); } catch { json = null; }
  if (!resp.ok || !json || json.ok === false) {
    throw new Error((json && (json.message || json.error)) || `Request failed (${resp.status})`);
  }
  return json;
}

function assertNoErrors(response) {
  if (response && response.hasErrors) {
    console.warn('CloudKit request had errors:', response.errors);
    const first = response.errors && response.errors[0];
    const reason = (first && (first.reason || first.serverErrorCode)) || 'CloudKit request failed';
    const suffix = response.errors && response.errors.length > 1 ? ` (+${response.errors.length - 1} more)` : '';
    throw new Error(reason + suffix);
  }
}

function recordToHunt(r) {
  return {
    id: r.recordName,
    recordChangeTag: r.recordChangeTag,
    title: r.fields.title && r.fields.title.value,
    description: r.fields.description && r.fields.description.value,
    folder: (r.fields.folder && r.fields.folder.value) || '',
    trophies: (r.fields.trophies && r.fields.trophies.value) || 0,
    venueId: r.fields.venueReference && r.fields.venueReference.value && r.fields.venueReference.value.recordName,
  };
}
function recordToGiftShopItem(r) {
  return {
    id: r.recordName,
    recordChangeTag: r.recordChangeTag,
    venueId: r.fields.venueReference && r.fields.venueReference.value && r.fields.venueReference.value.recordName,
    name: r.fields.name && r.fields.name.value,
    description: (r.fields.description && r.fields.description.value) || '',
    trophyCost: (r.fields.trophyCost && r.fields.trophyCost.value) || 0,
    kind: (r.fields.kind && r.fields.kind.value) || 'item',
    isActive: (r.fields.isActive && r.fields.isActive.value) === 1,
    sortOrder: (r.fields.sortOrder && r.fields.sortOrder.value) || 0,
  };
}
function recordToClue(r) {
  return {
    id: r.recordName,
    recordChangeTag: r.recordChangeTag,
    order: r.fields.order && r.fields.order.value,
    title: r.fields.title && r.fields.title.value,
    body: r.fields.body && r.fields.body.value,
    // nfcTagID intentionally lives on the separate ClueTag record type (not World/Authenticated
    // readable) — CloudKitStore.cluesForHunt merges it in from a batch ClueTag fetch below.
    tagStatus: (r.fields.tagStatus && r.fields.tagStatus.value) || 'pending',
    huntId: r.fields.huntReference && r.fields.huntReference.value && r.fields.huntReference.value.recordName,
  };
}

const CloudKitStore = {

  async checkIsAdmin(userRecordName) {
    // Routed through the backend rather than reading the native Users type directly —
    // checking someone ELSE's admin status now requires the caller to already be an
    // admin (checked server-side), closing off arbitrary-user enumeration. Self-checks
    // (the common case, at sign-in) are always allowed.
    try {
      const resp = await apiPost('/api/users/check-admin', {
        callerUserRecordName: CURRENT_MANAGER.userRecordName,
        targetUserRecordName: userRecordName,
      });
      return resp.isAdmin === true;
    } catch (err) {
      console.warn('checkIsAdmin failed:', err);
      return false;
    }
  },

  async upsertDirectoryEntry(userRecordName, name, email, hasRealName) {
    await apiPost('/api/users/upsert', {
      callerUserRecordName: CURRENT_MANAGER.userRecordName,
      targetUserRecordName: userRecordName,
      name, email, hasRealName,
    });
  },

  async allUsers() {
    const response = await publicDB.performQuery({ recordType: 'AppUser' });
    assertNoErrors(response);
    return response.records.map(r => ({
      userRecordName: r.fields.userRecordName && r.fields.userRecordName.value,
      name: r.fields.name && r.fields.name.value,
      email: r.fields.email && r.fields.email.value,
    }));
  },

  async getDirectoryEntry(userRecordName) {
    const response = await publicDB.fetchRecords('appuser_' + userRecordName);
    if (response.hasErrors) {
      console.warn('getDirectoryEntry fetch had errors:', response.errors);
      return null;
    }
    if (!response.records || !response.records[0]) return null;
    const rec = response.records[0];
    return {
      name: rec.fields.name && rec.fields.name.value,
      email: rec.fields.email && rec.fields.email.value,
    };
  },

  async allVenues() {
    // Scoping happens server-side based on the caller's verified admin status, not on
    // which client method is called — see functions/api/venues/list.js.
    const resp = await apiPost('/api/venues/list', { callerUserRecordName: CURRENT_MANAGER.userRecordName });
    return resp.venues;
  },

  async createVenue(name, address) {
    const response = await publicDB.saveRecords([{
      recordType: 'Venue',
      fields: { name: { value: name }, address: { value: address }, managers: { value: [] } },
    }]);
    assertNoErrors(response);
    return response.records[0].recordName;
  },

  async assignManager(venueId, userRecordName) {
    const venue = await this.venue(venueId);
    if ((venue.managers || []).includes(userRecordName)) return;
    const updated = [...(venue.managers || []), userRecordName];
    const response = await publicDB.saveRecords([{
      recordName: venueId,
      recordChangeTag: venue.recordChangeTag,
      operationType: 'update',
      recordType: 'Venue',
      fields: { managers: { value: updated } },
    }]);
    assertNoErrors(response);
  },

  async unassignManager(venueId, userRecordName) {
    const venue = await this.venue(venueId);
    const updated = (venue.managers || []).filter(id => id !== userRecordName);
    const response = await publicDB.saveRecords([{
      recordName: venueId,
      recordChangeTag: venue.recordChangeTag,
      operationType: 'update',
      recordType: 'Venue',
      fields: { managers: { value: updated } },
    }]);
    assertNoErrors(response);
  },

  async venuesForManager(managerId) {
    // managerId is always CURRENT_MANAGER.userRecordName in practice (see call sites);
    // the backend derives scope from the authenticated caller either way.
    const resp = await apiPost('/api/venues/list', { callerUserRecordName: CURRENT_MANAGER.userRecordName });
    return resp.venues;
  },

  async venue(id) {
    const resp = await apiPost('/api/venues/get', { callerUserRecordName: CURRENT_MANAGER.userRecordName, venueId: id });
    return resp.venue;
  },

  async huntsForVenue(venueId) {
    const response = await publicDB.performQuery({
      recordType: 'Hunt',
      filterBy: [{ fieldName: 'venueReference', comparator: 'EQUALS', fieldValue: { value: ckRefQuery(venueId) } }],
    });
    assertNoErrors(response);
    return response.records.map(recordToHunt);
  },

  async hunt(id) {
    const response = await publicDB.fetchRecords(id);
    assertNoErrors(response);
    return recordToHunt(response.records[0]);
  },

  async cluesForHunt(huntId) {
    const response = await publicDB.performQuery({
      recordType: 'Clue',
      filterBy: [{ fieldName: 'huntReference', comparator: 'EQUALS', fieldValue: { value: ckRefQuery(huntId) } }],
      sortBy: [{ fieldName: 'order', ascending: true }],
    });
    assertNoErrors(response);
    const clues = response.records.map(recordToClue).sort((a, b) => a.order - b.order);
    if (!clues.length) return clues;

    // nfcTagID lives on the separate ClueTag type, readable only by managers in the
    // Museum Managers CloudKit role (see CLOUDKIT_SETUP.md) — not World/Authenticated.
    // A manager without that role gets tagsByClueId misses here, not a hard failure.
    const tagResp = await publicDB.fetchRecords(clues.map(c => clueTagRecordName(c.id)));
    const tagsByClueId = {};
    (tagResp.records || []).forEach((r) => {
      if (!r || r.serverErrorCode) return;
      const clueId = r.fields.clueReference && r.fields.clueReference.value && r.fields.clueReference.value.recordName;
      if (clueId) tagsByClueId[clueId] = { nfcTagID: r.fields.nfcTagID && r.fields.nfcTagID.value, recordChangeTag: r.recordChangeTag };
    });

    return clues.map(c => ({
      ...c,
      nfcTagID: (tagsByClueId[c.id] && tagsByClueId[c.id].nfcTagID) || null,
      tagRecordChangeTag: tagsByClueId[c.id] && tagsByClueId[c.id].recordChangeTag,
    }));
  },

  async saveHunt(huntId, venueId, data, clueList, originalClueIds, huntChangeTag) {
    const resp = await apiPost('/api/hunts/save', {
      callerUserRecordName: CURRENT_MANAGER.userRecordName,
      huntId, venueId, huntChangeTag, data,
      clues: clueList,
      originalClueIds: [...(originalClueIds || [])],
    });
    return resp.huntId;
  },

  async deleteHunt(huntId) {
    await apiPost('/api/hunts/delete', {
      callerUserRecordName: CURRENT_MANAGER.userRecordName,
      huntId,
    });
  },

  async allFolders(venueId) {
    const [registryResp, hunts] = await Promise.all([
      publicDB.fetchRecords(folderRegistryRecordName(venueId)),
      this.huntsForVenue(venueId),
    ]);
    const registryRec = !registryResp.hasErrors && registryResp.records && registryResp.records[0];
    const registryNames = (registryRec && registryRec.fields.names && registryRec.fields.names.value) || [];
    const huntFolders = hunts.map(h => (h.folder || '').trim()).filter(Boolean);
    return [...new Set([...registryNames, ...huntFolders])].sort((a, b) => a.localeCompare(b));
  },

  async addFolder(venueId, name) {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    await apiPost('/api/folders/add', {
      callerUserRecordName: CURRENT_MANAGER.userRecordName,
      venueId, name: trimmed,
    });
  },

  async setHuntFolder(huntId, recordChangeTag, folder) {
    await apiPost('/api/hunts/set-folder', {
      callerUserRecordName: CURRENT_MANAGER.userRecordName,
      huntId, recordChangeTag, folder,
    });
  },

  // Pre-aggregated totals/time-series/per-hunt numbers — see functions/api/stats/
  // summary.js. venueId omitted means "everything I'm allowed to see" (every venue for
  // an admin, every managed venue for a manager); passing one scopes to just that venue.
  // days controls only the time-series window (totals/perHunt stay all-time); omitted
  // defaults server-side to 30.
  async getStats(venueId, days) {
    const resp = await apiPost('/api/stats/summary', {
      callerUserRecordName: CURRENT_MANAGER.userRecordName,
      venueId: venueId || null,
      days: days || null,
    });
    return { totals: resp.totals, timeSeries: resp.timeSeries, perHunt: resp.perHunt };
  },

  async setGiftShopEnabled(venueId, enabled) {
    await apiPost('/api/venues/set-giftshop-enabled', {
      callerUserRecordName: CURRENT_MANAGER.userRecordName,
      venueId, enabled,
    });
  },

  // GiftShopItem is World-readable, same posture as Hunt/Clue — read straight from
  // CloudKit like huntsForVenue does, no backend hop needed. Writes still go through
  // the S2S endpoints below.
  async giftShopItems(venueId) {
    const response = await publicDB.performQuery({
      recordType: 'GiftShopItem',
      filterBy: [{ fieldName: 'venueReference', comparator: 'EQUALS', fieldValue: { value: ckRefQuery(venueId) } }],
    });
    assertNoErrors(response);
    return response.records.map(recordToGiftShopItem).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  },

  async saveGiftShopItem(venueId, itemId, itemChangeTag, data) {
    const resp = await apiPost('/api/giftshop/items/save', {
      callerUserRecordName: CURRENT_MANAGER.userRecordName,
      itemId: itemId || null,
      venueId, itemChangeTag, data,
    });
    return resp.itemId;
  },

  async deleteGiftShopItem(itemId) {
    await apiPost('/api/giftshop/items/delete', {
      callerUserRecordName: CURRENT_MANAGER.userRecordName,
      itemId,
    });
  },

  // Staff-side redemption: typed code + the venue context the manager/admin is
  // authorized for — see functions/api/giftshop/redemption/complete.js.
  async completeRedemption(venueId, code) {
    const resp = await apiPost('/api/giftshop/redemption/complete', {
      callerUserRecordName: CURRENT_MANAGER.userRecordName,
      venueId, code,
    });
    return { item: resp.item, visitorDisplayName: resp.visitorDisplayName, remainingBalance: resp.remainingBalance };
  },
};

function identityToManager(identity) {
  const nameParts = identity.nameComponents
    ? [identity.nameComponents.givenName, identity.nameComponents.familyName].filter(Boolean)
    : [];
  const email = (identity.lookupInfo && identity.lookupInfo.emailAddress) || '';
  const fallbackName = email ? email.split('@')[0] : `User ${identity.userRecordName.slice(-6)}`;
  return {
    userRecordName: identity.userRecordName,
    name: nameParts.length ? nameParts.join(' ') : fallbackName,
    hasRealName: nameParts.length > 0,
    email,
  };
}

const Store = USE_MOCK ? MockStore : CloudKitStore;

const state = {
  venueId: null,
  huntId: null,
  isNewHunt: false,
  draft: { title: '', description: '', folder: '', clues: [] },
  originalClueIds: new Set(),
  huntChangeTag: null,
  expandedClueId: null,
  venueSearch: '',
  huntSearch: '',
  userSearch: '',
  showUserIds: false,
  userFilter: 'all',
  huntsHomeSearch: '',
  collapsedHuntFolders: new Set(),
  creatingFolderVenueId: null,
  huntsHomeVenueFilter: '',
  statsVenueFilter: '',
  statsTimeframeDays: 30,
  // Separate from collapsedHuntFolders (the Hunts screens' own state) since the
  // "venue:<id>" and "venue:<id>::folder:<name>" keys used here would otherwise
  // collide with that screen's per-folder collapse keys.
  collapsedStatsGroups: new Set(),
  giftShopVenueFilter: '',
  // Which sidebar item should read as active. Set explicitly by each nav
  // entry point (goToVenues/goToHuntsHome/goToUsers/goToSettings) rather
  // than inferred from the current view name, since view-hunts (a single
  // venue's hunts) is reached both by drilling into Venues and by the
  // single-venue-manager shortcut off the Hunts nav — the same view needs
  // a different sidebar highlight depending on which one got you there.
  activeNavSection: 'venues',
};

let draftClueSeq = 1;
const draftClueId = () => `draft_${draftClueSeq++}`;

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${name}`).classList.add('active');
  document.getElementById('app-shell').style.display = name === 'signin' ? 'none' : 'flex';
  if (name !== 'signin') setActiveNav();
  closeAccountMenus();
  window.scrollTo({ top: 0 });
}

function loadingHTML(label) {
  return `<div class="loading-state"><div class="spinner"></div><div>${escapeHTML(label)}</div></div>`;
}

function errorHTML(title, err, retryLabel) {
  const message = (err && err.message) || 'Something went wrong.';
  return `<div class="empty-state is-error">
    ${icon('triangleExclaim')}
    <div class="es-title">${escapeHTML(title)}</div>
    <div class="es-desc">${escapeHTML(message)}</div>
    <button class="btn btn-prominent es-retry" id="retry-btn">${escapeHTML(retryLabel || 'Try Again')}</button>
  </div>`;
}

function restrictedStateHTML(message) {
  return `<div class="empty-state">
    ${icon('lock')}
    <div class="es-title">Restricted</div>
    <div class="es-desc">${escapeHTML(message)}</div>
  </div>`;
}

const THEME_KEY = 'museTheme';
const SIDEBAR_COLLAPSED_KEY = 'museSidebarCollapsed';

function getStoredTheme() {
  const t = localStorage.getItem(THEME_KEY);
  return (t === 'light' || t === 'dark') ? t : 'system';
}
function applyTheme(value) {
  if (value === 'light' || value === 'dark') {
    document.documentElement.dataset.theme = value;
  } else {
    delete document.documentElement.dataset.theme;
  }
  localStorage.setItem(THEME_KEY, value);
}

function getSidebarCollapsed() {
  return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
}
function applySidebarCollapsed(collapsed) {
  document.getElementById('sidebar').classList.toggle('collapsed', collapsed);
  localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? 'true' : 'false');
}

applySidebarCollapsed(getSidebarCollapsed());

function renderSidebar() {
  const navVenues = document.getElementById('nav-venues');
  const navHuntsHome = document.getElementById('nav-hunts-home');
  const navStats = document.getElementById('nav-stats');
  const navGiftShop = document.getElementById('nav-giftshop');
  const navUsers = document.getElementById('nav-users');
  const navSettings = document.getElementById('nav-settings');
  navVenues.title = 'Venues';
  navVenues.innerHTML = `${icon('building')} <span class="nav-label">Venues</span>`;
  navVenues.addEventListener('click', goToVenues);
  navHuntsHome.title = 'Hunts';
  navHuntsHome.innerHTML = `${icon('map')} <span class="nav-label">Hunts</span>`;
  navHuntsHome.addEventListener('click', goToHuntsHome);
  navStats.title = 'Statistics';
  navStats.innerHTML = `${icon('chartBar')} <span class="nav-label">Statistics</span>`;
  navStats.addEventListener('click', goToStats);
  navGiftShop.title = 'Gift Shop';
  navGiftShop.innerHTML = `${icon('boxSeam')} <span class="nav-label">Gift Shop</span>`;
  navGiftShop.addEventListener('click', goToGiftShop);
  navUsers.title = 'Users';
  navUsers.innerHTML = `${icon('person')} <span class="nav-label">Users</span>`;
  navUsers.addEventListener('click', goToUsers);
  navSettings.title = 'Settings';
  navSettings.innerHTML = `${icon('gear')} <span class="nav-label">Settings</span>`;
  navSettings.addEventListener('click', goToSettings);

  const el = document.getElementById('sidebar-account');
  el.innerHTML = `
    <div class="account-menu-wrap">
      <button class="account-btn" id="account-btn" title="${escapeAttr(CURRENT_MANAGER.name)}">
        <span class="avatar">${icon('person')}</span>
        <span class="account-meta">
          <span class="account-name">${escapeHTML(CURRENT_MANAGER.name)}</span>
          <span class="account-role">${CURRENT_MANAGER.isAdmin ? 'Administrator' : 'Manager'}</span>
        </span>
        <span class="account-chevron">${icon('chevronDown')}</span>
      </button>
      <div class="account-dropdown glass-strong" id="account-dropdown">
        <div class="who">
          <div class="n">${escapeHTML(CURRENT_MANAGER.name)}</div>
          <div class="e">${escapeHTML(CURRENT_MANAGER.email)}</div>
        </div>
        <div class="dropdown-divider"></div>
        ${CURRENT_MANAGER.isAdmin ? `
          <button class="dropdown-item" id="menu-copy-id">${icon('tag')} Copy My Manager ID</button>
          <div class="dropdown-divider"></div>
        ` : ''}
        <button class="dropdown-item danger" id="menu-signout">${icon('close')} Sign Out</button>
      </div>
    </div>
  `;

  el.querySelector('#account-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    el.querySelector('#account-dropdown').classList.toggle('open');
  });
  el.querySelector('#menu-signout').addEventListener('click', () => { closeAccountMenus(); signOut(); });
  // IDs (CloudKit userRecordNames) are only useful for admin CloudKit Dashboard setup
  // work — managers/app users never need to see or copy their own.
  const copyIdBtn = el.querySelector('#menu-copy-id');
  if (copyIdBtn) {
    copyIdBtn.addEventListener('click', async () => {
      closeAccountMenus();
      try {
        await navigator.clipboard.writeText(CURRENT_MANAGER.userRecordName || '');
        showToast('checkCircle', 'Manager ID Copied');
      } catch {
        showToast('tag', CURRENT_MANAGER.userRecordName || 'No ID available');
      }
    });
  }
}

function setActiveNav() {
  ['venues', 'hunts-home', 'stats', 'giftshop', 'users', 'settings'].forEach((id) => {
    const el = document.getElementById(`nav-${id}`);
    if (el) el.classList.toggle('active', id === state.activeNavSection);
  });
}

function renderPageHeader(crumbs) {
  const el = document.getElementById('page-header');
  if (!crumbs.length) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  el.style.display = 'flex';

  const crumbsHTML = crumbs.map((c, i) => {
    const isLast = i === crumbs.length - 1;
    const sep = i > 0 ? `<span class="sep">${icon('chevronRight')}</span>` : '';
    if (isLast) return `${sep}<span class="crumb-current">${c.label}</span>`;
    return `${sep}<span class="crumb-link" data-crumb="${i}">${c.label}</span>`;
  }).join('');

  el.innerHTML = `<div class="crumbs">${crumbsHTML}</div>`;

  crumbs.forEach((c, i) => {
    if (i === crumbs.length - 1) return;
    el.querySelector(`[data-crumb="${i}"]`).addEventListener('click', c.onClick);
  });
}

function closeAccountMenus() {
  document.querySelectorAll('.account-dropdown').forEach(d => d.classList.remove('open'));
}
document.addEventListener('click', closeAccountMenus);

function renderSearchBox(containerId, placeholder, value, onInput) {
  const el = document.getElementById(containerId);
  el.innerHTML = `${icon('search')}<input type="text" placeholder="${placeholder}" value="${escapeAttr(value)}" />`;
  el.querySelector('input').addEventListener('input', (e) => onInput(e.target.value));
}

async function goToVenues() {
  state.venueId = null;
  state.huntId = null;
  state.activeNavSection = 'venues';
  renderPageHeader([]);
  renderSearchBox('venue-search-box', 'Search venues', state.venueSearch, (v) => {
    state.venueSearch = v;
    renderVenuesGrid();
  });

  const titleEl = document.getElementById('venues-title');
  titleEl.innerHTML = CURRENT_MANAGER.isAdmin
    ? `All Venues ${adminBadgeHTML()}`
    : 'Your Venues';

  const newVenueBtn = document.getElementById('btn-new-venue');
  newVenueBtn.style.display = CURRENT_MANAGER.isAdmin ? '' : 'none';
  newVenueBtn.innerHTML = `${icon('plus')} Add Venue`;
  newVenueBtn.onclick = showAddVenueForm;

  showView('venues');
  await renderVenuesGrid();
}

function showAddVenueForm() {
  const card = document.getElementById('alert-card');
  card.innerHTML = `
    <div class="alert-icon">${icon('building')}</div>
    <h2 class="alert-title">Add Venue</h2>
    <div class="field" style="width:100%;text-align:left;">
      <label class="label">Venue Name</label>
      <input type="text" id="venue-form-name" placeholder="e.g. Riverside Natural History Museum" />
    </div>
    <div class="field" style="width:100%;text-align:left;">
      <label class="label">Address</label>
      <input type="text" id="venue-form-address" placeholder="e.g. 400 Riverside Dr, Springfield" />
    </div>
    <p class="alert-msg" id="venue-form-error" style="display:none;color:var(--red);"></p>
    <div class="alert-actions">
      <button class="btn btn-glass" type="button" id="venue-form-cancel">Cancel</button>
      <button class="btn btn-prominent" type="button" id="venue-form-save">${icon('plus')} Add Venue</button>
    </div>
  `;
  document.getElementById('overlay').classList.add('open');

  const nameInput = document.getElementById('venue-form-name');
  const addressInput = document.getElementById('venue-form-address');
  const errorEl = document.getElementById('venue-form-error');
  const saveBtn = document.getElementById('venue-form-save');

  nameInput.focus();
  document.getElementById('venue-form-cancel').addEventListener('click', closeOverlay);

  saveBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    const address = addressInput.value.trim();
    if (!name) {
      errorEl.textContent = 'Give this venue a name before adding it.';
      errorEl.style.display = '';
      nameInput.focus();
      return;
    }

    saveBtn.disabled = true;
    saveBtn.innerHTML = `<div class="spinner" style="width:16px;height:16px;border-width:2px;"></div> Adding…`;
    try {
      await Store.createVenue(name, address);
      closeOverlay();
      showToast('checkCircle', 'Venue Added');
      await renderVenuesGrid();
    } catch (err) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = `${icon('plus')} Add Venue`;
      errorEl.textContent = err.message || 'Something went wrong talking to CloudKit.';
      errorEl.style.display = '';
    }
  });
}

let venuesCache = [];
let venueHuntCounts = {};

async function renderVenuesGrid() {
  const grid = document.getElementById('venues-grid');
  grid.innerHTML = loadingHTML('Loading venues…');

  let all;
  try {
    all = CURRENT_MANAGER.isAdmin
      ? await Store.allVenues()
      : await Store.venuesForManager(CURRENT_MANAGER.userRecordName);
    venuesCache = all;
    const counts = await Promise.all(all.map(v => Store.huntsForVenue(v.id).then(h => h.length).catch(() => 0)));
    venueHuntCounts = Object.fromEntries(all.map((v, i) => [v.id, counts[i]]));
  } catch (err) {
    grid.innerHTML = errorHTML('Could not load venues', err);
    grid.querySelector('#retry-btn').addEventListener('click', renderVenuesGrid);
    return;
  }

  const filtered = all.filter(v => v.name.toLowerCase().includes(state.venueSearch.toLowerCase()));

  if (all.length === 0) {
    grid.innerHTML = '';
    grid.appendChild(CURRENT_MANAGER.isAdmin
      ? emptyState('building', 'No Venues Yet', 'No Venue records exist in CloudKit yet.')
      : emptyState(
          'building',
          'No Venues Assigned',
          "You aren't listed as a manager for any venue yet. Ask an admin to add your Manager ID to a venue's managers list."
        ));
    return;
  }
  if (filtered.length === 0) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
      ${icon('search')}<div class="es-title">No matches</div>
      <div class="es-desc">No venues match “${escapeHTML(state.venueSearch)}”.</div>
    </div>`;
    return;
  }

  grid.innerHTML = filtered.map(v => `
    <div class="card glass venue-card" data-venue="${v.id}">
      ${CURRENT_MANAGER.isAdmin ? `
        <button class="btn-icon-sm venue-settings-btn" type="button" title="Venue Settings" data-venue-settings="${v.id}">${icon('gear')}</button>
      ` : ''}
      <div class="card-icon">${icon('building')}</div>
      <div class="card-title">${escapeHTML(v.name)}</div>
      <div class="card-sub">${escapeHTML(v.address)}</div>
      <div class="card-foot">
        <span class="badge">${venueHuntCounts[v.id] ?? 0} hunt${venueHuntCounts[v.id] === 1 ? '' : 's'}</span>
        ${v.giftShopEnabled ? `<span class="btn-icon-sm" style="pointer-events:none;" title="Gift shop enabled">${icon('boxSeam')}</span>` : ''}
        ${icon('chevronRight')}
      </div>
    </div>
  `).join('');

  grid.querySelectorAll('[data-venue]').forEach(card => {
    card.addEventListener('click', () => goToHunts(card.dataset.venue));
  });
  grid.querySelectorAll('[data-venue-settings]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const venue = filtered.find(v => v.id === btn.dataset.venueSettings);
      if (venue) showVenueSettingsForm(venue);
    });
  });
}

function showVenueSettingsForm(venue) {
  const card = document.getElementById('alert-card');
  card.innerHTML = `
    <div class="alert-icon">${icon('gear')}</div>
    <h2 class="alert-title">${escapeHTML(venue.name)}</h2>
    <div class="field settings-toggle-row" style="width:100%;margin-bottom:0;">
      <div style="text-align:left;">
        <label class="label" style="margin-bottom:2px;">Gift Shop</label>
        <div class="settings-desc">Let visitors earn trophies and redeem them here.</div>
      </div>
      <button class="toggle-switch ${venue.giftShopEnabled ? 'on' : ''}" id="venue-giftshop-toggle" type="button" role="switch" aria-checked="${!!venue.giftShopEnabled}"></button>
    </div>
    <p class="alert-msg" id="venue-settings-error" style="display:none;color:var(--red);"></p>
    <div class="alert-actions">
      <button class="btn btn-glass" type="button" id="venue-settings-cancel">Cancel</button>
      <button class="btn btn-prominent" type="button" id="venue-settings-save">Save</button>
    </div>
  `;
  document.getElementById('overlay').classList.add('open');

  const errorEl = document.getElementById('venue-settings-error');
  const saveBtn = document.getElementById('venue-settings-save');
  document.getElementById('venue-settings-cancel').addEventListener('click', closeOverlay);

  const giftShopToggle = document.getElementById('venue-giftshop-toggle');
  giftShopToggle.addEventListener('click', () => {
    const next = !giftShopToggle.classList.contains('on');
    giftShopToggle.classList.toggle('on', next);
    giftShopToggle.setAttribute('aria-checked', String(next));
  });

  saveBtn.addEventListener('click', async () => {
    const enabled = giftShopToggle.classList.contains('on');
    saveBtn.disabled = true;
    saveBtn.innerHTML = `<div class="spinner" style="width:16px;height:16px;border-width:2px;"></div> Saving…`;
    try {
      await Store.setGiftShopEnabled(venue.id, enabled);
      closeOverlay();
      showToast('checkCircle', 'Venue Updated');
      await updateGiftShopNavVisibility();
      await renderVenuesGrid();
    } catch (err) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = 'Save';
      errorEl.textContent = err.message || 'Something went wrong talking to CloudKit.';
      errorEl.style.display = '';
    }
  });
}

function emptyState(iconName, title, desc) {
  const div = document.createElement('div');
  div.className = 'empty-state';
  div.style.gridColumn = '1/-1';
  div.innerHTML = `${icon(iconName)}<div class="es-title">${title}</div><div class="es-desc">${desc}</div>`;
  return div;
}

const ADD_NEW_FOLDER_VALUE = '__add_new_folder__';

function folderSelectHTML(folders, selectedValue, extraClass) {
  return `
    <select class="${extraClass || ''}">
      <option value="" ${!selectedValue ? 'selected' : ''}>No Folder</option>
      ${folders.map(f => `<option value="${escapeAttr(f)}" ${f === selectedValue ? 'selected' : ''}>${escapeHTML(f)}</option>`).join('')}
      <option value="${ADD_NEW_FOLDER_VALUE}">+ Add New Folder…</option>
    </select>
  `;
}

function wireFolderSelect(selectEl, venueId, onChoose) {
  selectEl.addEventListener('change', async () => {
    if (selectEl.value !== ADD_NEW_FOLDER_VALUE) {
      onChoose(selectEl.value);
      return;
    }
    const wrap = selectEl.parentElement;
    wrap.innerHTML = `
      <input type="text" class="name-edit-input folder-new-input" placeholder="Folder name" />
      <button class="btn-icon-sm save" type="button" title="Save">${icon('checkCircle')}</button>
      <button class="btn-icon-sm cancel" type="button" title="Cancel">${icon('close')}</button>
    `;
    const input = wrap.querySelector('.folder-new-input');
    input.focus();
    wrap.querySelector('.cancel').addEventListener('click', () => onChoose(null));
    const confirm = async () => {
      const name = input.value.trim();
      if (!name) return;
      try {
        await Store.addFolder(venueId, name);
        onChoose(name);
      } catch (err) {
        showAlert({
          icon: 'triangleExclaim', tone: 'danger', title: 'Could Not Add Folder',
          message: err.message || 'Something went wrong talking to CloudKit.',
          actions: [{ label: 'OK', style: 'btn-prominent', onClick: closeOverlay }],
        });
      }
    };
    wrap.querySelector('.save').addEventListener('click', confirm);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') confirm();
      if (e.key === 'Escape') onChoose(null);
    });
  });
}

async function goToHuntsHome() {
  state.venueId = null;
  state.huntId = null;
  state.creatingFolderVenueId = null;
  state.huntsHomeVenueFilter = '';
  state.activeNavSection = 'hunts-home';

  if (!CURRENT_MANAGER.isAdmin) {
    try {
      const venues = await Store.venuesForManager(CURRENT_MANAGER.userRecordName);
      if (venues.length === 1) {
        venuesCache = venues;
        await goToHunts(venues[0].id);
        return;
      }
    } catch (err) {
      console.warn('Could not check venue count for the Hunts nav, falling back to the full list:', err);
    }
  }

  renderPageHeader([]);
  renderSearchBox('hunts-home-search-box', 'Search hunts', state.huntsHomeSearch, (v) => {
    state.huntsHomeSearch = v;
    renderHuntsHomeList();
  });

  showView('hunts-home');
  await renderHuntsHomeList();
}

let huntsHomeCache = [];

async function renderHuntsHomeList() {
  const listEl = document.getElementById('hunts-home-list');
  listEl.innerHTML = loadingHTML('Loading hunts…');

  let venues = [];
  try {
    venues = CURRENT_MANAGER.isAdmin
      ? await Store.allVenues()
      : await Store.venuesForManager(CURRENT_MANAGER.userRecordName);
    const huntsPerVenue = await Promise.all(venues.map(v => Store.huntsForVenue(v.id).catch(() => [])));
    huntsHomeCache = venues.flatMap((v, i) => huntsPerVenue[i].map(h => ({ ...h, venueId: v.id, venueName: v.name })));
  } catch (err) {
    listEl.innerHTML = errorHTML('Could not load hunts', err);
    listEl.querySelector('#retry-btn').addEventListener('click', renderHuntsHomeList);
    return;
  }

  const venueFilterEl = document.getElementById('hunts-home-venue-filter');
  if (venues.length > 1) {
    if (!venues.some(v => v.id === state.huntsHomeVenueFilter)) state.huntsHomeVenueFilter = '';
    venueFilterEl.style.display = '';
    venueFilterEl.innerHTML = `
      <option value="">All Venues</option>
      ${venues.map(v => `<option value="${escapeAttr(v.id)}" ${state.huntsHomeVenueFilter === v.id ? 'selected' : ''}>${escapeHTML(v.name)}</option>`).join('')}
    `;
    venueFilterEl.onchange = () => {
      state.huntsHomeVenueFilter = venueFilterEl.value;
      renderHuntsHomeList();
    };
  } else {
    venueFilterEl.style.display = 'none';
    state.huntsHomeVenueFilter = '';
  }

  const addFolderBtn = document.getElementById('btn-add-folder');
  addFolderBtn.innerHTML = `${icon('plus')} Add Folder`;
  addFolderBtn.style.display = state.huntsHomeVenueFilter ? '' : 'none';
  addFolderBtn.onclick = () => {
    state.creatingFolderVenueId = state.huntsHomeVenueFilter;
    renderHuntsHomeList();
  };

  const focusedVenues = state.huntsHomeVenueFilter
    ? venues.filter(v => v.id === state.huntsHomeVenueFilter)
    : venues;

  let registryFoldersByVenue = {};
  try {
    const lists = await Promise.all(focusedVenues.map(v => Store.allFolders(v.id).catch(() => [])));
    focusedVenues.forEach((v, i) => { registryFoldersByVenue[v.id] = lists[i]; });
  } catch (err) {
    console.warn('Could not load folders:', err);
  }

  const searchTerm = state.huntsHomeSearch.toLowerCase();
  const searching = state.huntsHomeSearch.trim().length > 0;

  const anyContent = focusedVenues.some(v =>
    huntsHomeCache.some(h => h.venueId === v.id) || (registryFoldersByVenue[v.id] || []).length > 0
  );
  if (!anyContent && !state.creatingFolderVenueId) {
    listEl.innerHTML = '';
    listEl.appendChild(emptyState(
      'map', 'No Hunts Yet',
      state.huntsHomeVenueFilter
        ? `No hunts exist for ${escapeHTML(focusedVenues[0].name)} yet.`
        : (CURRENT_MANAGER.isAdmin ? 'No Hunt records exist in CloudKit yet.' : "No hunts exist for your venues yet.")
    ));
    return;
  }

  const anyMatches = focusedVenues.some(v =>
    huntsHomeCache.some(h => h.venueId === v.id && h.title.toLowerCase().includes(searchTerm))
  );
  if (searching && !anyMatches && !focusedVenues.some(v => (registryFoldersByVenue[v.id] || []).length > 0) && !state.creatingFolderVenueId) {
    listEl.innerHTML = `<div class="empty-state">${icon('search')}<div class="es-title">No matches</div><div class="es-desc">No hunts match “${escapeHTML(state.huntsHomeSearch)}”.</div></div>`;
    return;
  }

  const showVenueHeadings = !state.huntsHomeVenueFilter;

  listEl.innerHTML = focusedVenues.map((v) => {
    const venueHunts = huntsHomeCache.filter(h => h.venueId === v.id && h.title.toLowerCase().includes(searchTerm));
    const registryFolders = registryFoldersByVenue[v.id] || [];
    const isCreatingHere = state.creatingFolderVenueId === v.id;
    if (venueHunts.length === 0 && registryFolders.length === 0 && !isCreatingHere) return '';
    return venueFolderSectionHTML(v, venueHunts, registryFolders, isCreatingHere, searching, showVenueHeadings);
  }).join('');

  wireFolderCreationRow(listEl, renderHuntsHomeList);

  listEl.querySelectorAll('.venue-add-folder').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.creatingFolderVenueId = btn.dataset.venueAddFolder;
      renderHuntsHomeList();
    });
  });

  listEl.querySelectorAll('.folder-header').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.collapseKey;
      if (state.collapsedHuntFolders.has(key)) {
        state.collapsedHuntFolders.delete(key);
      } else {
        state.collapsedHuntFolders.add(key);
      }
      renderHuntsHomeList();
    });
  });

  listEl.querySelectorAll('.hunt-row').forEach((row) => {
    const huntId = row.dataset.huntHome;
    const venueId = row.dataset.venue;
    row.addEventListener('click', () => openEditor(huntId, venueId));

    const actionsEl = row.querySelector('.hr-actions');
    actionsEl.addEventListener('click', (e) => e.stopPropagation());
    actionsEl.querySelector('.btn-move-folder').addEventListener('click', () => {
      const hunt = huntsHomeCache.find(h => h.id === huntId);
      if (hunt) openMoveFolderPicker(actionsEl, hunt, renderHuntsHomeList);
    });
  });
}

function venueFolderSectionHTML(venue, venueHunts, registryFolders, isCreatingHere, searching, showHeading, rowRenderer = huntHomeRowHTML) {
  const groups = new Map();
  venueHunts.forEach((h) => {
    const key = (h.folder || '').trim();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(h);
  });
  registryFolders.forEach((name) => {
    if (!groups.has(name)) groups.set(name, []);
  });
  const folderKeys = [...groups.keys()].filter(k => k).sort((a, b) => a.localeCompare(b));
  if (groups.has('')) folderKeys.push('');

  const creatingRowHTML = isCreatingHere ? `
    <div class="folder-group">
      <div class="folder-header-creating">
        ${icon('folder')}
        <input type="text" class="name-edit-input folder-new-input" placeholder="Folder name" />
        <button class="btn-icon-sm save" type="button" title="Save">${icon('checkCircle')}</button>
        <button class="btn-icon-sm cancel" type="button" title="Cancel">${icon('close')}</button>
      </div>
    </div>
  ` : '';

  const groupsHTML = folderKeys.map((key) => {
    const hunts = groups.get(key);
    const isUncategorized = key === '';
    const displayName = isUncategorized ? 'Uncategorized' : key;
    const collapseKey = venue.id + '::' + key;
    const collapsed = !searching && state.collapsedHuntFolders.has(collapseKey);
    return `
      <div class="folder-group ${collapsed ? 'collapsed' : ''}">
        <button class="folder-header" type="button" data-collapse-key="${escapeAttr(collapseKey)}">
          ${icon('folder')}
          <span class="folder-name">${escapeHTML(displayName)}</span>
          <span class="folder-count">${hunts.length}</span>
          <span class="folder-chevron">${icon('chevronDown')}</span>
        </button>
        <div class="folder-hunts">
          ${hunts.length ? hunts.map(h => rowRenderer(h)).join('') : `<div class="folder-empty-hint">No hunts in this folder yet.</div>`}
        </div>
      </div>
    `;
  }).join('');

  const headingHTML = showHeading ? `
    <div class="venue-section-heading">
      <span class="venue-section-name">${escapeHTML(venue.name)}</span>
      <button class="btn btn-glass venue-add-folder" type="button" data-venue-add-folder="${escapeAttr(venue.id)}">${icon('plus')} Add Folder</button>
    </div>
  ` : '';

  return `<div class="venue-section">${headingHTML}${creatingRowHTML}${groupsHTML}</div>`;
}

function huntHomeRowHTML(h) {
  return `
    <div class="hunt-row glass" data-hunt-home="${h.id}" data-venue="${h.venueId}">
      <div class="hr-icon">${icon('map')}</div>
      <div class="hr-body">
        <div class="hr-title">${escapeHTML(h.title)}</div>
        <div class="hr-sub">${escapeHTML(h.venueName)}</div>
      </div>
      <div class="hr-actions">
        <button class="btn-icon-sm btn-move-folder" type="button" title="Move to folder">${icon('folder')}</button>
        ${icon('chevronRight')}
      </div>
    </div>
  `;
}

// venueHuntRowHTML is the per-venue Hunts screen's row — same folder-move
// action as huntHomeRowHTML, but also carries the clue-count/tag-install
// badge that screen has always shown (huntClueCounts/huntInstalledTagCounts
// are populated by renderHuntsList).
function venueHuntRowHTML(h) {
  const clueCount = huntClueCounts[h.id] ?? 0;
  const installedCount = huntInstalledTagCounts[h.id] ?? 0;
  const tagsReady = clueCount > 0 && installedCount === clueCount;
  return `
    <div class="hunt-row glass" data-hunt="${h.id}">
      <div class="hr-icon">${icon('map')}</div>
      <div class="hr-body">
        <div class="hr-title">${escapeHTML(h.title)}</div>
        <div class="hr-sub">${escapeHTML(h.description)}</div>
      </div>
      <div class="hr-meta">
        <span class="hr-count">${clueCount} clue${clueCount === 1 ? '' : 's'}</span>
        ${clueCount > 0 ? `<span class="status-badge ${tagsReady ? 'status-installed' : 'status-pending'}">${icon(tagsReady ? 'checkCircle' : 'boxSeam')}${installedCount}/${clueCount} tags installed</span>` : ''}
      </div>
      <div class="hr-actions">
        <button class="btn-icon-sm btn-move-folder" type="button" title="Move to folder">${icon('folder')}</button>
        ${icon('chevronRight')}
      </div>
    </div>
  `;
}

// Wires the inline "new folder name" row produced by venueFolderSectionHTML
// (see state.creatingFolderVenueId) — shared by both the All Hunts screen
// and the per-venue Hunts screen, since folder creation looks and behaves
// identically on either.
function wireFolderCreationRow(listEl, onDone) {
  if (!state.creatingFolderVenueId) return;
  const creatingEl = listEl.querySelector('.folder-header-creating');
  if (!creatingEl) return;
  const venueId = state.creatingFolderVenueId;
  const input = creatingEl.querySelector('.folder-new-input');
  input.focus();
  const cancel = () => { state.creatingFolderVenueId = null; onDone(); };
  const save = async () => {
    const name = input.value.trim();
    if (!name) return;
    try {
      await Store.addFolder(venueId, name);
      state.creatingFolderVenueId = null;
      showToast('checkCircle', 'Folder Added');
      await onDone();
    } catch (err) {
      showAlert({
        icon: 'triangleExclaim', tone: 'danger', title: 'Could Not Add Folder',
        message: err.message || 'Something went wrong talking to CloudKit.',
        actions: [{ label: 'OK', style: 'btn-prominent', onClick: closeOverlay }],
      });
    }
  };
  creatingEl.querySelector('.save').addEventListener('click', save);
  creatingEl.querySelector('.cancel').addEventListener('click', cancel);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') cancel();
  });
}

function openMoveFolderPicker(actionsEl, hunt, onDone) {
  (async () => {
    let folders = [];
    try {
      folders = await Store.allFolders(hunt.venueId);
    } catch (err) {
      console.warn('Could not load folders:', err);
    }
    actionsEl.innerHTML = folderSelectHTML(folders, hunt.folder, 'folder-select folder-select-sm');
    const select = actionsEl.querySelector('select');
    select.focus();
    wireFolderSelect(select, hunt.venueId, async (name) => {
      if (name === null) { onDone(); return; }
      try {
        await Store.setHuntFolder(hunt.id, hunt.recordChangeTag, name);
        showToast('checkCircle', 'Hunt Moved');
        await onDone();
      } catch (err) {
        showAlert({
          icon: 'triangleExclaim', tone: 'danger', title: 'Could Not Move Hunt',
          message: err.message || 'Something went wrong talking to CloudKit.',
          actions: [{ label: 'OK', style: 'btn-prominent', onClick: closeOverlay }],
        });
        onDone();
      }
    });
  })();
}

/* ---------------------------------------------------------------
   Statistics — visitor hunt-start/completion numbers, reported by the
   iOS app to functions/api/events/log.js and pre-aggregated server-side
   by functions/api/stats/summary.js (see Store.getStats). Available to
   any signed-in manager, scoped to their own venues; admins can see
   everything or filter to one venue via the same switcher pattern used
   on the All Hunts screen.
------------------------------------------------------------------ */

async function goToStats() {
  state.venueId = null;
  state.huntId = null;
  state.activeNavSection = 'stats';
  renderPageHeader([]);
  showView('stats');
  await renderStatsView();
}

// Cache of the last successful load, so expanding/collapsing a venue or
// folder group can just re-render from memory instead of re-fetching from
// the network (and flashing the loading state) on every click.
let statsDataCache = null;

async function renderStatsView() {
  const bodyEl = document.getElementById('stats-body');
  bodyEl.innerHTML = loadingHTML('Loading statistics…');
  statsDataCache = null;

  let venues = [];
  try {
    venues = CURRENT_MANAGER.isAdmin
      ? await Store.allVenues()
      : await Store.venuesForManager(CURRENT_MANAGER.userRecordName);
  } catch (err) {
    bodyEl.innerHTML = errorHTML('Could not load statistics', err);
    bodyEl.querySelector('#retry-btn').addEventListener('click', renderStatsView);
    return;
  }

  const venueFilterEl = document.getElementById('stats-venue-filter');
  if (venues.length > 1) {
    if (!venues.some(v => v.id === state.statsVenueFilter)) state.statsVenueFilter = '';
    venueFilterEl.style.display = '';
    venueFilterEl.innerHTML = `
      <option value="">All Venues</option>
      ${venues.map(v => `<option value="${escapeAttr(v.id)}" ${state.statsVenueFilter === v.id ? 'selected' : ''}>${escapeHTML(v.name)}</option>`).join('')}
    `;
    venueFilterEl.onchange = () => {
      state.statsVenueFilter = venueFilterEl.value;
      renderStatsView();
    };
  } else {
    venueFilterEl.style.display = 'none';
    state.statsVenueFilter = '';
  }

  const timeframeEl = document.getElementById('stats-timeframe-select');
  timeframeEl.value = String(state.statsTimeframeDays);
  timeframeEl.onchange = () => {
    state.statsTimeframeDays = Number(timeframeEl.value);
    renderStatsView();
  };

  const refreshBtn = document.getElementById('btn-refresh-stats');
  refreshBtn.innerHTML = `${icon('refresh')} Refresh`;
  refreshBtn.title = 'Refresh statistics';
  refreshBtn.onclick = () => {
    refreshBtn.disabled = true;
    renderStatsView().finally(() => { refreshBtn.disabled = false; });
  };

  if (venues.length === 0) {
    bodyEl.innerHTML = '';
    bodyEl.appendChild(emptyState(
      'chartBar', 'No Venues Yet',
      CURRENT_MANAGER.isAdmin ? 'No Venue records exist in CloudKit yet.' : "You don't manage any venues yet."
    ));
    return;
  }

  let stats;
  try {
    stats = await Store.getStats(state.statsVenueFilter || null, state.statsTimeframeDays);
  } catch (err) {
    bodyEl.innerHTML = errorHTML('Could not load statistics', err);
    bodyEl.querySelector('#retry-btn').addEventListener('click', renderStatsView);
    return;
  }

  if (stats.perHunt.length === 0) {
    bodyEl.innerHTML = '';
    bodyEl.appendChild(emptyState('chartBar', 'No Hunts Yet', 'Create a hunt to start seeing visitor statistics here.'));
    return;
  }

  statsDataCache = { venues, stats };
  renderStatsBody();
}

function renderStatsBody() {
  if (!statsDataCache) return;
  const { venues, stats } = statsDataCache;
  const bodyEl = document.getElementById('stats-body');

  bodyEl.innerHTML = `
    <div class="stats-kpi-row">
      ${statTileHTML('Hunts Started', stats.totals.starts)}
      ${statTileHTML('Hunts Completed', stats.totals.completions)}
      ${statTileHTML('Completion Rate', stats.totals.completionRate + '%')}
    </div>
    <div class="panel glass stats-chart-panel">
      <p class="panel-title">Starts &amp; Completions <span class="stats-chart-sub">Last ${state.statsTimeframeDays} days</span></p>
      ${timeSeriesChartSVG(stats.timeSeries)}
    </div>
    <div class="panel glass">
      <p class="panel-title">By Hunt</p>
      ${statsGroupedHTML(stats.perHunt, venues)}
    </div>
  `;

  // Purely a local UI toggle — re-render from the cached data above rather
  // than calling renderStatsView(), which would re-fetch over the network.
  bodyEl.querySelectorAll('.stats-collapse-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.collapseKey;
      if (state.collapsedStatsGroups.has(key)) {
        state.collapsedStatsGroups.delete(key);
      } else {
        state.collapsedStatsGroups.add(key);
      }
      renderStatsBody();
    });
  });
}

// Hunts grouped by venue (collapsible), then by the folder each hunt has been
// filed into within that venue — mirrors the folder structure both admins and
// managers already see on the Hunts screens, so a hunt's stats live in the
// same place its editor does. A single-venue manager just gets one group.
function statsGroupedHTML(perHunt, venues) {
  const byVenue = new Map();
  perHunt.forEach((h) => {
    if (!byVenue.has(h.venueId)) byVenue.set(h.venueId, []);
    byVenue.get(h.venueId).push(h);
  });

  // Walk venues in the same order the rest of the console lists them, skipping
  // any venue with no hunts in this stats result.
  const orderedVenues = venues.filter((v) => byVenue.has(v.id));
  // A single venue (a one-venue manager, or an admin filtered to one venue)
  // doesn't need its own collapsible wrapper — just show its folders directly,
  // same as the per-venue Hunts screen does.
  const showVenueHeadings = orderedVenues.length > 1;

  return `
    <div class="stats-grouped-cols">
      <span>Hunt</span><span>Starts</span><span>Completions</span><span>Completion Rate</span>
    </div>
    ${orderedVenues.map((venue) => {
      const venueKey = `venue:${venue.id}`;
      const foldersHTML = statsFolderGroupsHTML(venueKey, byVenue.get(venue.id));

      if (!showVenueHeadings) return foldersHTML;

      const venueCollapsed = state.collapsedStatsGroups.has(venueKey);
      const venueStarts = byVenue.get(venue.id).reduce((sum, h) => sum + h.starts, 0);
      return `
        <div class="stats-venue-group ${venueCollapsed ? 'collapsed' : ''}">
          <button class="stats-venue-header stats-collapse-toggle" type="button" data-collapse-key="${escapeAttr(venueKey)}">
            ${icon('building')}
            <span class="stats-venue-name">${escapeHTML(venue.name)}</span>
            <span class="folder-count">${venueStarts} starts</span>
            <span class="folder-chevron">${icon('chevronDown')}</span>
          </button>
          <div class="stats-venue-body">${foldersHTML}</div>
        </div>
      `;
    }).join('')}
  `;
}

function statsFolderGroupsHTML(venueKey, venueHunts) {
  const groups = new Map();
  venueHunts.forEach((h) => {
    const key = (h.folder || '').trim();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(h);
  });
  const folderKeys = [...groups.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b));
  if (groups.has('')) folderKeys.push('');

  return folderKeys.map((key) => {
    const rows = groups.get(key).sort((a, b) => b.starts - a.starts);
    const displayName = key === '' ? 'Uncategorized' : key;
    const folderKey = `${venueKey}::folder:${key}`;
    const folderCollapsed = state.collapsedStatsGroups.has(folderKey);
    return `
      <div class="folder-group ${folderCollapsed ? 'collapsed' : ''}">
        <button class="folder-header stats-collapse-toggle" type="button" data-collapse-key="${escapeAttr(folderKey)}">
          ${icon('folder')}
          <span class="folder-name">${escapeHTML(displayName)}</span>
          <span class="folder-count">${rows.length}</span>
          <span class="folder-chevron">${icon('chevronDown')}</span>
        </button>
        <div class="folder-hunts">
          ${rows.map(statsHuntRowHTML).join('')}
        </div>
      </div>
    `;
  }).join('');
}

function statsHuntRowHTML(h) {
  return `
    <div class="stats-hunt-row">
      <span class="shr-title">${escapeHTML(h.title)}</span>
      <span>${h.starts}</span>
      <span>${h.completions}</span>
      <span>${h.completionRate}%</span>
    </div>
  `;
}

function statTileHTML(label, value) {
  return `
    <div class="stat-tile">
      <div class="stat-tile-label">${escapeHTML(label)}</div>
      <div class="stat-tile-value">${value}</div>
    </div>
  `;
}

// Hand-rolled SVG line chart — no charting library, since the CSP's script-src is
// locked to 'self' plus Apple/Cloudflare's own hosts and can't load one from a CDN.
// CSS custom properties (var(--accent) etc.) resolve fine here because this SVG is
// inlined directly into the page's own DOM, not drawn on a <canvas>.
function timeSeriesChartSVG(timeSeries) {
  const W = 800, H = 240, PAD_L = 36, PAD_R = 12, PAD_T = 12, PAD_B = 28;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const n = timeSeries.length;

  const maxVal = Math.max(1, ...timeSeries.map(d => Math.max(d.starts, d.completions)));
  const yMax = Math.ceil(maxVal * 1.15);

  const xFor = (i) => PAD_L + (n <= 1 ? 0 : (i / (n - 1)) * plotW);
  const yFor = (v) => PAD_T + plotH - (v / yMax) * plotH;
  const pathFor = (key) => timeSeries.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(1)} ${yFor(d[key]).toFixed(1)}`).join(' ');

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const y = PAD_T + plotH * (1 - f);
    const val = Math.round(yMax * f);
    return `
      <line x1="${PAD_L}" y1="${y.toFixed(1)}" x2="${W - PAD_R}" y2="${y.toFixed(1)}" stroke="var(--border)" stroke-width="1" />
      <text x="${PAD_L - 8}" y="${y.toFixed(1)}" text-anchor="end" dominant-baseline="middle" font-size="11" fill="var(--text-tertiary)">${val}</text>
    `;
  }).join('');

  // At most ~6 date labels across the axis so they don't collide.
  const labelEvery = Math.max(1, Math.ceil(n / 6));
  const xLabels = timeSeries.map((d, i) => {
    if (i % labelEvery !== 0 && i !== n - 1) return '';
    const label = new Date(d.date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `<text x="${xFor(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--text-tertiary)">${escapeHTML(label)}</text>`;
  }).join('');

  return `
    <div class="stats-legend">
      <span class="stats-legend-item"><span class="stats-legend-swatch" style="background:var(--accent)"></span>Starts</span>
      <span class="stats-legend-item"><span class="stats-legend-swatch" style="background:var(--green)"></span>Completions</span>
    </div>
    <svg class="stats-chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Line chart of hunt starts and completions over the last 30 days">
      ${gridLines}
      <path d="${pathFor('starts')}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      <path d="${pathFor('completions')}" fill="none" stroke="var(--green)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      ${xLabels}
    </svg>
  `;
}

// ---- Gift Shop ----
// Only shows venues with giftShopEnabled — the nav item itself is hidden entirely
// when none of the signed-in manager/admin's venues have it on (updateGiftShopNavVisibility).

let giftShopDataCache = null; // { venueId, items } — see renderStatsView's statsDataCache for why

async function goToGiftShop() {
  state.venueId = null;
  state.huntId = null;
  state.activeNavSection = 'giftshop';
  renderPageHeader([]);
  showView('giftshop');
  await renderGiftShopView();
}

async function renderGiftShopView() {
  const bodyEl = document.getElementById('giftshop-body');
  bodyEl.innerHTML = loadingHTML('Loading gift shop…');
  giftShopDataCache = null;

  let venues = [];
  try {
    const all = CURRENT_MANAGER.isAdmin
      ? await Store.allVenues()
      : await Store.venuesForManager(CURRENT_MANAGER.userRecordName);
    venues = all.filter(v => v.giftShopEnabled);
  } catch (err) {
    bodyEl.innerHTML = errorHTML('Could not load the gift shop', err);
    bodyEl.querySelector('#retry-btn').addEventListener('click', renderGiftShopView);
    return;
  }

  const venueFilterEl = document.getElementById('giftshop-venue-filter');
  if (venues.length > 1) {
    if (!venues.some(v => v.id === state.giftShopVenueFilter)) state.giftShopVenueFilter = venues[0].id;
    venueFilterEl.style.display = '';
    venueFilterEl.innerHTML = venues.map(v => `<option value="${escapeAttr(v.id)}" ${state.giftShopVenueFilter === v.id ? 'selected' : ''}>${escapeHTML(v.name)}</option>`).join('');
    venueFilterEl.onchange = () => {
      state.giftShopVenueFilter = venueFilterEl.value;
      renderGiftShopView();
    };
  } else {
    venueFilterEl.style.display = 'none';
    state.giftShopVenueFilter = venues[0] ? venues[0].id : '';
  }

  if (venues.length === 0) {
    bodyEl.innerHTML = '';
    bodyEl.appendChild(emptyState(
      'boxSeam', 'No Gift Shop Venues',
      CURRENT_MANAGER.isAdmin
        ? 'Enable the gift shop for a venue from the Venues page to get started.'
        : "None of your venues have the gift shop enabled yet. Ask an admin to turn it on."
    ));
    return;
  }

  const venueId = state.giftShopVenueFilter;
  let items;
  try {
    items = await Store.giftShopItems(venueId);
  } catch (err) {
    bodyEl.innerHTML = errorHTML('Could not load the gift shop', err);
    bodyEl.querySelector('#retry-btn').addEventListener('click', renderGiftShopView);
    return;
  }

  giftShopDataCache = { venueId, items };

  bodyEl.innerHTML = `
    <div class="panel glass">
      <p class="panel-title">Redeem a Code</p>
      <p class="giftshop-redeem-hint">Ask the visitor for the 5-letter code on their screen.</p>
      <div class="giftshop-redeem-row">
        <input type="text" id="giftshop-code-input" maxlength="5" placeholder="ABCDE" autocomplete="off" autocapitalize="characters" spellcheck="false" />
        <button class="btn btn-prominent" type="button" id="giftshop-redeem-btn">Redeem</button>
      </div>
      <div id="giftshop-redeem-result"></div>
    </div>
    <div class="panel glass">
      <p class="panel-title">
        <span>Catalog</span>
        <button class="btn btn-glass" type="button" id="btn-add-giftshop-item">${icon('plus')} Add Item</button>
      </p>
      <div id="giftshop-catalog-list">
        ${items.length ? items.map(giftShopItemRowHTML).join('') : `<div class="folder-empty-hint">No items yet — add one to get started.</div>`}
      </div>
    </div>
  `;

  wireGiftShopRedeemPanel(venueId);

  document.getElementById('btn-add-giftshop-item').addEventListener('click', () => showGiftShopItemForm(venueId, null));
  bodyEl.querySelectorAll('[data-item]').forEach((row) => {
    const item = items.find(i => i.id === row.dataset.item);
    if (!item) return;
    row.querySelector('.btn-edit-item').addEventListener('click', () => showGiftShopItemForm(venueId, item));
    row.querySelector('.btn-delete-item').addEventListener('click', () => confirmDeleteGiftShopItem(item));
  });
}

const REDEMPTION_ERROR_MESSAGES = {
  no_match: "That code doesn't match a pending redemption at this venue — it may have expired, or check with the visitor for the current code.",
  ambiguous_match: 'That code matched more than one pending redemption — ask the visitor to wait a few seconds for their code to refresh and try again.',
  insufficient_balance: "This visitor's trophy balance changed and is no longer enough to cover this item.",
  forbidden: "You're not authorized to redeem codes for this venue.",
};
function redemptionErrorMessage(err) {
  return REDEMPTION_ERROR_MESSAGES[err.message] || err.message || 'Could not redeem that code.';
}

function wireGiftShopRedeemPanel(venueId) {
  const codeInput = document.getElementById('giftshop-code-input');
  const redeemBtn = document.getElementById('giftshop-redeem-btn');
  const resultEl = document.getElementById('giftshop-redeem-result');

  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);
  });
  codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });
  codeInput.focus();

  const submit = async () => {
    const code = codeInput.value.trim();
    if (code.length !== 5) {
      resultEl.innerHTML = `<div class="giftshop-redeem-error">${icon('triangleExclaim')} Codes are 5 letters — check with the visitor and try again.</div>`;
      return;
    }
    redeemBtn.disabled = true;
    codeInput.disabled = true;
    resultEl.innerHTML = '';
    try {
      const result = await Store.completeRedemption(venueId, code);
      resultEl.innerHTML = `
        <div class="giftshop-redeem-success">
          ${icon('checkCircle')}
          Redeemed <strong>${escapeHTML(result.item.name)}</strong>${result.visitorDisplayName ? ` for ${escapeHTML(result.visitorDisplayName)}` : ''}.
          Remaining balance: ${result.remainingBalance}.
        </div>
      `;
      codeInput.value = '';
    } catch (err) {
      resultEl.innerHTML = `<div class="giftshop-redeem-error">${icon('triangleExclaim')} ${escapeHTML(redemptionErrorMessage(err))}</div>`;
    } finally {
      redeemBtn.disabled = false;
      codeInput.disabled = false;
      codeInput.focus();
    }
  };
  redeemBtn.addEventListener('click', submit);
}

function giftShopItemRowHTML(item) {
  return `
    <div class="hunt-row glass" data-item="${item.id}">
      <div class="hr-icon">${icon(item.kind === 'discount' ? 'tag' : 'boxSeam')}</div>
      <div class="hr-body">
        <div class="hr-title">${escapeHTML(item.name)}${item.isActive ? '' : ` <span class="folder-count">Inactive</span>`}</div>
        <div class="hr-sub">${item.trophyCost} troph${item.trophyCost === 1 ? 'y' : 'ies'} · ${item.kind === 'discount' ? 'Discount' : 'Item'}</div>
      </div>
      <div class="hr-actions">
        <button class="btn-icon-sm btn-edit-item" type="button" title="Edit">${icon('pencil')}</button>
        <button class="btn-icon-sm btn-delete-item" type="button" title="Delete">${icon('trash')}</button>
      </div>
    </div>
  `;
}

function showGiftShopItemForm(venueId, existingItem) {
  const isEdit = !!existingItem;
  const card = document.getElementById('alert-card');
  card.innerHTML = `
    <div class="alert-icon">${icon('boxSeam')}</div>
    <h2 class="alert-title">${isEdit ? 'Edit Item' : 'Add Item'}</h2>
    <div class="field" style="width:100%;text-align:left;">
      <label class="label">Name</label>
      <input type="text" id="item-form-name" value="${isEdit ? escapeAttr(existingItem.name) : ''}" placeholder="e.g. Dinosaur Plush Toy" />
    </div>
    <div class="field" style="width:100%;text-align:left;">
      <label class="label">Description <span class="label-optional">(optional)</span></label>
      <input type="text" id="item-form-desc" value="${isEdit ? escapeAttr(existingItem.description || '') : ''}" placeholder="Shown to visitors in the app" />
    </div>
    <div class="field" style="width:100%;text-align:left;">
      <label class="label">Kind</label>
      <select id="item-form-kind">
        <option value="item" ${!isEdit || existingItem.kind !== 'discount' ? 'selected' : ''}>Item</option>
        <option value="discount" ${isEdit && existingItem.kind === 'discount' ? 'selected' : ''}>Discount</option>
      </select>
    </div>
    <div class="field" style="width:100%;text-align:left;">
      <label class="label">Trophy Cost</label>
      <input type="number" id="item-form-cost" min="0" step="1" value="${isEdit ? existingItem.trophyCost : ''}" placeholder="0" />
    </div>
    ${isEdit ? `
      <div class="field" style="width:100%;text-align:left;margin-bottom:0;">
        <label class="label" style="display:flex;align-items:center;gap:8px;font-weight:500;">
          <input type="checkbox" id="item-form-active" ${existingItem.isActive ? 'checked' : ''} style="width:auto;" /> Active
        </label>
      </div>
    ` : ''}
    <p class="alert-msg" id="item-form-error" style="display:none;color:var(--red);"></p>
    <div class="alert-actions">
      <button class="btn btn-glass" type="button" id="item-form-cancel">Cancel</button>
      <button class="btn btn-prominent" type="button" id="item-form-save">${isEdit ? 'Save' : 'Add Item'}</button>
    </div>
  `;
  document.getElementById('overlay').classList.add('open');

  const nameInput = document.getElementById('item-form-name');
  const errorEl = document.getElementById('item-form-error');
  const saveBtn = document.getElementById('item-form-save');
  nameInput.focus();
  document.getElementById('item-form-cancel').addEventListener('click', closeOverlay);

  saveBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) {
      errorEl.textContent = 'Give this item a name before saving it.';
      errorEl.style.display = '';
      nameInput.focus();
      return;
    }
    const data = {
      name,
      description: document.getElementById('item-form-desc').value.trim(),
      kind: document.getElementById('item-form-kind').value,
      trophyCost: Number(document.getElementById('item-form-cost').value) || 0,
      isActive: isEdit ? document.getElementById('item-form-active').checked : true,
    };

    saveBtn.disabled = true;
    saveBtn.innerHTML = `<div class="spinner" style="width:16px;height:16px;border-width:2px;"></div> Saving…`;
    try {
      await Store.saveGiftShopItem(venueId, existingItem ? existingItem.id : null, existingItem ? existingItem.recordChangeTag : null, data);
      closeOverlay();
      showToast('checkCircle', isEdit ? 'Item Updated' : 'Item Added');
      await renderGiftShopView();
    } catch (err) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = isEdit ? 'Save' : 'Add Item';
      errorEl.textContent = err.message || 'Something went wrong talking to CloudKit.';
      errorEl.style.display = '';
    }
  });
}

function confirmDeleteGiftShopItem(item) {
  showAlert({
    icon: 'trash', tone: 'danger', title: 'Delete This Item?',
    message: `“${item.name}” will be removed from the catalog. This can't be undone.`,
    actions: [
      { label: 'Cancel', style: 'btn-glass', onClick: closeOverlay },
      {
        label: 'Delete', style: 'btn-prominent danger-fill',
        onClick: async () => {
          try {
            await Store.deleteGiftShopItem(item.id);
            closeOverlay();
            showToast('checkCircle', 'Item Deleted');
            await renderGiftShopView();
          } catch (err) {
            showAlert({
              icon: 'triangleExclaim', tone: 'danger', title: 'Could Not Delete Item',
              message: err.message || 'Something went wrong talking to CloudKit.',
              actions: [{ label: 'OK', style: 'btn-prominent', onClick: closeOverlay }],
            });
          }
        },
      },
    ],
  });
}

async function goToUsers() {
  state.venueId = null;
  state.huntId = null;
  state.activeNavSection = 'users';
  renderPageHeader([]);
  showView('users');

  const actionsEl = document.getElementById('users-actions');
  if (!CURRENT_MANAGER.isAdmin) {
    actionsEl.style.display = 'none';
    document.getElementById('users-list').innerHTML =
      restrictedStateHTML("You need administrator access to view and manage the people signed in to this console.");
    return;
  }
  actionsEl.style.display = '';

  renderSearchBox('user-search-box', 'Search users', state.userSearch, (v) => {
    state.userSearch = v;
    renderUsersList();
  });

  const filterSelect = document.getElementById('user-filter-select');
  filterSelect.value = state.userFilter;
  filterSelect.onchange = () => {
    state.userFilter = filterSelect.value;
    renderUsersList();
  };

  const toggleBtn = document.getElementById('btn-toggle-ids');
  const syncToggleLabel = () => {
    toggleBtn.innerHTML = `${icon('tag')} ${state.showUserIds ? 'Hide' : 'Show'} Manager IDs`;
  };
  syncToggleLabel();
  toggleBtn.onclick = () => {
    state.showUserIds = !state.showUserIds;
    syncToggleLabel();
    renderUsersList();
  };

  await renderUsersList();
}

async function renderUsersList() {
  const listEl = document.getElementById('users-list');
  listEl.innerHTML = loadingHTML('Loading users…');

  let users, venues;
  try {
    [users, venues] = await Promise.all([Store.allUsers(), Store.allVenues()]);
    const adminFlags = await Promise.all(users.map(u => Store.checkIsAdmin(u.userRecordName).catch(() => false)));
    users = users.map((u, i) => ({ ...u, isAdmin: adminFlags[i] }));
  } catch (err) {
    listEl.innerHTML = errorHTML('Could not load users', err);
    listEl.querySelector('#retry-btn').addEventListener('click', renderUsersList);
    return;
  }

  const managesAnyVenue = (u) => venues.some(v => (v.managers || []).includes(u.userRecordName));

  const matchesFilter = (u) => {
    switch (state.userFilter) {
      case 'admins': return u.isAdmin;
      case 'managers': return managesAnyVenue(u);
      case 'app': return !u.isAdmin && !managesAnyVenue(u);
      default: return true;
    }
  };

  const filtered = users.filter(u =>
    matchesFilter(u) &&
    ((u.name || '').toLowerCase().includes(state.userSearch.toLowerCase()) ||
     (u.email || '').toLowerCase().includes(state.userSearch.toLowerCase()))
  );

  if (users.length === 0) {
    listEl.innerHTML = '';
    listEl.appendChild(emptyState('person', 'No Users Yet', 'Nobody has signed in to the console yet.'));
    return;
  }
  if (filtered.length === 0) {
    const desc = state.userSearch
      ? `No users match “${escapeHTML(state.userSearch)}”.`
      : 'No users match this filter.';
    listEl.innerHTML = `<div class="empty-state">${icon('search')}<div class="es-title">No matches</div><div class="es-desc">${desc}</div></div>`;
    return;
  }

  listEl.innerHTML = filtered.map(u => userRowHTML(u, venues)).join('');

  filtered.forEach((u) => {
    const row = listEl.querySelector(`[data-user="${u.userRecordName}"]`);

    const copyIdBtn = row.querySelector('.btn-copy-userid');
    if (copyIdBtn) copyIdBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(u.userRecordName);
        showToast('checkCircle', 'Manager ID Copied');
      } catch {
        showToast('copy', u.userRecordName);
      }
    });

    row.querySelector('.btn-edit-name').addEventListener('click', () => {
      const titleEl = row.querySelector('.hr-title');
      titleEl.innerHTML = `
        <input type="text" class="name-edit-input" value="${escapeAttr(u.name)}" placeholder="Full name" />
        <button class="btn-icon-sm save" type="button" title="Save">${icon('checkCircle')}</button>
        <button class="btn-icon-sm cancel" type="button" title="Cancel">${icon('close')}</button>
      `;
      const input = titleEl.querySelector('.name-edit-input');
      input.focus();
      input.select();

      const save = async () => {
        const newName = input.value.trim();
        if (!newName) return;
        try {
          await Store.upsertDirectoryEntry(u.userRecordName, newName, u.email, true);
          if (u.userRecordName === CURRENT_MANAGER.userRecordName) {
            CURRENT_MANAGER.name = newName;
            CURRENT_MANAGER.hasRealName = true;
            renderSidebar();
          }
          showToast('checkCircle', 'Name Updated');
          await renderUsersList();
        } catch (err) {
          showAlert({
            icon: 'triangleExclaim', tone: 'danger', title: 'Could Not Save Name',
            message: err.message || 'Something went wrong talking to CloudKit.',
            actions: [{ label: 'OK', style: 'btn-prominent', onClick: closeOverlay }],
          });
        }
      };
      titleEl.querySelector('.save').addEventListener('click', save);
      titleEl.querySelector('.cancel').addEventListener('click', () => renderUsersList());
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') save();
        if (e.key === 'Escape') renderUsersList();
      });
    });

    row.querySelectorAll('[data-remove-venue]').forEach((btn) => {
      btn.addEventListener('click', () => confirmUnassignManager(u, btn.dataset.removeVenue, venues));
    });

    const addBtn = row.querySelector('.btn-assign-venue');
    const picker = row.querySelector('.venue-picker');
    if (addBtn) addBtn.addEventListener('click', async () => {
      const venueId = picker.value;
      if (!venueId) return;
      addBtn.disabled = true;
      try {
        await Store.assignManager(venueId, u.userRecordName);
        showToast('checkCircle', 'Manager Added');
        await renderUsersList();
      } catch (err) {
        showAlert({
          icon: 'triangleExclaim', tone: 'danger', title: 'Could Not Add Manager',
          message: err.message || 'Something went wrong talking to CloudKit.',
          actions: [{ label: 'OK', style: 'btn-prominent', onClick: closeOverlay }],
        });
        addBtn.disabled = false;
      }
    });
  });
}

function userRowHTML(u, venues) {
  const managedVenues = venues.filter(v => (v.managers || []).includes(u.userRecordName));
  const unmanagedVenues = venues.filter(v => !(v.managers || []).includes(u.userRecordName));

  return `
    <div class="user-card glass" data-user="${u.userRecordName}">
      <div class="user-card-head">
        <div class="hr-icon">${icon('person')}</div>
        <div class="hr-body">
          <div class="hr-title">
            <span class="user-name-display">${escapeHTML(u.name) || 'Unnamed'}</span>
            ${u.isAdmin ? adminBadgeHTML() : managedVenues.length ? managerBadgeHTML() : appUserBadgeHTML()}
            <button class="btn-icon-sm btn-edit-name" type="button" title="Edit name">${icon('pencil')}</button>
          </div>
          <div class="hr-sub">${escapeHTML(u.email)}</div>
          ${state.showUserIds ? `
            <div class="hr-sub user-id-row">
              <span class="user-id-value">${escapeHTML(u.userRecordName)}</span>
              <button class="btn-icon-sm btn-copy-userid" type="button" title="Copy Manager ID">${icon('copy')}</button>
            </div>
          ` : ''}
        </div>
      </div>
      <div class="user-venue-chips">
        ${managedVenues.length
          ? managedVenues.map(v => `
            <span class="venue-chip">
              ${escapeHTML(v.name)}
              <button class="chip-remove" data-remove-venue="${v.id}" title="Remove as manager">${icon('close')}</button>
            </span>
          `).join('')
          : u.isAdmin
            ? `<span class="user-venue-chips-empty">Has access to all venues as an Administrator</span>`
            : `<span class="user-venue-chips-empty">Not a manager of any venue</span>`}
      </div>
      ${!u.isAdmin && unmanagedVenues.length ? `
        <div class="user-assign-row">
          <select class="venue-picker">
            <option value="">Add as manager of…</option>
            ${unmanagedVenues.map(v => `<option value="${v.id}">${escapeHTML(v.name)}</option>`).join('')}
          </select>
          <button class="btn btn-glass btn-assign-venue" type="button">${icon('plus')} Add</button>
        </div>
      ` : ''}
    </div>
  `;
}

function confirmUnassignManager(user, venueId, venues) {
  const venue = venues.find(v => v.id === venueId);
  showAlert({
    icon: 'triangleExclaim', tone: 'danger', title: 'Remove This Manager?',
    message: `${user.name} will no longer be able to manage “${venue ? venue.name : 'this venue'}.”`,
    actions: [
      { label: 'Cancel', style: 'btn-glass', onClick: closeOverlay },
      { label: 'Remove', style: 'btn-prominent danger-fill', onClick: async () => {
        closeOverlay();
        try {
          await Store.unassignManager(venueId, user.userRecordName);
          showToast('checkCircle', 'Manager Removed');
          await renderUsersList();
        } catch (err) {
          showAlert({
            icon: 'triangleExclaim', tone: 'danger', title: 'Could Not Remove Manager',
            message: err.message || 'Something went wrong talking to CloudKit.',
            actions: [{ label: 'OK', style: 'btn-prominent', onClick: closeOverlay }],
          });
        }
      } },
    ],
  });
}

async function goToSettings() {
  state.venueId = null;
  state.huntId = null;
  state.activeNavSection = 'settings';
  renderPageHeader([]);
  showView('settings');

  const el = document.getElementById('settings-body');
  const theme = getStoredTheme();
  const collapsed = getSidebarCollapsed();

  el.innerHTML = `
    <div class="panel glass" style="max-width:480px;">
      <p class="panel-title">Appearance</p>
      <div class="field">
        <label class="label">Theme</label>
        <div class="segmented-control" id="theme-control">
          <button type="button" data-value="light" class="${theme === 'light' ? 'active' : ''}">Light</button>
          <button type="button" data-value="dark" class="${theme === 'dark' ? 'active' : ''}">Dark</button>
          <button type="button" data-value="system" class="${theme === 'system' ? 'active' : ''}">System</button>
        </div>
      </div>
      <div class="field settings-toggle-row" style="margin-bottom:0;">
        <div>
          <label class="label" style="margin-bottom:2px;">Collapse Sidebar</label>
          <div class="settings-desc">Show icons only, to save horizontal space.</div>
        </div>
        <button class="toggle-switch ${collapsed ? 'on' : ''}" id="sidebar-collapse-toggle" type="button" role="switch" aria-checked="${collapsed}"></button>
      </div>
    </div>
  `;

  el.querySelectorAll('#theme-control button').forEach((btn) => {
    btn.addEventListener('click', () => {
      applyTheme(btn.dataset.value);
      el.querySelectorAll('#theme-control button').forEach(b => b.classList.toggle('active', b === btn));
    });
  });

  const sidebarToggle = document.getElementById('sidebar-collapse-toggle');
  sidebarToggle.addEventListener('click', () => {
    const next = !getSidebarCollapsed();
    applySidebarCollapsed(next);
    sidebarToggle.classList.toggle('on', next);
    sidebarToggle.setAttribute('aria-checked', String(next));
  });
}

let huntsCache = [];
let huntClueCounts = {};
let huntInstalledTagCounts = {};

async function goToHunts(venueId) {
  state.venueId = venueId;
  state.huntId = null;
  state.creatingFolderVenueId = null;

  const venue = venuesCache.find(v => v.id === venueId) || await Store.venue(venueId);

  renderPageHeader([
    { label: 'Venues', onClick: goToVenues },
    { label: escapeHTML(venue.name) },
  ]);

  document.getElementById('hunts-title').textContent = venue.name;
  renderSearchBox('hunt-search-box', 'Search hunts', state.huntSearch, (v) => {
    state.huntSearch = v;
    renderHuntsList();
  });

  const newBtn = document.getElementById('btn-new-hunt');
  newBtn.innerHTML = `${icon('plus')} New Hunt`;
  newBtn.onclick = () => openEditor(null, venueId);

  const addFolderBtn = document.getElementById('btn-add-folder-venue');
  addFolderBtn.innerHTML = `${icon('plus')} Add Folder`;
  addFolderBtn.onclick = () => {
    state.creatingFolderVenueId = venueId;
    renderHuntsList();
  };

  showView('hunts');
  await renderHuntsList();
}

// Same folder grouping/management as the All Hunts screen's single-venue
// view (venueFolderSectionHTML, Add Folder, move-to-folder) — this is the
// screen a manager with exactly one venue actually lands on (see the
// redirect in goToHuntsHome), so folder management needs to live here too,
// not just on All Hunts. Any signed-in manager who can reach this venue at
// all already has CloudKit write access to Hunt/FolderRegistry — there's no
// separate admin-only permission being bypassed by showing it here.
async function renderHuntsList() {
  const listEl = document.getElementById('hunts-list');
  listEl.innerHTML = loadingHTML('Loading hunts…');

  let all, registryFolders = [];
  try {
    all = await Store.huntsForVenue(state.venueId);
    huntsCache = all;
    const clueLists = await Promise.all(all.map(h => Store.cluesForHunt(h.id).catch(() => [])));
    huntClueCounts = Object.fromEntries(all.map((h, i) => [h.id, clueLists[i].length]));
    huntInstalledTagCounts = Object.fromEntries(all.map((h, i) => [h.id, clueLists[i].filter(c => c.tagStatus === 'installed').length]));
    registryFolders = await Store.allFolders(state.venueId).catch(() => []);
  } catch (err) {
    listEl.innerHTML = errorHTML('Could not load hunts', err);
    listEl.querySelector('#retry-btn').addEventListener('click', renderHuntsList);
    return;
  }

  const searchTerm = state.huntSearch.toLowerCase();
  const searching = state.huntSearch.trim().length > 0;
  const filtered = all.filter(h => h.title.toLowerCase().includes(searchTerm));
  const isCreatingHere = state.creatingFolderVenueId === state.venueId;

  if (all.length === 0 && registryFolders.length === 0 && !isCreatingHere) {
    listEl.innerHTML = '';
    listEl.appendChild(emptyState('map', 'No Hunts Yet', 'Create your first scavenger hunt for this venue.'));
    return;
  }
  if (searching && filtered.length === 0 && registryFolders.length === 0 && !isCreatingHere) {
    listEl.innerHTML = `<div class="empty-state">${icon('search')}<div class="es-title">No matches</div><div class="es-desc">No hunts match “${escapeHTML(state.huntSearch)}”.</div></div>`;
    return;
  }

  listEl.innerHTML = venueFolderSectionHTML({ id: state.venueId }, filtered, registryFolders, isCreatingHere, searching, false, venueHuntRowHTML);

  wireFolderCreationRow(listEl, renderHuntsList);

  listEl.querySelectorAll('.folder-header').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.collapseKey;
      if (state.collapsedHuntFolders.has(key)) {
        state.collapsedHuntFolders.delete(key);
      } else {
        state.collapsedHuntFolders.add(key);
      }
      renderHuntsList();
    });
  });

  listEl.querySelectorAll('.hunt-row').forEach((row) => {
    const huntId = row.dataset.hunt;
    row.addEventListener('click', () => openEditor(huntId, state.venueId));

    const actionsEl = row.querySelector('.hr-actions');
    actionsEl.addEventListener('click', (e) => e.stopPropagation());
    actionsEl.querySelector('.btn-move-folder').addEventListener('click', () => {
      const hunt = all.find(h => h.id === huntId);
      if (hunt) openMoveFolderPicker(actionsEl, hunt, renderHuntsList);
    });
  });
}

async function openEditor(huntId, venueId) {
  state.venueId = venueId;
  state.huntId = huntId;
  state.isNewHunt = !huntId;
  state.expandedClueId = null;

  const venue = venuesCache.find(v => v.id === venueId) || await Store.venue(venueId);

  renderPageHeader([
    { label: 'Venues', onClick: goToVenues },
    { label: escapeHTML(venue.name), onClick: () => goToHunts(venueId) },
    { label: state.isNewHunt ? 'New Hunt' : 'Loading…' },
  ]);
  document.getElementById('editor-title').textContent = state.isNewHunt ? 'New Hunt' : 'Edit Hunt';
  document.getElementById('pv-venue-name').textContent = venue.name;

  showView('editor');
  document.getElementById('clue-list').innerHTML = loadingHTML('Loading clues…');

  if (huntId) {
    let h, clueList;
    try {
      h = huntsCache.find(x => x.id === huntId) || await Store.hunt(huntId);
      clueList = await Store.cluesForHunt(huntId);
    } catch (err) {
      document.getElementById('clue-list').innerHTML = errorHTML('Could not load this hunt', err);
      document.getElementById('clue-list').querySelector('#retry-btn').addEventListener('click', () => openEditor(huntId, venueId));
      return;
    }
    state.draft = { title: h.title, description: h.description, folder: h.folder || '', trophies: h.trophies || 0, clues: clueList.map(c => ({ ...c })) };
    state.originalClueIds = new Set(clueList.map(c => c.id));
    state.huntChangeTag = h.recordChangeTag;
  } else {
    state.draft = { title: '', description: '', folder: '', trophies: 0, clues: [] };
    state.originalClueIds = new Set();
    state.huntChangeTag = null;
  }

  syncCrumbTitle();

  const titleInput = document.getElementById('input-hunt-title');
  const descInput = document.getElementById('input-hunt-desc');
  const trophiesInput = document.getElementById('input-hunt-trophies');
  titleInput.value = state.draft.title;
  descInput.value = state.draft.description;
  trophiesInput.value = state.draft.trophies || '';
  titleInput.oninput = (e) => { state.draft.title = e.target.value; renderPreview(); syncCrumbTitle(); };
  descInput.oninput = (e) => { state.draft.description = e.target.value; };
  trophiesInput.oninput = (e) => { state.draft.trophies = Math.max(0, Math.floor(Number(e.target.value) || 0)); };
  renderHuntFolderField();

  const addBtn = document.getElementById('btn-add-clue');
  addBtn.innerHTML = `${icon('plusCircle')} Add Clue`;
  addBtn.onclick = addClue;

  const delBtn = document.getElementById('btn-delete-hunt');
  delBtn.innerHTML = `${icon('trash')} Delete Hunt`;
  delBtn.style.visibility = state.isNewHunt ? 'hidden' : 'visible';
  delBtn.onclick = confirmDeleteHunt;

  const cancelBtn = document.getElementById('btn-cancel-hunt');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.onclick = () => goToHunts(venueId);

  const saveBtn = document.getElementById('btn-save-hunt');
  saveBtn.innerHTML = `${icon('checkCircle')} Save Changes`;
  saveBtn.onclick = saveHunt;

  renderClueList();
  renderPreview();
}

async function renderHuntFolderField() {
  const wrap = document.getElementById('hunt-folder-field');
  wrap.innerHTML = loadingHTML('Loading folders…');
  let folders = [];
  try {
    folders = await Store.allFolders(state.venueId);
  } catch (err) {
    console.warn('Could not load folders:', err);
  }
  wrap.innerHTML = folderSelectHTML(folders, state.draft.folder, 'folder-select');
  wireFolderSelect(wrap.querySelector('select'), state.venueId, (name) => {
    if (name !== null) state.draft.folder = name;
    renderHuntFolderField();
  });
}

function syncCrumbTitle() {
  const crumbCurrent = document.querySelector('#page-header .crumb-current');
  if (crumbCurrent) crumbCurrent.textContent = state.draft.title || (state.isNewHunt ? 'New Hunt' : 'Hunt');
}

function addClue() {
  state.draft.clues.push({ id: draftClueId(), title: '', body: '', nfcTagID: generateTagID(), tagStatus: 'pending' });
  state.expandedClueId = state.draft.clues[state.draft.clues.length - 1].id;
  renderClueList();
  renderPreview();
  requestAnimationFrame(() => {
    const row = document.querySelector(`[data-clue-row="${state.expandedClueId}"]`);
    if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

function renderClueList() {
  const listEl = document.getElementById('clue-list');
  document.getElementById('clue-count-badge').textContent = state.draft.clues.length;

  if (state.draft.clues.length === 0) {
    listEl.innerHTML = `<div class="empty-state" style="padding:36px 12px;">
      ${icon('lightbulb')}<div class="es-title">No Clues Yet</div>
      <div class="es-desc">Add the first clue visitors will see when they start this hunt.</div>
    </div>`;
    return;
  }

  listEl.innerHTML = state.draft.clues.map((c, i) => clueRowHTML(c, i)).join('');

  state.draft.clues.forEach((c) => {
    const row = listEl.querySelector(`[data-clue-row="${c.id}"]`);

    row.querySelector('.clue-summary').addEventListener('click', (e) => {
      if (e.target.closest('.clue-handle')) return;
      state.expandedClueId = state.expandedClueId === c.id ? null : c.id;
      renderClueList();
      renderPreview();
    });

    const titleInput = row.querySelector('.clue-title-input');
    const bodyInput = row.querySelector('.clue-body-input');
    if (titleInput) {
      titleInput.addEventListener('input', (e) => {
        c.title = e.target.value;
        row.querySelector('.clue-summary-title').textContent = c.title || 'Untitled Clue';
        renderPreview();
      });
      bodyInput.addEventListener('input', (e) => {
        c.body = e.target.value;
        row.querySelector('.clue-summary-body-text').textContent = c.body || 'No clue text yet';
        renderPreview();
      });

      row.querySelector('.btn-copy-tag').addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(c.nfcTagID);
          showToast('checkCircle', 'Tag ID Copied');
        } catch {
          showToast('copy', c.nfcTagID);
        }
      });

      row.querySelector('.btn-generate-tag').addEventListener('click', (e) => {
        e.stopPropagation();
        const regenerate = () => {
          c.nfcTagID = generateTagID();
          c.tagStatus = 'pending';
          renderClueList();
          renderPreview();
        };
        if (c.tagStatus === 'pending') {
          regenerate();
        } else {
          showAlert({
            icon: 'triangleExclaim', tone: 'danger', title: 'Generate a New Tag?',
            message: "This clue's tag was already requested or installed. Generating a new code means that physical tag will no longer work — you'll need to request a fresh one.",
            actions: [
              { label: 'Cancel', style: 'btn-glass', onClick: closeOverlay },
              { label: 'Generate New', style: 'btn-prominent danger-fill', onClick: () => { closeOverlay(); regenerate(); } },
            ],
          });
        }
      });

      const requestBtn = row.querySelector('.btn-request-tag');
      if (requestBtn) requestBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        requestTagForClue(c);
      });

      const installedBtn = row.querySelector('.btn-mark-installed');
      if (installedBtn) installedBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        c.tagStatus = 'installed';
        renderClueList();
        renderPreview();
      });

      const notInstalledBtn = row.querySelector('.btn-mark-requested');
      if (notInstalledBtn) notInstalledBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        c.tagStatus = 'requested';
        renderClueList();
        renderPreview();
      });

      row.querySelector('.btn-delete-clue').addEventListener('click', (e) => {
        e.stopPropagation();
        confirmDeleteClue(c.id);
      });
    }

    row.draggable = true;
    row.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', c.id);
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => row.classList.remove('dragging'));
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      row.classList.add('drag-over');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('drag-over');
      const draggedId = e.dataTransfer.getData('text/plain');
      reorderClues(draggedId, c.id);
    });
  });
}

const TAG_STATUS_META = {
  pending: { label: 'Needs Tag', icon: 'clock', cls: 'status-pending' },
  requested: { label: 'Requested', icon: 'mail', cls: 'status-requested' },
  installed: { label: 'Installed', icon: 'checkCircle', cls: 'status-installed' },
};

function tagStatusBadgeHTML(status) {
  const meta = TAG_STATUS_META[status] || TAG_STATUS_META.pending;
  return `<span class="status-badge ${meta.cls}">${icon(meta.icon)}${meta.label}</span>`;
}

function adminBadgeHTML() {
  return `<span class="status-badge status-admin">${icon('gear')}Administrator</span>`;
}
function managerBadgeHTML() {
  return `<span class="status-badge status-manager">${icon('building')}Manager</span>`;
}
function appUserBadgeHTML() {
  return `<span class="status-badge status-appuser">${icon('person')}User</span>`;
}

function clueRowHTML(c, index) {
  const expanded = state.expandedClueId === c.id;
  const status = c.tagStatus || 'pending';
  return `
    <div class="clue-row ${expanded ? 'expanded' : ''}" data-clue-row="${c.id}">
      <div class="clue-summary">
        <span class="clue-handle" title="Drag to reorder">${icon('grip')}</span>
        <span class="clue-order">${index + 1}</span>
        <div class="clue-summary-body">
          <div class="clue-summary-title">${escapeHTML(c.title) || 'Untitled Clue'}</div>
          <div class="clue-summary-body-text">${escapeHTML(c.body) || 'No clue text yet'}</div>
        </div>
        ${tagStatusBadgeHTML(status)}
        <span class="clue-chevron">${icon('chevronRight')}</span>
      </div>
      <div class="clue-detail">
        <div class="field">
          <label class="label">Clue Title</label>
          <input type="text" class="clue-title-input" value="${escapeAttr(c.title)}" placeholder="e.g. Welcome" />
        </div>
        <div class="field">
          <label class="label">Clue Text</label>
          <textarea class="clue-body-input" rows="3" placeholder="What should visitors look for?">${escapeHTML(c.body)}</textarea>
        </div>
        <div class="field">
          <label class="label">NFC Tag</label>
          <div class="tag-display-row">
            <code class="clue-tag-code">${c.nfcTagID ? escapeHTML(c.nfcTagID) : 'Unavailable — ask an admin for Museum Managers access'}</code>
            <button class="btn btn-icon btn-copy-tag" type="button" title="Copy tag ID">${icon('copy')}</button>
          </div>
          <p class="tag-hint">Generated automatically — can't be typed in. A physical tag has to be manufactured with this exact code before it'll work at the exhibit.</p>
          <div class="tag-status-row">
            ${tagStatusBadgeHTML(status)}
            <div class="tag-status-actions">
              <button class="btn btn-glass btn-generate-tag" type="button">${icon('wand')} Regenerate</button>
              ${status === 'pending' ? `<button class="btn btn-prominent btn-request-tag" type="button">${icon('mail')} Request Tag</button>` : ''}
              ${status === 'requested' ? `<button class="btn btn-glass btn-mark-installed" type="button">${icon('boxSeam')} Mark as Installed</button>` : ''}
              ${status === 'installed' ? `<button class="btn btn-plain btn-mark-requested" type="button">Mark as Not Installed</button>` : ''}
            </div>
          </div>
        </div>
        <div class="clue-detail-actions">
          <button class="btn btn-destructive btn-delete-clue" type="button">${icon('trash')} Delete Clue</button>
        </div>
      </div>
    </div>
  `;
}

function reorderClues(draggedId, targetId) {
  if (draggedId === targetId) return;
  const clues = state.draft.clues;
  const fromIdx = clues.findIndex(c => c.id === draggedId);
  const toIdx = clues.findIndex(c => c.id === targetId);
  if (fromIdx === -1 || toIdx === -1) return;
  const [moved] = clues.splice(fromIdx, 1);
  clues.splice(toIdx, 0, moved);
  renderClueList();
  renderPreview();
}

const TAG_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const TAG_DIGITS = '23456789';
const TAG_SYMBOLS = '!@#$%^&*+=?';
const TAG_LENGTH = 20;

// Uniform random integer in [0, maxExclusive) via crypto.getRandomValues, with
// rejection sampling so the result isn't modulo-biased toward smaller values.
function secureRandomInt(maxExclusive) {
  const buf = new Uint32Array(1);
  const limit = 0x100000000 - (0x100000000 % maxExclusive);
  let x;
  do {
    crypto.getRandomValues(buf);
    x = buf[0];
  } while (x >= limit);
  return x % maxExclusive;
}

function generateTagID() {
  const all = TAG_LETTERS + TAG_DIGITS + TAG_SYMBOLS;
  const pick = (src) => src[secureRandomInt(src.length)];

  const chars = [pick(TAG_LETTERS), pick(TAG_DIGITS), pick(TAG_SYMBOLS)];
  while (chars.length < TAG_LENGTH) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = secureRandomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function requestTagForClue(clue) {
  if (!clue.nfcTagID) {
    showToast('triangleExclaim', "Tag code unavailable — you need Museum Managers access to request this tag");
    return;
  }
  const venue = venuesCache.find(v => v.id === state.venueId);
  const venueName = (venue && venue.name) || 'Venue';
  const huntTitle = state.draft.title.trim() || 'Untitled Hunt';
  const clueTitle = clue.title.trim() || 'Untitled Clue';

  const subject = `NFC Tag Request — ${venueName} / ${huntTitle} / ${clueTitle}`;
  const body = [
    'Please manufacture a physical NFC tag encoded with the exact ID below and deliver it for placement at this exhibit.',
    '',
    `Venue: ${venueName}`,
    `Hunt: ${huntTitle}`,
    `Clue: ${clueTitle}`,
    `Tag ID (must match exactly — matching is case-insensitive): ${clue.nfcTagID}`,
  ].join('\n');

  window.location.href = `mailto:${encodeURIComponent(TAG_REQUEST_EMAIL)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  clue.tagStatus = 'requested';
  renderClueList();
  renderPreview();
  showToast('mail', 'Tag Requested');
}

function renderPreview() {
  document.getElementById('pv-hunt-title').textContent = state.draft.title || 'Untitled Hunt';

  const clues = state.draft.clues;
  const activeClue = clues.find(c => c.id === state.expandedClueId) || clues[0];
  const activeIndex = activeClue ? clues.indexOf(activeClue) : -1;

  document.getElementById('pv-progress-label').textContent =
    clues.length ? `Clue ${Math.max(activeIndex, 0) + 1} of ${clues.length}` : 'No clues yet';

  const bars = document.getElementById('pv-bars');
  bars.innerHTML = clues.length
    ? clues.map((_, i) => `<div class="pv-bar ${i === activeIndex ? 'current' : i < activeIndex ? 'done' : ''}"></div>`).join('')
    : `<div class="pv-bar"></div><div class="pv-bar"></div><div class="pv-bar"></div>`;

  const bodyEl = document.getElementById('pv-card-body');
  if (activeClue && (activeClue.body || activeClue.title)) {
    bodyEl.classList.remove('placeholder');
    bodyEl.textContent = activeClue.body || activeClue.title;
  } else {
    bodyEl.classList.add('placeholder');
    bodyEl.textContent = 'Select or add a clue to preview it here.';
  }
}

async function saveHunt() {
  const title = state.draft.title.trim();
  if (!title) {
    showAlert({
      icon: 'triangleExclaim', tone: 'danger', title: 'Title Required',
      message: 'Give this hunt a title before saving.',
      actions: [{ label: 'OK', style: 'btn-prominent', onClick: closeOverlay }],
    });
    return;
  }
  const emptyClue = state.draft.clues.find(c => !c.title.trim() || !c.body.trim() || !c.nfcTagID || !c.nfcTagID.trim());
  if (emptyClue) {
    state.expandedClueId = emptyClue.id;
    renderClueList();
    showAlert({
      icon: 'triangleExclaim', tone: 'danger', title: 'Incomplete Clue',
      message: 'Every clue needs a title, clue text, and an NFC Tag ID before you can save.',
      actions: [{ label: 'OK', style: 'btn-prominent', onClick: closeOverlay }],
    });
    return;
  }

  const saveBtn = document.getElementById('btn-save-hunt');
  saveBtn.disabled = true;
  saveBtn.innerHTML = `<div class="spinner" style="width:16px;height:16px;border-width:2px;"></div> Saving…`;

  try {
    await Store.saveHunt(
      state.huntId,
      state.venueId,
      { title, description: state.draft.description.trim(), folder: state.draft.folder.trim(), trophies: state.draft.trophies || 0 },
      state.draft.clues,
      state.originalClueIds,
      state.huntChangeTag
    );
    showToast('checkCircle', 'Changes Saved');
    await goToHunts(state.venueId);
  } catch (err) {
    showAlert({
      icon: 'triangleExclaim', tone: 'danger', title: 'Could Not Save',
      message: err.message || 'Something went wrong talking to CloudKit.',
      actions: [{ label: 'OK', style: 'btn-prominent', onClick: closeOverlay }],
    });
    saveBtn.disabled = false;
    saveBtn.innerHTML = `${icon('checkCircle')} Save Changes`;
  }
}

function confirmDeleteHunt() {
  showAlert({
    icon: 'trash', tone: 'danger', title: 'Delete This Hunt?',
    message: `“${state.draft.title || 'This hunt'}” and all of its clues will be permanently removed.`,
    actions: [
      { label: 'Cancel', style: 'btn-glass', onClick: closeOverlay },
      { label: 'Delete', style: 'btn-prominent danger-fill', onClick: async () => {
        closeOverlay();
        try {
          await Store.deleteHunt(state.huntId);
          showToast('trash', 'Hunt Deleted');
          await goToHunts(state.venueId);
        } catch (err) {
          showAlert({
            icon: 'triangleExclaim', tone: 'danger', title: 'Could Not Delete',
            message: err.message || 'Something went wrong talking to CloudKit.',
            actions: [{ label: 'OK', style: 'btn-prominent', onClick: closeOverlay }],
          });
        }
      } },
    ],
  });
}

function confirmDeleteClue(clueId) {
  showAlert({
    icon: 'trash', tone: 'danger', title: 'Delete This Clue?',
    message: 'This clue will be removed once you save the hunt.',
    actions: [
      { label: 'Cancel', style: 'btn-glass', onClick: closeOverlay },
      { label: 'Delete', style: 'btn-prominent danger-fill', onClick: () => {
        state.draft.clues = state.draft.clues.filter(c => c.id !== clueId);
        if (state.expandedClueId === clueId) state.expandedClueId = null;
        closeOverlay();
        renderClueList();
        renderPreview();
      } },
    ],
  });
}

function showAlert({ icon: iconName, tone, title, message, actions }) {
  const overlay = document.getElementById('overlay');
  const card = document.getElementById('alert-card');
  card.innerHTML = `
    <div class="alert-icon ${tone}">${icon(iconName)}</div>
    <h2 class="alert-title">${title}</h2>
    <p class="alert-msg">${escapeHTML(message)}</p>
    <div class="alert-actions">
      ${actions.map((a, i) => `<button class="btn ${a.style.replace('danger-fill', '')}" data-action="${i}" style="${a.style.includes('danger-fill') ? 'background:var(--red);color:#fff;' : ''}">${a.label}</button>`).join('')}
    </div>
  `;
  actions.forEach((a, i) => {
    card.querySelector(`[data-action="${i}"]`).addEventListener('click', a.onClick);
  });
  overlay.classList.add('open');
}

let overlayBlocking = false;
function closeOverlay() {
  document.getElementById('overlay').classList.remove('open');
}
document.getElementById('overlay-scrim').addEventListener('click', () => {
  if (!overlayBlocking) closeOverlay();
});

let toastTimer = null;
function showToast(iconName, message) {
  const toast = document.getElementById('toast');
  toast.innerHTML = `${icon(iconName)}<span>${escapeHTML(message)}</span>`;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

const signInBtn = document.getElementById('btn-signin');
const ckAuthButton = document.getElementById('apple-sign-in-button');
const signInFoot = document.getElementById('signin-foot');
const demoBanner = document.getElementById('demo-banner');

async function handleSignedIn(identity) {
  Object.assign(CURRENT_MANAGER, identityToManager(identity));
  await finishSignIn();
}

async function finishSignIn() {
  try {
    CURRENT_MANAGER.isAdmin = await Store.checkIsAdmin(CURRENT_MANAGER.userRecordName);
  } catch (err) {
    console.warn('Could not check admin status:', err);
    CURRENT_MANAGER.isAdmin = false;
  }
  if (!CURRENT_MANAGER.hasRealName) {
    try {
      const existing = await Store.getDirectoryEntry(CURRENT_MANAGER.userRecordName);
      if (existing && existing.name) {
        CURRENT_MANAGER.name = existing.name;
        CURRENT_MANAGER.hasRealName = true;
      }
    } catch (err) {
      console.warn('Could not look up existing directory entry:', err);
    }
  }

  // Apple didn't share a name and there's no previously-saved one either — this is
  // effectively a first sign-in. Block entry until they give us a real name, so the
  // directory (and the CloudKit dashboard) never has an "Unnamed" entry again.
  if (!CURRENT_MANAGER.hasRealName) {
    promptForName();
    return;
  }

  await continueSignIn();
}

async function continueSignIn() {
  try {
    await Store.upsertDirectoryEntry(CURRENT_MANAGER.userRecordName, CURRENT_MANAGER.name, CURRENT_MANAGER.email, CURRENT_MANAGER.hasRealName);
  } catch (err) {
    console.warn('Could not update user directory entry:', err);
  }
  renderSidebar();
  await updateGiftShopNavVisibility();
  await enterAfterSignIn();
}

// The Gift Shop nav item only shows up if the signed-in manager/admin has at least one
// venue with it enabled — re-run after sign-in and after toggling the setting so it
// updates immediately rather than requiring a fresh sign-in.
async function updateGiftShopNavVisibility() {
  const navEl = document.getElementById('nav-giftshop');
  if (!navEl) return;
  try {
    const venues = CURRENT_MANAGER.isAdmin
      ? await Store.allVenues()
      : await Store.venuesForManager(CURRENT_MANAGER.userRecordName);
    navEl.style.display = venues.some(v => v.giftShopEnabled) ? '' : 'none';
  } catch (err) {
    console.warn('Could not check gift shop availability:', err);
    navEl.style.display = 'none';
  }
}

function promptForName() {
  const card = document.getElementById('alert-card');
  card.innerHTML = `
    <div class="alert-icon">${icon('person')}</div>
    <h2 class="alert-title">Welcome — what's your name?</h2>
    <p class="alert-msg">Enter your own name, not a venue's — this is how admins and other managers will identify <em>you</em> in the console, for example when assigning you to a venue.</p>
    <div class="field" style="width:100%;text-align:left;">
      <label class="label">Your Full Name</label>
      <input type="text" id="name-prompt-input" placeholder="e.g. Jamie Rivera (your name, not the venue's)" />
    </div>
    <p class="alert-msg" id="name-prompt-error" style="display:none;color:var(--red);"></p>
    <div class="alert-actions">
      <button class="btn btn-prominent" type="button" id="name-prompt-continue">Continue</button>
    </div>
  `;
  overlayBlocking = true;
  document.getElementById('overlay').classList.add('open');

  const input = document.getElementById('name-prompt-input');
  const errorEl = document.getElementById('name-prompt-error');
  const continueBtn = document.getElementById('name-prompt-continue');
  input.focus();

  const submit = async () => {
    const name = input.value.trim();
    if (!name) {
      errorEl.textContent = 'Please enter your name to continue.';
      errorEl.style.display = '';
      input.focus();
      return;
    }
    continueBtn.disabled = true;
    continueBtn.innerHTML = `<div class="spinner" style="width:16px;height:16px;border-width:2px;"></div> Continuing…`;
    CURRENT_MANAGER.name = name;
    CURRENT_MANAGER.hasRealName = true;
    overlayBlocking = false;
    closeOverlay();
    await continueSignIn();
  };
  continueBtn.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
}

async function enterAfterSignIn() {
  if (CURRENT_MANAGER.isAdmin) {
    await goToVenues();
    return;
  }
  try {
    const venues = await Store.venuesForManager(CURRENT_MANAGER.userRecordName);
    if (venues.length === 1) {
      venuesCache = venues;
      // Same shortcut goToHuntsHome() uses for a one-venue manager — the
      // landing screen is their venue's Hunts list, so the sidebar should
      // read "Hunts" as active, not "Venues" (which they never visited).
      state.activeNavSection = 'hunts-home';
      await goToHunts(venues[0].id);
      return;
    }
  } catch (err) {
    console.warn('Could not check venue count for direct routing, falling back to venues list:', err);
  }
  await goToVenues();
}

function signOut() {
  state.venueId = null;
  state.huntId = null;
  CURRENT_MANAGER.userRecordName = null;
  CURRENT_MANAGER.name = '';
  CURRENT_MANAGER.email = '';
  CURRENT_MANAGER.isAdmin = false;
  if (!USE_MOCK) {
    const realSignOutBtn = document.querySelector('#apple-sign-out-button *');
    if (realSignOutBtn) realSignOutBtn.click();
  }
  showView('signin');
}

if (USE_MOCK) {
  demoBanner.style.display = 'block';
  signInBtn.addEventListener('click', async () => {
    signInBtn.disabled = true;
    try {
      const manager = await Store.signIn();
      Object.assign(CURRENT_MANAGER, manager);
      await finishSignIn();
    } finally {
      signInBtn.disabled = false;
    }
  });
} else {
  signInBtn.style.display = 'none';
  ckAuthButton.classList.add('visible');

  function watchSignIn() {
    container.whenUserSignsIn().then((identity) => {
      handleSignedIn(identity);
      watchSignOut();
    }).catch((err) => {
      console.error('CloudKit sign-in listener error:', err);
      showAuthError(err);
    });
  }
  function watchSignOut() {
    container.whenUserSignsOut().then(() => {
      watchSignIn();
    }).catch((err) => {
      console.warn('CloudKit sign-out listener error:', err);
      watchSignIn();
    });
  }

  container.setUpAuth().then((identity) => {
    if (identity) {
      handleSignedIn(identity);
      watchSignOut();
    } else {
      watchSignIn();
    }
  }).catch((err) => {
    console.error('CloudKit setUpAuth failed — no sign-in button will appear:', err);
    showAuthError(err);
  });
}

function showAuthError(err) {
  const reason = (err && (err.reason || err.message)) || 'Could not connect to CloudKit.';
  signInFoot.textContent = reason;
  signInFoot.style.color = 'var(--red)';
}

function escapeHTML(str) {
  return (str ?? '').replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[m]));
}
function escapeAttr(str) { return escapeHTML(str); }
