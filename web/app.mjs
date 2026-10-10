import { createLocalClient } from '../lib/local-client.mjs';
import { safeURL } from '../lib/validation.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const link = (url, label, className = '') => safeURL(url) ? `<a class="${className}" href="${escape(url)}" data-open-in-chrome="${escape(url)}" rel="noopener noreferrer">${escape(label)}</a>` : `<span class="${className}">${escape(label)}</span>`;
const prKey = item => `${item.repository}#${item.number}`;
export const displayedPRState = (item, overlays = {}) => ['merged', 'closed'].includes(item.state)
  ? item.state
  : overlays.prStatus?.[prKey(item)] ?? item.state;
const issueCategory = (item, snapshot) => item.assignee?.id === snapshot.ownerId
  ? 'assigned'
  : snapshot.createdIssueIds?.includes(item.id)
    ? 'created'
    : snapshot.followedIssueIds.includes(item.id)
      ? 'followed'
      : 'context';
export function formatAssigneeName(value) {
  const name = String(value ?? '').trim();
  if (!name) return 'Unassigned';
  const parts = name.split(/\s*-\s*/).map(part => part.trim()).filter(Boolean);
  const english = parts.find(part => /^[A-Za-z]/.test(part));
  return english?.match(/[A-Za-z]+/)?.[0] ?? parts[0] ?? name;
}
const issueAssignee = item => item.assignee?.name ? `Assignee: ${formatAssigneeName(item.assignee.name)}` : 'Unassigned';
const statusTone = (type, name = '') => String(name).trim().toUpperCase() === 'EQA'
  ? 'eqa'
  : ['started', 'completed', 'canceled', 'backlog', 'triage', 'unstarted'].includes(type) ? type : 'unknown';
const statusOptions = [
  ['open', 'Open'],
  ['ready-review', 'Ready for Review'],
  ['merged', 'Merged'],
  ['closed', 'Closed'],
];
const groups = [
  { key: 'planned', label: 'Upcoming', symbol: '◷', types: new Set(['triage', 'unstarted']) },
  { key: 'current', label: 'Current work', symbol: '⚡', types: new Set(['started']) },
  { key: 'backlog', label: 'Backlog', symbol: '≡', types: new Set(['backlog']) },
  { key: 'completed', label: 'Completed', symbol: '✓', types: new Set(['completed', 'canceled']) },
];

