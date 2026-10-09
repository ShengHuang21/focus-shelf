import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalClient } from '../lib/local-client.mjs';
import { config, snapshot, memoryStorage, memoryLocks } from './helpers.mjs';

const options = (overrides = {}) => ({ config, storage: memoryStorage(), locks: memoryLocks(), ...overrides });

function delayedObserverLocks() {
  let count = 0;
  let deliver;
  let queued;
  const waiting = new Promise(resolve => { queued = resolve; });
  return {
    waiting,
    deliver: () => deliver(),
    request(name, options, callback) {
      assert.equal(options.mode, 'exclusive');
      assert.equal(options.ifAvailable, true);
      if (++count === 1) return Promise.resolve(callback(null));
      return new Promise((resolve, reject) => {
        deliver = () => Promise.resolve(callback({ name })).then(resolve, reject);
        queued();
      });
    },
  };
}

for (const change of ['owner', 'workspace', 'close']) {
  test(`C03/C08 delayed lock grant after ${change} invalidation never enables writing`, async t => {
    const locks = delayedObserverLocks();
    const storage = memoryStorage();
    const client = await createLocalClient(options({ storage, locks }));
    t.after(() => client.close());
    assert.equal(client.readOnly, true);
    const pending = client.acquireWriter();
    await locks.waiting;
    if (change === 'close') client.close();
    else {
      const linear = { ...config.linear, [change === 'owner' ? 'ownerId' : 'workspaceSlug']: 'different-identity' };
      assert.throws(() => client.acceptShelf({ config: { ...config, linear }, snapshot }), /IDENTITY_MISMATCH/);
    }
    locks.deliver();
    await pending;
    assert.equal(client.readOnly, true);
    assert.match(client.readOnlyReason, change === 'close' ? /closed/i : /identity/i);
    assert.throws(() => client.setMemo('DEMO-1', 'Forbidden delayed save'), /READ_ONLY/);
    assert.equal(storage.values.size, 0);
  });
}

test('C03 missing or inconsistent profile identity prevents browser writes', async () => {
  const client = await createLocalClient(options({ config: { ...config, profileId: '' } }));
  assert.equal(client.readOnly, true);
  assert.throws(() => client.setMemo('DEMO-1', 'Memo'), /READ_ONLY/);
});

test('C03 stale mismatched API state cannot replace accepted profile', async t => {
  const client = await createLocalClient(options());
  t.after(() => client.close());
  client.acceptShelf({ config, snapshot });
  assert.throws(() => client.acceptShelf({ config: { ...config, linear: { ...config.linear, ownerId: 'other-owner' } }, snapshot }), /IDENTITY_MISMATCH/);
  assert.equal(client.readOnly, true);
});

test('C08 same-profile second window is read-only until writer releases lock', async t => {
  const storage = memoryStorage();
  const locks = memoryLocks();
  const first = await createLocalClient(options({ storage, locks }));
  const second = await createLocalClient(options({ storage, locks }));
  t.after(() => { first.close(); second.close(); });
  assert.equal(first.readOnly, false);
  assert.equal(second.readOnly, true);
  assert.match(second.readOnlyReason, /another|window|writer/i);
  assert.throws(() => second.setMemo('DEMO-1', 'forbidden'), /READ_ONLY/);
  first.setMemo('DEMO-1', 'Saved after observer opened');
  first.close();
  await second.acquireWriter();
  assert.equal(second.readOnly, false);
  assert.equal(second.getMemo('DEMO-1'), 'Saved after observer opened');
  assert.equal(locks.requests.length, 3);
  assert.ok(locks.requests.every(request => request.mode === 'exclusive' && request.ifAvailable === true));
});

test('C03 owner and workspace independently isolate locks and overlays', async t => {
  const storage = memoryStorage();
  const locks = memoryLocks();
  const original = await createLocalClient(options({ storage, locks }));
  t.after(() => original.close());
  original.setMemo('DEMO-1', 'Original only');
  for (const linear of [
    { ...config.linear, ownerId: 'other-owner' },
    { ...config.linear, workspaceSlug: 'other-workspace' },
  ]) {
    const other = await createLocalClient(options({ storage, locks, config: { ...config, linear } }));
    t.after(() => other.close());
    assert.equal(other.readOnly, false);
    assert.equal(other.getMemo('DEMO-1'), '');
    other.setMemo('DEMO-1', 'Other only');
    assert.equal(original.getMemo('DEMO-1'), 'Original only');
  }
  assert.equal(new Set(locks.requests.map(request => request.name)).size, 3);
});

