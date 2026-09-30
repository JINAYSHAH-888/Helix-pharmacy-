/* Helixis control room — 03A load balancing lab.
   Every number in this section comes from /api/load-balancer in the Java gateway;
   nothing here simulates a balancer, it only draws the one that ran.

   Wrapped in an IIFE: script.js owns the page's globals ($, $$, escapeHtml,
   setGatewayState, state), and this file needs its own without colliding. */
(() => {

const lb = {
  snapshot: null,
  busy: false,
};

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[character]));
const num = (value, digits = 2) => Number(value ?? 0).toFixed(digits);
const int = (value) => new Intl.NumberFormat('en-IN').format(Math.round(value ?? 0));

const HEALTH_DOT = {
  HEALTHY_RMI: 'legend-dot-good',
  HEALTHY_LOCAL: 'legend-dot-good',
  FAILING: 'legend-dot-warn',
  PROBING: 'legend-dot-warn',
  CIRCUIT_OPEN: 'legend-dot-bad',
};

/* ── gateway ─────────────────────────────────────────────────────────────── */

async function call(path, { method = 'GET' } = {}) {
  const response = await fetch(path, { method });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail || payload.error || `Gateway returned ${response.status}`);
  return payload;
}

async function load() {
  try {
    render(await call('/api/load-balancer'));
  } catch (error) {
    // the header chip belongs to script.js; the lab reports its own trouble in its own status line
    $('#console-status').textContent = 'The Java gateway is not answering. Start it with ./scripts/start-web.sh.';
  }
}

/** Sends one lab action and redraws with whatever the gateway returns. */
async function act(params, busyLabel) {
  if (lb.busy) return;
  lb.busy = true;
  const status = $('#console-status');
  status.classList.add('is-busy');
  status.textContent = busyLabel;
  $$('.console-actions button').forEach((button) => { button.disabled = true; });
  try {
    render(await call(`/api/load-balancer/action?${params}`, { method: 'POST' }));
  } catch (error) {
    status.textContent = `The gateway refused that: ${error.message}`;
  } finally {
    lb.busy = false;
    status.classList.remove('is-busy');
    $$('.console-actions button').forEach((button) => { button.disabled = false; });
  }
}

/* ── render ──────────────────────────────────────────────────────────────── */

function render(snapshot) {
  lb.snapshot = snapshot;
  renderHeadline(snapshot);
  renderAlgorithms(snapshot);
  renderControls(snapshot);
  renderFlow(snapshot);
  renderNodes(snapshot);
  renderDistribution(snapshot);
  renderLatency(snapshot);
  renderComparison(snapshot);
  renderTrace(snapshot);
  renderHistory(snapshot);
  $('#console-status').textContent = snapshot.lastAction;
  const live = snapshot.backends.filter((node) => node.reachable).length;
  $('#lb-transport-note').textContent = live > 0
    ? `SEVEN ALGORITHMS · ${live} OF 6 OVER RMI`
    : 'SEVEN ALGORITHMS · GATEWAY SERVING ALL SIX';
}

function renderHeadline(snapshot) {
  const run = snapshot.lastRun;
  const values = {
    strategyLabel: snapshot.strategyLabel,
    throughput: run ? int(run.throughput) : '—',
    p95Ms: run ? num(run.p95Ms) : '—',
    p50Ms: run ? num(run.p50Ms) : '—',
    meanMs: run ? num(run.meanMs) : '—',
    durationMs: run ? num(run.durationMs) : '—',
    fairness: run ? num(run.fairness) : '—',
    spreadPercent: run ? num(run.spreadPercent, 1) : '—',
    errors: run ? int(run.errors) : '—',
  };
  $$('[data-metric]').forEach((element) => {
    const key = element.dataset.metric;
    if (key in values) element.textContent = values[key];
  });
}

function renderAlgorithms(snapshot) {
  $('#algo-grid').innerHTML = snapshot.strategies.map((item, index) => `
    <button class="algo-card" type="button" role="radio" aria-checked="${item.active}" data-strategy="${item.id}" tabindex="${item.active ? 0 : -1}">
      <span class="algo-card-head"><strong>${escapeHtml(item.label)}</strong><span class="algo-index">${String(index + 1).padStart(2, '0')}</span></span>
      <span class="algo-formula">${escapeHtml(item.formula)}</span>
      <p>${escapeHtml(item.how)}</p>
      <p class="algo-why">${escapeHtml(item.why)}</p>
      ${item.keyed ? '<span class="algo-badge">ROUTES ON THE KEY</span>' : ''}
    </button>`).join('');
}