const ticketIcons = {
  ticket: '<path class="ticket-icon-fill" d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  'recent-news': '<circle class="ticket-icon-fill" cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2M5 5l-2 2M19 5l2 2"/>',
  'news-filter': '<path class="ticket-icon-fill" d="M4 5h16l-6 7v5l-4 2v-7z"/><path d="M4 5h16l-6 7v5l-4 2v-7z"/><circle cx="18" cy="18" r="3"/><path d="m20.2 20.2 1.8 1.8"/>',
  download: '<path class="ticket-icon-fill" d="M5 15h14v5H5z"/><path d="M12 3v11m-4-4 4 4 4-4M5 16v4h14v-4"/>',
  outage: '<path class="ticket-icon-fill" d="m12 3 9 17H3z"/><path d="m12 3 9 17H3zM12 9v5M12 17h.01"/>',
  'chat-error': '<path class="ticket-icon-fill" d="M4 4h16v12H9l-5 4z"/><path d="M4 4h16v12H9l-5 4zM8 8h7M8 12h4"/><circle class="ticket-icon-accent" cx="18" cy="17.5" r="3.5"/><path class="ticket-icon-inverse" d="M18 15.8v2.2M18 19.4h.01"/>',
  sync: '<path class="ticket-icon-fill" d="M5 7h12l-2-2m2 2-2 2M19 17H7l2 2m-2-2 2-2"/><path d="M5 7h12l-2-2m2 2-2 2M19 17H7l2 2m-2-2 2-2M5 7a7 7 0 0 0-1 8M19 17a7 7 0 0 0 1-8"/>',
  password: '<circle class="ticket-icon-fill" cx="9" cy="11" r="5"/><circle cx="9" cy="11" r="5"/><path d="m13 14 7 7m-3-3 2-2m-4 0 2-2"/>',
  cluster: '<rect class="ticket-icon-fill" x="8" y="3" width="8" height="6" rx="2"/><rect x="8" y="3" width="8" height="6" rx="2"/><rect x="3" y="15" width="7" height="6" rx="2"/><rect x="14" y="15" width="7" height="6" rx="2"/><path d="M12 9v3M6.5 15v-3h11v3"/>',
  news: '<path class="ticket-icon-fill" d="M4 5h14v15H4z"/><path d="M4 5h14v15H4zM8 9h6M8 13h6M8 17h4M18 8h2v10a2 2 0 0 1-2 2"/>',
  'test-harness': '<path class="ticket-icon-fill" d="m9 3 1 5-5 10a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3L14 8l1-5z"/><path d="m9 3 1 5-5 10a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3L14 8l1-5M8 15h8M9 3h6"/><circle class="ticket-icon-accent" cx="10" cy="17.5" r="1"/>',
  'support-id': '<rect class="ticket-icon-fill" x="3" y="5" width="18" height="14" rx="3"/><rect x="3" y="5" width="18" height="14" rx="3"/><circle cx="8" cy="11" r="2"/><path d="M6 16c.8-1.4 3.2-1.4 4 0M13 10h5M13 14h4"/>',
  deploy: '<path class="ticket-icon-fill" d="M13 3c4 1 7 4 8 8l-6 6-8-8z"/><path d="M13 3c4 1 7 4 8 8l-6 6-8-8zM7 9l-3 2 4 2 3 4 2-3M8 16l-4 4M14 8h.01"/>',
};

const generatedPathRoles = { stroke: '', fill: 'ticket-icon-fill', accent: 'ticket-icon-accent', inverse: 'ticket-icon-inverse' };

function renderGeneratedTicketIcon(icon) {
  if (icon?.version !== 1 || !Array.isArray(icon.paths) || icon.paths.length < 1 || icon.paths.length > 12) return null;
  const paths = [];
  for (const path of icon.paths) {
    if (typeof path?.d !== 'string' || path.d.length < 2 || path.d.length > 400 || !/^[MmLlHhVvCcSsQqTtAaZz0-9eE+.,\s-]+$/.test(path.d) || !/^[Mm]/.test(path.d.trim()) || !(path.role in generatedPathRoles)) return null;
    if ('strokeWidth' in path && (!Number.isFinite(path.strokeWidth) || path.strokeWidth < 1 || path.strokeWidth > 6)) return null;
    const className = generatedPathRoles[path.role];
    paths.push(`<path${className ? ` class="${className}"` : ''} d="${escape(path.d)}"${path.strokeWidth ? ` stroke-width="${path.strokeWidth}"` : ''}/>`);
  }
  return `<svg class="ticket-topic-icon ticket-topic-icon-generated" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths.join('')}</svg>`;
}

export function renderTicketIcon(icon) {
  const generated = renderGeneratedTicketIcon(icon);
  if (generated) return generated;
  const drawing = ticketIcons[icon] ?? ticketIcons.ticket;
  return `<svg class="ticket-topic-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${drawing}</svg>`;
}

function ciMark(catalog, pr) {
  if (catalog?.schemaVersion === 2 && catalog.coverage?.find(item => item.issueId === pr.issueId)?.ci !== 'complete') return { symbol: '△', tone: 'attention', label: 'CI evidence unavailable' };
  const observation = (catalog?.ciObservations ?? []).find(item => item.repository === pr.repository && item.number === pr.number && (catalog.schemaVersion === 1 || item.headSha.toLowerCase() === pr.headSha?.toLowerCase()));
  if (!observation) return { symbol: '△', tone: 'attention', label: 'CI evidence unavailable' };
  const counts = observation.counts;
  if (counts.failed > 0) return { symbol: '×', tone: 'failed', label: 'CI test, build or lint checks failed' };
  if (counts.pending > 0 || counts.unknown > 0 || counts.neutral > 0) return { symbol: '△', tone: 'attention', label: 'CI needs attention' };
  if ((counts.releaseTargetPolicyFailed ?? 0) > 0) return { symbol: '△', tone: 'attention', label: 'Release target policy needs attention' };
  if (counts.passed > 0) return { symbol: '✓', tone: 'ok', label: 'Observed checks passed' };
  return { symbol: '△', tone: 'attention', label: 'No passing check evidence' };
}

