import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateSnapshot, validateCatalog, buildSnapshotV2, publishSnapshot, publishCatalog } from '../lib/snapshot.mjs';
import { renderShelf, createReport } from '../web/app.mjs';
import { startServer } from '../server.mjs';
import { config, snapshot, catalog, snapshotV2, catalogV2, temporaryHome, memoryStorage, memoryLocks } from './helpers.mjs';
import { createLocalClient } from '../lib/local-client.mjs';

test('verified creation timestamps survive projection and reject invalid dates', () => {
  const value = structuredClone(snapshotV2);
  value.issues[0].createdAt = '2026-09-30T16:30:00.000Z';
  assert.equal(buildSnapshotV2(value, config).issues[0].createdAt, value.issues[0].createdAt);
  for (const date of [null, 'yesterday', '2026-13-01T00:00:00.000Z']) {
    value.issues[0].createdAt = date;
    assert.throws(() => validateSnapshot(value, config), /createdAt/);
  }
});

test('v2 accepts three-level child closure, overlapping seeds, other assignees and unassigned Done context', () => {
  assert.deepEqual(validateSnapshot(snapshotV2, config), snapshotV2);
  assert.deepEqual(buildSnapshotV2(snapshotV2, config), snapshotV2);
  const value = structuredClone(snapshotV2);
  value.followedIssueIds.push('DEMO-2');
  assert.deepEqual(validateSnapshot(value, config), value);
});

test('v2 created seed keeps a ticket after its assignee changes', () => {
  const delegated = {
    ...structuredClone(snapshot.issues[0]),
    assignee: { id: 'demo-other', name: 'Anan Demo User' },
  };
  const value = {
    ...snapshotV2,
    scope: 'assigned-created-followed-context',
    createdIssueIds: ['DEMO-1'],
    followedIssueIds: [],
    issues: [delegated],
  };
  assert.deepEqual(validateSnapshot(value, config), value);
  assert.deepEqual(buildSnapshotV2(value, config), value);

  const missingCreatedSeed = structuredClone(value);
  missingCreatedSeed.createdIssueIds = [];
  assert.throws(() => validateSnapshot(missingCreatedSeed, config), /context unreachable/);
});

test('partial PR discovery retains verified rows without asserting complete CI', () => {
  const value = structuredClone(catalogV2);
  value.coverage[0].pr = 'unavailable';
  value.coverage[0].ci = 'unavailable';
  assert.deepEqual(validateCatalog(value, config, snapshotV2), value);
  assert.equal(value.pullRequests.length, catalogV2.pullRequests.length);
  const html = renderShelf({ config, snapshot: snapshotV2, catalog: value });
  assert.ok(html.includes(`PR #${value.pullRequests[0].number}`));
  value.coverage[0].ci = 'complete';
  assert.throws(() => validateCatalog(value, config, snapshotV2), /incomplete PR discovery/);
});

test('duplicate status and duplicate/block relations preserve their exact meaning', () => {
  const value = structuredClone(snapshotV2);
  value.issues[3].status = { name: 'Duplicate', type: 'duplicate' };
  value.issues[3].relations.push({ type: 'duplicateOf', issueId: 'DEMO-1' }, { type: 'blocks', issueId: 'DEMO-2' });
  assert.deepEqual(validateSnapshot(value, config), value);
  assert.deepEqual(buildSnapshotV2(value, config), value);
  const html = renderShelf({ config, snapshot: value, catalog: null });
  assert.doesNotMatch(html, /status-pill[^>]*>Duplicate/);
  assert.ok(!html.includes(`>${value.issues[3].id}</a>`));
  assert.ok(html.includes('>DEMO-1</a>'));
});

