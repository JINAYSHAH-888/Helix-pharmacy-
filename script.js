const state = {
  data: {},
  dataset: 'medicines',
  visibleRows: [],
  sortKey: null,
  sortDirection: 1,
  searchController: null,
  faultActionController: null,
  faultBusy: false,
  reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
};

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const number = (value) => new Intl.NumberFormat('en-IN').format(value ?? 0);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[character]));
const jsonText = (value) => typeof value === 'object' ? JSON.stringify(value) : String(value ?? '—');

function statusClass(value) {
  const status = String(value ?? '').toUpperCase();
  if (['ONLINE', 'SYNCED', 'CONFIRMED', 'HEALTHY', 'VERIFIED', 'FULLY_DISPENSED', 'REPLICATED'].includes(status)) return 'is-good';
  if (['SYNCING', 'PENDING', 'PENDING_SYNC', 'LOCAL_ONLY', 'PARTIALLY_DISPENSED', 'LOW'].includes(status)) return 'is-warn';
  if (['OFFLINE', 'DEGRADED', 'FAILED', 'CONFLICT', 'FLAGGED_DUPLICATE', 'EXPIRED', 'CANCELLED'].includes(status)) return 'is-bad';
  return '';
}

function statusMarkup(value) {
  return `<span class="data-state ${statusClass(value)}">${escapeHtml(value ?? 'UNKNOWN')}</span>`;
}

function setGatewayState(mode, label) {
  const stateElement = $('.gateway-state');
  const dot = $('#gateway-dot');
  const text = $('#gateway-label');
  stateElement?.classList.toggle('is-ready', mode === 'ready');
  stateElement?.classList.toggle('is-offline', mode === 'offline');
  dot?.classList.toggle('is-ready', mode === 'ready');
  dot?.classList.toggle('is-offline', mode === 'offline');
  if (text) text.textContent = label;
}

function formatTimestamp(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

async function apiGet(path, controller) {
  const response = await fetch(path, { signal: controller?.signal });
  if (!response.ok) throw new Error(`Gateway returned ${response.status}`);
  return response.json();
}

async function apiPost(path, controller) {
  const response = await fetch(path, { method: 'POST', signal: controller?.signal });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail || `Gateway returned ${response.status}`);
  }
  return response.json();
}

async function loadData({ quiet = false } = {}) {
  if (!quiet) setGatewayState('loading', 'Gateway checking');
  const refreshButton = $('#refresh-button');
  refreshButton?.classList.add('is-loading');
  if (refreshButton) {
    refreshButton.disabled = true;
    refreshButton.setAttribute('aria-busy', 'true');
  }

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 4500);
  try {
    const [overview, network, branches, medicines, prescriptions, inventory, transactions, database, faultTolerance] = await Promise.all([
      apiGet('/api/overview', controller), apiGet('/api/network', controller), apiGet('/api/branches', controller),
      apiGet('/api/medicines', controller), apiGet('/api/prescriptions', controller), apiGet('/api/inventory', controller),
      apiGet('/api/transactions', controller), apiGet('/api/database', controller), apiGet('/api/fault-tolerance', controller),
    ]);
    state.data = { overview, network, branches, medicines, prescriptions, inventory, transactions, database, faultTolerance };
    renderAll();
    setGatewayState('ready', network.mode === 'rmi-live' ? 'RMI gateway live' : 'Catalog mode');
    $('#overview-source').textContent = network.mode === 'rmi-live' ? 'Java gateway · RMI registries reachable' : 'Java gateway · catalog mode';
    $('#overview-status-dot')?.classList.add('is-ready');
    $('#last-updated').textContent = formatTimestamp(overview.generatedAt);
    document.body.dataset.agentState = 'ready';
  } catch (error) {
    setGatewayState('offline', 'Gateway unavailable');
    $('#overview-source').textContent = 'Run ./scripts/start-web.sh to connect';
    $('#overview-status-dot')?.classList.add('is-offline');
    $('#search-feedback').textContent = 'The frontend is ready, but the Java gateway is not reachable.';
    document.body.dataset.agentState = 'gateway-unavailable';
  } finally {
    window.clearTimeout(timer);
    refreshButton?.classList.remove('is-loading');
    if (refreshButton) {
      refreshButton.disabled = false;
      refreshButton.removeAttribute('aria-busy');
    }
  }
}

function renderAll() {
  renderOverview();
  renderNetwork();
  renderFaultTolerance();
  renderTable();
  renderSchema();
  updateDatasetCounts();
  setupScrollReveals();
  if (window.ScrollTrigger) window.ScrollTrigger.refresh();
}

function renderOverview() {
  const overview = state.data.overview;
  const counts = overview?.counts ?? {};
  const inventory = overview?.inventory ?? {};
  const metrics = { ...counts, ...inventory };
  $$('[data-metric]').forEach((element) => {
    element.textContent = number(metrics[element.dataset.metric]);
  });
  const statuses = overview?.branchStatuses ?? {};
  const branchNote = `${statuses.ONLINE ?? 0} online · ${statuses.OFFLINE ?? 0} offline`;
  const primary = $('[data-metric="branches"]')?.closest('.metric-card');
  if (primary) primary.querySelector('.metric-note').textContent = branchNote;
}