function renderControls(snapshot) {
  const requests = $('#requests-input');
  const concurrency = $('#concurrency-input');
  const skew = $('#skew-input');
  if (document.activeElement !== requests) requests.value = snapshot.requests;
  if (document.activeElement !== concurrency) concurrency.value = snapshot.concurrency;
  if (document.activeElement !== skew) skew.value = snapshot.skew;
  $('#requests-value').textContent = snapshot.requests;
  $('#concurrency-value').textContent = snapshot.concurrency;
}

/** Hub on the left, six backends on the right, line weight = share of the last burst. */
function renderFlow(snapshot) {
  const svg = $('#flow-svg');
  const nodes = snapshot.backends;
  const top = 34;
  const step = (360 - top * 2) / (nodes.length - 1);
  const hubX = 150;
  const hubY = 180;
  const nodeX = 580;

  const links = nodes.map((node, index) => {
    const y = top + index * step;
    const share = node.sharePercent || 0;
    const width = node.operatorDown || node.breaker === 'OPEN' ? 1 : Math.max(1, share * 0.55);
    const out = node.operatorDown || node.breaker === 'OPEN';
    return `<path class="flow-link${out ? ' is-out' : ''}" d="M ${hubX + 92} ${hubY} C 330 ${hubY}, 380 ${y}, ${nodeX} ${y}" stroke-width="${num(width, 1)}" />`;
  }).join('');

  const cards = nodes.map((node, index) => {
    const y = top + index * step;
    const hot = (node.sharePercent || 0) >= 25;
    const out = node.operatorDown || node.breaker === 'OPEN';
    return `<g class="flow-node${hot ? ' is-hot' : ''}${out ? ' is-out' : ''}">
      <rect x="${nodeX}" y="${y - 17}" width="250" height="34" rx="2" />
      <text class="flow-name" x="${nodeX + 12}" y="${y + 4}">N0${node.id} ${escapeHtml(node.name.toUpperCase())} · :${node.port}</text>
      <text class="flow-share" x="${nodeX + 238}" y="${y + 4}" text-anchor="end">${num(node.sharePercent, 1)}%</text>
    </g>`;
  }).join('');

  svg.innerHTML = `${svg.querySelector('title').outerHTML}${svg.querySelector('desc').outerHTML}
    ${links}
    <g class="flow-hub">
      <rect x="${hubX - 92}" y="${hubY - 30}" width="184" height="60" rx="2" />
      <text x="${hubX}" y="${hubY - 6}" text-anchor="middle">BALANCER</text>
      <text x="${hubX}" y="${hubY + 12}" text-anchor="middle">${escapeHtml(snapshot.strategyLabel.toUpperCase())}</text>
    </g>
    ${cards}`;
}

function renderNodes(snapshot) {
  $('#pool-grid').innerHTML = snapshot.backends.map((node) => `
    <article class="pool-card${node.operatorDown ? ' is-down' : ''}" data-node="${escapeHtml(node.name)}">
      <div class="pool-card-head">
        <strong>${escapeHtml(node.name)}</strong>
        <span class="pool-health"><i class="legend-dot ${HEALTH_DOT[node.health] ?? ''}"></i>${escapeHtml(node.health)}</span>
      </div>
      <p class="algo-index">${escapeHtml(node.branchCode)} · RMI :${node.port} · BREAKER ${escapeHtml(node.breaker)}</p>
      <div class="pool-share-bar"><i style="width:${Math.min(100, node.sharePercent)}%"></i></div>
      <dl class="pool-stats">
        <div><dt>SHARE</dt><dd>${num(node.sharePercent, 1)}%</dd></div>
        <div><dt>SERVED</dt><dd>${int(node.dispatched)}</dd></div>
        <div><dt>EWMA</dt><dd>${num(node.ewmaMs)} ms</dd></div>
        <div><dt>FAILED</dt><dd>${int(node.failed)}</dd></div>
      </dl>
      <div class="pool-controls">
        <button type="button" data-action="${node.operatorDown ? 'recover' : 'fail'}" data-node="${escapeHtml(node.name)}">${node.operatorDown ? 'Recover' : 'Crash it'}</button>
        <label>WEIGHT <input type="number" min="1" max="10" value="${node.weight}" data-weight="${escapeHtml(node.name)}" /></label>
        <label>+MS <input type="number" min="0" max="400" step="5" value="${node.addedLatencyMs}" data-slow="${escapeHtml(node.name)}" /></label>
      </div>
    </article>`).join('');
}