function presentationMaps(catalog, dri) {
  return {
    repositories: new Map((catalog?.presentation?.repositories ?? []).map(item => [item.repository, item])),
    tickets: new Map((catalog?.presentation?.tickets ?? []).map(item => [item.issueId, item])),
    workstreams: new Map((dri?.workstreams ?? []).filter(item => item.workstream).map(item => [item.workstream, item])),
  };
}

export function formatDriName(value) {
  const name = String(value ?? '').trim();
  if (!name) return 'Unassigned';
  const beforeDash = name.split(/\s*-\s*/)[0].trim();
  if (/^\p{Script=Han}/u.test(name)) return beforeDash;
  const english = name.split(/\s*-\s*/).find(part => /^[A-Za-z]/.test(part.trim()))?.trim() ?? name;
  return english.match(/[A-Za-z]+/)?.[0] ?? english.split(/\s+/)[0];
}

function renderDri(presentation, maps, sprint = null) {
  const item = presentation?.workstream ? maps.workstreams.get(presentation.workstream) : null;
  if (!item) return '';
  const first = formatDriName(item.firstDri);
  const second = formatDriName(item.secondDri);
  const sprintBadge = sprint
    ? `<span class="sprint-badge" title="Observed Linear Sprint: ${escape(sprint.name)}">${escape(sprint.name)}</span>`
    : '';
  return `<div class="ticket-dri"><span class="workstream-badge">${escape(item.workstream)}</span><span class="dri-primary"><strong>First DRI:</strong> ${escape(first)}</span><span class="dri-secondary"><strong>Second DRI:</strong> ${escape(second)}</span>${sprintBadge}</div>`;
}