function renderNetwork() {
  const network = state.data.network;
  const nodes = network?.nodes ?? [];
  const coordinator = network?.coordinator;
  const coordinatorLabel = $('#coordinator-label');
  const summary = $('.summary-status');
  coordinatorLabel.textContent = coordinator ? `${coordinator} / coordinator` : 'No live coordinator';
  summary.classList.toggle('is-ready', Boolean(coordinator));
  summary.classList.toggle('is-offline', !coordinator);
  $('#network-mode').textContent = String(network?.mode ?? 'catalog-only').toUpperCase();
  $('#reachable-label').textContent = `${network?.reachableNodes ?? 0} / ${network?.totalNodes ?? 6} REACHABLE`;

  $('#node-grid').innerHTML = nodes.map((node) => {
    const reachable = Boolean(node.reachable);
    const status = reachable ? node.effectiveStatus : 'OFFLINE';
    return `<article class="node-card ${node.coordinator ? 'is-coordinator' : ''}">
      <div class="node-card-head"><span>NODE ${String(node.nodeId).padStart(2, '0')}</span><span>PORT ${node.port}</span></div>
      <h3>${escapeHtml(node.name)}</h3>
      <p>${escapeHtml(node.branchName)} · ${escapeHtml(node.city)}<br />${escapeHtml(node.branchCode)}</p>
      <div class="node-meta"><span class="node-status ${reachable ? 'is-online' : 'is-offline'}"><i></i>${escapeHtml(status)}</span><span>${node.coordinator ? 'COORDINATOR' : reachable ? 'RESPONDING' : 'NO RESPONSE'}</span></div>
    </article>`;
  }).join('') || '<div class="table-empty">No node registry data returned.</div>';
}

function humanPhase(value) {
  return String(value ?? 'WAITING').replaceAll('_', ' ');
}

function renderFaultTolerance() {
  const simulation = state.data.faultTolerance;
  if (!simulation) return;
  const metrics = ['activeNode', 'term', 'replicatedEvents', 'replicationLag', 'failoverCount'];
  metrics.forEach((key) => {
    const element = $(`[data-fault-metric="${key}"]`);
    if (element) element.textContent = key === 'activeNode' ? String(simulation[key] ?? '—') : number(simulation[key]);
  });
  $('#fault-phase').textContent = humanPhase(simulation.phase);
  $('#fault-last-action').textContent = simulation.lastAction || 'No simulation action recorded.';
  $('#fault-mode').textContent = humanPhase(simulation.mode);

  $('#fault-nodes').innerHTML = (simulation.nodes ?? []).map((node) => {
    const stateClass = node.state === 'OFFLINE' ? 'is-failed' : node.state === 'ACTIVE' ? 'is-active' : node.state === 'CATCHING UP' ? 'is-catching-up' : '';
    return `<article class="replica-card ${stateClass}">
      <div><h3>${escapeHtml(node.name)}</h3><p>${escapeHtml(node.branchCode)} · RMI :${node.port}<br />Configured ${escapeHtml(node.configuredRole.toLowerCase())}</p></div>
      <div class="replica-card-meta"><span class="replica-role">${escapeHtml(node.role)}</span><span class="replica-state">${escapeHtml(node.state)}</span><span>${node.caughtUp ? 'LOG CAUGHT UP' : 'REPLAY PENDING'}</span></div>
    </article>`;
  }).join('') || '<div class="fault-empty">No replica state returned.</div>';

  $('#fault-events').innerHTML = (simulation.events ?? []).map((event) => {
    const stateText = humanPhase(event.commitState);
    const eventClass = event.replayed ? 'is-replayed' : event.commitState === 'DEGRADED_COMMIT' ? 'is-degraded' : '';
    return `<li class="replication-event">
      <span class="mono">SEQ ${String(event.sequence).padStart(2, '0')}</span>
      <div><strong>${escapeHtml(event.key)}</strong><small>${escapeHtml(event.payload)} · term ${event.term} · ${escapeHtml(event.committedBy)}</small></div>
      <div><span class="event-state ${eventClass}">${escapeHtml(stateText)}</span><div class="replication-checks"><span class="${event.primaryAck ? 'is-ack' : ''}"><i></i> MUM</span><span class="${event.backupAck ? 'is-ack' : ''}"><i></i> PUN</span></div></div>
    </li>`;
  }).join('') || '<li class="fault-empty">No events have been committed.</li>';

  $('#fault-audit').innerHTML = (simulation.audit ?? []).slice(0, 5).map((entry) => `<div class="audit-entry"><span class="mono">${escapeHtml(entry.type)} · T${entry.term}</span><span>${escapeHtml(entry.message)}</span></div>`).join('');
  const controls = simulation.controls ?? {};
  const buttonStates = { append: controls.canAppend !== false, fail: controls.canFailPrimary === true, recover: controls.canRecoverPrimary === true, reset: controls.canReset !== false };
  Object.entries(buttonStates).forEach(([key, enabled]) => {
    const button = $(`#fault-${key}`);
    if (!button || state.faultBusy) return;
    button.disabled = !enabled;
  });
  document.body.dataset.faultPhase = String(simulation.phase || '').toLowerCase();
}

async function runFaultToleranceAction(action) {
  if (state.faultBusy) return;
  state.faultBusy = true;
  state.faultActionController?.abort();
  state.faultActionController = new AbortController();
  $$('.fault-button').forEach((button) => {
    button.disabled = true;
    button.classList.add('is-loading');
    button.setAttribute('aria-busy', 'true');
  });
  try {
    const payload = await apiPost(`/api/fault-tolerance/action?action=${encodeURIComponent(action)}`, state.faultActionController);
    state.data.faultTolerance = payload;
    renderFaultTolerance();
  } catch (error) {
    if (error.name !== 'AbortError') {
      $('#fault-last-action').textContent = 'The simulation action could not reach the Java gateway.';
    }
  } finally {
    state.faultBusy = false;
    $$('.fault-button').forEach((button) => {
      button.classList.remove('is-loading');
      button.removeAttribute('aria-busy');
    });
    renderFaultTolerance();
  }
}

function setupFaultToleranceInteractions() {
  const actions = { 'fault-append': 'append', 'fault-fail': 'fail-primary', 'fault-recover': 'recover-primary', 'fault-reset': 'reset' };
  Object.entries(actions).forEach(([id, action]) => {
    $(`#${id}`)?.addEventListener('click', () => runFaultToleranceAction(action));
  });
}

