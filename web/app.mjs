import { createLocalClient } from '../lib/local-client.mjs';
import { safeURL } from '../lib/validation.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const link = (url, label, className = '') => safeURL(url) ? `<a class="${className}" href="${escape(url)}" data-open-in-chrome="${escape(url)}" rel="noopener noreferrer">${escape(label)}</a>` : `<span class="${className}">${escape(label)}</span>`;
const prKey = item => `${item.repository}#${item.number}`;
function currentCIObservation(catalog, pr) {
  if (catalog?.schemaVersion !== 2 || catalog.coverage?.find(item => item.issueId === pr.issueId)?.ci !== 'complete') return null;
  return catalog.ciObservations?.find(item => item.repository === pr.repository && item.number === pr.number && item.headSha.toLowerCase() === pr.headSha?.toLowerCase()) ?? null;
}
const currentCICounts = (catalog, pr) => currentCIObservation(catalog, pr)?.counts ?? null;
const allChecksPassed = counts => counts?.passed > 0 && counts.failed === 0 && counts.pending === 0 && counts.neutral === 0 && counts.unknown === 0;
export function displayedPRState(item, overlays = {}, catalog = null) {
  if (['merged', 'closed'].includes(item.state)) return item.state;
  const manual = overlays.prStatus?.[prKey(item)];
  if (typeof manual === 'string') return manual;
  if (manual?.status) return manual.status;
  const counts = item.isDraft === false ? currentCICounts(catalog, item) : null;
  return allChecksPassed(counts)
    ? 'ready-review' : 'open';
}
function changeRequestNeedsAttention(item, catalog) {
  if (item.review?.decision !== 'changes-requested') return false;
  const ci = currentCIObservation(catalog, item);
  if (!allChecksPassed(ci?.counts) || !ci.completedAt) return true;
  return Date.parse(item.review.submittedAt) >= Date.parse(ci.completedAt);
}
function manualPRWarning(item, overlays) {
  const selection = overlays.prStatus?.[prKey(item)];
  const manual = typeof selection === 'string' ? selection : selection?.status;
  if (item.state !== 'open') return '';
  if (manual === 'merged') return 'Not merged on GitHub';
  if (manual === 'closed') return 'Not closed on GitHub';
  return '';
}
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
  : type === 'duplicate' ? 'canceled'
  : ['started', 'completed', 'canceled', 'backlog', 'triage', 'unstarted'].includes(type) ? type : 'unknown';
