/* ---------------------------------------------------------------
   Muse Console — app logic

   Two data layers behind one interface (`Store`):
   - MockStore: in-memory sample data, used whenever config.js has no
     apiToken configured (or the CloudKit script failed to load) so
     the UI is still fully clickable without touching production.
   - CloudKitStore: real CloudKit JS calls against the public database,
     used once CLOUDKIT_CONFIG.apiToken is set.

   CloudKit JS reference: https://developer.apple.com/documentation/cloudkitjs
   The CloudKitStore methods below are written against the documented
   v2 API (CloudKit.configure / performQuery / saveRecords / deleteRecords /
   setUpAuth / whenUserSignsIn) but have NOT been exercised against a
   live container from here — there's no way for me to do that without
   your real API token. Test read access (sign in, load venues) before
   trusting the write paths (save/delete), and watch the browser console
   for CloudKit's own error payloads if something doesn't match.

   SCHEMA REQUIREMENT: Venue needs a `managers` field (List<String> of
   CloudKit userRecordNames) for the venuesForManager query below to
   work — see config.js for the full Dashboard checklist.
------------------------------------------------------------------ */

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

/* ---------------------------------------------------------------
   Mock data store (demo mode)
------------------------------------------------------------------ */

const MockStore = (() => {
  let venues = [
    { id: 'venue_1', name: 'Riverside Natural History Museum', address: '400 Riverside Dr, Springfield', managers: ['mock_manager'] },
    { id: 'venue_2', name: 'Old Mill Science Center', address: '12 Mill St, Springfield', managers: ['mock_manager'] },
    { id: 'venue_3', name: 'Harbor Maritime Museum', address: '88 Wharf Rd, Bayport', managers: ['someone_else'] },
  ];
  let hunts = [
    { id: 'hunt_1', venueId: 'venue_1', title: 'Dinosaur Trail', description: 'Explore the Mesozoic wing and uncover ancient secrets hiding in every hall.' },
    { id: 'hunt_2', venueId: 'venue_1', title: 'Gems & Minerals Quest', description: 'A sparkling journey through the earth sciences hall.' },
    { id: 'hunt_3', venueId: 'venue_2', title: 'Invention Lab Challenge', description: 'Discover the machines and ideas that changed the world.' },
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

  // The signed-in demo identity is the site owner, so it's an administrator
  // by default — a good way to exercise the admin views in demo mode. Note
  // venue_3 above is managed by "someone_else", not mock_manager, which is
  // exactly the case that shows off admin bypassing the normal manager filter.
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
  };
})();

/* ---------------------------------------------------------------
   CloudKit data store (live mode)
------------------------------------------------------------------ */

// Two different reference shapes: query filters want a bare { recordName }
// (an extra `action` key here can keep the filter from matching anything —
// this was silently returning zero rows for `venueReference == %@` queries
// rather than throwing, which is what made "no hunts" look like an empty
// venue instead of a broken filter). Saved record fields need `action` set
// (CloudKit requires it on any reference field being written).
function ckRefQuery(recordName) {
  return { recordName };
}
function ckRefSave(recordName) {
  return { recordName, action: 'NONE' };
}

function assertNoErrors(response) {
  if (response && response.hasErrors) {
    const first = response.errors && response.errors[0];
    throw new Error((first && (first.reason || first.serverErrorCode)) || 'CloudKit request failed');
  }
}

function recordToVenue(r) {
  return {
    id: r.recordName,
    recordChangeTag: r.recordChangeTag,
    name: r.fields.name && r.fields.name.value,
    address: r.fields.address && r.fields.address.value,
    managers: (r.fields.managers && r.fields.managers.value) || [],
  };
}
function recordToHunt(r) {
  return {
    id: r.recordName,
    recordChangeTag: r.recordChangeTag,
    title: r.fields.title && r.fields.title.value,
    description: r.fields.description && r.fields.description.value,
    venueId: r.fields.venueReference && r.fields.venueReference.value && r.fields.venueReference.value.recordName,
  };
}
function recordToClue(r) {
  return {
    id: r.recordName,
    recordChangeTag: r.recordChangeTag,
    order: r.fields.order && r.fields.order.value,
    title: r.fields.title && r.fields.title.value,
    body: r.fields.body && r.fields.body.value,
    nfcTagID: r.fields.nfcTagID && r.fields.nfcTagID.value,
    // Clue records saved before the tagStatus field existed won't have it —
    // treat those as "pending" rather than crashing or showing a blank status.
    tagStatus: (r.fields.tagStatus && r.fields.tagStatus.value) || 'pending',
    huntId: r.fields.huntReference && r.fields.huntReference.value && r.fields.huntReference.value.recordName,
  };
}

