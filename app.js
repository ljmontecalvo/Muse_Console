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
    { id: 'venue_1', name: 'Riverside Natural History Museum', address: '400 Riverside Dr, Springfield', managers: ['mock_manager'] },
    { id: 'venue_2', name: 'Old Mill Science Center', address: '12 Mill St, Springfield', managers: ['mock_manager'] },
    { id: 'venue_3', name: 'Harbor Maritime Museum', address: '88 Wharf Rd, Bayport', managers: ['someone_else'] },
  ];
  let hunts = [
    { id: 'hunt_1', venueId: 'venue_1', title: 'Dinosaur Trail', description: 'Explore the Mesozoic wing and uncover ancient secrets hiding in every hall.', folder: 'Natural History' },
    { id: 'hunt_2', venueId: 'venue_1', title: 'Gems & Minerals Quest', description: 'A sparkling journey through the earth sciences hall.', folder: 'Natural History' },
    { id: 'hunt_3', venueId: 'venue_2', title: 'Invention Lab Challenge', description: 'Discover the machines and ideas that changed the world.', folder: '' },
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

function assertNoErrors(response) {
  if (response && response.hasErrors) {
    console.warn('CloudKit request had errors:', response.errors);
    const first = response.errors && response.errors[0];
    const reason = (first && (first.reason || first.serverErrorCode)) || 'CloudKit request failed';
    const suffix = response.errors && response.errors.length > 1 ? ` (+${response.errors.length - 1} more)` : '';
    throw new Error(reason + suffix);
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
    folder: (r.fields.folder && r.fields.folder.value) || '',
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
    // nfcTagID intentionally lives on the separate ClueTag record type (not World/Authenticated
    // readable) — CloudKitStore.cluesForHunt merges it in from a batch ClueTag fetch below.
    tagStatus: (r.fields.tagStatus && r.fields.tagStatus.value) || 'pending',
    huntId: r.fields.huntReference && r.fields.huntReference.value && r.fields.huntReference.value.recordName,
  };
}

const CloudKitStore = {

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
    const huntRecord = huntId
      ? {
          recordName: huntId,
          recordChangeTag: huntChangeTag,
          operationType: 'update',
          recordType: 'Hunt',
          fields: { title: { value: data.title }, description: { value: data.description }, folder: { value: data.folder || '' } },
        }
      : { recordType: 'Hunt', fields: { title: { value: data.title }, description: { value: data.description }, folder: { value: data.folder || '' }, venueReference: { value: ckRefSave(venueId) } } };

    const huntResp = await publicDB.saveRecords([huntRecord]);
    assertNoErrors(huntResp);
    const finalHuntId = huntResp.records[0].recordName;

    const currentIds = new Set(clueList.filter(c => c.id && !c.id.startsWith('draft_')).map(c => c.id));
    const toDelete = [...(originalClueIds || [])].filter(id => !currentIds.has(id));

    const toSave = [];
    clueList.forEach((c, i) => {
      const isNew = !c.id || c.id.startsWith('draft_');
      const clueRecordName = isNew ? ('clue_' + crypto.randomUUID()) : c.id;

      const clueRecord = {
        recordType: 'Clue',
        fields: {
          title: { value: c.title },
          body: { value: c.body },
          tagStatus: { value: c.tagStatus || 'pending' },
          order: { value: i },
          huntReference: { value: ckRefSave(finalHuntId) },
        },
      };
      if (!isNew) {
        clueRecord.recordName = clueRecordName;
        clueRecord.recordChangeTag = c.recordChangeTag;
        clueRecord.operationType = 'update';
      } else {
        clueRecord.recordName = clueRecordName;
      }
      toSave.push(clueRecord);

      // nfcTagID lives on the separate ClueTag type (see cluesForHunt) so it's never
      // World/Authenticated readable — save it alongside the Clue in the same batch.
      const tagRecord = {
        recordType: 'ClueTag',
        recordName: clueTagRecordName(clueRecordName),
        fields: {
          nfcTagID: { value: c.nfcTagID },
          clueReference: { value: ckRefSave(clueRecordName) },
        },
      };
      if (c.tagRecordChangeTag) {
        tagRecord.recordChangeTag = c.tagRecordChangeTag;
        tagRecord.operationType = 'update';
      }
      toSave.push(tagRecord);
    });

    if (toSave.length) assertNoErrors(await publicDB.saveRecords(toSave));
    if (toDelete.length) {
      assertNoErrors(await publicDB.deleteRecords([...toDelete, ...toDelete.map(clueTagRecordName)]));
    }

    return finalHuntId;
  },

  async deleteHunt(huntId) {
    const clues = await this.cluesForHunt(huntId);
    if (clues.length) {
      const clueIds = clues.map(c => c.id);
      assertNoErrors(await publicDB.deleteRecords([...clueIds, ...clueIds.map(clueTagRecordName)]));
    }
    assertNoErrors(await publicDB.deleteRecords([huntId]));
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
    const recordName = folderRegistryRecordName(venueId);
    const fetchResp = await publicDB.fetchRecords(recordName);
    const existing = (!fetchResp.hasErrors && fetchResp.records && fetchResp.records[0]) || null;
    const current = (existing && existing.fields.names && existing.fields.names.value) || [];
    if (current.some(f => f.toLowerCase() === trimmed.toLowerCase())) return;
    const updated = [...current, trimmed];
    const record = existing
      ? { recordName, recordChangeTag: existing.recordChangeTag, operationType: 'update', recordType: 'FolderRegistry', fields: { names: { value: updated } } }
      : { recordName, recordType: 'FolderRegistry', fields: { names: { value: updated } } };
    assertNoErrors(await publicDB.saveRecords([record]));
  },

  async setHuntFolder(huntId, recordChangeTag, folder) {
    const response = await publicDB.saveRecords([{
      recordName: huntId,
      recordChangeTag,
      operationType: 'update',
      recordType: 'Hunt',
      fields: { folder: { value: folder || '' } },
    }]);
    assertNoErrors(response);
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
};

let draftClueSeq = 1;
const draftClueId = () => `draft_${draftClueSeq++}`;

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${name}`).classList.add('active');
  document.getElementById('app-shell').style.display = name === 'signin' ? 'none' : 'flex';
  if (name !== 'signin') setActiveNav(name);
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
  const navUsers = document.getElementById('nav-users');
  const navSettings = document.getElementById('nav-settings');
  navVenues.title = 'Venues';
  navVenues.innerHTML = `${icon('building')} <span class="nav-label">Venues</span>`;
  navVenues.addEventListener('click', goToVenues);
  navHuntsHome.title = 'Hunts';
  navHuntsHome.innerHTML = `${icon('map')} <span class="nav-label">Hunts</span>`;
  navHuntsHome.addEventListener('click', goToHuntsHome);
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

function setActiveNav(view) {
  const section = (view === 'hunts' || view === 'editor') ? 'venues' : view;
  ['venues', 'hunts-home', 'users', 'settings'].forEach((id) => {
    const el = document.getElementById(`nav-${id}`);
    if (el) el.classList.toggle('active', id === section);
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

  if (state.creatingFolderVenueId) {
    const creatingEl = listEl.querySelector('.folder-header-creating');
    if (creatingEl) {
      const venueId = state.creatingFolderVenueId;
      const input = creatingEl.querySelector('.folder-new-input');
      input.focus();
      const cancel = () => { state.creatingFolderVenueId = null; renderHuntsHomeList(); };
      const save = async () => {
        const name = input.value.trim();
        if (!name) return;
        try {
          await Store.addFolder(venueId, name);
          state.creatingFolderVenueId = null;
          showToast('checkCircle', 'Folder Added');
          await renderHuntsHomeList();
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
  }

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
      if (hunt) openMoveFolderPicker(actionsEl, hunt);
    });
  });
}

function venueFolderSectionHTML(venue, venueHunts, registryFolders, isCreatingHere, searching, showHeading) {
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
          ${hunts.length ? hunts.map(h => huntHomeRowHTML(h)).join('') : `<div class="folder-empty-hint">No hunts in this folder yet.</div>`}
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

function openMoveFolderPicker(actionsEl, hunt) {
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
      if (name === null) { renderHuntsHomeList(); return; }
      try {
        await Store.setHuntFolder(hunt.id, hunt.recordChangeTag, name);
        showToast('checkCircle', 'Hunt Moved');
        await renderHuntsHomeList();
      } catch (err) {
        showAlert({
          icon: 'triangleExclaim', tone: 'danger', title: 'Could Not Move Hunt',
          message: err.message || 'Something went wrong talking to CloudKit.',
          actions: [{ label: 'OK', style: 'btn-prominent', onClick: closeOverlay }],
        });
        renderHuntsHomeList();
      }
    });
  })();
}

async function goToUsers() {
  state.venueId = null;
  state.huntId = null;
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
    state.draft = { title: h.title, description: h.description, folder: h.folder || '', clues: clueList.map(c => ({ ...c })) };
    state.originalClueIds = new Set(clueList.map(c => c.id));
    state.huntChangeTag = h.recordChangeTag;
  } else {
    state.draft = { title: '', description: '', folder: '', clues: [] };
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

function generateTagID() {
  const all = TAG_LETTERS + TAG_DIGITS + TAG_SYMBOLS;
  const pick = (src) => src[Math.floor(Math.random() * src.length)];

  const chars = [pick(TAG_LETTERS), pick(TAG_DIGITS), pick(TAG_SYMBOLS)];
  while (chars.length < TAG_LENGTH) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
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
      { title, description: state.draft.description.trim(), folder: state.draft.folder.trim() },
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
  try {
    await Store.upsertDirectoryEntry(CURRENT_MANAGER.userRecordName, CURRENT_MANAGER.name, CURRENT_MANAGER.email, CURRENT_MANAGER.hasRealName);
  } catch (err) {
    console.warn('Could not update user directory entry:', err);
  }
  renderSidebar();
  await enterAfterSignIn();
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
