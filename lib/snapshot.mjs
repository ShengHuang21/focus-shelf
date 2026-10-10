import { open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { exact, fail, text, iso, safeURL } from './validation.mjs';
import { validateConfig } from './config.mjs';
import { safeHome, readJSON } from './files.mjs';

const MAX_ISSUES = 1000;
const MAX_CATALOG_ENTRIES = 5000;

export function validateSnapshot(value, config) {
  const code = 'INVALID_SNAPSHOT';
  const tracksCreated = value?.schemaVersion === 2 && 'createdIssueIds' in value;
  exact(value, ['schemaVersion', 'generatedAt', 'source', 'scope', 'ownerId', 'followedIssueIds', ...(tracksCreated ? ['createdIssueIds'] : []), 'issues'], code);
  exact(value.source, ['kind', 'workspaceSlug'], code);
  const expectedScope = value.schemaVersion === 1 ? 'assigned-followed' : tracksCreated ? 'assigned-created-followed-context' : 'assigned-followed-context';
  if (!config.linear || ![1, 2].includes(value.schemaVersion) || !iso(value.generatedAt) || value.source.kind !== 'codex-manual-refresh' || value.scope !== expectedScope || value.ownerId !== config.linear.ownerId || value.source.workspaceSlug !== config.linear.workspaceSlug) fail(code, 'identity');
  const createdIssueIds = tracksCreated ? value.createdIssueIds : [];
  if (!Array.isArray(value.issues) || value.issues.length > MAX_ISSUES || !Array.isArray(value.followedIssueIds) || value.followedIssueIds.length > MAX_ISSUES || new Set(value.followedIssueIds).size !== value.followedIssueIds.length || !Array.isArray(createdIssueIds) || createdIssueIds.length > MAX_ISSUES || new Set(createdIssueIds).size !== createdIssueIds.length) fail(code, 'issues/seeds');
  const issues = new Map();
  const uuids = new Set();
  for (const item of value.issues) {
    const issueFields = ['id', 'uuid', 'title', 'url', 'status', 'assignee', 'relations', 'sprint'];
    exact(item, [...issueFields, ...('estimate' in item ? ['estimate'] : []), ...('createdAt' in item ? ['createdAt'] : [])], code);
    if ('createdAt' in item && !iso(item.createdAt)) fail(code, 'createdAt');
    if (!/^[A-Za-z][A-Za-z0-9]*-\d+$/.test(item.id) || issues.has(item.id) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(item.uuid) || uuids.has(item.uuid) || !text(item.title) || !safeURL(item.url)) fail(code, 'issue');
    const url = new URL(item.url);
    if (url.protocol !== 'https:' || !['linear.app', 'linear.example.test'].includes(url.hostname) || !url.pathname.startsWith(`/${config.linear.workspaceSlug}/issue/${item.id}`) || !(url.pathname === `/${config.linear.workspaceSlug}/issue/${item.id}` || url.pathname.startsWith(`/${config.linear.workspaceSlug}/issue/${item.id}/`))) fail(code, 'issue URL');
    exact(item.status, ['name', 'type'], code);
    if (!text(item.status.name) || !['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled', 'duplicate'].includes(item.status.type)) fail(code, 'status');
    if (item.assignee !== null) { exact(item.assignee, ['id', 'name'], code); if (!text(item.assignee.id) || !text(item.assignee.name)) fail(code, 'assignee'); }
    if (value.schemaVersion === 1 && item.assignee?.id !== config.linear.ownerId && !value.followedIssueIds.includes(item.id)) fail(code, 'scope');
    if ('estimate' in item && item.estimate !== null && (!Number.isSafeInteger(item.estimate) || item.estimate < 0 || item.estimate > 100)) fail(code, 'estimate');
    if (item.sprint !== null) { exact(item.sprint, ['name', 'startDate', 'endDate'], code); if (!text(item.sprint.name) || !iso(item.sprint.startDate) || !iso(item.sprint.endDate) || item.sprint.startDate > item.sprint.endDate) fail(code, 'sprint'); }
    if (!Array.isArray(item.relations) || item.relations.length > MAX_CATALOG_ENTRIES) fail(code, 'relations');
    const edges = new Set();
    for (const edge of item.relations) {
      exact(edge, ['type', 'issueId'], code);
      if (!['parent', 'child', 'blockedBy', 'blocks', 'related', 'duplicateOf'].includes(edge.type) || !text(edge.issueId) || edge.issueId === item.id || edges.has(`${edge.type}:${edge.issueId}`)) fail(code, 'relation');
      edges.add(`${edge.type}:${edge.issueId}`);
    }
    if (item.relations.filter(edge => edge.type === 'parent').length > 1) fail(code, 'multiple parents');
    issues.set(item.id, item); uuids.add(item.uuid);
  }
  if (value.followedIssueIds.some(id => !issues.has(id))) fail(code, 'followed absent');
  if (createdIssueIds.some(id => !issues.has(id))) fail(code, 'created absent');
  for (const item of issues.values()) {
    for (const edge of item.relations) {
      const target = issues.get(edge.issueId);
      if (!target) fail(code, 'relation absent');
      if (['parent', 'child'].includes(edge.type) && !target.relations.some(back => back.type === (edge.type === 'parent' ? 'child' : 'parent') && back.issueId === item.id)) fail(code, 'reciprocal');
    }
    const visited = new Set([item.id]);
    let cursor = item;
    while (cursor.relations.some(edge => edge.type === 'parent')) {
      const id = cursor.relations.find(edge => edge.type === 'parent').issueId;
      if (visited.has(id)) fail(code, 'cycle');
      visited.add(id); cursor = issues.get(id);
    }
  }
  if (value.schemaVersion === 2) {
    const reachable = new Set([...issues.values()].filter(item => item.assignee?.id === value.ownerId || createdIssueIds.includes(item.id) || value.followedIssueIds.includes(item.id)).map(item => item.id));
    const queue = [...reachable];
    for (const id of queue) for (const edge of issues.get(id).relations) {
      if (edge.type === 'child' && !reachable.has(edge.issueId)) { reachable.add(edge.issueId); queue.push(edge.issueId); }
    }
    if (reachable.size !== issues.size) fail(code, 'context unreachable');
  }
  return structuredClone(value);
}

// Input issues must come from a complete authorized collection, including every
// descendant. External parent/reference edges are projected out, never expanded.
export function buildSnapshotV2(value, config) {
  const tracksCreated = 'createdIssueIds' in value;
  const createdIssueIds = tracksCreated ? value.createdIssueIds : [];
  if (!Array.isArray(value.issues) || new Set(value.issues.map(item => item.id)).size !== value.issues.length || !Array.isArray(value.followedIssueIds) || !Array.isArray(createdIssueIds)) fail('INVALID_SNAPSHOT', 'collection');
  const byId = new Map(value.issues.map(item => [item.id, item]));
  const selected = new Set(value.issues.filter(item => item.assignee?.id === config.linear?.ownerId || createdIssueIds.includes(item.id) || value.followedIssueIds.includes(item.id)).map(item => item.id));
  const queue = [...selected];
  for (const id of queue) for (const edge of byId.get(id).relations) {
    if (edge.type !== 'child') continue;
    const child = byId.get(edge.issueId);
    if (!child || !child.relations.some(back => back.type === 'parent' && back.issueId === id)) fail('INVALID_SNAPSHOT', 'incomplete child closure');
    if (!selected.has(child.id)) { selected.add(child.id); queue.push(child.id); }
  }
  for (const item of value.issues) for (const edge of item.relations) {
    if (edge.type === 'parent' && selected.has(edge.issueId) && !byId.get(edge.issueId).relations.some(back => back.type === 'child' && back.issueId === item.id)) fail('INVALID_SNAPSHOT', 'incomplete reciprocal child');
  }
  return validateSnapshot({ ...value, schemaVersion: 2, scope: tracksCreated ? 'assigned-created-followed-context' : 'assigned-followed-context', issues: value.issues.filter(item => selected.has(item.id)).map(item => ({ ...item, relations: item.relations.filter(edge => selected.has(edge.issueId)) })) }, config);
}

export function validateCatalog(value, config, snapshot) {
  const code = 'INVALID_CATALOG';
  const v2 = value?.schemaVersion === 2;
  exact(value, ['schemaVersion', 'ownerId', 'workspaceSlug', 'snapshotGeneratedAt', 'aliases', 'pullRequests', 'ciObservations', 'presentation', ...(v2 ? ['coverage'] : [])], code);
  if (!snapshot || !config.linear || ![1, 2].includes(value.schemaVersion) || value.schemaVersion !== snapshot.schemaVersion || value.ownerId !== config.linear.ownerId || value.workspaceSlug !== config.linear.workspaceSlug || value.snapshotGeneratedAt !== snapshot.generatedAt) fail(code, 'binding');
  const ids = new Set(snapshot.issues.map(item => item.id));
  const array = (items, fields, check) => {
    if (!Array.isArray(items) || items.length > MAX_CATALOG_ENTRIES) fail(code, 'array');
    for (const item of items) { exact(item, fields, code); if (!check(item)) fail(code, 'entry'); }
  };
  const repo = value => typeof value === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value);
  const number = value => Number.isSafeInteger(value) && value > 0;
  array(value.aliases, ['previousId', 'id', 'uuid', 'createdAt'], item => text(item.previousId) && ids.has(item.id) && snapshot.issues.find(issue => issue.id === item.id)?.uuid === item.uuid && iso(item.createdAt));
  const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value);
  const prURL = item => {
    if (!safeURL(item.url)) return false;
    const url = new URL(item.url);
    return url.protocol === 'https:' && url.hostname === 'github.com' && !url.port && url.pathname === `/${item.repository}/pull/${item.number}` && !url.search && !url.hash;
  };
  array(value.pullRequests, ['issueId', 'repository', 'number', 'url', 'baseBranch', 'state', 'purpose', 'observedAt', ...(v2 ? ['headSha', 'association'] : [])], item => {
    if (!(ids.has(item.issueId) && repo(item.repository) && number(item.number) && safeURL(item.url) && text(item.baseBranch) && ['open', 'merged', 'closed'].includes(item.state) && text(item.purpose) && iso(item.observedAt))) return false;
    if (!v2) return true;
    exact(item.association, ['kind', 'issueId', 'sourceUrl'], code);
    if (!sha(item.headSha) || !prURL(item) || item.association.issueId !== item.issueId) return false;
    if (item.association.kind === 'github-reference') return item.association.sourceUrl === item.url;
    if (item.association.kind !== 'linear-attachment' || !safeURL(item.association.sourceUrl)) return false;
    const url = new URL(item.association.sourceUrl);
    const path = `/${config.linear.workspaceSlug}/issue/${item.issueId}`;
    return url.protocol === 'https:' && ['linear.app', 'linear.example.test'].includes(url.hostname) && !url.port && (url.pathname === path || url.pathname.startsWith(path + '/')) && !url.search && !url.hash;
  });
  array(value.ciObservations, ['repository', 'number', 'headSha', 'observedAt', 'counts'], item => {
    const countFields = ['passed', 'failed', 'pending', 'skipped', 'neutral', 'unknown'];
    if ('releaseTargetPolicyFailed' in item.counts) countFields.push('releaseTargetPolicyFailed');
    exact(item.counts, countFields, code);
    return repo(item.repository) && number(item.number) && /^[a-f0-9]{40}$/i.test(item.headSha) && iso(item.observedAt) && Object.values(item.counts).every(count => Number.isSafeInteger(count) && count >= 0);
  });
  if (v2) {
    const unique = (items, key) => { if (new Set(items.map(key)).size !== items.length) fail(code, 'duplicate'); };
    unique(value.pullRequests, item => `${item.repository}#${item.number}#${item.issueId}`);
    const sharedPRs = new Map();
    const sharedFields = ['repository', 'number', 'url', 'baseBranch', 'state', 'purpose', 'observedAt', 'headSha'];
    for (const pr of value.pullRequests) {
      const key = `${pr.repository}#${pr.number}`;
      const previous = sharedPRs.get(key);
      if (previous && sharedFields.some(field => previous[field] !== pr[field])) fail(code, 'conflicting PR metadata');
      sharedPRs.set(key, pr);
    }
    unique(value.ciObservations, item => `${item.repository}#${item.number}#${item.headSha.toLowerCase()}`);
    array(value.coverage, ['issueId', 'pr', 'ci', 'observedAt'], item => ids.has(item.issueId) && ['complete', 'unavailable'].includes(item.pr) && ['complete', 'unavailable', 'not-applicable'].includes(item.ci) && iso(item.observedAt));
    unique(value.coverage, item => item.issueId);
    if (value.coverage.length !== ids.size) fail(code, 'coverage incomplete');
    for (const item of value.coverage) {
      const prs = value.pullRequests.filter(pr => pr.issueId === item.issueId);
      if (item.pr === 'unavailable' && item.ci !== 'unavailable') fail(code, 'incomplete PR discovery cannot establish CI coverage');
      if (item.ci === 'not-applicable' && (item.pr !== 'complete' || prs.length)) fail(code, 'coverage not applicable');
      if (!prs.length && item.ci === 'complete') fail(code, 'coverage without PR');
    }
  }
  exact(value.presentation, ['repositories', 'tickets', 'report'], code);
  array(value.presentation.repositories, ['repository', 'label', 'tone'], item => repo(item.repository) && text(item.label) && ['neutral', 'blue', 'green', 'amber', 'red'].includes(item.tone));
  const ticketIcons = new Set(['ticket', 'recent-news', 'news-filter', 'download', 'outage', 'chat-error', 'sync', 'password', 'cluster', 'news', 'test-harness', 'support-id', 'deploy']);
  const validateGeneratedIcon = icon => {
    exact(icon, ['version', 'paths'], code);
    if (icon.version !== 1 || !Array.isArray(icon.paths) || icon.paths.length < 1 || icon.paths.length > 12) return false;
    return icon.paths.every(path => {
      const fields = ['d', 'role', ...('strokeWidth' in path ? ['strokeWidth'] : [])];
      exact(path, fields, code);
      return typeof path.d === 'string' && path.d.length >= 2 && path.d.length <= 400
        && /^[MmLlHhVvCcSsQqTtAaZz0-9eE+.,\s-]+$/.test(path.d)
        && /^[Mm]/.test(path.d.trim())
        && ['stroke', 'fill', 'accent', 'inverse'].includes(path.role)
        && (!('strokeWidth' in path) || Number.isFinite(path.strokeWidth) && path.strokeWidth >= 1 && path.strokeWidth <= 6);
    });
  };
  for (const item of value.presentation.tickets) {
    const hasIcon = Object.hasOwn(item, 'icon');
    const hasLegacyGlyph = Object.hasOwn(item, 'glyph');
    if (hasIcon === hasLegacyGlyph) fail(code, 'entry');
    const fields = ['issueId', 'label', hasIcon ? 'icon' : 'glyph', 'tone', 'description', ...('workstream' in item ? ['workstream'] : [])];
    exact(item, fields, code);
    const glyphs = typeof item.glyph === 'string' ? [...item.glyph] : [];
    if (!(ids.has(item.issueId) && text(item.label) && item.label.length <= 40
      && (hasIcon ? (ticketIcons.has(item.icon) || validateGeneratedIcon(item.icon)) : glyphs.length >= 1 && glyphs.length <= 4 && !/[<>\p{C}]/u.test(item.glyph))
      && ['neutral', 'blue', 'purple', 'green', 'amber', 'red'].includes(item.tone)
      && text(item.description) && item.description.length <= 160
      && (!('workstream' in item) || text(item.workstream) && item.workstream.length <= 100))) fail(code, 'entry');
  }
  exact(value.presentation.report, ['excludedIssueIds', 'familySummaries'], code);
  if (!Array.isArray(value.presentation.report.excludedIssueIds) || value.presentation.report.excludedIssueIds.length > MAX_ISSUES || value.presentation.report.excludedIssueIds.some(id => !ids.has(id)) || !Array.isArray(value.presentation.report.familySummaries) || value.presentation.report.familySummaries.length > MAX_ISSUES || value.presentation.report.familySummaries.some(item => !text(item))) fail(code, 'report');
  return structuredClone(value);
}

