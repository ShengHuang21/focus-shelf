import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { validateSnapshot, validateCatalog, publishSnapshot } from '../lib/snapshot.mjs';
import { config, snapshot, catalog, temporaryHome } from './helpers.mjs';

const issue = (n, fields = {}) => ({ ...structuredClone(snapshot.issues[0]), id: `DEMO-${n}`, uuid: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, url: `https://linear.example.test/demo-workspace/issue/DEMO-${n}`, ...fields });
const graph = issues => ({ ...snapshot, issues });

test('C06 reciprocal parent/child graph and followed Done issue are preserved', () => {
  const value = graph([
    issue(1, { relations: [{ type: 'child', issueId: 'DEMO-2' }] }),
    issue(2, { relations: [{ type: 'parent', issueId: 'DEMO-1' }], status: { name: 'Done', type: 'completed' }, assignee: null }),
  ]);
  value.followedIssueIds = ['DEMO-1', 'DEMO-2'];
  assert.deepEqual(validateSnapshot(value, config), value);
});

test('C06 missing reciprocal edge, hierarchy cycle and multiple parents are rejected', () => {
  const invalid = [
    graph([issue(1, { relations: [{ type: 'child', issueId: 'DEMO-2' }] }), issue(2)]),
    graph([issue(1, { relations: [{ type: 'child', issueId: 'DEMO-2' }, { type: 'parent', issueId: 'DEMO-2' }] }), issue(2, { relations: [{ type: 'parent', issueId: 'DEMO-1' }, { type: 'child', issueId: 'DEMO-1' }] })]),
    graph([issue(1, { relations: [{ type: 'parent', issueId: 'DEMO-2' }, { type: 'parent', issueId: 'DEMO-3' }] }), issue(2, { relations: [{ type: 'child', issueId: 'DEMO-1' }] }), issue(3, { relations: [{ type: 'child', issueId: 'DEMO-1' }] })]),
  ];
  for (const value of invalid) assert.throws(() => validateSnapshot(value, config), /INVALID_SNAPSHOT/);
});

test('C06 duplicate IDs, wrong assignee and inconsistent followed membership are rejected', () => {
  for (const value of [
    graph([issue(1), issue(1)]),
    { ...snapshot, followedIssueIds: [], issues: [issue(1, { assignee: { id: 'different-owner', name: 'Other' } })] },
    { ...snapshot, followedIssueIds: ['DEMO-2'] },
    { ...snapshot, followedIssueIds: [], issues: [issue(1, { assignee: null })] },
  ]) assert.throws(() => validateSnapshot(value, config), /INVALID_SNAPSHOT/);
});

test('C06 valid synthetic snapshot retains assigned and followed identity', () => {
  assert.deepEqual(validateSnapshot(snapshot, config), snapshot);
});

test('C06 triage status and synthetic Linear URL satisfy the snapshot contract', () => {
  const value = graph([issue(1, { status: { name: 'Triage', type: 'triage' } })]);
  assert.deepEqual(validateSnapshot(value, config), value);
});

test('C06 unknown snapshot fields, private fields and mismatched identity fail closed', () => {
  for (const value of [
    { ...snapshot, ownerId: 'different-owner' },
    { ...snapshot, source: { ...snapshot.source, workspaceSlug: 'different-workspace' } },
    { ...snapshot, issues: [{ ...snapshot.issues[0], description: 'disallowed payload' }] },
    { ...snapshot, issues: [{ ...snapshot.issues[0], url: 'https://linear.example.test/different-workspace/issue/DEMO-1' }] },
    { ...snapshot, issues: Array.from({ length: 101 }, (_, i) => ({ ...snapshot.issues[0], id: `DEMO-${i + 1}` })) },
  ]) assert.throws(() => validateSnapshot(value, config), /INVALID_SNAPSHOT/);
});

test('C04 catalog binds owner, workspace, schema and exact snapshot time', () => {
  assert.deepEqual(validateCatalog(catalog, config, snapshot), catalog);
  for (const value of [
    { ...catalog, ownerId: 'different-owner' },
    { ...catalog, workspaceSlug: 'different-workspace' },
    { ...catalog, schemaVersion: 2 },
    { ...catalog, snapshotGeneratedAt: '2026-10-08T00:00:00.000Z' },
    { ...catalog, javascript: 'disallowed' },
    { ...catalog, pullRequests: [{ issueId: 'DEMO-1', raw: {} }] },
  ]) assert.throws(() => validateCatalog(value, config, snapshot), /INVALID_CATALOG/);
});