test('C03 namespace uses unambiguous identity tuple encoding', async t => {
  const storage = memoryStorage();
  const locks = memoryLocks();
  const tuples = [
    { profileId: 'demo-a', ownerId: 'b', workspaceSlug: 'c' },
    { profileId: 'demo', ownerId: 'a-b', workspaceSlug: 'c' },
    { profileId: 'demo', ownerId: 'a', workspaceSlug: 'b-c' },
  ];
  for (const [index, identity] of tuples.entries()) {
    const client = await createLocalClient(options({ storage, locks, config: { ...config, profileId: identity.profileId, linear: { ownerId: identity.ownerId, workspaceSlug: identity.workspaceSlug } } }));
    t.after(() => client.close());
    assert.equal(client.readOnly, false);
    assert.equal(client.getMemo('DEMO-1'), '');
    client.setMemo('DEMO-1', `tuple-${index}`);
  }
  assert.equal(new Set(locks.requests.map(request => request.name)).size, 3);
  assert.equal(storage.values.size, 3);
});

test('C08 closed clients cannot write or silently reacquire a lock', async () => {
  const client = await createLocalClient(options());
  client.close();
  assert.equal(client.readOnly, true);
  assert.throws(() => client.setMemo('DEMO-1', 'Forbidden'), /READ_ONLY|CLIENT_CLOSED/);
  assert.throws(() => client.setArchived('DEMO-1', true), /READ_ONLY|CLIENT_CLOSED/);
  assert.throws(() => client.setPRStatus('demo/repository#42', 'merged'), /READ_ONLY|CLIENT_CLOSED/);
  await assert.rejects(client.acquireWriter(), /CLIENT_CLOSED/);
});

test('C09 refresh preserves overlays and identical PR numbers in distinct repositories remain independent', async t => {
  const client = await createLocalClient(options());
  t.after(() => client.close());
  client.acceptShelf({ config, snapshot });
  client.setMemo('DEMO-1', 'Browser memo');
  client.setArchived('DEMO-1', true);
  client.setPRStatus('demo/one#42', 'merged');
  client.setPRStatus('demo/two#42', 'closed');
  client.acceptShelf({ config, snapshot: { ...snapshot, generatedAt: '2026-10-10T00:00:00.000Z', issues: [{ ...snapshot.issues[0], title: 'Refreshed' }] } });
  assert.equal(client.getMemo('DEMO-1'), 'Browser memo');
  assert.equal(client.isArchived('DEMO-1'), true);
  assert.equal(client.getPRStatus('demo/one#42'), 'merged');
  assert.equal(client.getPRStatus('demo/two#42'), 'closed');
});

test('C08 absence of Web Locks makes overlays visibly read-only', async t => {
  const client = await createLocalClient(options({ locks: null }));
  t.after(() => client.close());
  assert.equal(client.readOnly, true);
  assert.match(client.readOnlyReason, /Web Locks/);
});

test('C09 memo/archive/manual PR survive reload and remain profile isolated', async t => {
  const storage = memoryStorage();
  const locks = memoryLocks();
  const first = await createLocalClient(options({ storage, locks }));
  first.setMemo('DEMO-1', 'Local memo');
  first.setArchived('DEMO-1', true);
  first.setPRStatus('demo/repository#42', 'merged');
  first.close();
  const reload = await createLocalClient(options({ storage, locks }));
  t.after(() => reload.close());
  assert.equal(reload.getMemo('DEMO-1'), 'Local memo');
  assert.equal(reload.isArchived('DEMO-1'), true);
  assert.equal(reload.getPRStatus('demo/repository#42'), 'merged');
  const other = await createLocalClient(options({ storage, locks, config: { ...config, profileId: 'another-profile' } }));
  t.after(() => other.close());
  assert.equal(other.getMemo('DEMO-1'), '');
  assert.equal(other.isArchived('DEMO-1'), false);
  assert.equal(other.getPRStatus('demo/repository#42'), null);
});

test('C09 storage failure surfaces failed save and does not claim persistence', async t => {
  const storage = memoryStorage();
  storage.setItem = () => { throw new Error('QuotaExceededError'); };
  const client = await createLocalClient(options({ storage }));
  t.after(() => client.close());
  assert.throws(() => client.setMemo('DEMO-1', 'cannot persist'), /STORAGE_FAILED/);
  assert.equal(client.getMemo('DEMO-1'), '');
  assert.equal(client.saveState, 'failed');
});
