import { createLocalClient } from '../lib/local-client.mjs';
import { safeURL } from '../lib/validation.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const link = (url, label, className = '') => safeURL(url) ? `<a class="${className}" href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(label)}</a>` : `<span class="${className}">${escape(label)}</span>`;
const prKey = item => `${item.repository}#${item.number}`;
const statusTone = type => ['started', 'completed', 'canceled', 'backlog', 'triage', 'unstarted'].includes(type) ? type : 'unknown';
const statusOptions = [
  ['open', 'Open'],
  ['ready-review', 'Ready for Review'],
  ['merged', 'Merged'],
  ['closed', 'Closed'],
];
const groups = [
  { key: 'current', label: 'Current work', symbol: '⚡', types: new Set(['started']) },
  { key: 'planned', label: 'Upcoming', symbol: '◷', types: new Set(['triage', 'unstarted']) },
  { key: 'backlog', label: 'Backlog', symbol: '≡', types: new Set(['backlog']) },
  { key: 'completed', label: 'Completed', symbol: '✓', types: new Set(['completed', 'canceled']) },
];

function formatSnapshot(value, timezone) {
  if (!value) return 'No snapshot';
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short',
    }).format(new Date(value)).replace(',', '');
  } catch { return value; }
}

function ciMark(catalog, pr) {
  const observation = (catalog?.ciObservations ?? []).find(item => item.repository === pr.repository && item.number === pr.number);
  if (!observation) return { symbol: '△', tone: 'attention', label: 'CI evidence unavailable' };
  const counts = observation.counts;
  if (counts.failed > 0) return { symbol: '×', tone: 'failed', label: 'CI has failures' };
  if (counts.pending > 0 || counts.unknown > 0) return { symbol: '△', tone: 'attention', label: 'CI needs attention' };
  if (counts.passed > 0) return { symbol: '✓', tone: 'ok', label: 'Observed checks passed' };
  return { symbol: '△', tone: 'attention', label: 'No passing check evidence' };
}

function presentationMaps(catalog) {
  return {
    repositories: new Map((catalog?.presentation?.repositories ?? []).map(item => [item.repository, item])),
    tickets: new Map((catalog?.presentation?.tickets ?? []).map(item => [item.issueId, item])),
  };
}

function renderPRs(item, catalog, overlays, readOnly, maps) {
  const prs = (catalog?.pullRequests ?? []).filter(pr => pr.issueId === item.id);
  if (!prs.length) return '';
  return `<div class="ticket-prs">${prs.map(pr => {
    const key = prKey(pr);
    const state = overlays.prStatus?.[key] ?? pr.state;
    const repository = maps.repositories.get(pr.repository);
    const repoLabel = repository?.label ?? pr.repository.split('/').at(-1);
    const tone = repository?.tone ?? 'neutral';
    const ci = ciMark(catalog, pr);
    return `<div class="ticket-pr-entry"><span class="repo-badge repo-${escape(tone)}">${escape(repoLabel)}</span><span class="branch-badge">${escape(pr.baseBranch)}</span>${link(pr.url, `PR #${pr.number}`, 'pr-link')}<select class="pr-status pr-status-${escape(state)}" data-pr="${escape(key)}" ${readOnly ? 'disabled' : ''}>${statusOptions.map(([value, label]) => `<option value="${value}" ${value === state ? 'selected' : ''}>${label}</option>`).join('')}</select><span class="ci-mark ci-${ci.tone}" title="${escape(ci.label)}" aria-label="${escape(ci.label)}">${ci.symbol}</span><span class="pr-purpose">${escape(pr.purpose)}</span></div>`;
  }).join('')}</div>`;
}

function renderReferences(item, byId) {
  const references = item.relations.filter(edge => !['parent', 'child'].includes(edge.type));
  if (!references.length) return '';
  return `<details class="case-details"><summary>Background links (${references.length})</summary><div class="reference-list">${references.map(edge => {
    const target = byId.get(edge.issueId);
    return `<div><span class="reference-type">${escape(edge.type)}</span> ${target ? link(target.url, target.id, 'issue-link') : escape(edge.issueId)}${target ? ` · ${escape(target.title)}` : ''}</div>`;
  }).join('')}</div></details>`;
}

