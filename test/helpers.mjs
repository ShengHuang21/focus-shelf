import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const config = {
  schemaVersion: 1,
  profileId: 'demo-profile',
  linear: { ownerId: 'demo-owner', workspaceSlug: 'demo-workspace' },
  timezone: 'Asia/Tokyo',
  pins: [],
};

export const snapshot = {
  schemaVersion: 1,
  generatedAt: '2026-10-09T00:00:00.000Z',
  source: { kind: 'codex-manual-refresh', workspaceSlug: 'demo-workspace' },
  scope: 'assigned-followed',
  ownerId: 'demo-owner',
  followedIssueIds: ['DEMO-1'],
  issues: [{
    id: 'DEMO-1', uuid: '00000000-0000-4000-8000-000000000001',
    title: 'Synthetic example', url: 'https://linear.example.test/demo-workspace/issue/DEMO-1',
    status: { name: 'In Progress', type: 'started' },
    assignee: { id: 'demo-owner', name: 'Demo User' }, relations: [], sprint: null,
  }],
};

export const catalog = {
  schemaVersion: 1, ownerId: config.linear.ownerId,
  workspaceSlug: config.linear.workspaceSlug, snapshotGeneratedAt: snapshot.generatedAt,
  aliases: [], pullRequests: [], ciObservations: [],
  presentation: { repositories: [], tickets: [], report: { excludedIssueIds: [], familySummaries: [] } },
};

// Entirely synthetic three-level hierarchy, overlapping seeds and a followed
// ticket assigned to someone else. No real workspace/account evidence.
const demoIssue = (n, assignee, relations, type = 'started') => ({
  ...structuredClone(snapshot.issues[0]), id: `DEMO-${n}`,
  uuid: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  title: `Synthetic ticket ${n}`, url: `https://linear.example.test/demo-workspace/issue/DEMO-${n}`,
  assignee, relations, status: { name: type === 'completed' ? 'Done' : 'In Progress', type },
});
export const snapshotV2 = {
  ...snapshot, schemaVersion: 2, scope: 'assigned-followed-context', followedIssueIds: ['DEMO-1', 'DEMO-4'],
  issues: [
    demoIssue(1, snapshot.issues[0].assignee, [{ type: 'child', issueId: 'DEMO-2' }]),
    demoIssue(2, { id: 'demo-other', name: 'Other Demo User' }, [{ type: 'parent', issueId: 'DEMO-1' }, { type: 'child', issueId: 'DEMO-3' }]),
    demoIssue(3, null, [{ type: 'parent', issueId: 'DEMO-2' }], 'completed'),
    demoIssue(4, { id: 'demo-other', name: 'Other Demo User' }, []),
  ],
};
export const catalogV2 = {
  ...catalog, schemaVersion: 2,
  pullRequests: [{ issueId: 'DEMO-1', repository: 'demo/repository', number: 42,
    url: 'https://github.com/demo/repository/pull/42', baseBranch: 'main', state: 'open', purpose: 'Synthetic child work',
    headSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', observedAt: snapshot.generatedAt,
    association: { kind: 'linear-attachment', issueId: 'DEMO-1', sourceUrl: snapshotV2.issues[0].url },
  }],
  ciObservations: [{ repository: 'demo/repository', number: 42, headSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', observedAt: snapshot.generatedAt,
    counts: { passed: 2, failed: 0, pending: 0, skipped: 1, neutral: 0, unknown: 0 } }],
  coverage: snapshotV2.issues.map(item => ({ issueId: item.id, pr: 'complete', ci: item.id === 'DEMO-1' ? 'complete' : 'not-applicable', observedAt: snapshot.generatedAt })),
};

export async function temporaryHome(t) {
  const home = await mkdtemp(join(tmpdir(), 'focus-shelf-test-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  return home;
}

export function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    values,
  };
}

// Model Web Locks' exclusive ifAvailable behavior without browser dependencies.
export function memoryLocks() {
  const held = new Set();
  const requests = [];
  return {
    requests,
    async request(name, options, callback) {
      assert.equal(options.mode, 'exclusive', 'client must request an exclusive Web Lock');
      assert.equal(options.ifAvailable, true, 'client must not indefinitely queue an observer');
      requests.push({ name, ...options });
      if (held.has(name)) return callback(null);
      held.add(name);
      try { return await callback({ name }); }
      finally { held.delete(name); }
    },
  };
}