const datasetConfig = {
  medicines: {
    label: 'MEDICINES',
    columns: [
      { key: 'code', label: 'Medicine', cell: (row) => `<strong>${escapeHtml(row.code)}</strong><small>${escapeHtml(row.name)}</small>`, trigger: true },
      { key: 'genericName', label: 'Generic / category', cell: (row) => `${escapeHtml(row.genericName)}<br /><small>${escapeHtml(row.category)}</small>` },
      { key: 'stockUnits', label: 'Stock units', cell: (row) => number(row.stockUnits) },
      { key: 'manufacturer', label: 'Manufacturer', cell: (row) => escapeHtml(row.manufacturer) },
      { key: 'controlled', label: 'Control', cell: (row) => row.controlled ? statusMarkup(row.scheduleClass) : statusMarkup('STANDARD') },
    ],
  },
  prescriptions: {
    label: 'PRESCRIPTIONS',
    columns: [
      { key: 'id', label: 'Prescription', cell: (row) => `<strong>${escapeHtml(row.id.slice(0, 16))}…</strong><small>${escapeHtml(row.hash.slice(0, 18))}…</small>`, trigger: true },
      { key: 'patientName', label: 'Patient / doctor', cell: (row) => `${escapeHtml(row.patientName)}<br /><small>${escapeHtml(row.doctorName)}</small>` },
      { key: 'medicineName', label: 'Medicine', cell: (row) => `${escapeHtml(row.medicineCode)}<br /><small>${escapeHtml(row.medicineName)}</small>` },
      { key: 'branchCode', label: 'Branch', cell: (row) => `${escapeHtml(row.branchCode)}<br /><small>${escapeHtml(row.branchCity)}</small>` },
      { key: 'status', label: 'Status', cell: (row) => statusMarkup(row.status) },
      { key: 'expiryDate', label: 'Expiry', cell: (row) => escapeHtml(row.expiryDate) },
    ],
  },
  inventory: {
    label: 'INVENTORY',
    columns: [
      { key: 'branchCode', label: 'Branch', cell: (row) => `<strong>${escapeHtml(row.branchCode)}</strong><small>${escapeHtml(row.branchCity)}</small>`, trigger: true },
      { key: 'medicineCode', label: 'Medicine', cell: (row) => `${escapeHtml(row.medicineCode)}<br /><small>${escapeHtml(row.medicineName)}</small>` },
      { key: 'quantity', label: 'Quantity', cell: (row) => `${number(row.quantity)}<br /><small>reorder ${number(row.reorderThreshold)}</small>` },
      { key: 'stockState', label: 'Stock state', cell: (row) => statusMarkup(row.stockState) },
      { key: 'syncStatus', label: 'Sync', cell: (row) => statusMarkup(row.syncStatus) },
      { key: 'vectorClock', label: 'Vector clock', cell: (row) => `<span class="mono">${escapeHtml(jsonText(row.vectorClock))}</span>` },
    ],
  },
  transactions: {
    label: 'DISPENSING LEDGER',
    columns: [
      { key: 'id', label: 'Transaction', cell: (row) => `<strong>${escapeHtml(row.id.slice(0, 16))}…</strong><small>${escapeHtml(row.dispensedAt)}</small>`, trigger: true },
      { key: 'prescriptionId', label: 'Prescription / patient', cell: (row) => `${escapeHtml(row.prescriptionId.slice(0, 16))}…<br /><small>${escapeHtml(row.patientName)}</small>` },
      { key: 'branchCode', label: 'Branch', cell: (row) => `${escapeHtml(row.branchCode)}<br /><small>${escapeHtml(row.branchCity)}</small>` },
      { key: 'quantity', label: 'Quantity', cell: (row) => `${number(row.quantity)} units` },
      { key: 'idempotencyKey', label: 'Idempotency key', cell: (row) => `<span class="mono">${escapeHtml(row.idempotencyKey)}</span>` },
      { key: 'syncStatus', label: 'Sync', cell: (row) => statusMarkup(row.syncStatus) },
    ],
  },
  branches: {
    label: 'BRANCH REGISTRY',
    columns: [
      { key: 'code', label: 'Branch', cell: (row) => `<strong>${escapeHtml(row.code)}</strong><small>${escapeHtml(row.name)}</small>`, trigger: true },
      { key: 'city', label: 'City / state', cell: (row) => `${escapeHtml(row.city)}<br /><small>${escapeHtml(row.state)}</small>` },
      { key: 'nodeId', label: 'Node', cell: (row) => `NODE ${String(row.nodeId).padStart(2, '0')}<br /><small>RMI :${row.port}</small>` },
      { key: 'declaredStatus', label: 'Declared', cell: (row) => statusMarkup(row.declaredStatus) },
      { key: 'effectiveStatus', label: 'Effective', cell: (row) => statusMarkup(row.effectiveStatus) },
      { key: 'reachable', label: 'Probe', cell: (row) => statusMarkup(row.reachable ? 'REACHABLE' : 'NO RESPONSE') },
    ],
  },
};

function renderTable() {
  const config = datasetConfig[state.dataset];
  const source = state.data[state.dataset]?.items ?? [];
  const rows = [...source];
  if (state.sortKey) {
    rows.sort((left, right) => String(left[state.sortKey] ?? '').localeCompare(String(right[state.sortKey] ?? ''), undefined, { numeric: true }) * state.sortDirection);
  }
  state.visibleRows = rows;
  $('#table-kicker').textContent = config.label;
  $('#table-summary').textContent = `${number(rows.length)} records · ${state.sortKey ? `sorted by ${state.sortKey}` : 'source order'}`;
  $('#table-state').textContent = 'READ ONLY';
  $('#data-head').innerHTML = `<tr>${config.columns.map((column) => `<th scope="col"><button type="button" data-sort="${column.key}">${escapeHtml(column.label)} ${state.sortKey === column.key ? (state.sortDirection === 1 ? '↑' : '↓') : ''}</button></th>`).join('')}</tr>`;
  $('#data-body').innerHTML = rows.length ? rows.map((row) => `<tr>${config.columns.map((column) => `<td>${column.trigger ? `<button class="record-trigger" type="button" data-row-id="${escapeHtml(row.id ?? row.code)}">${column.cell(row)}</button>` : column.cell(row)}</td>`).join('')}</tr>`).join('') : '<tr><td class="table-empty" colspan="6">No records in this collection.</td></tr>';
}