test('optional Linear estimate is validated and rendered as a numbered circle', () => {
  const value = structuredClone(snapshotV2);
  value.issues[0].estimate = 3;
  value.issues[1].estimate = null;
  assert.deepEqual(validateSnapshot(value, config), value);
  const html = renderShelf({ config, snapshot: value, catalog: catalogV2 });
  assert.match(html, /class="estimate-points"[^>]*>3<\/span>/);
  assert.equal((html.match(/class="estimate-points"/g) ?? []).length, 1);
  const invalid = structuredClone(value);
  invalid.issues[0].estimate = '3';
  assert.throws(() => validateSnapshot(invalid, config), /estimate/);
});

test('v2 rejects orphan, related-only context and incomplete/nonreciprocal children', () => {
  const orphan = structuredClone(snapshotV2);
  orphan.issues[0].relations = [];
  orphan.issues[1].relations = [{ type: 'child', issueId: 'DEMO-3' }];
  const related = structuredClone(orphan);
  related.issues[0].relations = [{ type: 'related', issueId: 'DEMO-2' }];
  for (const value of [orphan, related]) assert.throws(() => validateSnapshot(value, config), /context unreachable/);
  const missing = structuredClone(snapshotV2);
  missing.issues.pop();
  missing.followedIssueIds = ['DEMO-1'];
  missing.issues.pop();
  assert.throws(() => buildSnapshotV2(missing, config), /incomplete child closure/);
  const nonreciprocal = structuredClone(snapshotV2);
  nonreciprocal.issues[2].relations = [];
  assert.throws(() => buildSnapshotV2(nonreciprocal, config), /incomplete child closure/);
  const missingForward = structuredClone(snapshotV2);
  missingForward.issues[0].relations = [];
  assert.throws(() => buildSnapshotV2(missingForward, config), /incomplete reciprocal child/);
});

test('v2 builder projects references and external parents without expanding seeds', () => {
  const value = structuredClone(snapshotV2);
  value.issues[0].relations.push({ type: 'parent', issueId: 'DEMO-20' }, { type: 'related', issueId: 'DEMO-20' }, { type: 'blockedBy', issueId: 'DEMO-20' }, { type: 'related', issueId: 'DEMO-4' });
  const outside = { ...structuredClone(value.issues[3]), id: 'DEMO-20', uuid: '00000000-0000-4000-8000-000000000020', url: 'https://linear.example.test/demo-workspace/issue/DEMO-20', relations: [{ type: 'child', issueId: 'DEMO-1' }] };
  value.issues.push(outside);
  const result = buildSnapshotV2(value, config);
  assert.equal(result.issues.length, 4);
  assert.deepEqual(result.issues[0].relations, [{ type: 'child', issueId: 'DEMO-2' }, { type: 'related', issueId: 'DEMO-4' }]);
});

test('v2 1000 issues and complete coverage accepted, 1001 rejected', () => {
  const value = { ...snapshotV2, followedIssueIds: [], issues: Array.from({ length: 1000 }, (_, index) => {
    const n = index + 1;
    return { ...structuredClone(snapshot.issues[0]), id: `DEMO-${n}`, uuid: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, url: `https://linear.example.test/demo-workspace/issue/DEMO-${n}` };
  }) };
  assert.equal(validateSnapshot(value, config).issues.length, 1000);
  const largeCatalog = { ...structuredClone(catalogV2), pullRequests: [], ciObservations: [], aliases: [], presentation: { repositories: [], tickets: [], report: { excludedIssueIds: [], familySummaries: [] } }, coverage: value.issues.map(issue => ({ issueId: issue.id, pr: 'unavailable', ci: 'unavailable', observedAt: value.generatedAt })) };
  assert.equal(validateCatalog(largeCatalog, config, value).coverage.length, 1000);
  value.issues.push({ ...value.issues[0], id: 'DEMO-1001', uuid: '00000000-0000-4000-8000-000000001001', url: 'https://linear.example.test/demo-workspace/issue/DEMO-1001' });
  assert.throws(() => validateSnapshot(value, config), /INVALID_SNAPSHOT/);
});