const canonical = value => JSON.stringify(value, function(key, item) { return item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(name => [name, item[name]])) : item; });

export async function publishSnapshot({ home, input, hooks = {} }) {
  const root = await safeHome(home, true);
  const lockPath = join(root, '.snapshot.lock');
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') fail('SNAPSHOT_LOCKED'); throw error; }
  let temporary;
  try {
    await hooks.afterLock?.();
    const config = validateConfig(await readJSON(root, 'config.json'));
    const next = validateSnapshot(input, config);
    let previous;
    try { previous = validateSnapshot(await readJSON(root, 'linear-latest.json'), config); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (previous) {
      if (previous.schemaVersion === 2 && next.schemaVersion === 1) fail('SNAPSHOT_DOWNGRADE');
      if (next.generatedAt < previous.generatedAt) fail('SNAPSHOT_ROLLBACK');
      if (next.generatedAt === previous.generatedAt) {
        if (canonical(next) !== canonical(previous)) fail('SNAPSHOT_CONFLICT');
        return { status: 'unchanged' };
      }
      if (previous.followedIssueIds.some(id => !next.followedIssueIds.includes(id) || !next.issues.some(issue => issue.id === id))) fail('FOLLOWED_INCOMPLETE');
      if ((previous.createdIssueIds ?? []).some(id => !(next.createdIssueIds ?? []).includes(id) || !next.issues.some(issue => issue.id === id))) fail('CREATED_INCOMPLETE');
    }
    temporary = join(root, `.snapshot-${randomUUID()}.tmp`);
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(next, null, 2) + '\n'); await file.sync(); } finally { await file.close(); }
    await hooks.beforeRename?.();
    await rename(temporary, join(root, 'linear-latest.json'));
    temporary = null;
    const directory = await open(root, 'r');
    try { await directory.sync(); } finally { await directory.close(); }
    await hooks.afterRenameBeforeAcknowledge?.();
    return { status: 'written' };
  } finally {
    if (temporary) await unlink(temporary).catch(() => {});
    await lock.close();
    await unlink(lockPath);
  }
}