function updateDatasetCounts() {
  $$('.dataset-tab').forEach((tab) => {
    const dataset = tab.dataset.dataset;
    const count = state.data[dataset]?.items?.length;
    if (typeof count === 'number') tab.querySelector('b').textContent = String(count).padStart(2, '0');
  });
}

function renderSchema() {
  const tables = state.data.database?.tables ?? [];
  $('#schema-list').innerHTML = tables.map((table) => `<article class="schema-row"><strong>${escapeHtml(table.name)}</strong><span class="mono">${number(table.rows)}</span><span>${escapeHtml(table.role)}</span><span>${escapeHtml(table.consistency)}</span><span class="mono">${escapeHtml(table.keyFields)}</span></article>`).join('') || '<div class="schema-empty">No schema map returned.</div>';
}

function openRecord(row) {
  const dialog = $('#record-dialog');
  if (!dialog) return;
  const entries = Object.entries(row).filter(([key]) => key !== 'hash' || row.hash);
  const title = row.name || row.patientName || row.id || row.code || row.branchCode || 'Record';
  $('#dialog-content').innerHTML = `<p class="dialog-eyebrow">${escapeHtml(state.dataset.toUpperCase())} / RECORD DETAIL</p><h2 id="dialog-title">${escapeHtml(title)}</h2><div class="dialog-meta">${entries.map(([key, value]) => `<div><span class="mono">${escapeHtml(key.replace(/[A-Z]/g, (letter) => ` ${letter}`).toUpperCase())}</span><strong>${escapeHtml(jsonText(value))}</strong></div>`).join('')}</div>`;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else {
    dialog.setAttribute('open', '');
    dialog.classList.add('is-open');
    document.body.classList.add('dialog-open');
  }
}

function closeRecordDialog() {
  const dialog = $('#record-dialog');
  if (!dialog) return;
  if (typeof dialog.close === 'function') dialog.close();
  dialog.removeAttribute('open');
  dialog.classList.remove('is-open');
  document.body.classList.remove('dialog-open');
}

function renderSearchResults(payload) {
  const results = $('#routed-results');
  const feedback = $('#search-feedback');
  const records = payload.records ?? [];
  const rmi = payload.rmi ?? {};
  feedback.textContent = `${number(payload.total)} related record${payload.total === 1 ? '' : 's'} · ${rmi.connected ? 'routed through Mumbai RMI router' : 'local catalogue view'}`;
  const recordList = records.length ? records.map((record) => `<div class="result-row"><span class="mono">${escapeHtml(record.kind)}</span><div><strong>${escapeHtml(record.title)}</strong><br /><small>${escapeHtml(record.subtitle)}</small></div><span class="mono">${escapeHtml(record.location)}</span></div>`).join('') : '<div class="result-row"><span class="mono">EMPTY</span><div><strong>No matching records</strong><br /><small>Try a medicine code, patient name, or idempotency key.</small></div></div>';
  const nodes = rmi.nodes ?? [];
  const routeDetail = rmi.connected ? `<h3>RMI route</h3><p>Lamport reply timestamp: <strong>${escapeHtml(rmi.lamportTimestamp)}</strong></p>${nodes.map((node) => `<div class="result-node"><span>${escapeHtml(node.name)}</span><span>${number(node.matches)} matches</span></div>`).join('')}` : `<h3>Route status</h3><p>${escapeHtml(rmi.message ?? 'RMI router unavailable; local catalogue remains readable.')}</p>`;
  results.innerHTML = `<div class="result-list">${recordList}</div><aside class="result-side">${routeDetail}</aside>`;
  results.hidden = false;
}

async function runSearch(event) {
  event.preventDefault();
  const input = $('#search-input');
  const query = input.value.trim();
  if (!query) {
    $('#search-feedback').textContent = 'Enter a query before routing it through the system.';
    $('#routed-results').hidden = true;
    input.focus();
    return;
  }
  state.searchController?.abort();
  state.searchController = new AbortController();
  $('#search-feedback').textContent = 'Routing query across the catalogue…';
  const type = $('#search-type').value;
  try {
    const payload = await apiGet(`/api/search?type=${encodeURIComponent(type)}&q=${encodeURIComponent(query)}`, state.searchController);
    renderSearchResults(payload);
  } catch (error) {
    $('#search-feedback').textContent = 'Search could not reach the gateway. Check that the Java web server is running.';
    $('#routed-results').hidden = true;
  }
}

function setupDataInteractions() {
  $('#refresh-button')?.addEventListener('click', () => loadData());
  $('#search-form')?.addEventListener('submit', runSearch);
  $('#search-input')?.addEventListener('input', (event) => {
    $('#clear-search').hidden = !event.target.value;
  });
  $('#clear-search')?.addEventListener('click', () => {
    $('#search-input').value = '';
    $('#clear-search').hidden = true;
    $('#search-feedback').textContent = '';
    $('#routed-results').hidden = true;
    $('#search-input').focus();
  });
  $$('.dataset-tab').forEach((tab) => tab.addEventListener('click', () => {
    state.dataset = tab.dataset.dataset;
    state.sortKey = null;
    $$('.dataset-tab').forEach((other) => {
      const active = other === tab;
      other.classList.toggle('is-active', active);
      other.setAttribute('aria-selected', String(active));
    });
    renderTable();
  }));
  $('#data-head')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-sort]');
    if (!button) return;
    const key = button.dataset.sort;
    state.sortDirection = state.sortKey === key ? state.sortDirection * -1 : 1;
    state.sortKey = key;
    renderTable();
  });
  $('#data-body')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-row-id]');
    if (!button) return;
    const row = state.visibleRows.find((item) => String(item.id ?? item.code) === button.dataset.rowId);
    if (row) openRecord(row);
  });
  $('#dialog-close')?.addEventListener('click', closeRecordDialog);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeRecordDialog();
  });
}