function renderPRs(item, catalog, overlays, readOnly, maps) {
  const prs = (catalog?.pullRequests ?? []).filter(pr => pr.issueId === item.id);
  if (!prs.length || maps.categories?.get(item.id) !== 'assigned') return '';
  return `<div class="ticket-prs">${prs.map(pr => {
    const key = prKey(pr);
    const state = displayedPRState(pr, overlays);
    const terminal = ['merged', 'closed'].includes(pr.state);
    const repository = maps.repositories.get(pr.repository);
    const repoLabel = repository?.label ?? pr.repository.split('/').at(-1);
    const normalizedLabel = repoLabel.trim().toUpperCase();
    const tone = normalizedLabel === 'QA' ? 'coral' : normalizedLabel === 'INFRA' ? 'gold' : repository?.tone ?? 'neutral';
    const ci = ciMark(catalog, pr);
    const ciIcon = state === 'ready-review' ? `<span class="ci-mark ci-${ci.tone}" title="${escape(ci.label)}" aria-label="${escape(ci.label)}">${ci.symbol}</span>` : '';
    return `<div class="ticket-pr-entry"><span class="repo-badge repo-${escape(tone)}">${escape(repoLabel)}</span><span class="branch-badge">${escape(pr.baseBranch)}</span>${link(pr.url, `PR #${pr.number}`, 'pr-link')}<select class="pr-status pr-status-${escape(state)}" data-pr="${escape(key)}" title="${terminal ? 'Current GitHub terminal state' : 'Set local workflow state; GitHub Merge/Closed is applied on the next Codex refresh'}" ${readOnly || terminal ? 'disabled' : ''}>${statusOptions.map(([value, label]) => `<option value="${value}" ${value === state ? 'selected' : ''}>${label}</option>`).join('')}</select>${ciIcon}</div>`;
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
  const childItems = activeRoots(children.get(item.id) ?? [], children, overlays);
  const presentation = maps.tickets.get(item.id);
  const hasDri = Boolean(presentation?.workstream && maps.workstreams.get(presentation.workstream));
  const icon = presentation?.icon ?? 'ticket';
  const thumbnailState = String(item.status.name).trim().toUpperCase() === 'ON HOLD' ? ' ticket-thumbnail-on-hold' : '';
  const memo = overlays.memos?.[item.id] ?? '';
  const estimate = Number.isSafeInteger(item.estimate)
    ? `<span class="estimate-points" title="Linear estimate: ${item.estimate} point${item.estimate === 1 ? '' : 's'}" aria-label="Linear estimate ${item.estimate} point${item.estimate === 1 ? '' : 's'}">${item.estimate}</span>`
    : '';
  const category = context.categories.get(item.id);
  const assignee = `${issueAssignee(item)}${archived ? ' · archived' : ''}`;
  const assigneeTitle = item.assignee?.name ? ` title="${escape(`Full Linear assignee: ${item.assignee.name}`)}"` : '';
  const delegated = nested && category === 'context' && Boolean(item.assignee?.id);
  const parentSprint = hasDri && childItems.length > 0 ? item.sprint : null;
  const createdOwnership = category === 'created'
    ? `<span class="ownership-created">Created</span><span class="ownership-arrow">→</span><span class="ownership-assigned"${assigneeTitle}>Assigned to ${escape(formatAssigneeName(item.assignee?.name))}${archived ? ' · archived' : ''}</span>`
    : `<span${assigneeTitle}>${escape(assignee)}</span>`;
  const ownership = hasDri
    ? ''
    : `<div class="ticket-ownership">${createdOwnership}${item.sprint ? `<span>· Sprint: ${escape(item.sprint.name)}</span>` : ''}</div>`;
  const body = `${ownership}${renderDri(presentation, maps, parentSprint)}<div class="ticket-heading">${presentation ? `<div class="ticket-thumbnail ticket-thumbnail-${escape(presentation.tone)}${thumbnailState}" role="img" aria-label="${escape(`${presentation.label} · ${presentation.description}`)}" title="${escape(presentation.description)}"><span class="ticket-thumbnail-icon">${renderTicketIcon(icon)}</span><span>${escape(presentation.label)}</span></div>` : ''}<div class="ticket-main"><div class="ticket-row">${link(item.url, item.id, 'issue-link')}${estimate}<span class="status-mark status-${statusTone(item.status.type, item.status.name)}" title="Observed Linear status: ${escape(item.status.name)}"></span><button class="archive-action" data-archive="${escape(item.id)}" ${readOnly ? 'disabled' : ''}>${archived ? 'Restore' : 'Archive'}</button></div><h3>${escape(item.title)}</h3></div></div><div class="memo-row"><span class="status-pill status-${statusTone(item.status.type, item.status.name)}" title="Read-only Linear status">${escape(item.status.name)}</span><span class="memo-label">Memo</span><textarea rows="1" data-memo="${escape(item.id)}" placeholder="None" ${readOnly ? 'disabled' : ''}>${escape(memo)}</textarea></div>${renderPRs(item, catalog, overlays, readOnly, maps)}${renderReferences(item, byId)}`;
  const card = !childItems.length
    ? `<article class="ticket-card${nested ? ' ticket-child' : ''}">${body}</article>`
    : `<article class="ticket-card ticket-family${nested ? ' ticket-child' : ''}">${body}<div class="handled-by"><span class="relationship-symbol relationship-symbol-child">Child</span><span>tasks ↓</span></div><div class="ticket-children">${childItems.map(child => renderIssue(child, { ...context, nested: true })).join('')}</div></article>`;
  if (!delegated) return card;
  const reveal = context.revealIssueId && familyHasIssue(item, context.revealIssueId, children, overlays);
  return `<details class="delegated-ticket"${reveal ? ' open' : ''}><summary><span class="delegated-id">${escape(item.id)}</span><span class="delegated-title">${escape(item.title)}</span><span class="delegated-assignee"${assigneeTitle}>${escape(issueAssignee(item))}</span><span class="status-pill status-${statusTone(item.status.type, item.status.name)}">${escape(item.status.name)}</span></summary>${card}</details>`;
}

function activeRoots(items, children, overlays) {
  return items.flatMap(item => overlays.archived?.[item.id] ? activeRoots(children.get(item.id) ?? [], children, overlays) : [item]);
}

function familyHasIssue(item, issueId, children, overlays) {
  if (item.id === issueId) return true;
  return activeRoots(children.get(item.id) ?? [], children, overlays).some(child => familyHasIssue(child, issueId, children, overlays));
}

function familyGroupType(item, children, overlays, categories, catalog) {
  function relevantTypes(current) {
    const visibleChildren = activeRoots(children.get(current.id) ?? [], children, overlays);
    const profileOwned = categories.get(current.id) !== 'context';
    const activePR = profileOwned && (catalog?.pullRequests ?? []).some(pr =>
      pr.issueId === current.id && ['open', 'ready-review'].includes(displayedPRState(pr, overlays))
    );
    const ownTypes = profileOwned ? [activePR ? 'started' : current.status.type] : [];
    return [...ownTypes, ...visibleChildren.flatMap(relevantTypes)];
  }
  const types = relevantTypes(item);
  if (types.includes('started')) return 'started';
  if (types.some(type => ['triage', 'unstarted'].includes(type))) return 'unstarted';
  if (types.includes('backlog')) return 'backlog';
  return types[0] ?? item.status.type;
}

function familySprintGroup(item, children, overlays, observedAt) {
  function visibleFamily(current) {
    const visibleChildren = activeRoots(children.get(current.id) ?? [], children, overlays);
    return [current, ...visibleChildren.flatMap(visibleFamily)];
  }
  const sprints = new Map();
  for (const member of visibleFamily(item)) {
    if (!member.sprint) continue;
    const key = [member.sprint.name, member.sprint.startDate, member.sprint.endDate].join('\u0000');
    sprints.set(key, member.sprint);
  }
  if (!sprints.size) return { key: 'none', kind: 'none', label: 'No Sprint', rank: 3, start: '' };
  if (sprints.size > 1) return { key: `mixed:${[...sprints.keys()].sort().join('|')}`, kind: 'mixed', label: 'Multiple Sprints', rank: 2, start: '' };
  const [key, sprint] = [...sprints.entries()][0];
  const now = Date.parse(observedAt);
  const start = Date.parse(sprint.startDate);
  const end = Date.parse(sprint.endDate);
  const kind = Number.isFinite(now) && Number.isFinite(start) && Number.isFinite(end)
    ? now < start ? 'upcoming' : now <= end ? 'current' : 'past'
    : 'dated';
  const prefix = { current: 'This Sprint', upcoming: 'Upcoming Sprint', past: 'Past Sprint', dated: 'Sprint' }[kind];
  const rank = { current: 0, upcoming: 1, dated: 1, past: 4 }[kind];
  return { key: `sprint:${key}`, kind, label: `${prefix} · ${sprint.name}`, rank, start: sprint.startDate };
}

function renderSprintGroups(items, context) {
  const sprintGroups = new Map();
  for (const item of items) {
    const group = familySprintGroup(item, context.children, context.overlays, context.snapshotGeneratedAt);
    const current = sprintGroups.get(group.key) ?? { ...group, items: [] };
    current.items.push(item);
    sprintGroups.set(group.key, current);
  }
  return [...sprintGroups.values()]
    .sort((left, right) => left.rank - right.rank || left.start.localeCompare(right.start) || left.label.localeCompare(right.label))
    .map(group => group.kind === 'none'
      ? `<div class="group-items sprint-group-none">${group.items.map(item => renderIssue(item, context)).join('')}</div>`
      : `<section class="sprint-group sprint-group-${escape(group.kind)}"><h3>${escape(group.label)}</h3><div class="group-items">${group.items.map(item => renderIssue(item, context)).join('')}</div></section>`)
    .join('');
}

export function createUpdateRequest() {
  return 'Please update my Focus Shelf. Collect the complete current Linear scope: issues assigned to me, issues I created and later reassigned, previously retained created or followed issues, and the full reciprocal child hierarchy. Re-verify each issue\'s Linear status, relationships, Sprint, estimate, exact associated PRs, current GitHub Merge/Closed state, and CI for the current PR head. Preserve browser-local Memo, Archive, and manual status for PRs that remain open. Treat a Release target policy failure as an attention warning, not a CI, test, build, or lint failure. Publish only after the complete snapshot and catalog both pass validation; then reload the live Focus Shelf page and verify the rendered results.';
}

export function renderShelf({ config, snapshot, catalog, dri, overlays = {}, readOnly = true, readOnlyReason = '', saveState = 'idle', revealIssueId = null }) {
  const issues = snapshot?.issues ?? [];
  const byId = new Map(issues.map(item => [item.id, item]));
  const categories = new Map(issues.map(item => [item.id, issueCategory(item, snapshot)]));
  const children = new Map();
  const childIds = new Set();
  for (const item of issues) {
    const parent = item.relations.find(edge => edge.type === 'parent');
    if (!parent || !byId.has(parent.issueId)) continue;
    childIds.add(item.id);
    children.set(parent.issueId, [...(children.get(parent.issueId) ?? []), item]);
  }
  const roots = issues.filter(item => !childIds.has(item.id));
  const maps = presentationMaps(catalog, dri);
  maps.snapshotVersion = snapshot?.schemaVersion;
  maps.categories = categories;
  const archivedItems = issues.filter(item => overlays.archived?.[item.id]);
  const archivedCount = archivedItems.length;
  const visibleRoots = activeRoots(roots, children, overlays);
  const pins = (config?.pins ?? []).map(pin => link(pin.url, pin.title, 'pin-link')).join('');
  const renderedGroups = groups.map(group => {
    const items = visibleRoots.filter(item => group.types.has(familyGroupType(item, children, overlays, categories, catalog)));
    if (!items.length) return '';
    const context = { byId, children, catalog, overlays, readOnly, maps, categories, snapshotGeneratedAt: snapshot?.generatedAt, revealIssueId };
    if (group.key === 'completed') {
      const reveal = revealIssueId && items.some(item => familyHasIssue(item, revealIssueId, children, overlays));
      return `<details class="focus-group focus-group-completed"${reveal ? ' open' : ''}><summary><span>${group.symbol}</span>${group.label}</summary><div class="sprint-groups">${renderSprintGroups(items, context)}</div></details>`;
    }
    return `<section class="focus-group focus-group-${escape(group.key)}"><h2><span>${group.symbol}</span>${group.label}</h2><div class="sprint-groups">${renderSprintGroups(items, context)}</div></section>`;
  }).join('');
  const empty = '<section class="empty"><h2>Your shelf is ready</h2><p>No issues yet. Configure your local profile and explicitly ask Codex to refresh a snapshot.</p></section>';
  const archive = `<details id="archive-section" class="archive-section"><summary>Archive · ${archivedCount}</summary><p>Only manually archived tickets appear here.</p><div class="archive-list">${archivedItems.map(item => renderIssue(item, { byId, children: new Map(), catalog, overlays, readOnly, maps, categories })).join('')}</div></details>`;
  const navigation = pins ? `<nav>${pins}</nav>` : '';
  const writerNotice = readOnly
    ? '<div class="writer-notice"><span>Read-only</span><button id="takeover">Use this window</button></div>'
    : '<div class="local-status" hidden aria-live="polite"></div>';
  const updateControl = '<header class="shelf-toolbar"><button id="request-focus-update" class="update-action" type="button" aria-describedby="focus-update-status" title="Copy a complete Focus Shelf refresh request for Codex"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 7v5h-5M4 17v-5h5M6.1 8A7 7 0 0 1 18 6l2 1M17.9 16A7 7 0 0 1 6 18l-2-1"/></svg><span>Update</span></button><span id="focus-update-status" class="update-status" aria-live="polite"></span><textarea id="focus-update-fallback" readonly hidden aria-label="Focus Shelf update request"></textarea></header>';
  const slackReport = '<section class="slack-report"><button id="generate-slack-report">Generate Slack Report</button><div id="slack-report-panel" hidden><div id="slack-report-preview" class="slack-report-preview"></div><textarea id="slack-report-text" readonly hidden></textarea><div class="slack-report-actions"><button id="copy-slack-report">Copy Report</button><span id="slack-report-status" aria-live="polite"></span></div></div></section>';
  return `${updateControl}${navigation}${writerNotice}${renderedGroups || empty}${archive}${slackReport}`;
}

const reportRepositoryLabel = (pr, catalog) => catalog?.presentation?.repositories?.find(item => item.repository === pr.repository)?.label
  ?? ({ 'elite-sales-infrastructure': 'Infra', 'elite-sales-monorepo': 'Monorepo', 'elite-sales-qa-tests': 'QA', 'elite-sales-data-orchestration': 'Data Orch.' }[pr.repository.split('/').at(-1)] ?? pr.repository);
const reportTarget = pr => pr.baseBranch === 'feature/build-release-candidate' ? 'RC (feature/build-release-candidate)' : pr.baseBranch;
const reportHtmlLink = (url, label) => safeURL(url) ? `<a href="${escape(url)}"><strong>${escape(label)}</strong></a>` : `<strong>${escape(label)}</strong>`;

function createReportModel({ snapshot, catalog, overlays = {} }) {
  const excluded = new Set(catalog?.presentation?.report?.excludedIssueIds ?? []);
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
  const visibleRoots = activeRoots(issues.filter(item => !childIds.has(item.id)), children, overlays);
  const family = item => [item, ...activeRoots(children.get(item.id) ?? [], children, overlays).flatMap(family)];
  const reportIssue = (item, prs = []) => ({
    id: item.id,
    title: item.title,
    url: item.url,
    prs: prs.map(pr => ({
      label: `${reportRepositoryLabel(pr, catalog)} #${pr.number}`,
      url: pr.url,
      target: reportTarget(pr),
      purpose: pr.purpose,
    })),
  });
  const ready = [];
  const progress = [];
  for (const root of visibleRoots) {
    const members = family(root).filter(item => !excluded.has(item.id));
    const readyMembers = members.flatMap(item => {
      if (issueCategory(item, snapshot) !== 'assigned') return [];
      const prs = (catalog?.pullRequests ?? []).filter(pr => pr.issueId === item.id && displayedPRState(pr, overlays) === 'ready-review');
      return prs.length ? [reportIssue(item, prs)] : [];
    });
    ready.push(...readyMembers);
    if (readyMembers.length) continue;
    const activeAssigned = members.filter(item => ['assigned', 'created'].includes(issueCategory(item, snapshot)) && item.status?.type === 'started');
    if (!activeAssigned.length) continue;
    const representative = ['assigned', 'created'].includes(issueCategory(root, snapshot)) ? root : activeAssigned[0];
    progress.push(reportIssue(representative));
  }
  return { sections: [{ title: 'Ready for Review', issues: ready }, { title: 'In Progress', issues: progress }] };
}

