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

const CURRENT_MANAGER = { userRecordName: null, name: '', email: '' };

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
    { id: 'clue_1', huntId: 'hunt_1', order: 0, title: 'Welcome', body: 'Find the massive skeleton greeting visitors at the entrance.', nfcTagID: 'REX-ENTRY-01' },
    { id: 'clue_2', huntId: 'hunt_1', order: 1, title: 'Frozen in Time', body: 'Search for the creature preserved mid-stride in solid amber.', nfcTagID: 'AMBER-04' },
    { id: 'clue_3', huntId: 'hunt_1', order: 2, title: 'Ancient Skies', body: 'Look up — what once soared above the treetops now hangs above you.', nfcTagID: 'PTERO-12' },
    { id: 'clue_4', huntId: 'hunt_2', order: 0, title: 'First Light', body: 'Find the crystal that splits sunlight into a rainbow on the wall.', nfcTagID: 'QUARTZ-A1' },
    { id: 'clue_5', huntId: 'hunt_2', order: 1, title: 'Deep Earth', body: 'Locate the darkest stone in the room, pulled from the deepest mine.', nfcTagID: 'OBSID-B2' },
    { id: 'clue_6', huntId: 'hunt_3', order: 0, title: 'Sparks Fly', body: 'Find the machine that first turned electricity into motion.', nfcTagID: 'MOTOR-01' },
  ];
  let seq = 100;
  const nextId = (prefix) => `${prefix}_${seq++}`;

  return {
    async signIn() {
      return { userRecordName: 'mock_manager', name: 'Landon Montecalvo', email: 'landonjmontecalvo@gmail.com' };
    },
    async resumeSession() { return null; }, // mock never auto-resumes; always show the sign-in screen
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

function ckRef(recordName) {
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
    huntId: r.fields.huntReference && r.fields.huntReference.value && r.fields.huntReference.value.recordName,
  };
}

const CloudKitStore = {
  async signIn() {
    const identity = await container.whenUserSignsIn();
    return identityToManager(identity);
  },
  async resumeSession() {
    const identity = await container.setUpAuth();
    return identity ? identityToManager(identity) : null;
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
      filterBy: [{ fieldName: 'venueReference', comparator: 'EQUALS', fieldValue: { value: ckRef(venueId) } }],
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
      filterBy: [{ fieldName: 'huntReference', comparator: 'EQUALS', fieldValue: { value: ckRef(huntId) } }],
      sortBy: [{ fieldName: 'order', ascending: true }],
    });
    assertNoErrors(response);
    return response.records.map(recordToClue).sort((a, b) => a.order - b.order);
  },

  async saveHunt(huntId, venueId, data, clueList, originalClueIds) {
    const huntRecord = huntId
      ? { recordName: huntId, recordType: 'Hunt', fields: { title: { value: data.title }, description: { value: data.description } } }
      : { recordType: 'Hunt', fields: { title: { value: data.title }, description: { value: data.description }, venueReference: { value: ckRef(venueId) } } };

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
          order: { value: i },
          huntReference: { value: ckRef(finalHuntId) },
        },
      };
      if (!isNew) record.recordName = c.id;
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
  return {
    userRecordName: identity.userRecordName,
    name: nameParts.length ? nameParts.join(' ') : 'Manager',
    email: (identity.lookupInfo && identity.lookupInfo.emailAddress) || '',
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
  expandedClueId: null,
  venueSearch: '',
  huntSearch: '',
};

let draftClueSeq = 1;
const draftClueId = () => `draft_${draftClueSeq++}`;