function renderIssue(item, context) {
  const { byId, children, catalog, overlays, readOnly, maps, nested = false } = context;
  const archived = Boolean(overlays.archived?.[item.id]);
  const childItems = (children.get(item.id) ?? []).filter(child => !overlays.archived?.[child.id]);
  const presentation = maps.tickets.get(item.id);
  const icon = { link: '↗', code: '</>', book: '▤', work: '⚙', home: '⌂' }[presentation?.icon] ?? '●';
  const memo = overlays.memos?.[item.id] ?? '';
  const assignee = item.assignee?.name ? `Assignee: ${item.assignee.name}` : 'Unassigned';
  const body = `<div class="ticket-ownership"><span>${escape(assignee)}</span>${item.sprint ? `<span>· Sprint: ${escape(item.sprint.name)}</span>` : ''}</div><div class="ticket-heading">${presentation ? `<div class="ticket-thumbnail"><span class="ticket-thumbnail-icon">${icon}</span><span>${escape(presentation.label)}</span></div>` : ''}<div class="ticket-main"><div class="ticket-row">${link(item.url, item.id, 'issue-link')}<span class="status-mark status-${statusTone(item.status.type)}" title="${escape(item.status.name)}"></span><button class="archive-action" data-archive="${escape(item.id)}" ${readOnly ? 'disabled' : ''}>${archived ? 'Restore' : 'Archive'}</button></div><h3>${escape(item.title)}</h3></div></div><div class="memo-row"><span class="memo-label">Memo</span><span class="status-pill status-${statusTone(item.status.type)}">${escape(item.status.name)}</span><textarea rows="1" data-memo="${escape(item.id)}" placeholder="None" ${readOnly ? 'disabled' : ''}>${escape(memo)}</textarea></div>${renderPRs(item, catalog, overlays, readOnly, maps)}${renderReferences(item, byId)}`;
  if (!childItems.length) return `<article class="ticket-card${nested ? ' ticket-child' : ''}">${body}</article>`;
  return `<article class="ticket-card ticket-family">${body}<div class="handled-by">Handled by ↓</div><div class="ticket-children">${childItems.map(child => renderIssue(child, { ...context, nested: true })).join('')}</div></article>`;
}

function activeRoots(items, children, overlays) {
  return items.flatMap(item => overlays.archived?.[item.id] ? activeRoots(children.get(item.id) ?? [], children, overlays) : [item]);
}

export function renderShelf({ config, snapshot, catalog, overlays = {}, readOnly = true, readOnlyReason = '', saveState = 'idle' }) {
  const issues = snapshot?.issues ?? [];
  const byId = new Map(issues.map(item => [item.id, item]));
  const children = new Map();
  const childIds = new Set();
  for (const item of issues) {
    const parent = item.relations.find(edge => edge.type === 'parent');
    if (!parent || !byId.has(parent.issueId)) continue;
    childIds.add(item.id);
    children.set(parent.issueId, [...(children.get(parent.issueId) ?? []), item]);
  }
  const roots = issues.filter(item => !childIds.has(item.id));
  const maps = presentationMaps(catalog);
  const archivedItems = issues.filter(item => overlays.archived?.[item.id]);
  const archivedCount = archivedItems.length;
  const visibleCount = issues.length - archivedCount;
  const visibleRoots = activeRoots(roots, children, overlays);
  const pins = (config?.pins ?? []).map(pin => link(pin.url, pin.title, 'pin-link')).join('');
  const renderedGroups = groups.map(group => {
    const items = visibleRoots.filter(item => group.types.has(item.status.type));
    if (!items.length) return '';
    return `<section class="focus-group"><h2><span>${group.symbol}</span>${group.label}</h2><div class="group-items">${items.map(item => renderIssue(item, { byId, children, catalog, overlays, readOnly, maps })).join('')}</div></section>`;
  }).join('');
  const empty = '<section class="empty"><h2>Your shelf is ready</h2><p>No issues yet. Configure your local profile and explicitly ask Codex to refresh a snapshot.</p></section>';
  const archive = `<details id="archive-section" class="archive-section"><summary>Archive · ${archivedCount}</summary><p>Only manually archived tickets appear here.</p><div class="archive-list">${archivedItems.map(item => renderIssue(item, { byId, children: new Map(), catalog, overlays, readOnly, maps })).join('')}</div></details>`;
  return `<header class="snapshot-summary"><span>Codex snapshot ${escape(formatSnapshot(snapshot?.generatedAt, config?.timezone))} · on-demand Codex refresh</span><span>${visibleCount} items${archivedCount ? ` · ${archivedCount} archived` : ''}</span></header><div class="top-actions"><nav>${pins}</nav><div class="action-buttons"><span class="local-status">${readOnly ? `Read-only · ${escape(readOnlyReason || 'Configure a profile')}` : `Local saves · ${escape(saveState)}`}</span><button id="reload">Reload snapshot</button><button id="report">Create report</button>${readOnly ? '<button id="takeover">Try writer lock</button>' : ''}</div></div>${renderedGroups || empty}${archive}<section id="report-panel" hidden><h2>Local report</h2><textarea id="report-text" readonly></textarea></section><footer>Configuration and snapshots stay on this computer. Opening or editing the shelf does not refresh external services.</footer>`;
}