const CloudKitStore = {
  // Auth (setUpAuth / whenUserSignsIn) is wired directly in the "Sign in / out"
  // section below, not here — see the note there for why.

  // Fails closed (returns false) on any error, including "field doesn't
  // exist" or a permissions problem reading the Users type's custom field —
  // an admin-check that can't be confirmed should never silently grant
  // access. See config.js item 8 if this always comes back false.
  async checkIsAdmin(userRecordName) {
    try {
      const response = await publicDB.fetchRecords(userRecordName);
      if (response.hasErrors) return false;
      const rec = response.records && response.records[0];
      const val = rec && rec.fields && rec.fields.isMuseAdministrator && rec.fields.isMuseAdministrator.value;
      return val === 1;
    } catch (err) {
      console.warn('checkIsAdmin failed:', err);
      return false;
    }
  },

  // Upserts this person's directory entry. operationType: 'forceUpdate' was
  // supposed to mean "create if missing, update if present, no changeTag
  // needed" per Apple's docs, but in practice against this container it
  // still hits "record to insert already exists" once the record is real —
  // same failure signature as the original Hunt/Clue save bug. Rather than
  // trust that operationType's documented behavior a second time, fetch
  // first and explicitly choose create vs. update, exactly like
  // saveHunt/assignManager already do reliably.
  //
  // The AppUser record's OWN recordName can't just be the person's
  // userRecordName — recordName is unique across the whole database, not
  // per record type, and that name is already taken by their built-in
  // Users record ("invalid attempt to update record from type 'Users' to
  // 'AppUser'"). Prefixing it keeps the lookup deterministic while
  // guaranteeing no collision with the reserved type.
  //
  // hasRealName distinguishes an Apple-shared name from our own locally
  // computed placeholder (see identityToManager) — only a real name is
  // written here, and 'update' only touches the fields it includes, so
  // omitting `name` entirely leaves whatever's already stored untouched.
  // Without this, every sign-in with no real name from Apple would
  // silently overwrite a name an admin had manually set on the Users page.
  async upsertDirectoryEntry(userRecordName, name, email, hasRealName) {
    const recordName = 'appuser_' + userRecordName;
    let existing = null;
    const fetchResp = await publicDB.fetchRecords(recordName);
    if (!fetchResp.hasErrors && fetchResp.records && fetchResp.records[0]) {
      existing = fetchResp.records[0];
    }

    const fields = { userRecordName: { value: userRecordName } };
    if (hasRealName) fields.name = { value: name };
    if (email) fields.email = { value: email };

    const record = existing
      ? { recordName, recordChangeTag: existing.recordChangeTag, operationType: 'update', recordType: 'AppUser', fields }
      : { recordName, recordType: 'AppUser', fields };

    const response = await publicDB.saveRecords([record]);
    assertNoErrors(response);
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

  // Used at sign-in to recover a name Apple didn't share this time — e.g. a
  // returning sign-in (Apple mostly only shares name/email on the very first
  // authorization) or one an admin set by hand from the Users page.
  async getDirectoryEntry(userRecordName) {
    const response = await publicDB.fetchRecords('appuser_' + userRecordName);
    if (response.hasErrors) {
      // CloudKit JS reports failures (permission denied, record not found,
      // etc.) as a resolved { hasErrors: true } response rather than a
      // rejection — silently treating that the same as "no entry yet" was
      // hiding the actual reason. Log it so it shows up in the console
      // instead of just silently not finding a name that really is there.
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

  // No filterBy — an admin needs every venue regardless of who manages it.
  // Unverified against a live container like everything else here: if this
  // errors, CloudKit may require an explicit filter even for "all records
  // of this type" queries.
  async allVenues() {
    const response = await publicDB.performQuery({ recordType: 'Venue' });
    assertNoErrors(response);
    return response.records.map(recordToVenue);
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
    const response = await publicDB.performQuery({
      recordType: 'Venue',
      filterBy: [{ fieldName: 'managers', comparator: 'LIST_CONTAINS', fieldValue: { value: managerId } }],
    });
    assertNoErrors(response);
    return response.records.map(recordToVenue);
  },

  async venue(id) {
    const response = await publicDB.fetchRecords(id);
    assertNoErrors(response);
    return recordToVenue(response.records[0]);
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
    return response.records.map(recordToClue).sort((a, b) => a.order - b.order);
  },

  async saveHunt(huntId, venueId, data, clueList, originalClueIds, huntChangeTag) {
    // CloudKit requires recordChangeTag + operationType: 'update' to modify an
    // existing record — without them it's treated as a create, which fails
    // with "record to insert already exists" for anything that already has
    // a recordName. Creates (no recordName yet) don't need either.
    const huntRecord = huntId
      ? {
          recordName: huntId,
          recordChangeTag: huntChangeTag,
          operationType: 'update',
          recordType: 'Hunt',
          fields: { title: { value: data.title }, description: { value: data.description } },
        }
      : { recordType: 'Hunt', fields: { title: { value: data.title }, description: { value: data.description }, venueReference: { value: ckRefSave(venueId) } } };

    const huntResp = await publicDB.saveRecords([huntRecord]);
    assertNoErrors(huntResp);
    const finalHuntId = huntResp.records[0].recordName;

    const currentIds = new Set(clueList.filter(c => c.id && !c.id.startsWith('draft_')).map(c => c.id));
    const toDelete = [...(originalClueIds || [])].filter(id => !currentIds.has(id));

    const toSave = clueList.map((c, i) => {
      const isNew = !c.id || c.id.startsWith('draft_');
      const record = {
        recordType: 'Clue',
        fields: {
          title: { value: c.title },
          body: { value: c.body },
          nfcTagID: { value: c.nfcTagID },
          tagStatus: { value: c.tagStatus || 'pending' },
          order: { value: i },
          huntReference: { value: ckRefSave(finalHuntId) },
        },
      };
      if (!isNew) {
        record.recordName = c.id;
        record.recordChangeTag = c.recordChangeTag;
        record.operationType = 'update';
      }
      return record;
    });

    if (toSave.length) assertNoErrors(await publicDB.saveRecords(toSave));
    if (toDelete.length) assertNoErrors(await publicDB.deleteRecords(toDelete));

    return finalHuntId;
  },

  async deleteHunt(huntId) {
    const clues = await this.cluesForHunt(huntId);
    if (clues.length) assertNoErrors(await publicDB.deleteRecords(clues.map(c => c.id)));
    assertNoErrors(await publicDB.deleteRecords([huntId]));
  },
};

function identityToManager(identity) {
  const nameParts = identity.nameComponents
    ? [identity.nameComponents.givenName, identity.nameComponents.familyName].filter(Boolean)
    : [];
  const email = (identity.lookupInfo && identity.lookupInfo.emailAddress) || '';
  // Apple only sends a real name/email here if the API token was created
  // with "Request user discoverability at sign in" AND the person consents
  // to sharing when prompted — neither is guaranteed, so this commonly
  // comes back empty. Fall back to something distinguishable rather than
  // a flat "Manager" for every unnamed person; an admin can always set a
  // real name afterward from the Users page (pencil icon next to a name).
  const fallbackName = email ? email.split('@')[0] : `User ${identity.userRecordName.slice(-6)}`;
  return {
    userRecordName: identity.userRecordName,
    name: nameParts.length ? nameParts.join(' ') : fallbackName,
    hasRealName: nameParts.length > 0,
    email,
  };
}

const Store = USE_MOCK ? MockStore : CloudKitStore;

/* ---------------------------------------------------------------
   App state
------------------------------------------------------------------ */

const state = {
  venueId: null,
  huntId: null,
  isNewHunt: false,
  draft: { title: '', description: '', clues: [] },
  originalClueIds: new Set(),
  huntChangeTag: null,
  expandedClueId: null,
  venueSearch: '',
  huntSearch: '',
  userSearch: '',
  showUserIds: false,
  userFilter: 'all', // 'all' | 'app' | 'managers' | 'admins'
};

let draftClueSeq = 1;
const draftClueId = () => `draft_${draftClueSeq++}`;

/* ---------------------------------------------------------------
   View switching
------------------------------------------------------------------ */

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${name}`).classList.add('active');
  document.getElementById('app-shell').style.display = name === 'signin' ? 'none' : 'flex';
  if (name !== 'signin') setActiveNav(name);
  closeAccountMenus();
  window.scrollTo({ top: 0 });
}

/* ---------------------------------------------------------------
   Loading / error helpers
------------------------------------------------------------------ */

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

/* ---------------------------------------------------------------
   Sidebar (nav + account menu) / page header (breadcrumbs)
------------------------------------------------------------------ */

// Nav (Venues/Users) and the account menu are chrome that doesn't change
// per-view — built once after sign-in rather than re-rendered on every
// navigation like the old per-view topbar was. setActiveNav (called from
// showView) is the only per-navigation update this needs.
function renderSidebar() {
  const navVenues = document.getElementById('nav-venues');
  const navUsers = document.getElementById('nav-users');
  navVenues.innerHTML = `${icon('building')} Venues`;
  navVenues.addEventListener('click', goToVenues);
  navUsers.innerHTML = `${icon('person')} Users`;
  navUsers.style.display = CURRENT_MANAGER.isAdmin ? '' : 'none';
  navUsers.addEventListener('click', goToUsers);

  const el = document.getElementById('sidebar-account');
  el.innerHTML = `
    <div class="account-menu-wrap">
      <button class="account-btn" id="account-btn">
        <span class="avatar">${icon('person')}</span>
        <span class="account-meta">
          <span class="account-name">${escapeHTML(CURRENT_MANAGER.name)}</span>
          <span class="account-role">${CURRENT_MANAGER.isAdmin ? 'Administrator' : 'Manager'}</span>
        </span>
        ${icon('chevronDown')}
      </button>
      <div class="account-dropdown glass-strong" id="account-dropdown">
        <div class="who">
          <div class="n">${escapeHTML(CURRENT_MANAGER.name)}</div>
          <div class="e">${escapeHTML(CURRENT_MANAGER.email)}</div>
        </div>
        <div class="dropdown-divider"></div>
        <button class="dropdown-item" id="menu-copy-id">${icon('tag')} Copy My Manager ID</button>
        <div class="dropdown-divider"></div>
        <button class="dropdown-item danger" id="menu-signout">${icon('close')} Sign Out</button>
      </div>
    </div>
  `;

  el.querySelector('#account-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    el.querySelector('#account-dropdown').classList.toggle('open');
  });
  el.querySelector('#menu-signout').addEventListener('click', () => { closeAccountMenus(); signOut(); });
  el.querySelector('#menu-copy-id').addEventListener('click', async () => {
    closeAccountMenus();
    try {
      await navigator.clipboard.writeText(CURRENT_MANAGER.userRecordName || '');
      showToast('checkCircle', 'Manager ID Copied');
    } catch {
      showToast('tag', CURRENT_MANAGER.userRecordName || 'No ID available');
    }
  });
}

// Highlights the sidebar nav item for the current section — Hunts and the
// Hunt editor are both reached by drilling into a venue, so they keep
// "Venues" highlighted rather than adding nav items of their own.
function setActiveNav(view) {
  const section = (view === 'hunts' || view === 'editor') ? 'venues' : view;
  document.getElementById('nav-venues').classList.toggle('active', section === 'venues');
  document.getElementById('nav-users').classList.toggle('active', section === 'users');
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

/* ---------------------------------------------------------------
   Search box helper
------------------------------------------------------------------ */

function renderSearchBox(containerId, placeholder, value, onInput) {
  const el = document.getElementById(containerId);
  el.innerHTML = `${icon('search')}<input type="text" placeholder="${placeholder}" value="${escapeAttr(value)}" />`;
  el.querySelector('input').addEventListener('input', (e) => onInput(e.target.value));
}

/* ---------------------------------------------------------------
   Venues view
------------------------------------------------------------------ */

async function goToVenues() {
  state.venueId = null;
  state.huntId = null;
  renderPageHeader([]);
  renderSearchBox('venue-search-box', 'Search venues', state.venueSearch, (v) => {
    state.venueSearch = v;
    renderVenuesGrid();
  });

  const titleEl = document.getElementById('venues-title');
  titleEl.innerHTML = CURRENT_MANAGER.isAdmin
    ? `All Venues ${adminBadgeHTML()}`
    : 'Your Venues';

  // Venue creation is admin-only — the Venue record type's Write role in
  // CloudKit is restricted to the Muse Administrators role (see config.js),
  // so a non-admin's create would fail server-side anyway; hiding the
  // button just keeps the UI honest about that.
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
    <div class="card glass" data-venue="${v.id}">
      <div class="card-icon">${icon('building')}</div>
      <div class="card-title">${escapeHTML(v.name)}</div>
      <div class="card-sub">${escapeHTML(v.address)}</div>
      <div class="card-foot">
        <span class="badge">${venueHuntCounts[v.id] ?? 0} hunt${venueHuntCounts[v.id] === 1 ? '' : 's'}</span>
        ${icon('chevronRight')}
      </div>
    </div>
  `).join('');

  grid.querySelectorAll('[data-venue]').forEach(card => {
    card.addEventListener('click', () => goToHunts(card.dataset.venue));
  });
}

function emptyState(iconName, title, desc) {
  const div = document.createElement('div');
  div.className = 'empty-state';
  div.style.gridColumn = '1/-1';
  div.innerHTML = `${icon(iconName)}<div class="es-title">${title}</div><div class="es-desc">${desc}</div>`;
  return div;
}

/* ---------------------------------------------------------------
   Users view (administrators only)
------------------------------------------------------------------ */

async function goToUsers() {
  state.venueId = null;
  state.huntId = null;
  renderPageHeader([]);
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

  showView('users');
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
      // "App Users" = a plain signed-in account with no elevated role yet —
      // not managing any venue and not an administrator.
      case 'app': return !u.isAdmin && !managesAnyVenue(u);
      default: return true;
    }
  };

  const filtered = users.filter(u =>
    matchesFilter(u) &&
    (u.name.toLowerCase().includes(state.userSearch.toLowerCase()) ||
     u.email.toLowerCase().includes(state.userSearch.toLowerCase()))
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
          // true: an admin manually setting this name is always authoritative,
          // unlike a sign-in's best-effort/possibly-fallback name.
          await Store.upsertDirectoryEntry(u.userRecordName, newName, u.email, true);
          // Editing your own row wouldn't otherwise show up until next
          // sign-in, since the sidebar only reads CURRENT_MANAGER, not the
          // directory record this just wrote to.
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
            ${u.isAdmin ? adminBadgeHTML() : ''}
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

/* ---------------------------------------------------------------
   Hunts view
------------------------------------------------------------------ */

let huntsCache = [];
let huntClueCounts = {};
let huntInstalledTagCounts = {};

async function goToHunts(venueId) {
  state.venueId = venueId;
  state.huntId = null;

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

  showView('hunts');
  await renderHuntsList();
}

async function renderHuntsList() {
  const listEl = document.getElementById('hunts-list');
  listEl.innerHTML = loadingHTML('Loading hunts…');

  let all;
  try {
    all = await Store.huntsForVenue(state.venueId);
    huntsCache = all;
    const clueLists = await Promise.all(all.map(h => Store.cluesForHunt(h.id).catch(() => [])));
    huntClueCounts = Object.fromEntries(all.map((h, i) => [h.id, clueLists[i].length]));
    huntInstalledTagCounts = Object.fromEntries(all.map((h, i) => [h.id, clueLists[i].filter(c => c.tagStatus === 'installed').length]));
  } catch (err) {
    listEl.innerHTML = errorHTML('Could not load hunts', err);
    listEl.querySelector('#retry-btn').addEventListener('click', renderHuntsList);
    return;
  }

  const filtered = all.filter(h => h.title.toLowerCase().includes(state.huntSearch.toLowerCase()));

  if (all.length === 0) {
    listEl.innerHTML = '';
    listEl.appendChild(emptyState('map', 'No Hunts Yet', 'Create your first scavenger hunt for this venue.'));
    return;
  }
  if (filtered.length === 0) {
    listEl.innerHTML = `<div class="empty-state">${icon('search')}<div class="es-title">No matches</div><div class="es-desc">No hunts match “${escapeHTML(state.huntSearch)}”.</div></div>`;
    return;
  }

  listEl.innerHTML = filtered.map(h => {
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
        ${icon('chevronRight')}
      </div>
    </div>
  `;
  }).join('');

  listEl.querySelectorAll('[data-hunt]').forEach(row => {
    row.addEventListener('click', () => openEditor(row.dataset.hunt, state.venueId));
  });
}

/* ---------------------------------------------------------------
   Hunt editor
------------------------------------------------------------------ */

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
    state.draft = { title: h.title, description: h.description, clues: clueList.map(c => ({ ...c })) };
    state.originalClueIds = new Set(clueList.map(c => c.id));
    state.huntChangeTag = h.recordChangeTag;
  } else {
    state.draft = { title: '', description: '', clues: [] };
    state.originalClueIds = new Set();
    state.huntChangeTag = null;
  }

  syncCrumbTitle();

  const titleInput = document.getElementById('input-hunt-title');
  const descInput = document.getElementById('input-hunt-desc');
  titleInput.value = state.draft.title;
  descInput.value = state.draft.description;
  titleInput.oninput = (e) => { state.draft.title = e.target.value; renderPreview(); syncCrumbTitle(); };
  descInput.oninput = (e) => { state.draft.description = e.target.value; };

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

    // Drag reorder
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
            <code class="clue-tag-code">${escapeHTML(c.nfcTagID)}</code>
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

// Always a random 20-character mix of capital letters, digits, and symbols —
// managers can't type or edit this, it's only ever machine-generated. This
// is the exact text that gets written to a physical NFC tag once one is
// manufactured, so it deliberately excludes visually-ambiguous characters
// (I/O and 0/1) even though it's meant to be copy-pasted, not hand-typed.
const TAG_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const TAG_DIGITS = '23456789';
const TAG_SYMBOLS = '!@#$%^&*+=?';
const TAG_LENGTH = 20;

function generateTagID() {
  const all = TAG_LETTERS + TAG_DIGITS + TAG_SYMBOLS;
  const pick = (src) => src[Math.floor(Math.random() * src.length)];

  // Guarantee at least one letter, one digit, and one symbol, then fill the
  // rest randomly from the combined pool and shuffle so the guaranteed
  // characters aren't always sitting in the first three positions.
  const chars = [pick(TAG_LETTERS), pick(TAG_DIGITS), pick(TAG_SYMBOLS)];
  while (chars.length < TAG_LENGTH) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function requestTagForClue(clue) {
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

  // mailto: hands off to the OS mail client without navigating away from
  // the page — no backend/email service needed for this.
  window.location.href = `mailto:${encodeURIComponent(TAG_REQUEST_EMAIL)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  clue.tagStatus = 'requested';
  renderClueList();
  renderPreview();
  showToast('mail', 'Tag Requested');
}

/* ---------------------------------------------------------------
   Preview phone
------------------------------------------------------------------ */

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

/* ---------------------------------------------------------------
   Save / delete hunt & clue confirmations
------------------------------------------------------------------ */

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
  const emptyClue = state.draft.clues.find(c => !c.title.trim() || !c.body.trim() || !c.nfcTagID.trim());
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
      { title, description: state.draft.description.trim() },
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

/* ---------------------------------------------------------------
   Glass alert overlay + toast
------------------------------------------------------------------ */

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

function closeOverlay() {
  document.getElementById('overlay').classList.remove('open');
}
document.getElementById('overlay-scrim').addEventListener('click', closeOverlay);

let toastTimer = null;
function showToast(iconName, message) {
  const toast = document.getElementById('toast');
  toast.innerHTML = `${icon(iconName)}<span>${escapeHTML(message)}</span>`;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

/* ---------------------------------------------------------------
   Sign in / out
------------------------------------------------------------------ */

const signInBtn = document.getElementById('btn-signin');       // demo-mode-only custom button
const ckAuthButton = document.getElementById('apple-sign-in-button'); // real CloudKit-injected button
const signInFoot = document.getElementById('signin-foot');
const demoBanner = document.getElementById('demo-banner');

async function handleSignedIn(identity) {
  Object.assign(CURRENT_MANAGER, identityToManager(identity));
  await finishSignIn();
}

// Runs after CURRENT_MANAGER's identity (userRecordName/name/email) is set,
// regardless of mock or real auth. Checks admin status and upserts this
// person's directory entry (see config.js items 5-9) before routing —
// both are best-effort: a failure here shouldn't block sign-in itself,
// it just means they're treated as a non-admin and/or don't show up in
// the admin Users list yet.
async function finishSignIn() {
  try {
    CURRENT_MANAGER.isAdmin = await Store.checkIsAdmin(CURRENT_MANAGER.userRecordName);
  } catch (err) {
    console.warn('Could not check admin status:', err);
    CURRENT_MANAGER.isAdmin = false;
  }
  // Apple only shares name/email on (roughly) the first authorization — a
  // returning sign-in commonly comes back with neither, which would
  // otherwise show the "User a1b2c3" placeholder every time even though a
  // real name was captured (or manually set by an admin) previously. Prefer
  // whatever's already in the directory before falling back to that.
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
  try {
    await Store.upsertDirectoryEntry(CURRENT_MANAGER.userRecordName, CURRENT_MANAGER.name, CURRENT_MANAGER.email, CURRENT_MANAGER.hasRealName);
  } catch (err) {
    console.warn('Could not update user directory entry:', err);
  }
  renderSidebar();
  await enterAfterSignIn();
}

// Managers are only ever assigned to one venue in practice, so skip the
// venue grid and land straight on that venue's hunts. Still falls back to
// the grid for the 0-venue ("not assigned yet") and >1-venue edge cases —
// see the "All Venues" account-menu item / venues breadcrumb for the way
// back if either of those ever comes up. Admins always land on the venues
// grid (showing every venue) — auto-jumping into one particular venue
// doesn't make sense once "all venues" is the point.
async function enterAfterSignIn() {
  if (CURRENT_MANAGER.isAdmin) {
    await goToVenues();
    return;
  }
  try {
    const venues = await Store.venuesForManager(CURRENT_MANAGER.userRecordName);
    if (venues.length === 1) {
      venuesCache = venues;
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
    // Proxy to CloudKit's own (hidden) sign-out button, since CloudKit JS
    // doesn't expose a plain programmatic "sign out" call — it's meant to be
    // triggered by clicking the button it injects into #apple-sign-out-button.
    // This is what makes watchSignOut() (below) resolve and re-arm sign-in.
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

  // whenUserSignsIn()/whenUserSignsOut() are one-shot promises — each
  // resolves exactly once, then is done. To support signing in, out, and
  // back in again within one page load, re-subscribe after each event
  // instead of attaching a single .then() at startup.
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
      watchSignIn(); // still re-arm sign-in even if this listener itself errored
    });
  }

  // setUpAuth() must run first — it's what actually injects the real button
  // into the containers above, and it also resolves with the existing user
  // if a persisted session cookie is still valid (auto-resume). Only start
  // ONE watch chain based on its result (signed in -> watch for sign-out;
  // not signed in -> watch for sign-in) so we never end up with two
  // competing whenUserSignsIn()/whenUserSignsOut() subscriptions racing
  // each other, which is what happens if you start watchSignIn() up front
  // and then separately react to setUpAuth resolving with an identity too.
  // If the token/environment/origin is wrong, this REJECTS (it does not
  // just resolve null) and no button ever gets injected — that's the
  // "no button shows up at all" failure mode, so surface it visibly.
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

/* ---------------------------------------------------------------
   Utils
------------------------------------------------------------------ */

function escapeHTML(str) {
  return (str ?? '').replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[m]));
}
function escapeAttr(str) { return escapeHTML(str); }