/* ---------------------------------------------------------------
   View switching
------------------------------------------------------------------ */

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${name}`).classList.add('active');
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
   Topbar / breadcrumbs / account menu
------------------------------------------------------------------ */

function renderTopbar(containerId, crumbs) {
  const el = document.getElementById(containerId);
  const crumbsHTML = crumbs.map((c, i) => {
    const isLast = i === crumbs.length - 1;
    const sep = i > 0 ? `<span class="sep">${icon('chevronRight')}</span>` : '';
    if (isLast) return `${sep}<span class="crumb-current">${c.label}</span>`;
    return `${sep}<span class="crumb-link" data-crumb="${i}">${c.label}</span>`;
  }).join('');

  el.innerHTML = `
    <div class="crumbs">
      <span class="brand" style="margin-right:6px;">
        <span class="mark">M</span><span>Muse Console</span>
      </span>
      ${crumbs.length ? `<span class="sep">${icon('chevronRight')}</span>` : ''}
      ${crumbsHTML}
    </div>
    <div class="account">
      <div class="account-menu-wrap">
        <button class="account-btn" id="account-btn">
          <span class="account-name">${escapeHTML(CURRENT_MANAGER.name)}</span>
          <span class="avatar">${icon('person')}</span>
        </button>
        <div class="account-dropdown glass-strong" id="account-dropdown">
          <div class="who">
            <div class="n">${escapeHTML(CURRENT_MANAGER.name)}</div>
            <div class="e">${escapeHTML(CURRENT_MANAGER.email)}</div>
          </div>
          <div class="dropdown-divider"></div>
          <div class="manager-id-row">
            <span class="mid-label">Manager ID</span>
            <span class="mid-value" title="${escapeAttr(CURRENT_MANAGER.userRecordName || '')}">${escapeHTML(CURRENT_MANAGER.userRecordName || '')}</span>
          </div>
          <button class="dropdown-item" id="menu-copy-id">${icon('tag')} Copy My Manager ID</button>
          <div class="dropdown-divider"></div>
          <button class="dropdown-item" id="menu-venues">${icon('building')} All Venues</button>
          <div class="dropdown-divider"></div>
          <button class="dropdown-item danger" id="menu-signout">${icon('close')} Sign Out</button>
        </div>
      </div>
    </div>
  `;

  crumbs.forEach((c, i) => {
    if (i === crumbs.length - 1) return;
    el.querySelector(`[data-crumb="${i}"]`).addEventListener('click', c.onClick);
  });

  el.querySelector('#account-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    el.querySelector('#account-dropdown').classList.toggle('open');
  });
  el.querySelector('#menu-venues').addEventListener('click', () => { closeAccountMenus(); goToVenues(); });
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
  renderTopbar('topbar-venues', []);
  renderSearchBox('venue-search-box', 'Search venues', state.venueSearch, (v) => {
    state.venueSearch = v;
    renderVenuesGrid();
  });
  showView('venues');
  await renderVenuesGrid();
}

let venuesCache = [];
let venueHuntCounts = {};

async function renderVenuesGrid() {
  const grid = document.getElementById('venues-grid');
  grid.innerHTML = loadingHTML('Loading venues…');

  let all;
  try {
    all = await Store.venuesForManager(CURRENT_MANAGER.userRecordName);
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
    grid.appendChild(emptyState(
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
   Hunts view
------------------------------------------------------------------ */

let huntsCache = [];
let huntClueCounts = {};

async function goToHunts(venueId) {
  state.venueId = venueId;
  state.huntId = null;

  const venue = venuesCache.find(v => v.id === venueId) || await Store.venue(venueId);

  renderTopbar('topbar-hunts', [
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
    const counts = await Promise.all(all.map(h => Store.cluesForHunt(h.id).then(c => c.length).catch(() => 0)));
    huntClueCounts = Object.fromEntries(all.map((h, i) => [h.id, counts[i]]));
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

  listEl.innerHTML = filtered.map(h => `
    <div class="hunt-row glass" data-hunt="${h.id}">
      <div class="hr-icon">${icon('map')}</div>
      <div class="hr-body">
        <div class="hr-title">${escapeHTML(h.title)}</div>
        <div class="hr-sub">${escapeHTML(h.description)}</div>
      </div>
      <div class="hr-meta">
        <span class="hr-count">${huntClueCounts[h.id] ?? 0} clue${huntClueCounts[h.id] === 1 ? '' : 's'}</span>
        ${icon('chevronRight')}
      </div>
    </div>
  `).join('');

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

  renderTopbar('topbar-editor', [
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
  } else {
    state.draft = { title: '', description: '', clues: [] };
    state.originalClueIds = new Set();
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
  const crumbCurrent = document.querySelector('#topbar-editor .crumb-current');
  if (crumbCurrent) crumbCurrent.textContent = state.draft.title || (state.isNewHunt ? 'New Hunt' : 'Hunt');
}

function addClue() {
  state.draft.clues.push({ id: draftClueId(), title: '', body: '', nfcTagID: '' });
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
    const tagInput = row.querySelector('.clue-tag-input');
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
      tagInput.addEventListener('input', (e) => {
        c.nfcTagID = e.target.value;
        const chip = row.querySelector('.clue-tag-chip');
        if (chip) chip.textContent = c.nfcTagID || 'NO TAG';
      });
      row.querySelector('.btn-generate-tag').addEventListener('click', () => {
        c.nfcTagID = generateTagID();
        tagInput.value = c.nfcTagID;
        row.querySelector('.clue-tag-chip').textContent = c.nfcTagID;
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

function clueRowHTML(c, index) {
  const expanded = state.expandedClueId === c.id;
  return `
    <div class="clue-row ${expanded ? 'expanded' : ''}" data-clue-row="${c.id}">
      <div class="clue-summary">
        <span class="clue-handle" title="Drag to reorder">${icon('grip')}</span>
        <span class="clue-order">${index + 1}</span>
        <div class="clue-summary-body">
          <div class="clue-summary-title">${escapeHTML(c.title) || 'Untitled Clue'}</div>
          <div class="clue-summary-body-text">${escapeHTML(c.body) || 'No clue text yet'}</div>
        </div>
        <span class="clue-tag-chip">${escapeHTML(c.nfcTagID) || 'NO TAG'}</span>
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
          <label class="label">NFC Tag ID</label>
          <div class="tag-generate-row">
            <input type="text" class="clue-tag-input mono" value="${escapeAttr(c.nfcTagID)}" placeholder="e.g. REX-ENTRY-01" />
            <button class="btn btn-glass btn-generate-tag" type="button">${icon('wand')} Generate</button>
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

