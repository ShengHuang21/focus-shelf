import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { renderShelf, createReport, createReportHtml, createUpdateRequest, createDailyUpdateRequest, createButtonUpdateRequest, createMemoDrafts, formatAssigneeName, renderTicketIcon, displayedPRState, completedArchiveIds } from '../web/app.mjs';
import { config, snapshot, catalog, snapshotV2, catalogV2 } from './helpers.mjs';

const root = new URL('..', import.meta.url).pathname;

test('Update prompt preserves Sprint evidence without redefining template grouping or completion', () => {
  const request = createUpdateRequest();
  for (const phrase of ['group by Sprint only inside Current work and Completed', 'Upcoming and Backlog group directly into Assigned to me, Assigned to others, and Unassigned', 'newest Sprint first', 'verified creation month', 'a past Sprint does not mean Done']) assert.ok(request.includes(phrase));
});

test('Daily Update prompt delegates Sprint rules to the bundled contract without embedding dates', async () => {
  const request = createDailyUpdateRequest('2026-10-10T00:00:00.000Z');
  assert.match(request, /skills\/focus-shelf\/SKILL\.md/);
  assert.match(request, /CODEX_SNAPSHOT\.md/);
  assert.match(request, /last validated local snapshot\/catalog pair \(24-hour overlap\)/);
  assert.doesNotMatch(request, /2026-10-10|2026-10-09/);
  assert.ok(request.length < 1000);
  const contract = await readFile(join(root, 'CODEX_SNAPSHOT.md'), 'utf8');
  assert.match(contract, /Sprint membership for every retained issue on every daily refresh/);
  assert.match(contract, /including those previously without a Sprint/);
});