test('v2 catalogs require per-ticket coverage, exact association and unique PR/CI keys', () => {
  assert.deepEqual(validateCatalog(catalogV2, config, snapshotV2), catalogV2);
  const invalid = [];
  for (const change of [
    value => value.coverage.pop(),
    value => value.coverage.push(value.coverage[0]),
    value => { value.coverage[0].ci = 'not-applicable'; },
    value => { value.coverage[0].pr = 'unavailable'; },
    value => { value.pullRequests[0].association.issueId = 'DEMO-4'; },
    value => { value.pullRequests[0].association.sourceUrl = 'https://linear.example.test/demo-workspace/issue/DEMO-20'; },
    value => { value.pullRequests[0].url += '0'; },
    value => { value.pullRequests[0].headSha = 'bad'; },
    value => { value.pullRequests[0].association.kind = 'inferred'; },
    value => value.pullRequests.push(value.pullRequests[0]),
    value => value.ciObservations.push(value.ciObservations[0]),
  ]) { const value = structuredClone(catalogV2); change(value); invalid.push(value); }
  for (const value of invalid) assert.throws(() => validateCatalog(value, config, snapshotV2), /INVALID_CATALOG/);
  const shared = structuredClone(catalogV2);
  shared.pullRequests.push({ ...shared.pullRequests[0], issueId: 'DEMO-4', association: { kind: 'github-reference', issueId: 'DEMO-4', sourceUrl: shared.pullRequests[0].url } });
  shared.coverage[3].ci = 'complete';
  assert.deepEqual(validateCatalog(shared, config, snapshotV2), shared);
  shared.pullRequests[1].association.sourceUrl += '0';
  assert.throws(() => validateCatalog(shared, config, snapshotV2), /INVALID_CATALOG/);
});

test('v2 UI hides internal PR coverage gaps and displays CI conclusions only with complete coverage', () => {
  const render = (value, status = 'ready-review') => renderShelf({ config, snapshot: snapshotV2, catalog: value, overlays: { prStatus: { 'demo/repository#42': status } } });
  assert.match(render(catalogV2), /Observed checks passed/);
  assert.doesNotMatch(render(catalogV2, 'merged'), /class="ci-mark"|Observed checks passed|CI evidence unavailable/);
  assert.doesNotMatch(render(null), /PR evidence unavailable|No associated PR observed/);
  for (const change of [
    value => { value.ciObservations[0].headSha = 'b'.repeat(40); },
    value => { value.ciObservations[0].repository = 'demo/another'; },
    value => { value.ciObservations[0].number = 43; },
    value => { value.coverage[0].ci = 'unavailable'; },
  ]) {
    const value = structuredClone(catalogV2); change(value);
    assert.match(render(value), /CI evidence unavailable/);
    assert.doesNotMatch(render(value), /Observed checks passed/);
  }
  const value = structuredClone(catalogV2);
  value.coverage[3] = { ...value.coverage[3], pr: 'unavailable', ci: 'unavailable' };
  assert.doesNotMatch(render(value), /PR evidence unavailable|No associated PR observed/);
});

test('release target policy is an attention triangle while actual CI failures remain a cross', () => {
  const render = counts => {
    const value = structuredClone(catalogV2);
    value.ciObservations[0].counts = counts;
    return renderShelf({ config, snapshot: snapshotV2, catalog: value, overlays: { prStatus: { 'demo/repository#42': 'ready-review' } } });
  };
  const policy = render({ passed: 2, failed: 0, pending: 0, skipped: 1, neutral: 0, unknown: 0, releaseTargetPolicyFailed: 1 });
  assert.match(policy, /ci-attention[^>]*>△<\/span>/);
  assert.match(policy, /Release target policy needs attention/);
  assert.doesNotMatch(policy, /ci-failed[^>]*>×<\/span>/);

  const actualFailure = render({ passed: 2, failed: 1, pending: 0, skipped: 1, neutral: 0, unknown: 0, releaseTargetPolicyFailed: 0 });
  assert.match(actualFailure, /ci-failed[^>]*>×<\/span>/);
  assert.match(actualFailure, /CI test, build or lint checks failed/);
});