export function createReport({ snapshot, catalog, overlays = {} }) {
  const excluded = new Set(catalog?.presentation?.report?.excludedIssueIds ?? []);
  return (snapshot?.issues ?? []).filter(item => !overlays.archived?.[item.id] && !excluded.has(item.id)).map(item => {
    const prs = (catalog?.pullRequests ?? []).filter(pr => pr.issueId === item.id).map(pr => `${prKey(pr)} ${overlays.prStatus?.[prKey(pr)] ?? pr.state}`).join('\n');
    return `${item.id} — ${item.title}\n${item.status?.name ?? ''}${overlays.memos?.[item.id] ? '\n' + overlays.memos[item.id] : ''}${prs ? '\n' + prs : ''}`;
  }).join('\n\n');
}

if (typeof document !== 'undefined') {
  let shelf;
  let client;
  const main = document.querySelector('main');
  async function reload() {
    const response = await fetch('/api/shelf', { cache: 'no-store' });
    if (!response.ok) throw new Error('Local snapshot unavailable');
    const next = await response.json();
    if (client) client.acceptShelf(next);
    else client = await createLocalClient({ config: next.config, storage: window.localStorage, locks: navigator.locks });
    shelf = next; render();
  }
  function render() {
    main.innerHTML = renderShelf({ ...shelf, overlays: client.getOverlays(), readOnly: client.readOnly, readOnlyReason: client.readOnlyReason, saveState: client.saveState });
    const errors = () => { const node = main.querySelector('.local-status'); node.textContent = `Save failed · ${client.readOnlyReason || 'Local storage or input unavailable'}`; node.classList.add('error'); };
    const action = fn => { try { fn(); render(); } catch { errors(); } };
    main.querySelector('#reload').onclick = () => reload().catch(errors);
    main.querySelector('#takeover')?.addEventListener('click', async () => { await client.acquireWriter(); render(); });
    main.querySelectorAll('[data-memo]').forEach(node => { node.onchange = () => action(() => client.setMemo(node.dataset.memo, node.value)); });
    main.querySelectorAll('[data-archive]').forEach(node => { node.onclick = () => action(() => client.setArchived(node.dataset.archive, !client.isArchived(node.dataset.archive))); });
    main.querySelectorAll('[data-pr]').forEach(node => { node.onchange = () => action(() => client.setPRStatus(node.dataset.pr, node.value)); });
    main.querySelector('#report').onclick = () => { main.querySelector('#report-panel').hidden = false; main.querySelector('#report-text').value = createReport({ ...shelf, overlays: client.getOverlays() }); };
  }
  window.addEventListener('pagehide', () => client?.close());
  reload().catch(() => { main.textContent = 'Focus Shelf could not load local configuration. Check FOCUS_SHELF_HOME and reload.'; });
}
