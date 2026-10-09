import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const config = {
  schemaVersion: 1,
  profileId: 'demo-profile',
  linear: { ownerId: 'demo-owner', workspaceSlug: 'demo-workspace' },
  timezone: 'Asia/Tokyo',
  features: { savedWebpages: true },
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