test('release target policy count is optional but strictly validated', () => {
  const valid = structuredClone(catalogV2);
  valid.ciObservations[0].counts.releaseTargetPolicyFailed = 1;
  assert.deepEqual(validateCatalog(valid, config, snapshotV2), valid);
  for (const invalidCount of [-1, '1']) {
    const invalid = structuredClone(valid);
    invalid.ciObservations[0].counts.releaseTargetPolicyFailed = invalidCount;
    assert.throws(() => validateCatalog(invalid, config, snapshotV2), /INVALID_CATALOG/);
  }
});

test('v2 preserves category semantics without visible system counts and keeps archived descendants', async t => {
  const client = await createLocalClient({ config, storage: memoryStorage(), locks: memoryLocks() });
  t.after(() => client.close());
  client.setMemo('DEMO-3', 'Synthetic local memo');
  client.setPRStatus('demo/repository#42', 'ready-review');
  client.setArchived('DEMO-2', true);
  client.acceptShelf({ config, snapshot: snapshotV2 });
  const state = { config, snapshot: snapshotV2, catalog: catalogV2, overlays: client.getOverlays() };
  const html = renderShelf(state);
  assert.doesNotMatch(html, /\d+ items|\d+ assigned|\d+ followed|Codex snapshot|Reload snapshot|Create report/);
  assert.match(html, /ticket-ownership"><span class="ownership-unassigned">Unassigned/);
  assert.match(html, /ticket-ownership"><span title="Full Linear assignee: Other Demo User">Assignee: Other · archived/);
  assert.equal((html.match(/Synthetic ticket 3/g) ?? []).length, 1);
  assert.match(html, /Synthetic local memo/);
  assert.match(html, /ready-review/);
  assert.doesNotMatch(createReport(state), /DEMO-2 —/);
  assert.match(createReport(state), /DEMO-1 —/);
  client.setArchived('DEMO-2', false);
  assert.match(renderShelf({ ...state, overlays: client.getOverlays() }), /Synthetic ticket 2/);
});

test('v1 compatibility is retained, mixed catalog generations rejected and v2 cannot downgrade', async t => {
  assert.deepEqual(validateSnapshot(snapshot, config), snapshot);
  assert.deepEqual(validateCatalog(catalog, config, snapshot), catalog);
  assert.throws(() => validateCatalog(catalog, config, snapshotV2), /INVALID_CATALOG/);
  assert.throws(() => validateCatalog(catalogV2, config, snapshot), /INVALID_CATALOG/);
  const home = await temporaryHome(t);
  await writeFile(join(home, 'config.json'), JSON.stringify(config));
  await publishSnapshot({ home, input: snapshot });
  const next = { ...snapshotV2, generatedAt: '2026-10-10T00:00:00.000Z' };
  assert.equal((await publishSnapshot({ home, input: next })).status, 'written');
  assert.equal((await publishSnapshot({ home, input: next })).status, 'unchanged');
  await assert.rejects(publishSnapshot({ home, input: { ...snapshot, generatedAt: '2026-10-11T00:00:00.000Z' } }), /SNAPSHOT_DOWNGRADE/);
  assert.deepEqual(JSON.parse(await readFile(join(home, 'linear-latest.json'), 'utf8')), next);
});

test('publisher refuses to silently drop a previously recorded created ticket', async t => {
  const home = await temporaryHome(t);
  await writeFile(join(home, 'config.json'), JSON.stringify(config));
  const withCreatedSeed = {
    ...structuredClone(snapshotV2),
    scope: 'assigned-created-followed-context',
    createdIssueIds: ['DEMO-1'],
  };
  await publishSnapshot({ home, input: withCreatedSeed });

  const missingCreatedSeed = {
    ...structuredClone(snapshotV2),
    generatedAt: '2026-10-10T00:00:00.000Z',
  };
  await assert.rejects(publishSnapshot({ home, input: missingCreatedSeed }), /CREATED_INCOMPLETE/);
  assert.deepEqual(JSON.parse(await readFile(join(home, 'linear-latest.json'), 'utf8')), withCreatedSeed);
});

test('catalog publisher validates the current snapshot binding and writes atomically', async t => {
  const home = await temporaryHome(t);
  await writeFile(join(home, 'config.json'), JSON.stringify(config));
  await publishSnapshot({ home, input: snapshotV2 });
  assert.equal((await publishCatalog({ home, input: catalogV2 })).status, 'written');
  assert.equal((await publishCatalog({ home, input: catalogV2 })).status, 'unchanged');
  assert.deepEqual(JSON.parse(await readFile(join(home, 'catalog.json'), 'utf8')), catalogV2);

  const invalid = structuredClone(catalogV2);
  invalid.snapshotGeneratedAt = '2026-10-10T00:00:00.000Z';
  await assert.rejects(publishCatalog({ home, input: invalid }), /INVALID_CATALOG/);
  assert.deepEqual(JSON.parse(await readFile(join(home, 'catalog.json'), 'utf8')), catalogV2);
});

test('catalog publisher refuses to silently drop a previously published PR', async t => {
  const home = await temporaryHome(t);
  await writeFile(join(home, 'config.json'), JSON.stringify(config));
  await publishSnapshot({ home, input: snapshotV2 });
  await publishCatalog({ home, input: catalogV2 });
  const missing = structuredClone(catalogV2);
  missing.pullRequests = [];
  missing.ciObservations = [];
  missing.coverage[0] = { ...missing.coverage[0], pr: 'unavailable', ci: 'unavailable' };
  await assert.rejects(publishCatalog({ home, input: missing }), /PR_CONTINUITY_INCOMPLETE: demo\/repository#42/);
  assert.deepEqual(JSON.parse(await readFile(join(home, 'catalog.json'), 'utf8')), catalogV2);
  assert.equal((await publishCatalog({ home, input: missing, allowPRRemovals: ['demo/repository#42'] })).status, 'written');
  await assert.rejects(publishCatalog({ home, input: missing, allowPRRemovals: ['demo/repository#99'] }), /UNUSED_PR_REMOVAL/);
});

test('PR continuity guard survives a new snapshot timestamp', async t => {
  const home = await temporaryHome(t);
  await writeFile(join(home, 'config.json'), JSON.stringify(config));
  await publishSnapshot({ home, input: snapshotV2 });
  await publishCatalog({ home, input: catalogV2 });
  const nextSnapshot = { ...structuredClone(snapshotV2), generatedAt: '2026-10-10T00:00:00.000Z' };
  await publishSnapshot({ home, input: nextSnapshot });
  const nextCatalog = structuredClone(catalogV2);
  nextCatalog.snapshotGeneratedAt = nextSnapshot.generatedAt;
  nextCatalog.pullRequests = [];
  nextCatalog.ciObservations = [];
  nextCatalog.coverage = nextCatalog.coverage.map(item => ({ ...item, pr: 'unavailable', ci: 'unavailable', observedAt: nextSnapshot.generatedAt }));
  await assert.rejects(publishCatalog({ home, input: nextCatalog }), /PR_CONTINUITY_INCOMPLETE: demo\/repository#42/);
});

test('catalog publisher replaces a stale catalog after a snapshot generation change', async t => {
  const home = await temporaryHome(t);
  await writeFile(join(home, 'config.json'), JSON.stringify(config));
  await writeFile(join(home, 'catalog.json'), JSON.stringify(catalog));
  await publishSnapshot({ home, input: snapshotV2 });
  assert.equal((await publishCatalog({ home, input: catalogV2 })).status, 'written');
  assert.deepEqual(JSON.parse(await readFile(join(home, 'catalog.json'), 'utf8')), catalogV2);
});

test('API reads v2 pair and hides stale v1 catalog', async t => {
  const home = await temporaryHome(t);
  for (const [name, value] of Object.entries({ 'config.json': config, 'linear-latest.json': snapshotV2, 'catalog.json': catalogV2 })) await writeFile(join(home, name), JSON.stringify(value));
  const server = await startServer({ home, port: 0 });
  t.after(() => server.close());
  let state = await (await fetch(`${server.origin}/api/shelf`)).json();
  assert.deepEqual(state.snapshot, snapshotV2);
  assert.deepEqual(state.catalog, catalogV2);
  await writeFile(join(home, 'catalog.json'), JSON.stringify(catalog));
  state = await (await fetch(`${server.origin}/api/shelf`)).json();
  assert.equal(state.catalog, null);
  assert.equal(state.availability.catalog, 'invalid');
});

test('v2 Slack report stays audience-facing and omits internal classification and coverage gaps', () => {
  const value = structuredClone(catalogV2);
  value.coverage[1] = { ...value.coverage[1], pr: 'unavailable', ci: 'unavailable' };
  value.coverage[3] = { ...value.coverage[3], pr: 'unavailable', ci: 'unavailable' };
  const report = createReport({ snapshot: snapshotV2, catalog: value, overlays: { prStatus: { 'demo/repository#42': 'ready-review' } } });
  assert.match(report, /^Ready for Review\n• DEMO-1 — Synthetic ticket 1/);
  assert.match(report, /demo\/repository #42 → main — Synthetic child work/);
  assert.doesNotMatch(report, /assigned|followed|context|Assignee|CI evidence unavailable|No associated PR observed/);
  assert.doesNotMatch(report, /DEMO-2|DEMO-3|DEMO-4/);
  assert.doesNotMatch(createReport({ snapshot: snapshotV2, catalog: null }), /PR evidence unavailable|No associated PR observed/);
});

test('v2 same PR across tickets rejects conflicting shared metadata', () => {
  const value = structuredClone(catalogV2);
  value.pullRequests.push({ ...structuredClone(value.pullRequests[0]), issueId: 'DEMO-4', association: { kind: 'github-reference', issueId: 'DEMO-4', sourceUrl: value.pullRequests[0].url } });
  value.coverage[3].ci = 'complete';
  assert.deepEqual(validateCatalog(value, config, snapshotV2), value);
  for (const [field, replacement] of Object.entries({ baseBranch: 'develop', state: 'merged', purpose: 'Conflicting purpose', observedAt: '2026-10-10T00:00:00.000Z', headSha: 'b'.repeat(40) })) {
    const conflict = structuredClone(value);
    conflict.pullRequests[1][field] = replacement;
    assert.throws(() => validateCatalog(conflict, config, snapshotV2), /INVALID_CATALOG/);
  }
});

test('v2 association evidence rejects nonempty URL ports, query strings and fragments', () => {
  for (const suffix of [':8443', '?query=1', '#fragment']) {
    for (const kind of ['pr', 'github-reference', 'linear-attachment']) {
      const value = structuredClone(catalogV2);
      const pr = value.pullRequests[0];
      const decorate = url => suffix.startsWith(':') ? url.replace('.com/', `.com${suffix}/`).replace('.test/', `.test${suffix}/`) : url + suffix;
      if (kind === 'pr') pr.url = decorate(pr.url);
      else if (kind === 'github-reference') pr.association = { kind, issueId: pr.issueId, sourceUrl: decorate(pr.url) };
      else pr.association.sourceUrl = decorate(pr.association.sourceUrl);
      assert.throws(() => validateCatalog(value, config, snapshotV2), /INVALID_CATALOG/);
    }
  }
});