const prContinuityKey = item => `${item.repository}#${item.number}`;

function protectedPreviousPRKeys(value, config, snapshot) {
  if (value?.schemaVersion !== 2 || value.ownerId !== config.linear?.ownerId || value.workspaceSlug !== config.linear?.workspaceSlug || !Array.isArray(value.pullRequests)) return new Set();
  const currentIssueIds = new Set(snapshot.issues.map(item => item.id));
  const keys = new Set();
  for (const item of value.pullRequests) {
    if (!currentIssueIds.has(item?.issueId)) continue;
    if (typeof item.repository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(item.repository) || !Number.isSafeInteger(item.number) || item.number <= 0) fail('PR_CONTINUITY_INVALID');
    keys.add(prContinuityKey(item));
  }
  return keys;
}

export async function publishCatalog({ home, input, allowPRRemovals = [], hooks = {} }) {
  const root = await safeHome(home, true);
  const lockPath = join(root, '.catalog.lock');
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') fail('CATALOG_LOCKED'); throw error; }
  let temporary;
  try {
    await hooks.afterLock?.();
    const config = validateConfig(await readJSON(root, 'config.json'));
    const snapshot = validateSnapshot(await readJSON(root, 'linear-latest.json'), config);
    const next = validateCatalog(input, config, snapshot);
    let previous;
    let previousRaw;
    try {
      previousRaw = await readJSON(root, 'catalog.json');
      previous = validateCatalog(previousRaw, config, snapshot);
    }
    catch (error) { if (error.code !== 'ENOENT' && !error.message.startsWith('INVALID_CATALOG')) throw error; }
    if (!Array.isArray(allowPRRemovals) || new Set(allowPRRemovals).size !== allowPRRemovals.length || allowPRRemovals.some(key => !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+$/.test(key))) fail('INVALID_PR_REMOVALS');
    const nextKeys = new Set(next.pullRequests.map(prContinuityKey));
    const missingKeys = [...protectedPreviousPRKeys(previousRaw, config, snapshot)].filter(key => !nextKeys.has(key));
    const allowed = new Set(allowPRRemovals);
    const unacknowledged = missingKeys.filter(key => !allowed.has(key));
    const unused = allowPRRemovals.filter(key => !missingKeys.includes(key));
    if (unacknowledged.length) fail('PR_CONTINUITY_INCOMPLETE', unacknowledged.join(', '));
    if (unused.length) fail('UNUSED_PR_REMOVAL', unused.join(', '));
    if (previous && canonical(next) === canonical(previous)) return { status: 'unchanged' };
    temporary = join(root, `.catalog-${randomUUID()}.tmp`);
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(next, null, 2) + '\n'); await file.sync(); } finally { await file.close(); }
    await hooks.beforeRename?.();
    await rename(temporary, join(root, 'catalog.json'));
    temporary = null;
    const directory = await open(root, 'r');
    try { await directory.sync(); } finally { await directory.close(); }
    await hooks.afterRenameBeforeAcknowledge?.();
    return { status: 'written' };
  } finally {
    if (temporary) await unlink(temporary).catch(() => {});
    await lock.close();
    await unlink(lockPath);
  }
}