function generateTagID() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const rand = (n, src) => Array.from({ length: n }, () => src[Math.floor(Math.random() * src.length)]).join('');
  return `${rand(4, letters)}-${rand(4, '0123456789')}`;
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
      state.originalClueIds
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

const signInBtn = document.getElementById('btn-signin');
const signInFoot = document.getElementById('signin-foot');
const demoBanner = document.getElementById('demo-banner');

if (USE_MOCK) {
  demoBanner.style.display = 'block';
}

signInBtn.addEventListener('click', async () => {
  signInBtn.disabled = true;
  const originalHTML = signInBtn.innerHTML;
  signInBtn.textContent = 'Signing in…';
  try {
    const manager = await Store.signIn();
    Object.assign(CURRENT_MANAGER, manager);
    await goToVenues();
  } catch (err) {
    signInFoot.textContent = (err && err.message) || 'Sign-in failed. Please try again.';
    signInFoot.style.color = 'var(--red)';
  } finally {
    signInBtn.disabled = false;
    signInBtn.innerHTML = originalHTML;
  }
});

function signOut() {
  state.venueId = null;
  state.huntId = null;
  CURRENT_MANAGER.userRecordName = null;
  CURRENT_MANAGER.name = '';
  CURRENT_MANAGER.email = '';
  // Note: this clears the app's local session only. CloudKit JS doesn't expose
  // a documented programmatic "sign out of Apple ID" call from here — the
  // underlying browser session/cookie may let the user silently resume next
  // time. Verify against current CloudKit JS docs if a hard sign-out matters.
  showView('signin');
}

// Auto-resume a previous session on load (CloudKit persists auth via cookie
// when apiTokenAuth.persist is true).
(async () => {
  try {
    const manager = await Store.resumeSession();
    if (manager) {
      Object.assign(CURRENT_MANAGER, manager);
      await goToVenues();
    }
  } catch (err) {
    console.warn('Could not resume CloudKit session:', err);
  }
})();

/* ---------------------------------------------------------------
   Utils
------------------------------------------------------------------ */

function escapeHTML(str) {
  return (str ?? '').replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[m]));
}
function escapeAttr(str) { return escapeHTML(str); }