function renderDistribution(snapshot) {
  const run = snapshot.lastRun;
  const target = $('#dist-bars');
  $('#dist-label').textContent = run ? `${int(run.requests)} REQUESTS · ${escapeHtml(run.strategyLabel.toUpperCase())}` : '—';
  if (!run) {
    target.innerHTML = '<p class="lb-empty">Dispatch a burst to see where the requests went.</p>';
    return;
  }
  const peak = Math.max(...run.shares.map((share) => share.sharePercent), 1);
  target.innerHTML = run.shares.map((share) => {
    const node = snapshot.backends.find((item) => item.name === share.node);
    const out = node && (node.operatorDown || node.breaker === 'OPEN');
    return `<div class="dist-row">
      <span>${escapeHtml(share.node.toUpperCase())}</span>
      <div class="dist-track${out ? ' is-out' : ''}"><i style="width:${(share.sharePercent / peak) * 100}%"></i></div>
      <b>${num(share.sharePercent, 1)}%</b>
    </div>`;
  }).join('');
}

function renderLatency(snapshot) {
  const run = snapshot.lastRun;
  const target = $('#latency-rail');
  $('#latency-label').textContent = run ? `CONCURRENCY ${run.concurrency} · ${escapeHtml(run.skew)}` : '—';
  if (!run) {
    target.innerHTML = '<p class="lb-empty">No measurements yet.</p>';
    return;
  }
  const rows = [['p50', run.p50Ms], ['p95', run.p95Ms], ['p99', run.p99Ms]];
  const peak = Math.max(...rows.map(([, value]) => value), 0.01);
  target.innerHTML = rows.map(([label, value]) => `
    <div class="latency-row">
      <span>${label.toUpperCase()}</span>
      <div class="dist-track"><i style="width:${(value / peak) * 100}%"></i></div>
      <b>${num(value)} ms</b>
    </div>`).join('');
}

function renderComparison(snapshot) {
  const rows = snapshot.comparison ?? [];
  const body = $('#compare-body');
  if (!rows.length) {
    $('#compare-label').textContent = 'RUN “COMPARE ALL SEVEN” TO FILL THIS';
    body.innerHTML = '<tr><td class="table-empty" colspan="8">The same workload, put through all seven algorithms in turn.</td></tr>';
    return;
  }
  const first = rows[0];
  $('#compare-label').textContent = `${int(first.requests)} REQUESTS · CONCURRENCY ${first.concurrency} · ${escapeHtml(first.skew)}`;
  const bestFair = Math.max(...rows.map((row) => row.fairness));
  const bestP95 = Math.min(...rows.map((row) => row.p95Ms));
  body.innerHTML = rows.map((row) => `
    <tr class="${row.strategy === snapshot.strategy ? 'is-active' : ''}">
      <td><b>${escapeHtml(row.strategyLabel)}</b></td>
      <td class="${row.fairness === bestFair ? 'is-best' : ''}">${num(row.fairness)}${row.fairness === bestFair ? ' ★' : ''}</td>
      <td>${num(row.spreadPercent, 1)} pp</td>
      <td>${num(row.p50Ms)} ms</td>
      <td class="${row.p95Ms === bestP95 ? 'is-best' : ''}">${num(row.p95Ms)} ms${row.p95Ms === bestP95 ? ' ★' : ''}</td>
      <td>${num(row.p99Ms)} ms</td>
      <td>${int(row.throughput)} /s</td>
      <td>${int(row.errors)}</td>
    </tr>`).join('');
}