test('C06 writer rejects rollback and divergent same-time publication, allows exact repeat', async t => {
  const home = await temporaryHome(t);
  await writeFile(join(home, 'config.json'), JSON.stringify(config));
  await publishSnapshot({ home, input: snapshot });
  const original = await readFile(join(home, 'linear-latest.json'), 'utf8');
  const repeat = await publishSnapshot({ home, input: structuredClone(snapshot) });
  assert.equal(repeat.status, 'unchanged');
  await assert.rejects(publishSnapshot({ home, input: { ...snapshot, generatedAt: '2026-10-08T00:00:00.000Z' } }), /SNAPSHOT_ROLLBACK/);
  await assert.rejects(publishSnapshot({ home, input: { ...snapshot, issues: [{ ...snapshot.issues[0], title: 'Divergent' }] } }), /SNAPSHOT_CONFLICT/);
  assert.equal(await readFile(join(home, 'linear-latest.json'), 'utf8'), original);
});

test('C06 previously followed IDs cannot disappear from a refresh', async t => {
  const home = await temporaryHome(t);
  await writeFile(join(home, 'config.json'), JSON.stringify(config));
  await publishSnapshot({ home, input: snapshot });
  await assert.rejects(publishSnapshot({ home, input: { ...snapshot, generatedAt: '2026-10-10T00:00:00.000Z', followedIssueIds: [], issues: [] } }), /FOLLOWED_INCOMPLETE/);
});

test('C07 publication holds exclusive external lock and preserves destination on rename failure', async t => {
  const home = await temporaryHome(t);
  await writeFile(join(home, 'config.json'), JSON.stringify(config));
  await publishSnapshot({ home, input: snapshot });
  const old = await readFile(join(home, 'linear-latest.json'), 'utf8');
  let release;
  let acquired;
  const acquiredPromise = new Promise(resolve => { acquired = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const next = { ...snapshot, generatedAt: '2026-10-10T00:00:00.000Z' };
  const first = publishSnapshot({ home, input: next, hooks: { afterLock: async () => { acquired(); await held; } } });
  // Attach rejection handling immediately, including while the empty shell throws.
  const observed = first.then(value => ({ value }), error => ({ error }));
  const outcome = await Promise.race([acquiredPromise.then(() => 'acquired'), observed]);
  assert.equal(outcome, 'acquired', 'publisher must acquire and expose the test lock hook');
  await assert.rejects(publishSnapshot({ home, input: next }), /SNAPSHOT_LOCKED/);
  release();
  assert.equal((await observed).value.status, 'written');
  await assert.rejects(publishSnapshot({ home, input: { ...snapshot, generatedAt: '2026-10-11T00:00:00.000Z' }, hooks: { beforeRename: () => { throw new Error('TEST_RENAME_FAILURE'); } } }), /TEST_RENAME_FAILURE/);
  const written = JSON.parse(await readFile(join(home, 'linear-latest.json'), 'utf8'));
  assert.deepEqual(written, next);
  assert.notEqual(await readFile(join(home, 'linear-latest.json'), 'utf8'), old);
  assert.deepEqual((await readdir(home)).sort(), ['config.json', 'linear-latest.json']);
});

test('C07 acknowledgement failure after rename preserves the newly published bytes', async t => {
  const home = await temporaryHome(t);
  await writeFile(join(home, 'config.json'), JSON.stringify(config));
  await publishSnapshot({ home, input: snapshot });
  const next = { ...snapshot, generatedAt: '2026-10-10T00:00:00.000Z', issues: [issue(1, { status: { name: 'Done', type: 'completed' } })] };
  await assert.rejects(publishSnapshot({ home, input: next, hooks: { afterRenameBeforeAcknowledge: () => { throw new Error('TEST_ACK_FAILURE'); } } }), /TEST_ACK_FAILURE/);
  assert.deepEqual(JSON.parse(await readFile(join(home, 'linear-latest.json'), 'utf8')), next);
  assert.deepEqual((await readdir(home)).sort(), ['config.json', 'linear-latest.json']);
  assert.equal((await publishSnapshot({ home, input: next })).status, 'unchanged');
});

test('C07 contender retries against latest publication and cannot drop newly followed issue', async t => {
  const home = await temporaryHome(t);
  await writeFile(join(home, 'config.json'), JSON.stringify(config));
  await publishSnapshot({ home, input: snapshot });
  let acquired;
  let release;
  const locked = new Promise(resolve => { acquired = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const winner = { ...snapshot, generatedAt: '2026-10-10T00:00:00.000Z', followedIssueIds: ['DEMO-1', 'DEMO-2'], issues: [issue(1), issue(2, { assignee: null })] };
  const obsolete = { ...snapshot, generatedAt: '2026-10-11T00:00:00.000Z' };
  const pending = publishSnapshot({ home, input: winner, hooks: { afterLock: async () => { acquired(); await held; } } });
  const observed = pending.then(value => ({ value }), error => ({ error }));
  assert.equal(await Promise.race([locked.then(() => 'locked'), observed]), 'locked');
  await assert.rejects(publishSnapshot({ home, input: obsolete }), /SNAPSHOT_LOCKED/);
  release();
  assert.equal((await observed).value.status, 'written');
  await assert.rejects(publishSnapshot({ home, input: obsolete }), /FOLLOWED_INCOMPLETE/);
  assert.deepEqual(JSON.parse(await readFile(join(home, 'linear-latest.json'), 'utf8')), winner);
});