test('Update button uses the short incremental contract and full refresh names the actual local home', () => {
  const request = createButtonUpdateRequest(snapshotV2);
  assert.match(request, /daily incremental refresh/);
  assert.match(request, /24-hour overlap/);
  assert.match(request, /new PRs even for unchanged retained tickets/);
  assert.match(request, /every catalogued PR, including Closed PRs/);
  assert.match(request, /Validate coverage, continuity, and the complete pair before saving/);
  assert.doesNotMatch(request, /20\d{2}-\d{2}-\d{2}/);
  assert.equal(createButtonUpdateRequest(null), createUpdateRequest());
  assert.match(createUpdateRequest(), /resolved local data home.*FOCUS_SHELF_HOME.*\.focus-shelf\//);
  assert.doesNotMatch(createUpdateRequest(), /external home/);
});

test('Memo draft survives a redraw and an older save acknowledgement', () => {
  const drafts = createMemoDrafts();
  const submitted = drafts.input('DEMO-1', 'first text');
  assert.equal(drafts.overlay({ 'DEMO-1': 'old file text' })['DEMO-1'], 'first text');
  drafts.input('DEMO-1', 'newer text');
  assert.equal(drafts.acknowledge('DEMO-1', submitted), false);
  assert.equal(drafts.overlay({ 'DEMO-1': 'first text' })['DEMO-1'], 'newer text');
  const latest = drafts.get('DEMO-1');
  assert.equal(drafts.acknowledge('DEMO-1', latest), true);
  assert.equal(drafts.overlay({ 'DEMO-1': 'newer text' })['DEMO-1'], 'newer text');
});

test('Missing or incomplete PR evidence is not reported as a definite empty review list', () => {
  const missing = { config, snapshot: snapshotV2, catalog: null };
  assert.match(renderShelf(missing), /PR data not loaded · review status cannot be determined/);
  assert.match(createReport(missing), /Ready for Review\n• PR review status not fully checked\./);
  assert.doesNotMatch(createReport(missing).split('\n\n')[0], /None/);
  assert.match(createReportHtml(missing), /<li>PR review status not fully checked\.<\/li>/);

  const incomplete = { ...catalogV2, coverage: catalogV2.coverage.map(item => item.issueId === 'DEMO-1' ? { ...item, pr: 'unavailable', ci: 'unavailable' } : item) };
  const incompleteShelf = renderShelf({ config, snapshot: snapshotV2, catalog: incomplete });
  assert.match(incompleteShelf, /PR #42/);
  assert.doesNotMatch(incompleteShelf, /PR list not fully checked|PR review status not fully checked/);
  assert.match(createReport({ snapshot: snapshotV2, catalog: incomplete }), /PR review status not fully checked/);

  assert.doesNotMatch(renderShelf({ config, snapshot: snapshotV2, catalog: catalogV2 }), /PR review status not fully checked/);

  const completeEmpty = { ...catalogV2, pullRequests: [], ciObservations: [], coverage: catalogV2.coverage.map(item => ({ ...item, ci: 'not-applicable' })) };
  assert.match(createReport({ snapshot: snapshotV2, catalog: completeEmpty }), /Ready for Review\n• None\./);
});

test('Upcoming groups directly by ownership while retaining To Do/Triage status and child trees', () => {
  const base = { ...snapshot.issues[0], relations: [], status: { name: 'To Do', type: 'unstarted' } };
  const issues = [base, { ...base, id: 'DEMO-2', assignee: null }, { ...base, id: 'DEMO-3', status: { name: 'Triage', type: 'triage' }, assignee: { id: 'other', name: 'Alex' } }];
  const state = { config, snapshot: { ...snapshot, issues, createdIssueIds: ['DEMO-2', 'DEMO-3'] }, catalog: null };
  const html = renderShelf(state);
  for (const key of ['ownership:planned:none:mine', 'ownership:planned:none:unassigned', 'ownership:planned:none:delegated']) assert.ok(html.includes(`data-fold="${key}">`));
  assert.match(html, /status-pill status-unstarted/);
  assert.match(html, /status-pill status-triage/);
  assert.doesNotMatch(html, /data-fold="upcoming:/);
  assert.doesNotMatch(html, /data-fold="sprint:planned:/);
  const restored = renderShelf({ ...state, revealIssueId: 'DEMO-3' });
  assert.match(restored, /data-fold="ownership:planned:none:delegated" open/);
});

test('Backlog ownership groups start collapsed without an extra Sprint layer', () => {
  const base = { ...snapshot.issues[0], relations: [], status: { name: 'Backlog', type: 'backlog' } };
  const issues = [base, { ...base, id: 'DEMO-2', assignee: { id: 'other', name: 'Alex' } }, { ...base, id: 'DEMO-3', assignee: null }, { ...base, id: 'DEMO-4', status: { name: 'In Progress', type: 'started' } }];
  const state = { config, snapshot: { ...snapshot, issues, createdIssueIds: ['DEMO-2', 'DEMO-3'] }, catalog: null };
  const html = renderShelf(state);
  for (const key of ['mine', 'delegated', 'unassigned']) assert.match(html, new RegExp(`data-fold="ownership:backlog:none:${key}">`));
  assert.match(html, /data-fold="ownership:current:none:mine" open/);
  assert.doesNotMatch(html, /data-fold="group:backlog" open/);
  assert.match(renderShelf({ ...state, revealIssueId: 'DEMO-2' }), /data-fold="ownership:backlog:none:delegated" open/);
  const sprint = { name: 'Example Sprint', startDate: '2026-10-01T00:00:00.000Z', endDate: '2026-10-20T00:00:00.000Z' };
  const dated = renderShelf({ ...state, snapshot: { ...state.snapshot, issues: [{ ...base, sprint }] }, now: '2026-10-10T00:00:00.000Z' });
  assert.doesNotMatch(dated, /data-fold="sprint:backlog:/);
  assert.match(dated, /ownership:backlog:none:mine/);
});

test('Child disclosure counts displayed immediate children, not all descendants', () => {
  const value = structuredClone(snapshotV2);
  const extra = { ...value.issues[2], id: 'DEMO-5', relations: [{ type: 'parent', issueId: 'DEMO-1' }] };
  value.issues[0].relations.push({ type: 'child', issueId: extra.id });
  value.issues.push(extra);
  const state = { config, snapshot: value, catalog: null };
  assert.match(renderShelf(state), /data-fold="children:DEMO-1"[^]*?<span>· 2 tasks<\/span>/);
  assert.match(renderShelf(state), /data-fold="children:DEMO-2"[^]*?<span>· 1 task<\/span>/);
  assert.match(renderShelf({ ...state, overlays: { archived: { 'DEMO-5': true } } }), /data-fold="children:DEMO-1"[^]*?<span>· 1 task · 1 archived<\/span>/);
  for (const phrase of ['bundled focus-shelf', 'exhaust pagination', 'PR responsibility separately', 'PR continuity', 'leave the existing local files unchanged']) assert.ok(createUpdateRequest().includes(phrase));
});

test('Triage uses slate-blue while To Do keeps a distinct gold badge', async () => {
  const css = await readFile(join(root, 'web/styles.css'), 'utf8');
  assert.match(css, /\.status-pill\.status-triage \{ color: #536477; background: #eaf0f6; \}/);
  assert.match(css, /\.status-pill\.status-unstarted \{ color: #845400; background: #fff0bd; \}/);
});

test('Current work groups by Sprint then verified ownership without splitting families', () => {
  const issue = { ...snapshot.issues[0], relations: [], status: { name: 'In Progress', type: 'started' }, sprint: { name: '26.10.S1', startDate: '2026-10-01T00:00:00.000Z', endDate: '2026-10-15T00:00:00.000Z' } };
  const issues = [issue, { ...issue, id: 'DEMO-2', assignee: { id: 'other', name: 'Alex' } }, { ...issue, id: 'DEMO-3', assignee: null }, { ...issue, id: 'DEMO-4', assignee: { id: 'other', name: 'Sam' } }, { ...issue, id: 'DEMO-5', sprint: null }];
  const state = { config, snapshot: { ...snapshot, issues, createdIssueIds: ['DEMO-2', 'DEMO-3'], followedIssueIds: ['DEMO-4'] }, catalog: null, now: '2026-10-10T00:00:00.000Z' };
  const html = renderShelf(state);
  assert.match(html, /This Sprint · 26\.10\.S1/);
  assert.match(html, />No Sprint<\/summary>/);
  for (const label of ['Assigned to me', 'Assigned to others', 'Unassigned']) assert.ok(html.includes(`<summary>${label}</summary>`));
  assert.doesNotMatch(html, /<summary>Following<\/summary>/);
  assert.match(html, /data-fold="ownership:[^"]+" open/);
  assert.match(html, /data-fold="group:current" open/);
  assert.doesNotMatch(html, /data-fold="sprint:current:[^"]+">/);
  assert.match(renderShelf({ ...state, revealIssueId: 'DEMO-2' }), /data-fold="ownership:[^"]+:delegated" open/);
  assert.equal([...html.matchAll(/data-archive="DEMO-2"/g)].length, 1);
});

test('Completed folds every subgroup and orders Sprint then creation month newest first', () => {
  const done = { ...snapshot.issues[0], relations: [], status: { name: 'Done', type: 'completed' }, sprint: null };
  const issues = [
    { ...done, id: 'DEMO-1', sprint: { name: '26.9.S1', startDate: '2026-09-01T00:00:00.000Z', endDate: '2026-09-15T00:00:00.000Z' } },
    { ...done, id: 'DEMO-2', sprint: { name: '26.9.S2', startDate: '2026-09-16T00:00:00.000Z', endDate: '2026-09-30T00:00:00.000Z' } },
    { ...done, id: 'DEMO-3', createdAt: '2026-09-30T16:30:00.000Z' },
    { ...done, id: 'DEMO-4', createdAt: '2026-09-01T00:00:00.000Z' },
    { ...done, id: 'DEMO-5', createdAt: '2025-10-01T00:00:00.000Z' },
    { ...done, id: 'DEMO-6' },
  ];
  const state = { config: { ...config, timezone: 'Asia/Tokyo' }, snapshot: { ...snapshot, issues }, catalog: null, now: '2026-10-10T00:00:00.000Z' };
  const html = renderShelf(state);
  const summaries = [...html.matchAll(/data-fold="sprint:completed:[^"]+"><summary>([^<]+)<\/summary>/g)].map(match => match[1]);
  assert.deepEqual(summaries, ['Sprint · 26.9.S2', 'Sprint · 26.9.S1', 'October 2026', 'September 2026', 'October 2025', 'Undated']);
  assert.doesNotMatch(html, /data-fold="sprint:completed:[^"]+" open/);
  assert.match(renderShelf({ ...state, revealIssueId: 'DEMO-3' }), /data-fold="sprint:completed:month:2026-10" open/);
  assert.match(createUpdateRequest(), /creation timestamps/);
});

test('Duplicate tickets are omitted regardless of assignee and original work remains', () => {
  for (const assignee of [null, snapshot.issues[0].assignee]) {
    const original = { ...snapshot.issues[0], relations: [{ type: 'related', issueId: 'DEMO-2' }] };
    const duplicate = { ...snapshot.issues[0], id: 'DEMO-2', title: 'Duplicate copy', assignee, status: { name: 'Duplicate', type: 'duplicate' }, relations: [{ type: 'duplicateOf', issueId: original.id }] };
    const state = { config, snapshot: { ...snapshot, issues: [original, duplicate] }, catalog: null, overlays: { archived: { 'DEMO-2': true } } };
    assert.doesNotMatch(renderShelf(state), /DEMO-2|Duplicate copy/);
    assert.match(renderShelf(state), /DEMO-1/);
    assert.doesNotMatch(createReport(state), /DEMO-2/);
    assert.doesNotMatch(createReportHtml(state), /DEMO-2/);
  }
});

test('Backlog is not promoted by an open PR or a started child', () => {
  const parent = { ...snapshot.issues[0], status: { name: 'Backlog', type: 'backlog' }, relations: [{ type: 'child', issueId: 'DEMO-2' }] };
  const child = { ...snapshot.issues[0], id: 'DEMO-2', title: 'Started child', relations: [{ type: 'parent', issueId: parent.id }] };
  const value = { ...catalog, pullRequests: [{ ...catalogV2.pullRequests[0], issueId: parent.id, state: 'open' }] };
  const html = renderShelf({ config, snapshot: { ...snapshot, issues: [parent, child] }, catalog: value });
  assert.match(html, /data-fold="group:backlog">[^]*DEMO-1/);
  assert.doesNotMatch(html, /data-fold="group:current"/);
  assert.match(html, /Started child/);
});

test('Sprint phase follows current time and actual dates, not stale snapshot or S1 midpoint guesses', () => {
  const issue = { ...snapshot.issues[0], sprint: { name: '26.10.S2', startDate: '2026-10-20T00:00:00.000Z', endDate: '2026-11-02T00:00:00.000Z' } };
  const state = { config, snapshot: { ...snapshot, generatedAt: '2026-09-01T00:00:00.000Z', issues: [issue] }, catalog: null };
  assert.match(renderShelf({ ...state, now: '2026-10-10T00:00:00.000Z' }), /Upcoming Sprint · 26\.10\.S2/);
  assert.match(renderShelf({ ...state, now: '2026-10-25T00:00:00.000Z' }), /This Sprint · 26\.10\.S2/);
  assert.match(renderShelf({ ...state, now: '2026-11-03T00:00:00.000Z' }), /Past Sprint · 26\.10\.S2/);
  assert.match(renderShelf({ ...state, snapshot: { ...state.snapshot, issues: [{ ...issue, sprint: { ...issue.sprint, startDate: null, endDate: null } }] }, now: '2026-10-25T00:00:00.000Z' }), />Sprint · 26\.10\.S2/);
});

test('Backlog and ownership fold independently and reveal restores both levels', () => {
  const issue = { ...snapshot.issues[0], status: { name: 'Backlog', type: 'backlog' }, sprint: { name: 'Old sprint', startDate: '2026-09-01T00:00:00.000Z', endDate: '2026-09-10T00:00:00.000Z' } };
  const state = { config, snapshot: { ...snapshot, generatedAt: '2026-10-10T00:00:00.000Z', issues: [issue] }, catalog: null };
  const html = renderShelf(state);
  assert.match(html, /data-fold="group:backlog"><summary>/);
  assert.match(html, /data-fold="ownership:backlog:none:mine"><summary>/);
  const revealed = renderShelf({ ...state, revealIssueId: issue.id });
  assert.match(revealed, /data-fold="group:backlog" open/);
  assert.match(revealed, /data-fold="ownership:backlog:none:mine" open/);
});

test('Estimate circles explicitly identify points in their hover tooltip', () => {
  for (const points of [0, 1, 3]) {
    const html = renderShelf({ config, snapshot: { ...snapshot, issues: [{ ...snapshot.issues[0], estimate: points }] }, catalog: null });
    assert.ok(html.includes(`class="estimate-points" title="Estimate: ${points} point${points === 1 ? '' : 's'}"`));
  }
});

test('Canceled work is omitted from shelf, archive and reports without hiding active descendants', () => {
  const parent = { ...snapshot.issues[0], status: { name: 'Canceled', type: 'canceled' }, relations: [{ type: 'child', issueId: 'DEMO-2' }] };
  const child = { ...snapshot.issues[0], id: 'DEMO-2', title: 'Active replacement work', url: 'https://linear.example.test/demo-workspace/issue/DEMO-2', relations: [{ type: 'parent', issueId: 'DEMO-1' }, { type: 'related', issueId: 'DEMO-1' }] };
  const state = { config, snapshot: { ...snapshot, issues: [parent, child] }, catalog: null, overlays: { archived: { 'DEMO-1': true } } };
  const html = renderShelf(state);
  assert.doesNotMatch(html, /DEMO-1|>Canceled</);
  assert.match(html, /DEMO-2/);
  assert.match(html, /Archive · 0/);
  assert.doesNotMatch(createReport(state), /DEMO-1/);
  assert.match(createReport(state), /DEMO-2/);
  assert.doesNotMatch(createReportHtml(state), /DEMO-1/);
  for (const name of ['Cancel', 'Cancelled', 'Canceled']) {
    assert.doesNotMatch(renderShelf({ config, snapshot: { ...snapshot, issues: [{ ...parent, relations: [], status: { name, type: 'canceled' } }] }, catalog: null }), /DEMO-1/);
  }
});

test('C11 rendering treats supplied titles and memo as text; report remains local', () => {
  const unsafe = { ...snapshot, issues: [{ ...snapshot.issues[0], title: '<img src=x onerror=alert(1)>' }] };
  const html = renderShelf({ config, snapshot: unsafe, catalog: null });
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img src=x/);
  const report = createReport({ config, snapshot, catalog: null, overlays: { memos: { 'DEMO-1': '<script>bad</script>' } } });
  assert.equal(typeof report, 'string');
  assert.match(report, /DEMO-1/);
});

test('C11 ticket presentation retains the Linear assignee', () => {
  const state = {
    config, snapshot,
    catalog: { ...catalog, presentation: { ...catalog.presentation, tickets: [{ issueId: 'DEMO-1', label: 'Demo', icon: 'ticket', tone: 'blue', description: 'Synthetic' }] } },
  };
  const html = renderShelf(state);
  assert.match(html, /class="ticket-ownership"><span[^>]*>Assignee: Demo<\/span><\/div>/);
  const report = createReport(state);
  assert.match(report, /In Progress\n• DEMO-1 — Synthetic example/);
  assert.doesNotMatch(report, /Assignee/);
});

test('C11 assignee display prefers the English name and omits the Japanese duplicate', () => {
  assert.equal(formatAssigneeName('- Alex Example - アレックス エグザンプル'), 'Alex');
  assert.equal(formatAssigneeName('例野 太郎 - Casey Example -'), 'Casey');
  assert.equal(formatAssigneeName('Morgan Example Long Synthetic Name'), 'Morgan');
  assert.equal(formatAssigneeName('例野 太郎'), '例野 太郎');
});

test('C11 shared UI uses the canonical Focus Shelf hierarchy and compact visual frame', () => {
  const parent = { ...snapshot.issues[0], id: 'DEMO-10', uuid: '00000000-0000-4000-8000-000000000010', title: 'Synthetic user report', url: 'https://linear.example.test/demo-workspace/issue/DEMO-10', relations: [{ type: 'child', issueId: 'DEMO-11' }] };
  const child = { ...snapshot.issues[0], id: 'DEMO-11', uuid: '00000000-0000-4000-8000-000000000011', title: 'Synthetic engineering work', url: 'https://linear.example.test/demo-workspace/issue/DEMO-11', relations: [{ type: 'parent', issueId: 'DEMO-10' }] };
  const state = {
    config,
    snapshot: { ...snapshot, followedIssueIds: ['DEMO-10', 'DEMO-11'], issues: [parent, child] },
    catalog: { ...catalog, presentation: { ...catalog.presentation, tickets: [{ issueId: 'DEMO-11', label: 'Chat Recovery', icon: 'chat-error', tone: 'blue', description: 'Synthetic recovery topic illustration' }] } },
  };
  const html = renderShelf(state);
  assert.doesNotMatch(html, /Codex snapshot|Reload snapshot|Create report|\d+ items|\d+ assigned/);
  assert.match(html, /id="generate-slack-report">Generate Slack Report<\/button>/);
  assert.match(html, /id="copy-slack-report">Copy Report<\/button>/);
  assert.match(html, /focus-group/);
  assert.match(html, /relationship-symbol relationship-symbol-child">Child/);
  assert.match(html, /<details class="child-task-fold" data-fold="children:DEMO-10"><summary class="handled-by">/);
  assert.match(html, /<span>· 1 task<\/span>/);
  const revealed = renderShelf({ ...state, revealIssueId: 'DEMO-11' });
  assert.match(revealed, /data-fold="children:DEMO-10" open/);
  assert.match(html, /ticket-thumbnail/);
  assert.match(html, /<svg class="ticket-topic-icon"/);
  assert.doesNotMatch(html, /💬|↻|●/);
  assert.match(html, /status-pill/);
  assert.match(html, /Archive · 0/);
  assert.doesNotMatch(html, /Saved webpages|LOCAL WORKSPACE|Show archived/);
});

test('C11 top Update control prepares an explicit Codex refresh request without claiming external sync', () => {
  const html = renderShelf({ config, snapshot, catalog });
  assert.match(html, /^<header class="shelf-toolbar">/);
  assert.match(html, /id="request-focus-update"[^>]*>[^]*<span>Update<\/span>/);
  assert.match(html, /id="focus-update-status"[^>]*aria-live="polite"/);
  assert.match(html, /id="focus-update-fallback"[^>]*readonly hidden/);
  const request = createUpdateRequest();
  assert.match(request, /Please update my Focus Shelf/);
  assert.match(request, /all issues I created \(including reassigned and unassigned issues\)/);
  assert.match(request, /exact associated PRs/);
  assert.match(request, /Preserve local-file Memo and local-file Archive/);
  assert.match(request, /Release target policy failure as an attention warning/);
  assert.match(request, /Reload the same local page and verify rendered results when available/);
  assert.doesNotMatch(html, /Update complete|Synchronized|Synced/);
});

test('C11 archiving a parent keeps its child tree together in Archive', () => {
  const parent = { ...snapshot.issues[0], id: 'DEMO-10', uuid: '00000000-0000-4000-8000-000000000010', title: 'Synthetic parent', status: { name: 'Done', type: 'completed' }, url: 'https://linear.example.test/demo-workspace/issue/DEMO-10', relations: [{ type: 'child', issueId: 'DEMO-11' }] };
  const child = { ...snapshot.issues[0], id: 'DEMO-11', uuid: '00000000-0000-4000-8000-000000000011', title: 'Synthetic child', status: { name: 'In Progress', type: 'started' }, url: 'https://linear.example.test/demo-workspace/issue/DEMO-11', relations: [{ type: 'parent', issueId: 'DEMO-10' }] };
  const state = { config, snapshot: { ...snapshot, followedIssueIds: ['DEMO-10', 'DEMO-11'], issues: [parent, child] }, catalog, overlays: { archived: { 'DEMO-10': true, 'DEMO-11': true } } };
  const html = renderShelf(state);
  const current = html.slice(0, html.indexOf('<details id="archive-section"'));
  const archive = html.slice(html.indexOf('<details id="archive-section"'));
  assert.doesNotMatch(current, /Synthetic parent/);
  assert.doesNotMatch(current, /Synthetic child/);
  assert.match(archive, /Archive · 2/);
  assert.match(archive, /Synthetic parent/);
  assert.match(archive, /data-fold="children:DEMO-10" open/);
  assert.match(archive, /Synthetic child/);
  assert.match(archive, /class="ticket-outstanding"[^>]*>1 In Progress<\/div>/);
  assert.equal((archive.match(/Synthetic child/g) ?? []).length, 1);
  assert.match(archive, />Restore</);
  const parentOnly = renderShelf({ ...state, overlays: { archived: { 'DEMO-10': true } } });
  assert.match(parentOnly, /Archive · 2/);
  assert.doesNotMatch(parentOnly.slice(0, parentOnly.indexOf('<details id="archive-section"')), /Synthetic child/);
  const restoredParent = renderShelf({ ...state, overlays: { archived: { 'DEMO-10': false, 'DEMO-11': true } } });
  assert.match(restoredParent, /Archive · 1/);
  assert.match(restoredParent, /class="handled-by"[^]*?<span>· 0 tasks · 1 archived<\/span>/);
});

test('Archived parent returns to Completed only when every child and associated PR is complete', () => {
  const parent = { ...snapshot.issues[0], id: 'DEMO-10', status: { name: 'Done', type: 'completed' }, relations: [{ type: 'child', issueId: 'DEMO-11' }] };
  const child = { ...snapshot.issues[0], id: 'DEMO-11', status: { name: 'In Progress', type: 'started' }, relations: [{ type: 'parent', issueId: 'DEMO-10' }] };
  const scope = { ...snapshotV2, issues: [parent, child] };
  const coverage = [parent, child].map(item => ({ issueId: item.id, pr: 'complete' }));
  const catalog = { schemaVersion: 2, coverage, pullRequests: [] };
  const archived = { 'DEMO-10': true, 'DEMO-11': true };
  assert.deepEqual(completedArchiveIds(scope, catalog, archived), []);
  const done = { ...scope, issues: [parent, { ...child, status: { name: 'Done', type: 'completed' } }] };
  assert.deepEqual(completedArchiveIds(done, { ...catalog, coverage: [{ issueId: parent.id, pr: 'unavailable' }, coverage[1]] }, archived), []);
  assert.deepEqual(completedArchiveIds(done, { ...catalog, pullRequests: [{ issueId: child.id, state: 'open' }] }, archived), []);
  assert.deepEqual(completedArchiveIds(done, catalog, archived), ['DEMO-11', 'DEMO-10']);
});

test('C11 restoring a completed ticket opens its destination group instead of making it appear lost', () => {
  const done = { ...snapshot.issues[0], status: { name: 'Done', type: 'completed' } };
  const restored = renderShelf({ config, snapshot: { ...snapshot, issues: [done] }, catalog, overlays: { archived: { 'DEMO-1': false } }, revealIssueId: 'DEMO-1' });
  assert.match(restored, /<details class="focus-group focus-group-completed" data-fold="group:completed" open>/);
  assert.match(restored, /DEMO-1/);
  assert.match(restored, /data-archive="DEMO-1"[^>]*>Archive<\/button>/);
});

test('C11 a completed Linear ticket stays Current work while an associated PR remains open', () => {
  const done = { ...snapshot.issues[0], status: { name: 'Done', type: 'completed' } };
  const activeCatalog = {
    ...catalog,
    pullRequests: [{ ...catalogV2.pullRequests[0], issueId: done.id, state: 'open' }],
  };
  const html = renderShelf({ config, snapshot: { ...snapshot, issues: [done] }, catalog: activeCatalog });
  assert.match(html, /data-fold="group:current"[^]*DEMO-1/);
  assert.match(renderShelf({ config, snapshot: { ...snapshot, issues: [done] }, catalog: activeCatalog, revealIssueId: done.id }), /data-fold="group:current" open/);
  assert.match(html, /PR #/);
  assert.match(html, /status-pill status-completed[^>]*>Done</);
  assert.doesNotMatch(html, /focus-group-completed/);
});

test('C11 a completed Linear ticket moves into Completed after all associated PRs become terminal', () => {
  const done = { ...snapshot.issues[0], status: { name: 'Done', type: 'completed' } };
  const mergedCatalog = {
    ...catalog,
    pullRequests: [{ ...catalogV2.pullRequests[0], issueId: done.id, state: 'merged' }],
  };
  const html = renderShelf({ config, snapshot: { ...snapshot, issues: [done] }, catalog: mergedCatalog });
  assert.match(html, /<details class="focus-group focus-group-completed" data-fold="group:completed">[^]*DEMO-1/);
  assert.doesNotMatch(html, /focus-group-current/);
});

test('C11 other-owner ticket PRs remain visible with creator attribution', () => {
  const contextIssue = { ...snapshot.issues[0], id: 'DEMO-2', uuid: '00000000-0000-4000-8000-000000000002', title: 'Other owner context', url: 'https://linear.example.test/demo-workspace/issue/DEMO-2', assignee: { id: 'other-owner', name: 'Other Owner' } };
  const state = {
    config,
    snapshot: { ...snapshot, followedIssueIds: ['DEMO-1', 'DEMO-2'], issues: [snapshot.issues[0], contextIssue] },
    catalog: { ...catalog, pullRequests: [{ issueId: 'DEMO-2', repository: 'demo/other', number: 7, url: 'https://github.com/demo/other/pull/7', baseBranch: 'main', state: 'open', purpose: 'Context-only change', observedAt: snapshot.generatedAt, creator: { login: 'alex-demo', displayName: 'Alex', isProfileOwner: false } }] },
  };
  const html = renderShelf(state);
  assert.match(html, /PR #7/);
  assert.match(html, /Created by Alex/);
  assert.match(html, /Assignee: Other/);
  assert.doesNotMatch(html, /ticket-ownership"><span>(?:followed|assigned|context) ·/);
});

test('C11 a ticket created by the profile remains visible after reassignment', () => {
  const reassigned = {
    ...snapshot.issues[0],
    assignee: { id: 'other-owner', name: '- Anandhavelu Arumugam - アナンダヴェル アルムガム' },
  };
  const value = {
    ...snapshot,
    schemaVersion: 2,
    scope: 'assigned-created-followed-context',
    createdIssueIds: ['DEMO-1'],
    followedIssueIds: [],
    issues: [reassigned],
  };
  const html = renderShelf({ config, snapshot: value, catalog: null });
  assert.match(html, /ownership-created">Created<\/span>/);
  assert.match(html, /ownership-arrow">→<\/span>/);
  assert.match(html, /ownership-assigned[^>]*>Assigned to Anandhavelu<\/span>/);
  assert.match(html, /DEMO-1/);
  assert.doesNotMatch(html, /delegated-ticket/);

  const report = createReport({ snapshot: value, catalog: null });
  assert.doesNotMatch(report, /In Progress\n• DEMO-1/);
});

test('C11 a created unassigned ticket has only the Unassigned ownership label', () => {
  const value = { ...snapshot, createdIssueIds: ['DEMO-1'], issues: [{ ...snapshot.issues[0], assignee: null }] };
  const html = renderShelf({ config, snapshot: value, catalog: null });
  assert.match(html, /ticket-ownership"><span class="ownership-unassigned">Unassigned<\/span>/);
  assert.doesNotMatch(html, /ownership-created|ownership-arrow|Assigned to Unassigned/);
});

test('Unassigned uses a shared red badge with a topic thumbnail', async () => {
  const value = { ...snapshot, issues: [{ ...snapshot.issues[0], assignee: null }] };
  const presentation = { ...catalog.presentation, tickets: [{ issueId: 'DEMO-1', label: 'Demo', icon: 'ticket', tone: 'blue', description: 'Synthetic' }] };
  const html = renderShelf({ config, snapshot: value, catalog: { ...catalog, presentation } });
  assert.match(html, /class="ownership-unassigned">Unassigned<\/span>/);
  const css = await readFile(join(root, 'web/styles.css'), 'utf8');
  assert.match(css, /\.ownership-unassigned\s*\{[^}]*color:\s*#a12b24;[^}]*background:\s*#fff1f0/s);
});

test('C11 neutral topic color defaults to blue regardless of ticket group', () => {
  const presentation = { ...catalog.presentation, tickets: [{ issueId: 'DEMO-1', label: 'Demo', icon: 'ticket', tone: 'neutral', description: 'Synthetic topic' }] };
  for (const [name, type] of [['Todo', 'unstarted'], ['Backlog', 'backlog'], ['Done', 'completed']]) {
    const html = renderShelf({ config, snapshot: { ...snapshot, issues: [{ ...snapshot.issues[0], status: { name, type } }] }, catalog: { ...catalog, presentation } });
    assert.match(html, /ticket-thumbnail ticket-thumbnail-blue/);
    assert.doesNotMatch(html, /ticket-thumbnail-neutral|ticket-thumbnail-on-hold/);
  }
  const held = renderShelf({ config, snapshot: { ...snapshot, issues: [{ ...snapshot.issues[0], status: { name: 'On Hold', type: 'backlog' } }] }, catalog: { ...catalog, presentation } });
  assert.match(held, /ticket-thumbnail-blue ticket-thumbnail-on-hold/);
});

test('C11 other-owner child work is collapsed without exposing internal context labels', () => {
  const parent = { ...snapshot.issues[0], id: 'DEMO-10', uuid: '00000000-0000-4000-8000-000000000010', title: 'Profile owner parent', url: 'https://linear.example.test/demo-workspace/issue/DEMO-10', relations: [{ type: 'child', issueId: 'DEMO-11' }] };
  const delegated = { ...snapshot.issues[0], id: 'DEMO-11', uuid: '00000000-0000-4000-8000-000000000011', title: 'Delegated trial task', url: 'https://linear.example.test/demo-workspace/issue/DEMO-11', assignee: { id: 'other-owner', name: 'Other Owner' }, relations: [{ type: 'parent', issueId: 'DEMO-10' }] };
  const value = { ...snapshot, schemaVersion: 2, scope: 'assigned-followed-context', followedIssueIds: [], issues: [parent, delegated] };
  const html = renderShelf({ config, snapshot: value, catalog: null });
  assert.match(html, /<details class="delegated-ticket"><summary>[^<]*<span class="delegated-id">DEMO-11/);
  assert.match(html, /Delegated trial task/);
  assert.match(html, /delegated-assignee" title="Full Linear assignee: Other Owner">Assignee: Other/);
  assert.doesNotMatch(html, /context · Assignee/);
  assert.doesNotMatch(html, /<details class="delegated-ticket" open/);
});

test('C11 an active child keeps its completed parent family in Current work', () => {
  const parent = { ...snapshot.issues[0], id: 'DEMO-10', uuid: '00000000-0000-4000-8000-000000000010', title: 'Completed context parent', url: 'https://linear.example.test/demo-workspace/issue/DEMO-10', status: { name: 'Done', type: 'completed' }, relations: [{ type: 'child', issueId: 'DEMO-11' }] };
  const child = { ...snapshot.issues[0], id: 'DEMO-11', uuid: '00000000-0000-4000-8000-000000000011', title: 'Active assigned child', url: 'https://linear.example.test/demo-workspace/issue/DEMO-11', status: { name: 'In Progress', type: 'started' }, relations: [{ type: 'parent', issueId: 'DEMO-10' }] };
  const html = renderShelf({ config, snapshot: { ...snapshot, followedIssueIds: ['DEMO-10'], issues: [parent, child] }, catalog });
  assert.match(html, /data-fold="group:current"[^]*Completed context parent/);
  assert.match(html, /Active assigned child/);
  assert.doesNotMatch(html, /data-fold="group:completed"/);
});

test('C11 another owner active child keeps the completed family in Current work', () => {
  const parent = { ...snapshot.issues[0], id: 'DEMO-10', uuid: '00000000-0000-4000-8000-000000000010', title: 'Completed profile work', url: 'https://linear.example.test/demo-workspace/issue/DEMO-10', status: { name: 'Done', type: 'completed' }, relations: [{ type: 'child', issueId: 'DEMO-11' }] };
  const delegated = { ...snapshot.issues[0], id: 'DEMO-11', uuid: '00000000-0000-4000-8000-000000000011', title: 'Other owner active context', url: 'https://linear.example.test/demo-workspace/issue/DEMO-11', status: { name: 'In Progress', type: 'started' }, assignee: { id: 'other-owner', name: 'Other Owner' }, relations: [{ type: 'parent', issueId: 'DEMO-10' }] };
  const value = { ...snapshot, schemaVersion: 2, scope: 'assigned-followed-context', followedIssueIds: [], issues: [parent, delegated] };
  const html = renderShelf({ config, snapshot: value, catalog: null });
  assert.match(html, /data-fold="group:current"[^]*Completed profile work/);
  assert.match(html, /Other owner active context/);
  assert.doesNotMatch(html, /data-fold="group:completed"/);
});

test('C11 standalone completed work is collapsed by default', () => {
  const done = { ...snapshot.issues[0], status: { name: 'Done', type: 'completed' } };
  const html = renderShelf({ config, snapshot: { ...snapshot, issues: [done] }, catalog });
  assert.match(html, /<details class="focus-group focus-group-completed" data-fold="group:completed"><summary><span>✓<\/span>Completed<\/summary>/);
  assert.doesNotMatch(html, /<details class="focus-group focus-group-completed" data-fold="group:completed" open>/);
});

test('C11 Upcoming is displayed before Current work and Backlog while Todo uses amber distinct from Done green', async () => {
  const upcoming = { ...snapshot.issues[0], id: 'DEMO-10', uuid: '00000000-0000-4000-8000-000000000010', title: 'Upcoming item', url: 'https://linear.example.test/demo-workspace/issue/DEMO-10', status: { name: 'Todo', type: 'unstarted' } };
  const current = { ...snapshot.issues[0], id: 'DEMO-11', uuid: '00000000-0000-4000-8000-000000000011', title: 'Current item', url: 'https://linear.example.test/demo-workspace/issue/DEMO-11', status: { name: 'In Progress', type: 'started' } };
  const backlog = { ...snapshot.issues[0], id: 'DEMO-12', uuid: '00000000-0000-4000-8000-000000000012', title: 'Backlog item', url: 'https://linear.example.test/demo-workspace/issue/DEMO-12', status: { name: 'Backlog', type: 'backlog' } };
  const html = renderShelf({ config, snapshot: { ...snapshot, followedIssueIds: ['DEMO-10', 'DEMO-11', 'DEMO-12'], issues: [upcoming, current, backlog] }, catalog: null });
  assert.ok(html.indexOf('>Upcoming<') < html.indexOf('>Current work<'));
  assert.ok(html.indexOf('>Current work<') < html.indexOf('>Backlog<'));
  assert.match(html, /<details class="focus-group focus-group-planned" data-fold="group:planned"><summary><span>◷<\/span>Upcoming<\/summary>/);
  assert.match(renderShelf({ config, snapshot: { ...snapshot, issues: [upcoming] }, catalog: null, revealIssueId: upcoming.id }), /data-fold="group:planned" open/);
  const css = await readFile(join(root, 'web/styles.css'), 'utf8');
  assert.doesNotMatch(css, /\.focus-group-planned\s*>\s*h2/);
  assert.match(css, /\.status-pill\.status-unstarted\s*\{[^}]*color:\s*#845400;[^}]*background:\s*#fff0bd;/s);
  assert.match(css, /\.status-pill\.status-completed\s*\{[^}]*color:\s*var\(--green\);[^}]*background:\s*var\(--green-bg\)/s);
  assert.doesNotMatch(css, /\.status-pill\.status-unstarted\s*\{[^}]*var\(--green\)/s);
  assert.doesNotMatch(css, /\.status-pill\.status-unstarted\s*\{[^}]*var\(--purple\)/s);
});

test('C11 a child that owns another child stays in the same recursive tree instead of becoming a new framed card', () => {
  const rootIssue = { ...snapshot.issues[0], id: 'DEMO-10', uuid: '00000000-0000-4000-8000-000000000010', title: 'Root', url: 'https://linear.example.test/demo-workspace/issue/DEMO-10', relations: [{ type: 'child', issueId: 'DEMO-11' }] };
  const middle = { ...snapshot.issues[0], id: 'DEMO-11', uuid: '00000000-0000-4000-8000-000000000011', title: 'Middle', url: 'https://linear.example.test/demo-workspace/issue/DEMO-11', relations: [{ type: 'parent', issueId: 'DEMO-10' }, { type: 'child', issueId: 'DEMO-12' }] };
  const leaf = { ...snapshot.issues[0], id: 'DEMO-12', uuid: '00000000-0000-4000-8000-000000000012', title: 'Leaf', url: 'https://linear.example.test/demo-workspace/issue/DEMO-12', relations: [{ type: 'parent', issueId: 'DEMO-11' }] };
  const html = renderShelf({ config, snapshot: { ...snapshot, followedIssueIds: ['DEMO-10'], issues: [rootIssue, middle, leaf] }, catalog });
  assert.match(html, /ticket-card ticket-family ticket-child[^>]*>[\s\S]*Middle/);
  assert.equal((html.match(/relationship-symbol-child/g) ?? []).length, 2);
});

test('C11 nested ticket levels use progressive surfaces plus a non-colour tree connector', async () => {
  const css = await readFile(join(root, 'web/styles.css'), 'utf8');
  assert.match(css, /\.ticket-family > \.ticket-heading > \.ticket-thumbnail\s*\{[^}]*border:\s*2px solid #5575b8;[^}]*box-shadow:\s*0 0 0 2px #e3eaff;/s);
  assert.match(css, /\.ticket-family > \.ticket-heading > \.ticket-thumbnail-on-hold\s*\{[^}]*border-color:\s*#b8bbc3;/s);
  assert.match(css, /\.ticket-children\s*\{[^}]*border-left:\s*2px solid #c7d5ea/s);
  assert.match(css, /\.ticket-child\s*\{[^}]*background:\s*#f8fafc/s);
  assert.match(css, /\.ticket-children \.ticket-children > \.ticket-child\s*\{[^}]*background:\s*#f1f5f9/s);
  assert.match(css, /\.ticket-children \.ticket-children \.ticket-children > \.ticket-child\s*\{[^}]*background:\s*#eaf0f7/s);
  assert.match(css, /\.ticket-child::before\s*\{[^}]*border-top:\s*2px solid #c7d5ea/s);
});

test('C11 Current work groups complete ticket families by observed Linear Sprint', () => {
  const sprint = { name: 'Sprint 26.10.S1', startDate: '2026-10-01T00:00:00.000Z', endDate: '2026-10-20T23:59:59.000Z' };
  const first = { ...snapshot.issues[0], id: 'DEMO-10', uuid: '00000000-0000-4000-8000-000000000010', title: 'First sprint item', url: 'https://linear.example.test/demo-workspace/issue/DEMO-10', sprint };
  const second = { ...snapshot.issues[0], id: 'DEMO-11', uuid: '00000000-0000-4000-8000-000000000011', title: 'Second sprint item', url: 'https://linear.example.test/demo-workspace/issue/DEMO-11', sprint };
  const unscheduled = { ...snapshot.issues[0], id: 'DEMO-12', uuid: '00000000-0000-4000-8000-000000000012', title: 'Unscheduled item', url: 'https://linear.example.test/demo-workspace/issue/DEMO-12', sprint: null };
  const html = renderShelf({ config, snapshot: { ...snapshot, generatedAt: '2026-10-09T00:00:00.000Z', issues: [first, second, unscheduled] }, catalog, now: '2026-10-09T00:00:00.000Z' });
  assert.equal((html.match(/This Sprint · Sprint 26\.10\.S1/g) ?? []).length, 1);
  const start = html.indexOf('This Sprint · Sprint 26.10.S1');
  const currentSprint = html.slice(start, html.indexOf('data-fold="sprint:current:none"', start));
  assert.match(currentSprint, /First sprint item/);
  assert.match(currentSprint, /Second sprint item/);
  assert.doesNotMatch(currentSprint, /Unscheduled item/);
  assert.match(html, /Unscheduled item/);
  assert.doesNotMatch(html, /<h3>No Sprint<\/h3>/);
});

test('C11 parent Sprint and assignee remain visible with topic presentation', () => {
  const sprint = { name: 'Sprint 26.10.S1', startDate: '2026-10-01T00:00:00.000Z', endDate: '2026-10-20T23:59:59.000Z' };
  const parent = { ...snapshot.issues[0], id: 'DEMO-20', uuid: '00000000-0000-4000-8000-000000000020', title: 'Sprint parent', url: 'https://linear.example.test/demo-workspace/issue/DEMO-20', sprint, relations: [{ type: 'child', issueId: 'DEMO-21' }] };
  const child = { ...snapshot.issues[0], id: 'DEMO-21', uuid: '00000000-0000-4000-8000-000000000021', title: 'Sprint child', url: 'https://linear.example.test/demo-workspace/issue/DEMO-21', sprint, relations: [{ type: 'parent', issueId: 'DEMO-20' }] };
  const presentation = [parent, child].map(item => ({ issueId: item.id, label: 'Demo', icon: 'ticket', tone: 'blue', description: 'Synthetic' }));
  const html = renderShelf({ config, snapshot: { ...snapshot, issues: [parent, child] }, catalog: { ...catalog, presentation: { ...catalog.presentation, tickets: presentation } } });
  assert.match(html, /class="ticket-ownership"><span[^>]*>Assignee: Demo<\/span><span>· Sprint: Sprint 26\.10\.S1<\/span><\/div>/);
});

test('C11 a parent-child family groups by the parent Sprint, not the child Sprint', () => {
  const one = { name: 'Sprint 26.10.S1', startDate: '2026-10-01T00:00:00.000Z', endDate: '2026-10-20T23:59:59.000Z' };
  const two = { name: 'Sprint 26.10.S2', startDate: '2026-10-21T00:00:00.000Z', endDate: '2026-11-10T23:59:59.000Z' };
  const parent = { ...snapshot.issues[0], id: 'DEMO-20', uuid: '00000000-0000-4000-8000-000000000020', title: 'Mixed parent', url: 'https://linear.example.test/demo-workspace/issue/DEMO-20', sprint: one, relations: [{ type: 'child', issueId: 'DEMO-21' }] };
  const child = { ...snapshot.issues[0], id: 'DEMO-21', uuid: '00000000-0000-4000-8000-000000000021', title: 'Mixed child', url: 'https://linear.example.test/demo-workspace/issue/DEMO-21', sprint: two, relations: [{ type: 'parent', issueId: 'DEMO-20' }] };
  const html = renderShelf({ config, snapshot: { ...snapshot, issues: [parent, child] }, catalog, now: '2026-10-09T00:00:00.000Z' });
  const parentGroup = html.slice(html.indexOf('This Sprint · Sprint 26.10.S1'));
  assert.match(parentGroup, /Mixed parent/);
  assert.match(parentGroup, /Mixed child/);
  assert.doesNotMatch(html, /Multiple Sprints/);

  const unsprinted = renderShelf({ config, snapshot: { ...snapshot, issues: [{ ...parent, sprint: null }, child] }, catalog, now: '2026-10-09T00:00:00.000Z' });
  assert.match(unsprinted, /No Sprint/);
  assert.doesNotMatch(unsprinted, /This Sprint · Sprint 26.10.S2/);
});

test('C11 Slack report uses Ready for Review and In Progress sections with linked nested PRs', () => {
  const second = { ...snapshot.issues[0], id: 'DEMO-2', uuid: '00000000-0000-4000-8000-000000000002', title: 'Archived synthetic issue', url: 'https://linear.example.test/demo-workspace/issue/DEMO-2' };
  const pullRequest = (repository, state) => ({ issueId: 'DEMO-1', repository, number: 42, url: `https://example.test/${repository}/pull/42`, baseBranch: 'main', state, purpose: 'Synthetic delivery', observedAt: snapshot.generatedAt });
  const state = {
    config, snapshot: { ...snapshot, issues: [...snapshot.issues, second] },
    catalog: { ...catalog, pullRequests: [pullRequest('demo/one', 'open'), pullRequest('demo/two', 'open')] },
    overlays: { memos: { 'DEMO-1': 'LOCAL_REPORT_MEMO' }, archived: { 'DEMO-2': true }, prStatus: { 'demo/one#42': 'ready-review', 'demo/two#42': 'closed' } },
  };
  const report = createReport(state);
  const html = createReportHtml(state);
  assert.match(report, /^Ready for Review\n/);
  assert.doesNotMatch(report, /Archived synthetic issue|DEMO-2/);
  assert.doesNotMatch(report, /LOCAL_REPORT_MEMO|demo\/two #42/);
  assert.match(report, /• DEMO-1 — Synthetic example\n  https:\/\/linear\.example\.test\/demo-workspace\/issue\/DEMO-1/);
  assert.match(report, /◦ demo\/one #42 → main — Synthetic delivery\n      https:\/\/example\.test\/demo\/one\/pull\/42/);
  assert.match(html, /<p><strong>Ready for Review<\/strong><\/p><ul>/);
  assert.match(html, /<a href="https:\/\/linear\.example\.test\/demo-workspace\/issue\/DEMO-1"><strong>DEMO-1<\/strong><\/a>/);
  assert.match(html, /<ul><li><a href="https:\/\/example\.test\/demo\/one\/pull\/42"><strong>demo\/one #42<\/strong><\/a> → main/);
  assert.doesNotMatch(html, /&lt;https:|\|DEMO-1/);
});

test('C11 rendering escapes memo and removes unsafe link protocols', () => {
  const state = {
    config, snapshot: { ...snapshot, issues: [{ ...snapshot.issues[0], url: 'javascript:alert(1)' }] }, catalog: null,
    overlays: { memos: { 'DEMO-1': '<script>MEMO_SENTINEL</script>' } },
  };
  const html = renderShelf(state);
  assert.match(html, /&lt;script&gt;MEMO_SENTINEL/);
  assert.doesNotMatch(html, /<script>MEMO_SENTINEL|href=["']javascript:|javascript:alert/);
});

test('C11 every approved shelf link delegates to the local Chrome opener', () => {
  const withPR = { ...catalog, pullRequests: [{ issueId: 'DEMO-1', repository: 'example/one', number: 7, url: 'https://github.com/example/one/pull/7', baseBranch: 'main', state: 'open', purpose: 'Synthetic change', observedAt: snapshot.generatedAt }] };
  const html = renderShelf({ config, snapshot, catalog: withPR, overlays: {}, readOnly: true });
  assert.match(html, new RegExp(`data-open-in-chrome="${snapshot.issues[0].url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  assert.match(html, /data-open-in-chrome="https:\/\/github\.com\/example\/one\/pull\/7"/);
  assert.doesNotMatch(html, /target="_blank"/);
  assert.doesNotMatch(html, /Synthetic change|pr-purpose/);
});

test('C11 branch badges inherit a lighter repository colour treatment', async () => {
  const css = await readFile(join(root, 'web/styles.css'), 'utf8');
  for (const tone of ['blue', 'green', 'gold', 'amber', 'coral', 'red']) assert.match(css, new RegExp(`\\.repo-${tone} \\+ \\.branch-badge`));
});

test('Repository and branch palettes remain canonical without catalog colour entries', () => {
  for (const [slug, label, tone] of [['elite-sales-monorepo', 'Monorepo', 'blue'], ['elite-sales-infrastructure', 'Infra', 'gold'], ['elite-sales-qa-tests', 'QA', 'coral']]) {
    const value = structuredClone(catalogV2);
    value.presentation.repositories = [];
    value.pullRequests[0].repository = `example/${slug}`;
    value.pullRequests[0].url = `https://github.com/example/${slug}/pull/${value.pullRequests[0].number}`;
    const html = renderShelf({ config, snapshot: snapshotV2, catalog: value });
    assert.ok(html.includes(`repo-badge repo-${tone}">${label}</span><span class="branch-badge">`));
  }
});

test('C11 QA repository badges use coral instead of Done-like green', () => {
  const value = structuredClone(catalogV2);
  value.presentation.repositories = [{ repository: 'demo/repository', label: 'QA', tone: 'green' }];
  const html = renderShelf({ config, snapshot: snapshotV2, catalog: value });
  assert.match(html, /repo-badge repo-coral">QA<\/span><span class="branch-badge">main/);
  assert.doesNotMatch(html, /repo-badge repo-green">QA/);
});

test('C11 Infra repository badges use gold distinct from QA coral and Monorepo blue', () => {
  const value = structuredClone(catalogV2);
  value.presentation.repositories = [{ repository: 'demo/repository', label: 'Infra', tone: 'amber' }];
  const html = renderShelf({ config, snapshot: snapshotV2, catalog: value });
  assert.match(html, /repo-badge repo-gold">Infra<\/span><span class="branch-badge">main/);
  assert.doesNotMatch(html, /repo-badge repo-(?:amber|coral|blue)">Infra/);
});

test('C11 PR dropdown keeps a neutral menu and gives every option its own status colour', async () => {
  const css = await readFile(join(root, 'web/styles.css'), 'utf8');
  assert.match(css, /\.pr-status::picker\(select\)[^{]*\{[^}]*background:\s*var\(--surface\)/s);
  for (const value of ['open', 'ready-review', 'merged', 'closed']) {
    assert.match(css, new RegExp(`\\.pr-status option\\[value="${value}"\\]`));
    assert.doesNotMatch(css, new RegExp(`\\.pr-status option\\[value="${value}"\\][^{]*\\{[^}]*background:`));
  }
  assert.match(css, /\.pr-status option::before[^}]*border-radius:\s*50%/s);
  assert.match(css, /\.pr-status option:hover[^}]*background:\s*#f4f6f8/s);
});

test('C11 ticket status is read-only Linear evidence and precedes the local Memo', async () => {
  const html = renderShelf({ config, snapshot, catalog, overlays: { ticketStatus: { 'DEMO-1': 'on-hold' } }, readOnly: false });
  assert.match(html, /status-pill status-started[^>]*title="Read-only Linear status"[^>]*>In Progress/);
  assert.doesNotMatch(html, /data-ticket-status|ticket-status-|<select[^>]*ticket-status/);
  assert.ok(html.indexOf('Read-only Linear status') < html.indexOf('<span class="memo-label">Memo<\/span>'));
  assert.ok(html.indexOf('<span class="memo-label">Memo<\/span>') < html.indexOf('data-memo="DEMO-1"'));
  const report = createReport({ config, snapshot, catalog, overlays: { ticketStatus: { 'DEMO-1': 'on-hold' } } });
  assert.match(report, /\nIn Progress(?:\n|$)/);
  assert.doesNotMatch(report, /\nOn Hold(?:\n|$)/);
  const css = await readFile(join(root, 'web/styles.css'), 'utf8');
  assert.match(css, /\.status-pill\.status-started/);
});

test('C11 EQA remains Current work but has its own pink Linear-status treatment', async () => {
  const value = structuredClone(snapshot);
  value.issues[0].status = { name: 'EQA', type: 'started' };
  const html = renderShelf({ config, snapshot: value, catalog });
  assert.match(html, /<details class="focus-group focus-group-current" data-fold="group:current" open><summary><span>⚡<\/span>Current work<\/summary>/);
  assert.match(html, /status-mark status-eqa[^>]*title="Observed Linear status: EQA"/);
  assert.match(html, /status-pill status-eqa[^>]*>EQA<\/span>/);
  const css = await readFile(join(root, 'web/styles.css'), 'utf8');
  assert.match(css, /\.status-eqa[^}]*var\(--pink\)/s);
  assert.match(css, /\.status-pill\.status-eqa[^}]*var\(--pink-bg\)/s);
});

test('C11 only On Hold mutes the topic thumbnail', async () => {
  const presentation = { ...catalog.presentation, tickets: [{ issueId: 'DEMO-1', label: 'GWS', icon: 'test-harness', tone: 'blue', description: 'Synthetic GWS topic' }] };
  const renderStatus = (name, type = 'backlog') => renderShelf({
    config,
    snapshot: { ...snapshot, issues: [{ ...snapshot.issues[0], status: { name, type } }] },
    catalog: { ...catalog, presentation },
  });
  assert.match(renderStatus('On Hold'), /ticket-thumbnail ticket-thumbnail-blue ticket-thumbnail-on-hold/);
  assert.doesNotMatch(renderStatus('Backlog'), /ticket-thumbnail-on-hold/);
  assert.doesNotMatch(renderStatus('In Progress', 'started'), /ticket-thumbnail-on-hold/);
  const css = await readFile(join(root, 'web/styles.css'), 'utf8');
  assert.match(css, /\.ticket-thumbnail-on-hold\s*\{[^}]*background:\s*#f1f2f4/s);
  assert.match(css, /\.ticket-thumbnail-on-hold \.ticket-thumbnail-icon\s*\{[^}]*filter:\s*grayscale\(1\)/s);
});

test('C11 topic illustrations use trusted SVG geometry and fall back without rendering emoji', () => {
  assert.match(renderTicketIcon('chat-error'), /^<svg[^>]*ticket-topic-icon/);
  assert.match(renderTicketIcon('unknown'), /<svg[^>]*ticket-topic-icon/);
  assert.doesNotMatch(renderTicketIcon('unknown'), /●|💬|🚀/);
  const generated = renderTicketIcon({ version: 1, paths: [{ d: 'M8 8H56V56H8Z', role: 'fill' }, { d: 'M8 8H56V56H8Z', role: 'stroke', strokeWidth: 4 }] });
  assert.match(generated, /viewBox="0 0 64 64"/);
  assert.match(generated, /ticket-topic-icon-generated/);
  assert.doesNotMatch(renderTicketIcon({ version: 1, paths: [{ d: 'M8 8" onload="alert\(1\)', role: 'stroke' }] }), /onload|alert/);
});

test('C11 GitHub terminal PR state overrides an older local review selection', () => {
  const pr = { repository: 'demo/repository', number: 42, state: 'merged' };
  const overlays = { prStatus: { 'demo/repository#42': 'ready-review' } };
  assert.equal(displayedPRState(pr, overlays), 'merged');
  assert.equal(displayedPRState({ ...pr, state: 'open' }, overlays), 'ready-review');
  const value = structuredClone(catalogV2);
  value.pullRequests[0].state = 'merged';
  const html = renderShelf({ config, snapshot: snapshotV2, catalog: value, overlays });
  assert.match(html, /pr-status-merged[^>]*disabled/);
  assert.doesNotMatch(html, /pr-status-ready-review/);
  assert.doesNotMatch(createReport({ snapshot: snapshotV2, catalog: value, overlays }), /repository #42|demo\/repository#42/);
});

test('C11 manual Merged survives a later Open observation with an explicit GitHub warning', () => {
  const value = structuredClone(catalogV2);
  value.pullRequests[0].observedAt = '2026-10-10T00:00:00.000Z';
  const overlays = { prStatus: { 'demo/repository#42': { status: 'merged', observedAt: '2026-10-09T00:00:00.000Z' } } };
  assert.equal(displayedPRState(value.pullRequests[0], overlays, value), 'merged');
  const html = renderShelf({ config, snapshot: snapshotV2, catalog: value, overlays });
  assert.match(html, /pr-status-merged/);
  assert.match(html, /Not merged on GitHub/);
  value.pullRequests[0].state = 'merged';
  assert.doesNotMatch(renderShelf({ config, snapshot: snapshotV2, catalog: value, overlays }), /Not merged on GitHub/);
});

test('C11 production browser code uses local API and no Chrome/external service primitives', async () => {
  const source = await readFile(join(root, 'web/app.mjs'), 'utf8');
  assert.match(source, /\/api\/shelf/);
  assert.doesNotMatch(source, /chrome\.|api\.linear\.app|api\.github\.com|sendMessage\s*\(/);
});

test('C12 concise README shows architecture and Quick Start; thin Skill defines refresh', async () => {
  const readme = await readFile(join(root, 'README.md'), 'utf8');
  const skill = await readFile(join(root, 'skills/focus-shelf/SKILL.md'), 'utf8');
  assert.match(readme, /## Architecture[\s\S]*```mermaid/);
  assert.match(readme, /## Quick Start/);
  assert.match(readme, /FOCUS_SHELF_HOME/);
  assert.match(readme, /npm start/);
  assert.match(readme, /authorized Linear access/i);
  assert.match(readme, /archive\.json/i);
  assert.match(skill, /FOCUS_SHELF_HOME/);
  assert.match(skill, /localhost:8770/);
  assert.match(skill, /authoriz/i);
  assert.match(skill, /manual/i);
  assert.match(skill, /resolved local data home/i);
});

test('C12 bundled Skill specifies connector capabilities and safe refresh requirements', async () => {
  const readme = await readFile(join(root, 'README.md'), 'utf8');
  const skill = await readFile(join(root, 'skills/focus-shelf/SKILL.md'), 'utf8');
  assert.match(readme, /Linear/);
  assert.match(readme, /GitHub/);
  assert.match(readme, /does not connect to Linear or GitHub/);
  assert.match(skill, /Linear connector\/MCP/);
  assert.match(skill, /assigned[\s\S]*created[\s\S]*prior created and followed[\s\S]*relations[\s\S]*Sprint/);
  assert.match(skill, /GitHub connector\/MCP[\s\S]*logged-in CLI/);
  assert.match(skill, /verified associated PR[\s\S]*complete checks\/status/);
  assert.match(skill, /credentials[\s\S]*config/i);
  assert.match(skill, /preserve[\s\S]*previous|preserve[\s\S]*existing/i);
});

test('C02/C12 read-only --list emits the exact publication file list without excluded state', async () => {
  const result = spawnSync(process.execPath, ['scripts/validate-shareable.mjs', '--list'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0);
  const files = JSON.parse(result.stdout);
  assert.ok(Array.isArray(files));
  assert.equal(files.length, 36);
  assert.deepEqual(files, [...files].sort());
  assert.equal(new Set(files).size, files.length);
  for (const file of files) {
    assert.doesNotMatch(file, /^(?:work|\.git|\.code-review-graph|\.focus-shelf|node_modules)\//);
    assert.ok(!['config.json', 'linear-latest.json', 'catalog.json', 'local-only.json'].includes(file));
    await readFile(join(root, file));
  }
  for (const required of ['README.md', 'CODEX_SNAPSHOT.md', 'web/icons/relation-child.svg', 'lib/archive.mjs', 'lib/shareability.mjs', 'scripts/write-codex-catalog.mjs', 'scripts/validate-shareable.mjs', 'skills/focus-shelf/SKILL.md', 'skills/generate-focus-shelf-icon/SKILL.md', 'test/archive.test.mjs', 'test/snapshot-v2.test.mjs']) assert.ok(files.includes(required));
});

test('C02 shareable publication tree contains no private identifiers or data payloads', async () => {
  const violations = [];
  async function scan(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (['.git', '.code-review-graph', '.focus-shelf', 'work', 'node_modules'].includes(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await scan(path);
      else {
        const content = await readFile(path, 'utf8');
        // Only generic synthetic pollution markers belong in the shared test.
        for (const forbidden of ['SYNTHETIC_' + 'PUBLICATION_POLLUTION']) {
          if (content.toLowerCase().includes(forbidden.toLowerCase())) violations.push(path);
        }
        assert.ok(!['config.json', 'linear-latest.json', 'catalog.json', 'local-only.json'].includes(entry.name), `external user data in publication tree: ${path}`);
      }
    }
  }
  await scan(root);
  assert.deepEqual(violations, []);
});