function renderTrace(snapshot) {
  const rows = snapshot.trace ?? [];
  const body = $('#trace-body');
  if (!rows.length) {
    body.innerHTML = '<tr><td class="table-empty" colspan="7">Dispatch a burst to fill the trace.</td></tr>';
    return;
  }
  body.innerHTML = rows.map((entry) => `
    <tr class="${entry.status === 'OK' ? '' : 'trace-failed'}">
      <td class="mono">${int(entry.sequence)}</td>
      <td class="mono">${escapeHtml(entry.key)}</td>
      <td><b>${escapeHtml(entry.node)}</b></td>
      <td class="trace-reason">${escapeHtml(entry.reason)}</td>
      <td class="mono">${escapeHtml(entry.transport)}</td>
      <td class="mono">${num(entry.latencyMs)} ms</td>
      <td class="mono">${escapeHtml(entry.status)}</td>
    </tr>`).join('');
}

function renderHistory(snapshot) {
  const rows = snapshot.history ?? [];
  const body = $('#history-body');
  if (!rows.length) {
    body.innerHTML = '<tr><td class="table-empty" colspan="7">No runs yet in this gateway process.</td></tr>';
    return;
  }
  body.innerHTML = rows.map((row) => `
    <tr>
      <td>${String(row.run).padStart(2, '0')}</td>
      <td><b>${escapeHtml(row.strategyLabel)}</b></td>
      <td>${int(row.requests)} reqs · c${row.concurrency} · ${escapeHtml(row.skew)}</td>
      <td>${num(row.durationMs)} ms</td>
      <td>${int(row.throughput)} /s</td>
      <td>${num(row.p95Ms)} ms</td>
      <td>${num(row.fairness)}</td>
    </tr>`).join('');
}

/* ── interactions ────────────────────────────────────────────────────────── */

function setup() {
  $('#refresh-button')?.addEventListener('click', () => load());

  $('#algo-grid').addEventListener('click', (event) => {
    const card = event.target.closest('[data-strategy]');
    if (card) act(`action=strategy&value=${encodeURIComponent(card.dataset.strategy)}`, 'Switching algorithm…');
  });
  // radiogroup keyboard contract: arrows move between the options, not just tab
  $('#algo-grid').addEventListener('keydown', (event) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    const cards = $$('#algo-grid .algo-card');
    const at = cards.indexOf(event.target.closest('.algo-card'));
    if (at < 0) return;
    event.preventDefault();
    const next = cards[(at + step + cards.length) % cards.length];
    next.focus();
    act(`action=strategy&value=${encodeURIComponent(next.dataset.strategy)}`, 'Switching algorithm…');
  });

  const pushWorkload = () => act(
    `action=workload&requests=${$('#requests-input').value}&concurrency=${$('#concurrency-input').value}&skew=${$('#skew-input').value}`,
    'Updating the workload…');
  $('#requests-input').addEventListener('input', (event) => { $('#requests-value').textContent = event.target.value; });
  $('#concurrency-input').addEventListener('input', (event) => { $('#concurrency-value').textContent = event.target.value; });
  $('#requests-input').addEventListener('change', pushWorkload);
  $('#concurrency-input').addEventListener('change', pushWorkload);
  $('#skew-input').addEventListener('change', pushWorkload);

  $('#run-burst').addEventListener('click', () => act('action=run', 'Dispatching the burst…'));
  $('#run-compare').addEventListener('click', () => act('action=compare', 'Running all seven algorithms over the same workload…'));
  $('#run-reset').addEventListener('click', () => act('action=reset', 'Resetting the lab…'));

  $('#pool-grid').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    act(`action=${button.dataset.action}&node=${encodeURIComponent(button.dataset.node)}`,
      `${button.dataset.action === 'fail' ? 'Taking' : 'Recovering'} ${button.dataset.node}…`);
  });
  $('#pool-grid').addEventListener('change', (event) => {
    const weight = event.target.closest('[data-weight]');
    if (weight) return act(`action=weight&node=${encodeURIComponent(weight.dataset.weight)}&value=${weight.value}`, 'Setting weight…');
    const slow = event.target.closest('[data-slow]');
    if (slow) act(`action=slow&node=${encodeURIComponent(slow.dataset.slow)}&value=${slow.value}`, 'Setting latency penalty…');
  });
}

setup();
load();
})();