function setupScrollReveals() {
  if (!window.gsap || !window.ScrollTrigger || state.reducedMotion) return;
  $$('.reveal-section').forEach((section) => {
    if (section.dataset.motionReady) return;
    section.dataset.motionReady = 'true';
    gsap.from(section.querySelectorAll('.section-rule, .overview-intro, .network-intro, .fault-intro, .explorer-intro, .database-intro, .metric-card, .node-card, .explorer-shell, .protocol-grid, .schema-row, .fault-toolbar, .fault-metrics, .fault-grid, .fault-sequence, .repl-console, .repl-notes'), {
      y: 28, opacity: 0, duration: .7, stagger: .045, ease: 'power2.out', scrollTrigger: { trigger: section, start: 'top 78%', once: true }
    });
  });
}

function setupCapsuleOpening() {
  const canvas = $('#capsule-canvas');
  const scene = $('.tablet-scene');
  const sequence = $('.capsule-frame-sequence');
  if (!canvas || !scene || !window.gsap || !window.ScrollTrigger) {
    document.body.classList.remove('opening-active');
    return;
  }
  const ctx = canvas.getContext('2d', { alpha: false });
  gsap.registerPlugin(ScrollTrigger, ...(window.ScrollSmoother ? [window.ScrollSmoother] : []));
  if (window.ScrollSmoother && !state.reducedMotion) {
    try {
      ScrollSmoother.create({ wrapper: '#smooth-wrapper', content: '#smooth-content', smooth: 1.1, effects: true, normalizeScroll: true });
    } catch (error) {
      console.warn('ScrollSmoother unavailable; using native scroll.', error);
    }
  }

  // Vector fallback timeline — used only if the frame images fail to load.
  const sceneConfig = {
    trigger: scene, start: 'top top', end: 'bottom bottom', scrub: 1.05,
    pin: '.tablet-stage', pinSpacing: false, invalidateOnRefresh: true,
    onLeave: () => document.body.classList.remove('opening-active'),
    onEnterBack: () => document.body.classList.add('opening-active'),
  };
  let fallbackReveal = null;
  const buildVectorFallback = () => {
    fallbackReveal = gsap.timeline({ scrollTrigger: sceneConfig });
    fallbackReveal
      .to('.tablet-top', { x: '-=34', y: '-=205', rotationZ: -5, rotationX: -18, duration: .34, ease: 'power2.out' }, 0)
      .to('.tablet-bottom', { x: '+=34', y: '+=205', rotationZ: 5, rotationX: 18, duration: .34, ease: 'power2.out' }, 0)
      .to('.tablet-inside', { scale: 2.05, duration: .42, ease: 'power2.inOut' }, .18)
      .to('.tablet-stage', { scale: 1.2, duration: .42, ease: 'power2.inOut' }, .18)
      .to('.tablet-stage', { scale: 1, duration: .18, ease: 'power2.out' }, .7)
      .to('.tablet-top, .tablet-bottom', { opacity: 0, duration: .11 }, .71)
      .to('.tablet-inside', { opacity: 0, scale: .8, duration: .14 }, .8)
      .to('.tablet-shadow', { opacity: 0, duration: .14 }, .8);
  };

  const frameCount = 100;
  const frameUrl = (index) => `frames/frame_${String(index + 1).padStart(3, '0')}.jpg`;
  const images = new Array(frameCount);
  const proxy = { frame: 0 };
  let lastDrawn = -1;
  let lastW = 0;
  let lastH = 0;

  const sizeCanvas = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    // Size from the viewport, not canvas.clientWidth: the stage is always full
    // screen, and clientWidth can read 0 during ScrollSmoother/pin layout setup,
    // which would leave the canvas at its 300x150 default (blurry).
    const cw = canvas.clientWidth || window.innerWidth;
    const ch = canvas.clientHeight || window.innerHeight;
    const w = Math.round(cw * dpr);
    const h = Math.round(ch * dpr);
    if (!w || !h) return false;
    if (w === lastW && h === lastH) return false;
    canvas.width = lastW = w;
    canvas.height = lastH = h;
    return true;
  };

  // Draw one frame to the canvas with cover/contain fit and high-quality scaling.
  const draw = (value, force = false) => {
    const index = Math.max(0, Math.min(frameCount - 1, Math.round(value)));
    const img = images[index];
    if (!img || !img.complete || !img.naturalWidth) return;
    if (!force && index === lastDrawn) return;
    lastDrawn = index;
    const cw = canvas.width;
    const ch = canvas.height;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    // Cover on wide viewports for a full-bleed hero; contain on narrow/portrait
    // so the capsule is never cropped when the halves swing open.
    const portrait = cw / ch < 1.2;
    const scale = portrait
      ? Math.min(cw / iw, ch / ih)
      : Math.max(cw / iw, ch / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    const dx = (cw - dw) / 2;
    const dy = (ch - dh) / 2;
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--paper') || '#f3f2ec';
    ctx.fillRect(0, 0, cw, ch);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, dx, dy, dw, dh);
  };

  const redraw = () => { sizeCanvas(); draw(proxy.frame, true); };

  let scrubTrigger = null;
  const startSequence = () => {
    sequence.classList.remove('is-loading');
    sequence.classList.add('is-ready');
    gsap.set('.tablet, .tablet-inside, .tablet-shadow', { autoAlpha: 0 });
    sizeCanvas();
    draw(0, true);
    // Corrective repaints in case the first sizing raced with layout/font load.
    requestAnimationFrame(redraw);
    window.addEventListener('load', redraw, { once: true });

    if (state.reducedMotion) {
      // No scroll-scrub: collapse the tall scene and show the final frame.
      scene.style.height = '100vh';
      draw(frameCount - 1, true);
      document.body.classList.remove('opening-active');
      ScrollTrigger.refresh();
      return;
    }

    scrubTrigger = gsap.to(proxy, {
      frame: frameCount - 1,
      ease: 'none',
      scrollTrigger: {
        trigger: scene,
        start: 'top top',
        end: 'bottom bottom',
        scrub: 1,
        pin: '.tablet-stage',
        pinSpacing: false,
        anticipatePin: 1,
        invalidateOnRefresh: true,
        onUpdate: () => draw(proxy.frame),
        onLeave: () => document.body.classList.remove('opening-active'),
        onEnterBack: () => document.body.classList.add('opening-active'),
      },
    });
    ScrollTrigger.refresh();
  };

  // Preload every frame; start scrubbing as soon as the first is ready and
  // refresh once the whole sequence has decoded so scroll math is accurate.
  let loaded = 0;
  const onFrameReady = (index) => {
    loaded += 1;
    if (index === lastDrawn) draw(proxy.frame, true);
    if (loaded === frameCount) ScrollTrigger.refresh();
  };

  const first = new Image();
  first.decoding = 'async';
  first.onload = () => {
    images[0] = first;
    startSequence();
    for (let index = 1; index < frameCount; index += 1) {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => onFrameReady(index);
      image.onerror = () => onFrameReady(index);
      image.src = frameUrl(index);
      images[index] = image;
    }
  };
  first.onerror = () => {
    // Frames unavailable — fall back to the pure-CSS vector capsule.
    console.warn('Capsule frames failed to load; using vector fallback.');
    buildVectorFallback();
    ScrollTrigger.refresh();
  };

  sequence.classList.add('is-loading');
  first.src = frameUrl(0);

  window.addEventListener('resize', redraw, { passive: true });
  // A refresh (pin re-measure, resize, layout change) can resize — and thereby
  // clear — the canvas, so always repaint the current frame afterwards.
  ScrollTrigger.addEventListener('refresh', redraw);
};