export function createReport(state) {
  return createReportModel(state).sections.map(section => `${section.title}\n${section.issues.length ? section.issues.map(item => {
    const prs = item.prs.map(pr => `    ◦ ${pr.label} → ${pr.target} — ${pr.purpose}\n      ${pr.url}`).join('\n');
    return `• ${item.id} — ${item.title}\n  ${item.url}${prs ? `\n${prs}` : ''}`;
  }).join('\n') : '• None.'}`).join('\n\n');
}

export function createReportHtml(state) {
  return createReportModel(state).sections.map(section => `<p><strong>${escape(section.title)}</strong></p><ul>${section.issues.length ? section.issues.map(item =>
    `<li>${reportHtmlLink(item.url, item.id)} — ${escape(item.title)}${item.prs.length ? `<ul>${item.prs.map(pr => `<li>${reportHtmlLink(pr.url, pr.label)} → ${escape(pr.target)} — ${escape(pr.purpose)}</li>`).join('')}</ul>` : ''}</li>`
  ).join('') : '<li>None.</li>'}</ul>`).join('\n');
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
  function render(revealIssueId = null) {
    main.innerHTML = renderShelf({ ...shelf, overlays: client.getOverlays(), readOnly: client.readOnly, readOnlyReason: client.readOnlyReason, saveState: client.saveState, revealIssueId });
    const errors = () => { const node = main.querySelector('.local-status') ?? main.querySelector('.writer-notice'); node.hidden = false; node.textContent = `Save failed · ${client.readOnlyReason || 'Local storage or input unavailable'}`; node.classList.add('error'); };
    const action = (fn, reveal = null) => { try { fn(); render(reveal); if (reveal) main.querySelector(`[data-archive="${CSS.escape(reveal)}"]`)?.scrollIntoView({ block: 'center' }); } catch { errors(); } };
    main.querySelector('#takeover')?.addEventListener('click', async () => { await client.acquireWriter(); render(); });
    main.querySelector('#request-focus-update').onclick = async () => {
      const request = createUpdateRequest();
      const status = main.querySelector('#focus-update-status');
      const fallback = main.querySelector('#focus-update-fallback');
      try {
        await navigator.clipboard.writeText(request);
        status.textContent = 'Copied — paste into Codex';
        fallback.hidden = true;
      } catch {
        fallback.value = request;
        fallback.hidden = false;
        fallback.select();
        status.textContent = 'Copy this request to Codex';
      }
    };
    main.querySelectorAll('[data-memo]').forEach(node => { node.onchange = () => action(() => client.setMemo(node.dataset.memo, node.value)); });
    main.querySelectorAll('[data-archive]').forEach(node => { node.onclick = () => {
      const id = node.dataset.archive;
      const restoring = client.isArchived(id);
      action(() => client.setArchived(id, !restoring), restoring ? id : null);
    }; });
    main.querySelectorAll('[data-pr]').forEach(node => { node.onchange = () => action(() => client.setPRStatus(node.dataset.pr, node.value)); });
    main.querySelectorAll('[data-open-in-chrome]').forEach(node => { node.onclick = async event => {
      event.preventDefault();
      try {
        const response = await fetch('/api/open-in-chrome', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: node.dataset.openInChrome }) });
        if (!response.ok) throw new Error('Chrome open failed');
      } catch { errors(); }
    }; });
    main.querySelector('#generate-slack-report').onclick = () => {
      const panel = main.querySelector('#slack-report-panel');
      panel.hidden = false;
      const state = { ...shelf, overlays: client.getOverlays() };
      main.querySelector('#slack-report-preview').innerHTML = createReportHtml(state);
      main.querySelector('#slack-report-text').value = createReport(state);
    };
    main.querySelector('#copy-slack-report').onclick = async () => {
      const state = { ...shelf, overlays: client.getOverlays() };
      const text = createReport(state);
      const html = createReportHtml(state);
      const status = main.querySelector('#slack-report-status');
      try {
        if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('Rich clipboard unavailable');
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        })]);
        status.textContent = 'Copied with formatting';
      } catch {
        try {
          await navigator.clipboard.writeText(text);
          status.textContent = 'Copied as plain text';
        } catch {
          const fallback = main.querySelector('#slack-report-text');
          fallback.hidden = false;
          fallback.select();
          status.textContent = 'Select and copy';
        }
      }
    };
  }
  window.addEventListener('pagehide', () => client?.close());
  reload().catch(() => { main.textContent = 'Focus Shelf could not load local configuration. Check FOCUS_SHELF_HOME and reload.'; });
}
