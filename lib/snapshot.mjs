import { open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { exact, fail, text, iso, safeURL } from './validation.mjs';
import { validateConfig } from './config.mjs';
import { safeHome, readJSON } from './files.mjs';

export function validateSnapshot(value, config) {
  const code = 'INVALID_SNAPSHOT';
  exact(value, ['schemaVersion', 'generatedAt', 'source', 'scope', 'ownerId', 'followedIssueIds', 'issues'], code);
  exact(value.source, ['kind', 'workspaceSlug'], code);
  if (!config.linear || value.schemaVersion !== 1 || !iso(value.generatedAt) || value.source.kind !== 'codex-manual-refresh' || value.scope !== 'assigned-followed' || value.ownerId !== config.linear.ownerId || value.source.workspaceSlug !== config.linear.workspaceSlug) fail(code, 'identity');
  if (!Array.isArray(value.issues) || value.issues.length > 100 || !Array.isArray(value.followedIssueIds) || value.followedIssueIds.length > 100 || new Set(value.followedIssueIds).size !== value.followedIssueIds.length) fail(code, 'issues/followed');
  const issues = new Map();
  const uuids = new Set();
  for (const item of value.issues) {
    exact(item, ['id', 'uuid', 'title', 'url', 'status', 'assignee', 'relations', 'sprint'], code);
    if (!/^[A-Za-z][A-Za-z0-9]*-\d+$/.test(item.id) || issues.has(item.id) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(item.uuid) || uuids.has(item.uuid) || !text(item.title) || !safeURL(item.url)) fail(code, 'issue');
    const url = new URL(item.url);
    if (url.protocol !== 'https:' || !['linear.app', 'linear.example.test'].includes(url.hostname) || !url.pathname.startsWith(`/${config.linear.workspaceSlug}/issue/${item.id}`) || !(url.pathname === `/${config.linear.workspaceSlug}/issue/${item.id}` || url.pathname.startsWith(`/${config.linear.workspaceSlug}/issue/${item.id}/`))) fail(code, 'issue URL');
    exact(item.status, ['name', 'type'], code);
    if (!text(item.status.name) || !['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled'].includes(item.status.type)) fail(code, 'status');
    if (item.assignee !== null) { exact(item.assignee, ['id', 'name'], code); if (!text(item.assignee.id) || !text(item.assignee.name)) fail(code, 'assignee'); }
    if (item.assignee?.id !== config.linear.ownerId && !value.followedIssueIds.includes(item.id)) fail(code, 'scope');
    if (item.sprint !== null) { exact(item.sprint, ['name', 'startDate', 'endDate'], code); if (!text(item.sprint.name) || !iso(item.sprint.startDate) || !iso(item.sprint.endDate) || item.sprint.startDate > item.sprint.endDate) fail(code, 'sprint'); }
    if (!Array.isArray(item.relations) || item.relations.length > 100) fail(code, 'relations');
    const edges = new Set();
    for (const edge of item.relations) {
      exact(edge, ['type', 'issueId'], code);
      if (!['parent', 'child', 'blockedBy', 'related'].includes(edge.type) || !text(edge.issueId) || edge.issueId === item.id || edges.has(`${edge.type}:${edge.issueId}`)) fail(code, 'relation');
      edges.add(`${edge.type}:${edge.issueId}`);
    }
    if (item.relations.filter(edge => edge.type === 'parent').length > 1) fail(code, 'multiple parents');
    issues.set(item.id, item); uuids.add(item.uuid);
  }
  if (value.followedIssueIds.some(id => !issues.has(id))) fail(code, 'followed absent');
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
  return structuredClone(value);
}

export function validateCatalog(value, config, snapshot) {
  const code = 'INVALID_CATALOG';
  exact(value, ['schemaVersion', 'ownerId', 'workspaceSlug', 'snapshotGeneratedAt', 'aliases', 'pullRequests', 'ciObservations', 'presentation'], code);
  if (!snapshot || !config.linear || value.schemaVersion !== 1 || value.ownerId !== config.linear.ownerId || value.workspaceSlug !== config.linear.workspaceSlug || value.snapshotGeneratedAt !== snapshot.generatedAt) fail(code, 'binding');
  const ids = new Set(snapshot.issues.map(item => item.id));
  const array = (items, fields, check) => {
    if (!Array.isArray(items) || items.length > 200) fail(code, 'array');
    for (const item of items) { exact(item, fields, code); if (!check(item)) fail(code, 'entry'); }
  };
  const repo = value => typeof value === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value);
  const number = value => Number.isSafeInteger(value) && value > 0;
  array(value.aliases, ['previousId', 'id', 'uuid', 'createdAt'], item => text(item.previousId) && ids.has(item.id) && snapshot.issues.find(issue => issue.id === item.id)?.uuid === item.uuid && iso(item.createdAt));
  array(value.pullRequests, ['issueId', 'repository', 'number', 'url', 'baseBranch', 'state', 'purpose', 'observedAt'], item => ids.has(item.issueId) && repo(item.repository) && number(item.number) && safeURL(item.url) && text(item.baseBranch) && ['open', 'merged', 'closed'].includes(item.state) && text(item.purpose) && iso(item.observedAt));
  array(value.ciObservations, ['repository', 'number', 'headSha', 'observedAt', 'counts'], item => {
    exact(item.counts, ['passed', 'failed', 'pending', 'skipped', 'neutral', 'unknown'], code);
    return repo(item.repository) && number(item.number) && /^[a-f0-9]{40}$/i.test(item.headSha) && iso(item.observedAt) && Object.values(item.counts).every(count => Number.isSafeInteger(count) && count >= 0);
  });
  exact(value.presentation, ['repositories', 'tickets', 'report'], code);
  array(value.presentation.repositories, ['repository', 'label', 'tone'], item => repo(item.repository) && text(item.label) && ['neutral', 'blue', 'green', 'amber', 'red'].includes(item.tone));
  array(value.presentation.tickets, ['issueId', 'label', 'glyph', 'tone', 'description'], item => {
    const glyphs = typeof item.glyph === 'string' ? [...item.glyph] : [];
    return ids.has(item.issueId) && text(item.label) && item.label.length <= 40
      && glyphs.length >= 1 && glyphs.length <= 4 && !/[<>\p{C}]/u.test(item.glyph)
      && ['neutral', 'blue', 'purple', 'green', 'amber', 'red'].includes(item.tone)
      && text(item.description) && item.description.length <= 160;
  });
  exact(value.presentation.report, ['excludedIssueIds', 'familySummaries'], code);
  if (!Array.isArray(value.presentation.report.excludedIssueIds) || value.presentation.report.excludedIssueIds.some(id => !ids.has(id)) || !Array.isArray(value.presentation.report.familySummaries) || value.presentation.report.familySummaries.length > 100 || value.presentation.report.familySummaries.some(item => !text(item))) fail(code, 'report');
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
      if (next.generatedAt < previous.generatedAt) fail('SNAPSHOT_ROLLBACK');
      if (next.generatedAt === previous.generatedAt) {
        if (canonical(next) !== canonical(previous)) fail('SNAPSHOT_CONFLICT');
        return { status: 'unchanged' };
      }
      if (previous.followedIssueIds.some(id => !next.followedIssueIds.includes(id) || !next.issues.some(issue => issue.id === id))) fail('FOLLOWED_INCOMPLETE');
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