/* ── Consistency & replication lab ────────────────────────────────
 * A self-contained, client-side single-leader replication model.
 * Mumbai is the leader; a write is appended to the leader's log with a
 * monotonic version, then fanned out to five followers with per-node
 * latency. A write commits once W replicas (leader included) acknowledge.
 * Reads consult R replicas (strong) or one replica (eventual) and report
 * whether the value returned is the newest committed version.            */
function setupConsistencyLab() {
  const rail = $('#repl-nodes');
  const eventsList = $('#repl-events');
  if (!rail || !eventsList) return;

  const NODES = [
    { id: 'MUM', name: 'Mumbai', leader: true },
    { id: 'PUN', name: 'Pune' },
    { id: 'DEL', name: 'Delhi' },
    { id: 'BLR', name: 'Bengaluru' },
    { id: 'HYD', name: 'Hyderabad' },
    { id: 'CHN', name: 'Chennai' },
  ];

  const model = {
    mode: 'strong',
    W: 2,
    R: 2,
    key: 'stock:MED-0008',
    version: 0,           // leader's authoritative version for the active key
    committedValue: null, // last value the leader committed for the active key
    commits: 0,
    staleReads: 0,
    opSeq: 0,
    busy: false,
    events: [],
    timers: [],
  };

  // Per-node runtime state keyed by node id.
  const nodeState = {};
  NODES.forEach((node) => {
    nodeState[node.id] = { up: true, value: null, version: 0, acking: false };
  });

  const N = NODES.length;
  const els = {
    w: $('#repl-w'), r: $('#repl-r'),
    wVal: $('#repl-w-val'), rVal: $('#repl-r-val'),
    verdict: $('#repl-verdict'), keyLabel: $('#repl-key-label'),
    writeForm: $('#repl-write-form'), readForm: $('#repl-read-form'),
    keyInput: $('#repl-key'), valueInput: $('#repl-value'), readKeyInput: $('#repl-read-key'),
    writeBtn: $('#repl-write-btn'), readBtn: $('#repl-read-btn'), reset: $('#repl-reset'),
  };
  const metric = (name) => $(`[data-repl-metric="${name}"]`);

  const clearTimers = () => { model.timers.forEach((id) => clearTimeout(id)); model.timers = []; };
  const later = (fn, ms) => { const id = window.setTimeout(fn, ms); model.timers.push(id); return id; };

  const upNodes = () => NODES.filter((node) => nodeState[node.id].up);
  const inSyncCount = () => NODES.filter((node) => nodeState[node.id].version === model.version).length;
  const maxLag = () => model.version === 0 ? 0
    : Math.max(0, ...NODES.map((node) => model.version - nodeState[node.id].version));

  function quorumVerdict() {
    const strongByQuorum = model.W + model.R > N;
    if (model.mode === 'eventual') {
      return { cls: 'is-eventual', text: `EVENTUAL · reads hit 1 replica · may return a stale value until replication catches up` };
    }
    if (strongByQuorum) {
      return { cls: 'is-strong', text: `STRONG · W(${model.W}) + R(${model.R}) = ${model.W + model.R} > N(${N}) · read & write sets overlap, newest value guaranteed` };
    }
    return { cls: 'is-eventual', text: `WEAK · W(${model.W}) + R(${model.R}) = ${model.W + model.R} ≤ N(${N}) · sets may not overlap, a read can miss the latest write` };
  }

  function renderConfig() {
    els.wVal.textContent = model.W;
    els.rVal.textContent = model.R;
    const v = quorumVerdict();
    els.verdict.className = `repl-verdict ${v.cls}`;
    els.verdict.textContent = v.text;
  }

  function renderMetrics() {
    metric('version').textContent = `v${model.version}`;
    metric('commits').textContent = model.commits;
    metric('insync').textContent = `${inSyncCount()} / ${N}`;
    metric('lag').textContent = maxLag();
    metric('stale').textContent = model.staleReads;
  }

  function renderNodes() {
    rail.innerHTML = '';
    NODES.forEach((node) => {
      const st = nodeState[node.id];
      const lagging = st.up && st.version < model.version;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'repl-node';
      if (node.leader) button.classList.add('is-leader-node');
      if (!st.up) button.classList.add('is-down');
      else if (lagging) button.classList.add('is-lagging');
      if (st.acking) button.classList.add('is-acking');
      const statusText = !st.up ? 'partitioned' : lagging ? `behind by ${model.version - st.version}` : 'in sync';
      button.innerHTML = `
        <div class="repl-node-head">
          <span class="repl-node-name">${node.name}</span>
          <span class="repl-role ${node.leader ? 'is-leader' : ''}">${node.leader ? 'LEADER' : 'FOLLOWER'}</span>
        </div>
        <div class="repl-node-status"><i></i>${statusText}</div>
        <div class="repl-node-progress"><i style="width:${model.version ? Math.round((st.version / model.version) * 100) : 0}%"></i></div>
        <div class="repl-node-store">
          <div class="repl-node-value">${st.value === null ? '—' : escapeHtml(st.value)}</div>
          <div class="repl-node-version">version v${st.version}</div>
        </div>`;
      button.addEventListener('click', () => togglePartition(node.id));
      rail.appendChild(button);
    });
  }

  function renderEvents() {
    if (!model.events.length) {
      eventsList.innerHTML = '<li class="fault-empty">Write a record to watch it replicate across the cluster.</li>';
      return;
    }
    eventsList.innerHTML = model.events.slice(0, 9).map((event) => `
      <li class="replication-event">
        <span class="mono">${event.tag}</span>
        <div><strong>${escapeHtml(event.title)}</strong><small>${escapeHtml(event.detail)}</small></div>
        <span class="repl-event-verdict ${event.verdictCls || ''}">${escapeHtml(event.verdict || '')}</span>
      </li>`).join('');
  }

  function renderAll() { renderConfig(); renderMetrics(); renderNodes(); renderEvents(); }

  function pushEvent(event) {
    model.events.unshift(event);
    if (model.events.length > 30) model.events.pop();
    renderEvents();
  }

  function setBusy(busy) {
    model.busy = busy;
    els.writeBtn.disabled = busy;
    els.readBtn.disabled = busy;
    els.writeBtn.classList.toggle('is-loading', busy);
  }

  function togglePartition(id) {
    if (model.busy) return;
    const st = nodeState[id];
    if (NODES.find((node) => node.id === id).leader && st.up) {
      // Keep the demo coherent: the leader can't be partitioned here.
      pushEvent({ tag: 'NOTE', title: 'Leader stays reachable', detail: 'Partition a follower instead — leader failover lives in the fault lab.', verdict: '', verdictCls: '' });
      return;
    }
    st.up = !st.up;
    if (st.up) {
      // Rejoin: replay the log up to the committed version.
      st.value = model.committedValue;
      st.version = model.version;
      pushEvent({ tag: 'REJOIN', title: `${labelFor(id)} rejoined the cluster`, detail: `Replayed replication log → caught up to v${model.version}.`, verdict: 'IN SYNC', verdictCls: 'is-fresh' });
    } else {
      pushEvent({ tag: 'PART', title: `${labelFor(id)} partitioned`, detail: 'Node stops acknowledging writes and may serve stale reads.', verdict: 'OFFLINE', verdictCls: 'is-stale' });
    }
    renderAll();
  }

  const labelFor = (id) => NODES.find((node) => node.id === id).name;

  function doWrite(key, value) {
    if (model.busy) return;
    // Switching keys resets the per-key version view for clarity.
    if (key !== model.key) {
      model.key = key;
      model.version = 0;
      model.committedValue = null;
      NODES.forEach((node) => { nodeState[node.id].value = null; nodeState[node.id].version = 0; });
      els.keyLabel.textContent = key;
    }

    const reachable = upNodes();
    const opId = `W${String(++model.opSeq).padStart(2, '0')}`;
    const version = model.version + 1;

    if (model.mode === 'strong' && reachable.length < model.W) {
      pushEvent({ tag: opId, title: `set(${escapeHtml(key)} = ${escapeHtml(value)}) rejected`, detail: `Only ${reachable.length} replica(s) reachable — cannot meet W=${model.W}. Write refused to protect consistency.`, verdict: 'BLOCKED', verdictCls: 'is-blocked' });
      renderMetrics();
      return;
    }

    setBusy(true);
    model.version = version;
    const leader = NODES[0];
    nodeState[leader.id].value = value;
    nodeState[leader.id].version = version;

    pushEvent({ tag: opId, title: `Leader ${leader.name} accepted set(${escapeHtml(key)} = ${escapeHtml(value)})`, detail: `Appended to replication log as v${version}. Fanning out to followers…`, verdict: `ACK 1/${model.W}`, verdictCls: '' });
    renderNodes();
    renderMetrics();

    let acks = 1;             // leader counts as the first ack
    let committed = false;
    const followers = NODES.slice(1).filter((node) => nodeState[node.id].up);
    let pending = followers.length;

    const finish = () => {
      setBusy(false);
      if (!committed && model.mode === 'strong') {
        pushEvent({ tag: opId, title: `set ${escapeHtml(key)} = ${escapeHtml(value)} did not reach quorum`, detail: `Only ${acks}/${model.W} acknowledgements. Value held un-committed on the leader.`, verdict: 'NO QUORUM', verdictCls: 'is-blocked' });
      }
      renderAll();
    };

    if (!followers.length) {
      // Nothing to replicate to; decide purely on the leader ack.
      if (acks >= model.W) commitWrite(opId, key, value, version, acks);
      later(finish, 200);
      return;
    }

    followers.forEach((node) => {
      const st = nodeState[node.id];
      st.acking = true;
      const latency = 350 + Math.round(Math.random() * 1150);
      later(() => {
        st.acking = false;
        st.value = value;
        st.version = version;
        acks += 1;
        renderNodes();
        renderMetrics();
        pushEvent({ tag: opId, title: `${node.name} replicated v${version}`, detail: `Applied set(${escapeHtml(key)} = ${escapeHtml(value)}) after ${latency} ms.`, verdict: `ACK ${acks}/${model.W}`, verdictCls: acks >= model.W ? 'is-commit' : '' });
        if (!committed && acks >= model.W) {
          committed = true;
          commitWrite(opId, key, value, version, acks);
        }
        pending -= 1;
        if (pending === 0) finish();
      }, latency);
    });

    // Eventual mode still fans out, but commits immediately on the leader.
    if (model.mode === 'eventual' && !committed) {
      committed = true;
      commitWrite(opId, key, value, version, 1, true);
    }
  }

  function commitWrite(opId, key, value, version, acks, eventual = false) {
    model.commits += 1;
    model.committedValue = value;
    const detail = eventual
      ? `Leader committed locally (eventual). Followers converge asynchronously.`
      : `Reached W=${model.W} with ${acks} acknowledgements. Value is durable.`;
    pushEvent({ tag: opId, title: `COMMIT · ${escapeHtml(key)} = ${escapeHtml(value)} @ v${version}`, detail, verdict: 'COMMITTED', verdictCls: 'is-commit' });
    renderMetrics();
  }

  function doRead(key) {
    const opId = `R${String(++model.opSeq).padStart(2, '0')}`;
    if (key !== model.key) {
      pushEvent({ tag: opId, title: `get(${escapeHtml(key)}) → not found`, detail: `No value has been written for this key in the model. Try "${escapeHtml(model.key)}".`, verdict: 'MISS', verdictCls: 'is-stale' });
      return;
    }
    const reachable = upNodes();

    if (model.mode === 'strong') {
      if (reachable.length < model.R) {
        pushEvent({ tag: opId, title: `get(${escapeHtml(key)}) rejected`, detail: `Only ${reachable.length} replica(s) reachable — cannot meet R=${model.R}.`, verdict: 'BLOCKED', verdictCls: 'is-blocked' });
        return;
      }
      // Query R replicas, prefer the leader, and take the newest version.
      const quorum = reachable.slice(0, model.R);
      const newest = quorum.reduce((best, node) => nodeState[node.id].version > best.version
        ? { version: nodeState[node.id].version, value: nodeState[node.id].value } : best,
        { version: -1, value: null });
      const fresh = newest.version === model.version;
      const overlaps = model.W + model.R > N;
      if (!fresh) model.staleReads += 1;
      pushEvent({
        tag: opId,
        title: `get(${escapeHtml(key)}) → ${escapeHtml(String(newest.value))} @ v${newest.version}`,
        detail: `Read quorum R=${model.R} across ${quorum.map((node) => node.id).join(', ')}. ${overlaps ? 'W+R>N guarantees overlap with the latest write.' : 'W+R≤N: quorum may miss the newest write.'}`,
        verdict: fresh ? 'FRESH' : 'STALE',
        verdictCls: fresh ? 'is-fresh' : 'is-stale',
      });
    } else {
      // Eventual: read from a single (random reachable) replica.
      const node = reachable[Math.floor(Math.random() * reachable.length)];
      const st = nodeState[node.id];
      const fresh = st.version === model.version;
      if (!fresh) model.staleReads += 1;
      pushEvent({
        tag: opId,
        title: `get(${escapeHtml(key)}) → ${st.value === null ? '—' : escapeHtml(String(st.value))} @ v${st.version}`,
        detail: `Eventual read from ${node.name} only. ${fresh ? 'This replica is already caught up.' : `Leader is at v${model.version}; this replica has not converged yet.`}`,
        verdict: fresh ? 'FRESH' : 'STALE',
        verdictCls: fresh ? 'is-fresh' : 'is-stale',
      });
    }
    renderMetrics();
  }

  function reset() {
    clearTimers();
    model.version = 0; model.committedValue = null; model.commits = 0;
    model.staleReads = 0; model.opSeq = 0; model.events = []; model.busy = false;
    NODES.forEach((node) => { nodeState[node.id] = { up: true, value: null, version: 0, acking: false }; });
    setBusy(false);
    renderAll();
  }

  // ── Wiring ──────────────────────────────────────────────────────
  $$('#repl-mode .repl-seg-btn').forEach((btn) => btn.addEventListener('click', () => {
    model.mode = btn.dataset.mode;
    $$('#repl-mode .repl-seg-btn').forEach((other) => {
      const active = other === btn;
      other.classList.toggle('is-active', active);
      other.setAttribute('aria-selected', String(active));
    });
    renderConfig();
  }));

  els.w.addEventListener('input', () => { model.W = Number(els.w.value); renderConfig(); });
  els.r.addEventListener('input', () => { model.R = Number(els.r.value); renderConfig(); });

  els.writeForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const key = els.keyInput.value.trim();
    const value = els.valueInput.value.trim();
    if (!key || !value) return;
    els.readKeyInput.value = key;
    doWrite(key, value);
  });

  els.readForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const key = els.readKeyInput.value.trim();
    if (!key) return;
    doRead(key);
  });

  els.reset.addEventListener('click', reset);

  renderAll();
}

setupDataInteractions();
setupFaultToleranceInteractions();
setupConsistencyLab();
setupCapsuleOpening();
loadData();
window.addEventListener('resize', () => window.ScrollTrigger?.refresh());