const statusOptions = [
  ['open', 'Open'],
  ['ready-review', 'Ready for Review'],
  ['merged', 'Merged'],
  ['closed', 'Closed'],
];
const visibleIssues = snapshot => {
  const issues = snapshot?.issues ?? [];
  const excluded = new Set(issues.filter(item => ['canceled', 'duplicate'].includes(item.status.type)
    || ['cancel', 'canceled', 'cancelled', 'duplicate'].includes(item.status.name.trim().toLowerCase())).map(item => item.id));
  return issues.filter(item => !excluded.has(item.id)).map(item => ({
    ...item, relations: item.relations.filter(edge => !excluded.has(edge.issueId)),
  }));
};
const groups = [
  { key: 'planned', label: 'Upcoming', symbol: '◷', types: new Set(['triage', 'unstarted']) },
  { key: 'current', label: 'Current work', symbol: '⚡', types: new Set(['started']) },
  { key: 'backlog', label: 'Backlog', symbol: '≡', types: new Set(['backlog']) },
  { key: 'completed', label: 'Completed', symbol: '✓', types: new Set(['completed', 'canceled', 'duplicate']) },
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
  if (!prs.length) return '';
  return `<div class="ticket-prs">${prs.map(pr => {
    const key = prKey(pr);
    const state = displayedPRState(pr, overlays, catalog);
    const terminal = ['merged', 'closed'].includes(pr.state);
    const repository = maps.repositories.get(pr.repository);
    const repoLabel = repository?.label ?? reportRepositoryLabel(pr, catalog);
    const normalizedLabel = repoLabel.trim().toUpperCase();
    const tone = normalizedLabel === 'QA' ? 'coral' : normalizedLabel === 'INFRA' ? 'gold' : normalizedLabel === 'MONOREPO' || normalizedLabel === 'MONO REPO' ? 'blue' : repository?.tone ?? 'neutral';
    const ci = ciMark(catalog, pr);
    const ciIcon = state === 'ready-review' ? `<span class="ci-mark ci-${ci.tone}" title="${escape(ci.label)}" aria-label="${escape(ci.label)}">${ci.symbol}</span>` : '';
    const reviewBadge = !terminal && changeRequestNeedsAttention(pr, catalog) ? `<span class="pr-review-attention" title="Changes requested after the last full-green CI run">↻ Changes requested</span>` : '';
    const manualWarning = manualPRWarning(pr, overlays);
    const mismatchBadge = manualWarning ? `<span class="pr-manual-warning" title="GitHub state at last check: Open · ${escape(pr.observedAt)}">${escape(manualWarning)}</span>` : '';
    const creator = pr.creator?.isProfileOwner === false ? `<span class="pr-creator" title="GitHub author: ${escape(pr.creator.login)}">Created by ${escape(pr.creator.displayName ?? pr.creator.login)}</span>` : '';
    return `<div class="ticket-pr-entry"><span class="repo-badge repo-${escape(tone)}">${escape(repoLabel)}</span><span class="branch-badge">${escape(pr.baseBranch)}</span>${link(pr.url, `PR #${pr.number}`, 'pr-link')}${creator}<select class="pr-status pr-status-${escape(state)}" data-pr="${escape(key)}" title="${terminal ? 'Current GitHub terminal state' : 'Set a local status; GitHub state is checked separately on the next Codex refresh'}" ${readOnly || terminal ? 'disabled' : ''}>${statusOptions.map(([value, label]) => `<option value="${value}" ${value === state ? 'selected' : ''}>${label}</option>`).join('')}</select>${mismatchBadge}${reviewBadge}${ciIcon}</div>`;
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
  const thumbnailTone = presentation?.tone === 'neutral' ? 'blue' : presentation?.tone;
  const thumbnailState = String(item.status.name).trim().toUpperCase() === 'ON HOLD' ? ' ticket-thumbnail-on-hold' : '';
  const memo = overlays.memos?.[item.id] ?? '';
  const estimate = Number.isSafeInteger(item.estimate)
    ? `<span class="estimate-points" title="Estimate: ${item.estimate} point${item.estimate === 1 ? '' : 's'}" aria-label="Estimate: ${item.estimate} point${item.estimate === 1 ? '' : 's'}">${item.estimate}</span>`
    : '';
  const category = context.categories.get(item.id);
  const assignee = `${issueAssignee(item)}${archived ? ' · archived' : ''}`;
  const assigneeTitle = item.assignee?.name ? ` title="${escape(`Full Linear assignee: ${item.assignee.name}`)}"` : '';
  const delegated = nested && category === 'context' && Boolean(item.assignee?.id);
  const parentSprint = hasDri && childItems.length > 0 ? item.sprint : null;
  const createdOwnership = category === 'created' && item.assignee?.id
    ? `<span class="ownership-created">Created</span><span class="ownership-arrow">→</span><span class="ownership-assigned"${assigneeTitle}>Assigned to ${escape(formatAssigneeName(item.assignee?.name))}${archived ? ' · archived' : ''}</span>`
    : `<span${item.assignee?.id ? '' : ' class="ownership-unassigned"'}${assigneeTitle}>${escape(assignee)}</span>`;
  const ownership = hasDri && item.assignee?.id
    ? ''
    : `<div class="ticket-ownership">${createdOwnership}${item.sprint ? `<span>· Sprint: ${escape(item.sprint.name)}</span>` : ''}</div>`;
  const revealChild = context.revealIssueId && childItems.some(child => familyHasIssue(child, context.revealIssueId, children, overlays));
  const body = `${ownership}${renderDri(presentation, maps, parentSprint)}<div class="ticket-heading">${presentation ? `<div class="ticket-thumbnail ticket-thumbnail-${escape(thumbnailTone)}${thumbnailState}" role="img" aria-label="${escape(`${presentation.label} · ${presentation.description}`)}" title="${escape(presentation.description)}"><span class="ticket-thumbnail-icon">${renderTicketIcon(icon)}</span><span>${escape(presentation.label)}</span></div>` : ''}<div class="ticket-main"><div class="ticket-row">${link(item.url, item.id, 'issue-link')}${estimate}<span class="status-mark status-${statusTone(item.status.type, item.status.name)}" title="Observed Linear status: ${escape(item.status.name)}"></span><button class="archive-action" data-archive="${escape(item.id)}" ${readOnly ? 'disabled' : ''}>${archived ? 'Restore' : 'Archive'}</button></div><h3>${escape(item.title)}</h3></div></div><div class="memo-row"><span class="status-pill status-${statusTone(item.status.type, item.status.name)}" title="Read-only Linear status">${escape(item.status.name)}</span><span class="memo-label">Memo</span><textarea rows="1" data-memo="${escape(item.id)}" placeholder="None" ${readOnly ? 'disabled' : ''}>${escape(memo)}</textarea></div>${renderPRs(item, catalog, overlays, readOnly, maps)}${renderReferences(item, byId)}`;
  const card = !childItems.length
    ? `<article class="ticket-card${nested ? ' ticket-child' : ''}">${body}</article>`
    : `<article class="ticket-card ticket-family${nested ? ' ticket-child' : ''}">${body}<details class="child-task-fold" data-fold="children:${escape(item.id)}"${revealChild ? ' open' : ''}><summary class="handled-by"><span class="relationship-symbol relationship-symbol-child">Child</span><span>· ${childItems.length} ${childItems.length === 1 ? 'task' : 'tasks'}</span><span class="fold-chevron" aria-hidden="true"></span></summary><div class="ticket-children">${childItems.map(child => renderIssue(child, { ...context, nested: true })).join('')}</div></details></article>`;
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

function familyHasOpenPR(item, children, openPRIssueIds) {
  if (openPRIssueIds.has(item.id)) return true;
  return (children.get(item.id) ?? []).some(child => familyHasOpenPR(child, children, openPRIssueIds));
}

// Keep the Linear status visible, but leave a Done family in Current work while any associated PR remains open.
const familyGroupType = (item, children, openPRIssueIds) => item.status.type === 'completed'
  && familyHasOpenPR(item, children, openPRIssueIds) ? 'started' : item.status.type;

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
  return { key: `sprint:${key}`, kind, name: sprint.name, label: `${prefix} · ${sprint.name}`, rank, start: sprint.startDate };
}

function renderGroupedItems(items, context, sprintKey) {
  if (!['current', 'backlog', 'planned'].includes(context.workGroup)) return items.map(item => renderIssue(item, context)).join('');
  const ownership = [
    { key: 'mine', label: 'Assigned to me', matches: item => context.categories.get(item.id) === 'assigned' },
    { key: 'delegated', label: context.workGroup === 'planned' ? 'Assigned to others' : 'Created → Assigned to others', matches: item => context.workGroup === 'planned' ? item.assignee !== null && context.categories.get(item.id) !== 'assigned' : context.categories.get(item.id) === 'created' && item.assignee !== null },
    { key: 'unassigned', label: 'Unassigned', matches: item => item.assignee === null },
    { key: 'following', label: 'Following', matches: () => true },
  ];
  const visibleOwnership = context.workGroup === 'planned' ? ownership.filter(group => group.key !== 'following') : ownership;
  const buckets = new Map(visibleOwnership.map(group => [group.key, []]));
  for (const item of items) buckets.get(visibleOwnership.find(group => group.matches(item)).key).push(item);
  return visibleOwnership.map(group => {
    const members = buckets.get(group.key);
    if (!members.length) return '';
    const reveal = context.workGroup === 'current' || context.revealIssueId && members.some(item => familyHasIssue(item, context.revealIssueId, context.children, context.overlays));
    return `<details class="ownership-group ownership-group-${group.key}" data-fold="ownership:${context.workGroup}:${escape(sprintKey)}:${group.key}"${reveal ? ' open' : ''}><summary>${escape(group.label)}</summary><div class="group-items">${members.map(item => renderIssue(item, context)).join('')}</div></details>`;
  }).join('');
}

function renderSprintGroups(items, context) {
  if (context.workGroup === 'backlog') return renderGroupedItems(items, context, 'none');
  if (context.workGroup === 'planned') return renderGroupedItems(items, context, 'none');
  const completed = context.workGroup === 'completed';
  const sprintGroups = new Map();
  for (const item of items) {
    let group = familySprintGroup(item, context.children, context.overlays, context.snapshotGeneratedAt);
    if (completed && group.kind === 'none') {
      const date = new Date(item.createdAt ?? NaN);
      if (Number.isFinite(date.getTime())) {
        const options = { timeZone: context.timezone, year: 'numeric', month: '2-digit' };
        const parts = new Intl.DateTimeFormat('en', options).formatToParts(date);
        const month = `${parts.find(part => part.type === 'year').value}-${parts.find(part => part.type === 'month').value}`;
        group = { key: `month:${month}`, kind: 'month', label: new Intl.DateTimeFormat('en', { ...options, month: 'long' }).format(date), rank: 1, start: month };
      } else group = { key: 'undated', kind: 'undated', label: 'Undated', rank: 2, start: '' };
    } else if (completed) group = { ...group, rank: 0, label: group.kind === 'mixed' || /^Sprint\b/i.test(group.name) ? group.label.replace(/^(This|Upcoming|Past)? ?Sprint · /, '') : `Sprint · ${group.name}` };
    const current = sprintGroups.get(group.key) ?? { ...group, items: [] };
    current.items.push(item);
    sprintGroups.set(group.key, current);
  }
  return [...sprintGroups.values()]
    .sort((left, right) => left.rank - right.rank || (completed ? right.start.localeCompare(left.start) : left.start.localeCompare(right.start)) || left.label.localeCompare(right.label))
    .map(group => group.kind === 'none' && context.workGroup !== 'current'
      ? `<div class="group-items sprint-group-none">${renderGroupedItems(group.items, context, group.key)}</div>`
      : completed || group.kind === 'past' || ['current', 'backlog'].includes(context.workGroup)
        ? `<details class="sprint-group sprint-group-past" data-fold="sprint:${escape(context.workGroup)}:${escape(group.key)}"${context.workGroup === 'current' || context.revealIssueId && group.items.some(item => familyHasIssue(item, context.revealIssueId, context.children, context.overlays)) ? ' open' : ''}><summary>${escape(group.label)}</summary><div class="group-items">${renderGroupedItems(group.items, context, group.key)}</div></details>`
      : `<section class="sprint-group sprint-group-${escape(group.kind)}"><h3>${escape(group.label)}</h3><div class="group-items">${renderGroupedItems(group.items, context, group.key)}</div></section>`)
    .join('');
}

export function createUpdateRequest() {
  return 'Please update my Focus Shelf using this repository\'s bundled focus-shelf and generate-focus-shelf-icon Skills and CODEX_SNAPSHOT.md, not personal defaults. Confirm the intended external home, profile, Linear owner/workspace and existing local origin. Collect the complete current Linear scope: issues assigned to me, all issues I created (including reassigned and unassigned issues), previously retained created or followed issues, and the full reciprocal child hierarchy; exhaust pagination. Re-verify Linear status, relationships, historical identifier aliases, Sprint start/end dates, estimate and verified Linear creation timestamps. Discover exact associated PRs from attachments, comments and GitHub references, then verify association and my PR responsibility separately using a confirmed GitHub identity; do not attribute other people\'s PRs to me or infer no PR from an incomplete search. Refresh current GitHub Open/Merged/Closed state, Draft flag, and complete CI for each current PR head. Derive Ready for Review only for a non-Draft open PR with at least one passing check and no failed, pending, neutral or unknown non-policy checks at that head; skipped checks do not block it and a Release target policy failure shows an attention triangle. Treat a Release target policy failure as an attention warning, not a CI, test, build, or lint failure; skipped or unknown checks are not failures. Preserve local-file Memo and browser-local Archive. Keep manual PR selections in the local file across refreshes. If a PR is manually marked Merged or Closed while GitHub still reports Open, retain the selection and show a clear mismatch reminder; actual GitHub terminal state remains authoritative. Retain verified PRs without silent disappearance, provide topic icons for every visible root, and reuse the private DRI map only where verified. Keep ticket status read-only; exclude Canceled/Duplicate cards and let the application own grouping, counts and formatting. Collect authoritative Sprint names and start/end dates for all issues, but group by Sprint only inside Current work and Completed. Current work uses Sprint (or No Sprint), then ownership; Completed puts the newest Sprint first and groups unsprinted families by verified creation month. Upcoming and Backlog group directly into Assigned to me, Assigned to others, and Unassigned; show To Do/Triage status on each ticket without adding status subgroups. Preserve Sprint metadata on individual tickets. Determine This/Upcoming/Past Sprint from actual dates and current time, never guessed S1/S2 boundaries; a past Sprint does not mean Done. Save the updated snapshot and catalog to this computer only after repository validation and PR continuity checks pass; otherwise leave the existing local files unchanged and report the gap. Never save raw descriptions, comments or credentials. Reload the same local page and verify rendered results when available; distinguish local save checks from unavailable browser verification.';
}

export function createDailyUpdateRequest(snapshotGeneratedAt) {
  const since = new Date(snapshotGeneratedAt);
  if (!Number.isFinite(since.valueOf())) return createUpdateRequest();
  const overlap = new Date(since.valueOf() - 24 * 60 * 60 * 1000).toISOString();
  return `Please run a daily incremental Focus Shelf refresh using this repository's bundled focus-shelf and generate-focus-shelf-icon Skills and CODEX_SNAPSHOT.md. Use the current profile, Linear owner/workspace, GitHub identity, team DRI map and local origin already configured for this shelf. The last successfully published snapshot is ${since.toISOString()}; query Linear issues updated after ${overlap} (24-hour overlap) and exhaust pagination. Also enumerate the owner's current assigned issue IDs and issues created since ${overlap}; retain every previously published created/followed seed, including Done tickets. Merge changed records into the prior complete snapshot rather than rebuilding from a blank set. For each changed/new issue and any previously included issue whose membership or relations may have changed, refresh status, assignee, estimate, Sprint and authoritative start/end dates, createdAt, exact relations, comments/PR references and historical identifier aliases. Separately re-verify current Sprint membership for every retained issue on each daily refresh, including tickets whose prior Sprint was null: Sprint assignment can change without other meaningful ticket changes, so detect newly added, removed, or changed Sprint membership and refresh the ticket's Sprint name and authoritative dates. If complete Sprint-membership coverage for the retained set cannot be obtained, do not claim it is current or publish a partial refresh; preserve prior files and report the gap. Recursively fetch the complete reciprocal child closure for affected seeds and include every new descendant; remove an old issue only when current evidence proves it no longer belongs to the assigned/created/followed scope or any retained child closure. Preserve unaffected issue records, local-file Memo and browser-local Archive. Keep manual PR selections in the local file across refreshes. If a PR is manually marked Merged or Closed while GitHub still reports Open, retain that choice and show a clear mismatch reminder; actual GitHub terminal state remains authoritative. Discover and verify new PR associations only for changed/new affected tickets; refresh GitHub state, Draft flag, and complete CI for each known open PR and each newly discovered PR at its current head. Derive Ready for Review only for a non-Draft open PR with at least one passing check and no failed, pending, neutral or unknown non-policy checks at that head; skipped checks do not block it and a Release target policy failure shows an attention triangle. Keep prior verified associations for unaffected PRs and preserve any PR whose association or ownership remains unresolved; never infer no PR from an incomplete search. Treat Release target policy as an attention warning; skipped/unknown checks are not failures. Preserve ticket icons/workstreams for unchanged meanings and refresh topic icons only when a visible root's meaning changed or a new root appeared. Keep ticket status read-only, omit Canceled/Duplicate cards, and let the application group and format. Save a new complete snapshot/catalog pair on this computer only after affected-scope, Sprint-membership, child-closure, PR-continuity and validation checks pass; keep prior records and observations for unaffected items. If the previous snapshot is missing, identity changed, the incremental query or relationship closure is incomplete, or unexpected scope drift appears, do not save a partial delta: perform a full refresh or preserve the previous files and report the gap. Never save raw descriptions, comments or credentials. Reload the same local page and report API/local-save checks separately from any unavailable visual browser verification.`;
}

export function renderShelf({ config, snapshot, catalog, dri, overlays = {}, readOnly = true, readOnlyReason = '', saveState = 'idle', revealIssueId = null, now = new Date().toISOString() }) {
  const issues = visibleIssues(snapshot);
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
  const openPRIssueIds = new Set((catalog?.pullRequests ?? []).filter(pr => pr.state === 'open').map(pr => pr.issueId));
  const archivedItems = issues.filter(item => overlays.archived?.[item.id]);
  const archivedCount = archivedItems.length;
  const visibleRoots = activeRoots(roots, children, overlays);
  const pins = (config?.pins ?? []).map(pin => link(pin.url, pin.title, 'pin-link')).join('');
  const renderedGroups = groups.map(group => {
    const items = visibleRoots.filter(item => group.types.has(familyGroupType(item, children, openPRIssueIds)));
    if (!items.length) return '';
    const context = { byId, children, catalog, overlays, readOnly, maps, categories, snapshotGeneratedAt: now, revealIssueId, workGroup: group.key, timezone: config?.timezone ?? 'UTC' };
    const reveal = group.key === 'current' || revealIssueId && items.some(item => familyHasIssue(item, revealIssueId, children, overlays));
    return `<details class="focus-group focus-group-${group.key}" data-fold="group:${group.key}"${reveal ? ' open' : ''}><summary><span>${group.symbol}</span>${group.label}</summary><div class="sprint-groups">${renderSprintGroups(items, context)}</div></details>`;
  }).join('');
  const empty = '<section class="empty"><h2>Your shelf is ready</h2><p>No issues yet. Configure your local profile and explicitly ask Codex to refresh a snapshot.</p></section>';
  const archive = `<details id="archive-section" class="archive-section"><summary>Archive · ${archivedCount}</summary><p>Only manually archived tickets appear here.</p><div class="archive-list">${archivedItems.map(item => renderIssue(item, { byId, children: new Map(), catalog, overlays, readOnly, maps, categories })).join('')}</div></details>`;
  const navigation = pins ? `<nav>${pins}</nav>` : '';
  const writerNotice = readOnly
    ? '<div class="writer-notice"><span>Read-only</span><button id="takeover">Use this window</button></div>'
    : '<div class="local-status" hidden aria-live="polite"></div>';
  const updateControl = '<header class="shelf-toolbar"><button id="request-focus-update" class="update-action" type="button" aria-describedby="focus-update-status" title="Copy a daily incremental Focus Shelf refresh request for Codex"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 7v5h-5M4 17v-5h5M6.1 8A7 7 0 0 1 18 6l2 1M17.9 16A7 7 0 0 1 6 18l-2-1"/></svg><span>Update</span></button><button id="request-focus-full-update" class="update-full-action" type="button" aria-describedby="focus-update-status" title="Copy a complete Focus Shelf reconciliation request for Codex">Full refresh</button><span id="focus-update-status" class="update-status" aria-live="polite"></span><textarea id="focus-update-fallback" readonly hidden aria-label="Focus Shelf update request"></textarea></header>';
  const slackReport = '<section class="slack-report"><button id="generate-slack-report">Generate Slack Report</button><div id="slack-report-panel" hidden><div id="slack-report-preview" class="slack-report-preview"></div><textarea id="slack-report-text" readonly hidden></textarea><div class="slack-report-actions"><button id="copy-slack-report">Copy Report</button><span id="slack-report-status" aria-live="polite"></span></div></div></section>';
  return `${updateControl}${navigation}${writerNotice}${renderedGroups || empty}${archive}${slackReport}`;
}

const reportRepositoryLabel = (pr, catalog) => catalog?.presentation?.repositories?.find(item => item.repository === pr.repository)?.label
  ?? ({ 'elite-sales-infrastructure': 'Infra', 'elite-sales-monorepo': 'Monorepo', 'elite-sales-qa-tests': 'QA', 'elite-sales-data-orchestration': 'Data Orch.' }[pr.repository.split('/').at(-1)] ?? pr.repository);
const reportTarget = pr => pr.baseBranch === 'feature/build-release-candidate' ? 'RC (feature/build-release-candidate)' : pr.baseBranch;
const reportHtmlLink = (url, label) => safeURL(url) ? `<a href="${escape(url)}"><strong>${escape(label)}</strong></a>` : `<strong>${escape(label)}</strong>`;

function createReportModel({ snapshot, catalog, overlays = {} }) {
  const excluded = new Set(catalog?.presentation?.report?.excludedIssueIds ?? []);
  const issues = visibleIssues(snapshot);
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
      const prs = (catalog?.pullRequests ?? []).filter(pr => pr.issueId === item.id && displayedPRState(pr, overlays, catalog) === 'ready-review');
      return prs.length ? [reportIssue(item, prs)] : [];
    });
    ready.push(...readyMembers);
    if (readyMembers.length) continue;
    const activeAssigned = members.filter(item => issueCategory(item, snapshot) === 'assigned' && item.status?.type === 'started');
    if (!activeAssigned.length) continue;
    progress.push(...activeAssigned.map(item => reportIssue(item)));
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
  let memoState = { revision: 0, memos: {} };
  let prStatusState = { revision: 0, statuses: {} };
  const main = document.querySelector('main');
  const currentOverlays = () => ({ ...client.getOverlays(), memos: memoState.memos, prStatus: prStatusState.statuses });
  async function reload() {
    const response = await fetch('/api/shelf', { cache: 'no-store' });
    if (!response.ok) throw new Error('Local snapshot unavailable');
    const next = await response.json();
    let nextMemos = { revision: 0, memos: {} };
    let nextPRStatus = { revision: 0, statuses: {} };
    if (next.config) {
      const memoResponse = await fetch('/api/memos', { cache: 'no-store' });
      if (!memoResponse.ok) throw new Error('Local Memo unavailable');
      nextMemos = await memoResponse.json();
      const prStatusResponse = await fetch('/api/pr-status', { cache: 'no-store' });
      if (!prStatusResponse.ok) throw new Error('Local PR status unavailable');
      nextPRStatus = await prStatusResponse.json();
    }
    if (client) client.acceptShelf(next);
    else client = await createLocalClient({ config: next.config, storage: window.localStorage, locks: navigator.locks });
    shelf = next; memoState = nextMemos; prStatusState = nextPRStatus; render();
  }
  function render(revealIssueId = null) {
    const folds = new Map([...main.querySelectorAll('details[data-fold]')].map(node => [node.dataset.fold, node.open]));
    main.innerHTML = renderShelf({ ...shelf, overlays: currentOverlays(), readOnly: client.readOnly, readOnlyReason: client.readOnlyReason, saveState: client.saveState, revealIssueId });
    main.querySelectorAll('details[data-fold]').forEach(node => {
      if ((!revealIssueId || !node.open) && folds.has(node.dataset.fold)) node.open = folds.get(node.dataset.fold);
    });
    const errors = () => { const node = main.querySelector('.local-status') ?? main.querySelector('.writer-notice'); node.hidden = false; node.textContent = `Save failed · ${client.readOnlyReason || 'Local storage or input unavailable'}`; node.classList.add('error'); };
    const action = (fn, reveal = null) => { try { fn(); render(reveal); if (reveal) main.querySelector(`[data-archive="${CSS.escape(reveal)}"]`)?.scrollIntoView({ block: 'center' }); } catch { errors(); } };
    main.querySelector('#takeover')?.addEventListener('click', async () => { await client.acquireWriter(); render(); });
    const copyUpdatePrompt = async request => {
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
    main.querySelector('#request-focus-update').onclick = () => copyUpdatePrompt(
      shelf.snapshot
        ? "Please update my Focus Shelf incrementally using this repository's bundled focus-shelf Skill and CODEX_SNAPSHOT.md. Recheck all known open PRs, including review chronology and current-head CI. Preserve manual PR choices and local data; save updated files on this computer only after validation. Remind me if a manual Merged or Closed choice is still Open on GitHub."
        : createUpdateRequest(),
    );
    main.querySelector('#request-focus-full-update').onclick = () => copyUpdatePrompt(createUpdateRequest());
    main.querySelectorAll('[data-memo]').forEach(node => { node.onchange = async () => {
      if (client.readOnly) return errors();
      const value = node.value;
      const previouslyShown = memoState.memos[node.dataset.memo] ?? '';
      try {
        const response = await fetch('/api/memos', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: node.dataset.memo, value, expectedRevision: memoState.revision }) });
        if (!response.ok) throw new Error(response.status === 409 ? 'Memo changed in another window. Copy your text before reloading.' : 'Memo was not saved.');
        memoState = await response.json();
        const current = main.querySelector(`[data-memo="${CSS.escape(node.dataset.memo)}"]`);
        if (current && current !== node && current.value === previouslyShown) current.value = value;
        const status = main.querySelector('.local-status');
        if (status) { status.hidden = false; status.textContent = 'Memo saved on this computer'; status.classList.remove('error'); }
      } catch (error) {
        const status = main.querySelector('.local-status') ?? main.querySelector('.writer-notice');
        status.hidden = false; status.textContent = error.message || 'Memo was not saved'; status.classList.add('error');
      }
    }; });
    main.querySelectorAll('[data-archive]').forEach(node => { node.onclick = () => {
      const id = node.dataset.archive;
      const restoring = client.isArchived(id);
      action(() => client.setArchived(id, !restoring), restoring ? id : null);
    }; });
    main.querySelectorAll('[data-pr]').forEach(node => { node.onchange = async () => {
      if (client.readOnly) return errors();
      try {
        const response = await fetch('/api/pr-status', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: node.dataset.pr, status: node.value, expectedRevision: prStatusState.revision }) });
        if (!response.ok) throw new Error(response.status === 409 ? 'PR status changed in another window. Reload before saving.' : 'PR status was not saved.');
        prStatusState = await response.json();
        render();
      } catch (error) {
        render();
        const status = main.querySelector('.local-status') ?? main.querySelector('.writer-notice');
        status.hidden = false; status.textContent = error.message || 'PR status was not saved'; status.classList.add('error');
      }
    }; });
    main.querySelectorAll('[data-open-in-chrome]').forEach(node => { node.onclick = async event => {
      event.preventDefault();
      const showLinkError = message => {
        const status = main.querySelector('.local-status') ?? main.querySelector('.writer-notice');
        status.hidden = false;
        status.textContent = message;
        status.classList.add('error');
      };
      try {
        const response = await fetch('/api/open-in-chrome', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: node.dataset.openInChrome }) });
        if (response.status === 403) return showLinkError('Link not opened · the local service did not approve it. Reload or update the shelf.');
        if (response.status === 502) return showLinkError('Link not opened · Chrome could not open it. Check Chrome and try again.');
        if (!response.ok) return showLinkError('Link not opened · the local Focus Shelf service rejected the request. Reload the page and try again.');
      } catch {
        showLinkError('Link not opened · the local Focus Shelf service is unavailable. Restart it at this page’s address and reload.');
      }
    }; });
    main.querySelector('#generate-slack-report').onclick = () => {
      const panel = main.querySelector('#slack-report-panel');
      panel.hidden = false;
      const state = { ...shelf, overlays: currentOverlays() };
      main.querySelector('#slack-report-preview').innerHTML = createReportHtml(state);
      main.querySelector('#slack-report-text').value = createReport(state);
    };
    main.querySelector('#copy-slack-report').onclick = async () => {
      const state = { ...shelf, overlays: currentOverlays() };
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
  reload().catch(() => { main.textContent = 'Focus Shelf could not load local configuration or personal state. Check FOCUS_SHELF_HOME and reload.'; });
}
