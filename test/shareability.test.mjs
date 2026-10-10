import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { renderShelf, createReport, createReportHtml, createUpdateRequest, formatAssigneeName, formatDriName, renderTicketIcon, displayedPRState } from '../web/app.mjs';
import { config, snapshot, catalog, dri, snapshotV2, catalogV2 } from './helpers.mjs';

const root = new URL('..', import.meta.url).pathname;

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

test('C11 verified workstream displays First and Second DRI separately from assignee', () => {
  const state = {
    config, snapshot, dri,
    catalog: { ...catalog, presentation: { ...catalog.presentation, tickets: [{ issueId: 'DEMO-1', label: 'Demo', icon: 'ticket', tone: 'blue', description: 'Synthetic', workstream: 'Synthetic Workstream' }] } },
  };
  const html = renderShelf(state);
  assert.match(html, /class="dri-primary"><strong>First DRI:<\/strong> First/);
  assert.match(html, /class="dri-secondary"><strong>Second DRI:<\/strong> Second/);
  assert.doesNotMatch(html, /Assignee: Demo User/);
  const report = createReport(state);
  assert.match(report, /In Progress\n• DEMO-1 — Synthetic example/);
  assert.doesNotMatch(report, /First DRI|Second DRI|Assignee/);
});

test('C11 Second DRI is visually quieter than the primary owner', async () => {
  const css = await readFile(join(root, 'web/styles.css'), 'utf8');
  assert.match(css, /\.dri-secondary\s*\{[^}]*color:\s*#9296a1/s);
  assert.match(css, /\.dri-secondary strong\s*\{[^}]*color:\s*#7f8490/s);
});

test('C11 assignee display prefers the English name and omits the Japanese duplicate', () => {
  assert.equal(formatAssigneeName('- Alex Example - アレックス エグザンプル'), 'Alex');
  assert.equal(formatAssigneeName('例野 太郎 - Casey Example -'), 'Casey');
  assert.equal(formatAssigneeName('Morgan Example Long Synthetic Name'), 'Morgan');
  assert.equal(formatAssigneeName('例野 太郎'), '例野 太郎');
});

test('C11 DRI display names keep only the first English name or the leading Kanji name', () => {
  assert.equal(formatDriName('Taylor Example (例(れい))'), 'Taylor');
  assert.equal(formatDriName('ジェイミー エグザンプル- Jamie Example -'), 'Jamie');
  assert.equal(formatDriName('ロビン - Robin'), 'Robin');
  assert.equal(formatDriName('例野 花子- Avery Example -'), '例野 花子');
  assert.equal(formatDriName(null), 'Unassigned');
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
  assert.match(html, /<span>tasks<\/span>/);
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
  assert.match(request, /issues I created and later reassigned/);
  assert.match(request, /exact associated PRs/);
  assert.match(request, /Preserve browser-local Memo, Archive/);
  assert.match(request, /Release target policy failure as an attention warning/);
  assert.match(request, /reload the live Focus Shelf page and verify the rendered results/);
  assert.doesNotMatch(html, /Update complete|Synchronized|Synced/);
});

test('C11 archived tickets move into the collapsed Archive section without hiding active children', () => {
  const parent = { ...snapshot.issues[0], id: 'DEMO-10', uuid: '00000000-0000-4000-8000-000000000010', title: 'Synthetic parent', url: 'https://linear.example.test/demo-workspace/issue/DEMO-10', relations: [{ type: 'child', issueId: 'DEMO-11' }] };
  const child = { ...snapshot.issues[0], id: 'DEMO-11', uuid: '00000000-0000-4000-8000-000000000011', title: 'Synthetic child', url: 'https://linear.example.test/demo-workspace/issue/DEMO-11', relations: [{ type: 'parent', issueId: 'DEMO-10' }] };
  const state = { config, snapshot: { ...snapshot, followedIssueIds: ['DEMO-10', 'DEMO-11'], issues: [parent, child] }, catalog, overlays: { archived: { 'DEMO-10': true } } };
  const html = renderShelf(state);
  const current = html.slice(0, html.indexOf('<details id="archive-section"'));
  const archive = html.slice(html.indexOf('<details id="archive-section"'));
  assert.doesNotMatch(current, /Synthetic parent/);
  assert.match(current, /Synthetic child/);
  assert.match(archive, /Archive · 1/);
  assert.match(archive, /Synthetic parent/);
  assert.match(archive, />Restore</);
});

test('C11 restoring a completed ticket opens its destination group instead of making it appear lost', () => {
  const done = { ...snapshot.issues[0], status: { name: 'Done', type: 'completed' } };
  const restored = renderShelf({ config, snapshot: { ...snapshot, issues: [done] }, catalog, overlays: { archived: { 'DEMO-1': false } }, revealIssueId: 'DEMO-1' });
  assert.match(restored, /<details class="focus-group focus-group-completed" data-fold="group:completed" open>/);
  assert.match(restored, /DEMO-1/);
  assert.match(restored, /data-archive="DEMO-1"[^>]*>Archive<\/button>/);
});

test('C11 a completed Linear ticket stays in Current work while an associated PR remains active', () => {
  const done = { ...snapshot.issues[0], status: { name: 'Done', type: 'completed' } };
  const activeCatalog = {
    ...catalog,
    pullRequests: [{ ...catalogV2.pullRequests[0], issueId: done.id, state: 'open' }],
  };
  const html = renderShelf({ config, snapshot: { ...snapshot, issues: [done] }, catalog: activeCatalog });
  assert.match(html, /<section class="focus-group focus-group-current">[^]*DEMO-1/);
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

test('C11 other-owner ticket PRs are not shown as profile-owned work', () => {
  const contextIssue = { ...snapshot.issues[0], id: 'DEMO-2', uuid: '00000000-0000-4000-8000-000000000002', title: 'Other owner context', url: 'https://linear.example.test/demo-workspace/issue/DEMO-2', assignee: { id: 'other-owner', name: 'Other Owner' } };
  const state = {
    config,
    snapshot: { ...snapshot, followedIssueIds: ['DEMO-1', 'DEMO-2'], issues: [snapshot.issues[0], contextIssue] },
    catalog: { ...catalog, pullRequests: [{ issueId: 'DEMO-2', repository: 'demo/other', number: 7, url: 'https://github.com/demo/other/pull/7', baseBranch: 'main', state: 'open', purpose: 'Context-only change', observedAt: snapshot.generatedAt }] },
  };
  const html = renderShelf(state);
  assert.doesNotMatch(html, /PR #7|demo\/other#7|Related PRs/);
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
  assert.match(report, /In Progress\n• DEMO-1/);
});

test('C11 a created unassigned ticket has only the Unassigned ownership label', () => {
  const value = { ...snapshot, createdIssueIds: ['DEMO-1'], issues: [{ ...snapshot.issues[0], assignee: null }] };
  const html = renderShelf({ config, snapshot: value, catalog: null });
  assert.match(html, /ticket-ownership"><span>Unassigned<\/span>/);
  assert.doesNotMatch(html, /ownership-created|ownership-arrow|Assigned to Unassigned/);
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

test('C11 an active child keeps a completed parent family in Current work', () => {
  const parent = { ...snapshot.issues[0], id: 'DEMO-10', uuid: '00000000-0000-4000-8000-000000000010', title: 'Completed context parent', url: 'https://linear.example.test/demo-workspace/issue/DEMO-10', status: { name: 'Done', type: 'completed' }, relations: [{ type: 'child', issueId: 'DEMO-11' }] };
  const child = { ...snapshot.issues[0], id: 'DEMO-11', uuid: '00000000-0000-4000-8000-000000000011', title: 'Active assigned child', url: 'https://linear.example.test/demo-workspace/issue/DEMO-11', status: { name: 'In Progress', type: 'started' }, relations: [{ type: 'parent', issueId: 'DEMO-10' }] };
  const html = renderShelf({ config, snapshot: { ...snapshot, followedIssueIds: ['DEMO-10'], issues: [parent, child] }, catalog });
  const current = html.slice(html.indexOf('Current work'), html.indexOf('<details id="archive-section"'));
  assert.match(current, /Completed context parent/);
  assert.match(current, /Active assigned child/);
  assert.doesNotMatch(html, /<h2><span>✓<\/span>Completed<\/h2>/);
});

test('C11 another owner context child cannot promote completed profile work into Current work', () => {
  const parent = { ...snapshot.issues[0], id: 'DEMO-10', uuid: '00000000-0000-4000-8000-000000000010', title: 'Completed profile work', url: 'https://linear.example.test/demo-workspace/issue/DEMO-10', status: { name: 'Done', type: 'completed' }, relations: [{ type: 'child', issueId: 'DEMO-11' }] };
  const delegated = { ...snapshot.issues[0], id: 'DEMO-11', uuid: '00000000-0000-4000-8000-000000000011', title: 'Other owner active context', url: 'https://linear.example.test/demo-workspace/issue/DEMO-11', status: { name: 'In Progress', type: 'started' }, assignee: { id: 'other-owner', name: 'Other Owner' }, relations: [{ type: 'parent', issueId: 'DEMO-10' }] };
  const value = { ...snapshot, schemaVersion: 2, scope: 'assigned-followed-context', followedIssueIds: [], issues: [parent, delegated] };
  const html = renderShelf({ config, snapshot: value, catalog: null });
  const current = html.slice(html.indexOf('Current work'), html.indexOf('<details class="focus-group focus-group-completed" data-fold="group:completed">'));
  const completed = html.slice(html.indexOf('<details class="focus-group focus-group-completed" data-fold="group:completed">'));
  assert.doesNotMatch(current, /Completed profile work|Other owner active context/);
  assert.match(completed, /Completed profile work/);
  assert.match(completed, /Other owner active context/);
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
  const html = renderShelf({ config, snapshot: { ...snapshot, generatedAt: '2026-10-09T00:00:00.000Z', issues: [first, second, unscheduled] }, catalog });
  assert.equal((html.match(/This Sprint · Sprint 26\.10\.S1/g) ?? []).length, 1);
  const start = html.indexOf('This Sprint · Sprint 26.10.S1');
  const currentSprint = html.slice(start, html.indexOf('</section>', start));
  assert.match(currentSprint, /First sprint item/);
  assert.match(currentSprint, /Second sprint item/);
  assert.doesNotMatch(currentSprint, /Unscheduled item/);
  assert.match(html, /Unscheduled item/);
  assert.doesNotMatch(html, /<h3>No Sprint<\/h3>/);
});

test('C11 parent DRI row shows one compact Sprint badge after Second DRI', () => {
  const sprint = { name: 'Sprint 26.10.S1', startDate: '2026-10-01T00:00:00.000Z', endDate: '2026-10-20T23:59:59.000Z' };
  const parent = { ...snapshot.issues[0], id: 'DEMO-20', uuid: '00000000-0000-4000-8000-000000000020', title: 'Sprint parent', url: 'https://linear.example.test/demo-workspace/issue/DEMO-20', sprint, relations: [{ type: 'child', issueId: 'DEMO-21' }] };
  const child = { ...snapshot.issues[0], id: 'DEMO-21', uuid: '00000000-0000-4000-8000-000000000021', title: 'Sprint child', url: 'https://linear.example.test/demo-workspace/issue/DEMO-21', sprint, relations: [{ type: 'parent', issueId: 'DEMO-20' }] };
  const presentation = [parent, child].map(item => ({ issueId: item.id, label: 'Demo', icon: 'ticket', tone: 'blue', description: 'Synthetic', workstream: 'Synthetic Workstream' }));
  const html = renderShelf({ config, snapshot: { ...snapshot, issues: [parent, child] }, catalog: { ...catalog, presentation: { ...catalog.presentation, tickets: presentation } }, dri });
  assert.equal((html.match(/class="sprint-badge"/g) ?? []).length, 1);
  assert.match(html, /class="dri-secondary"><strong>Second DRI:<\/strong> Second<\/span><span class="sprint-badge"[^>]*>Sprint 26\.10\.S1<\/span>/);
});

test('C11 a parent-child family stays intact and reports mixed Sprint membership instead of splitting children', () => {
  const one = { name: 'Sprint 26.10.S1', startDate: '2026-10-01T00:00:00.000Z', endDate: '2026-10-20T23:59:59.000Z' };
  const two = { name: 'Sprint 26.10.S2', startDate: '2026-10-21T00:00:00.000Z', endDate: '2026-11-10T23:59:59.000Z' };
  const parent = { ...snapshot.issues[0], id: 'DEMO-20', uuid: '00000000-0000-4000-8000-000000000020', title: 'Mixed parent', url: 'https://linear.example.test/demo-workspace/issue/DEMO-20', sprint: one, relations: [{ type: 'child', issueId: 'DEMO-21' }] };
  const child = { ...snapshot.issues[0], id: 'DEMO-21', uuid: '00000000-0000-4000-8000-000000000021', title: 'Mixed child', url: 'https://linear.example.test/demo-workspace/issue/DEMO-21', sprint: two, relations: [{ type: 'parent', issueId: 'DEMO-20' }] };
  const html = renderShelf({ config, snapshot: { ...snapshot, issues: [parent, child] }, catalog });
  const mixed = html.slice(html.indexOf('Multiple Sprints'));
  assert.match(mixed, /Mixed parent/);
  assert.match(mixed, /Mixed child/);
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
  const html = renderShelf({ config, snapshot, catalog: withPR, dri, overlays: {}, readOnly: true });
  assert.match(html, new RegExp(`data-open-in-chrome="${snapshot.issues[0].url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  assert.match(html, /data-open-in-chrome="https:\/\/github\.com\/example\/one\/pull\/7"/);
  assert.doesNotMatch(html, /target="_blank"/);
  assert.doesNotMatch(html, /Synthetic change|pr-purpose/);
});

test('C11 branch badges inherit a lighter repository colour treatment', async () => {
  const css = await readFile(join(root, 'web/styles.css'), 'utf8');
  for (const tone of ['blue', 'green', 'gold', 'amber', 'coral', 'red']) assert.match(css, new RegExp(`\\.repo-${tone} \\+ \\.branch-badge`));
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
  assert.match(html, /<h2><span>⚡<\/span>Current work<\/h2>/);
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

test('C11 production browser code uses local API and no Chrome/external service primitives', async () => {
  const source = await readFile(join(root, 'web/app.mjs'), 'utf8');
  assert.match(source, /\/api\/shelf/);
  assert.doesNotMatch(source, /chrome\.|api\.linear\.app|api\.github\.com|sendMessage\s*\(/);
});

test('C12 README and thin Skill explain exact local setup and explicit authorized manual refresh', async () => {
  const readme = await readFile(join(root, 'README.md'), 'utf8');
  const skill = await readFile(join(root, 'skills/focus-shelf/SKILL.md'), 'utf8');
  for (const text of [readme, skill]) {
    assert.match(text, /FOCUS_SHELF_HOME/);
    assert.match(text, /localhost:8770/);
    assert.match(text, /authoriz/i);
    assert.match(text, /manual/i);
    assert.match(text, /browser.local|browser local/i);
  }
  assert.match(readme, /npm start/);
  assert.match(readme, /EADDRINUSE/);
});

test('C12 docs specify authorized connector capabilities and separate demo from real first refresh', async () => {
  const readme = await readFile(join(root, 'README.md'), 'utf8');
  const skill = await readFile(join(root, 'skills/focus-shelf/SKILL.md'), 'utf8');
  for (const content of [readme, skill]) {
    assert.match(content, /Linear connector\/MCP/);
    assert.match(content, /assigned[\s\S]*created[\s\S]*prior created and followed[\s\S]*relations[\s\S]*Sprint/);
    assert.match(content, /GitHub connector\/MCP[\s\S]*logged-in CLI/);
    assert.match(content, /verified associated PR[\s\S]*complete checks\/status/);
    assert.match(content, /credentials[\s\S]*config/i);
    assert.match(content, /preserve[\s\S]*previous|preserve[\s\S]*existing/i);
  }
  assert.match(readme, /Demo home/);
  assert.match(readme, /Real home/);
  assert.match(readme, /only[\s\S]*config\.json/i);
  assert.match(readme, /Do not copy[\s\S]*demo snapshot[\s\S]*catalog/i);
  assert.match(readme, /first refresh/i);
  assert.match(readme, /Update[\s\S]*cop(?:y|ies)[\s\S]*Codex/i);
  assert.match(readme, /node scripts\/validate-shareable\.mjs --list/);
});

test('C02/C12 read-only --list emits the exact publication file list without excluded state', async () => {
  const result = spawnSync(process.execPath, ['scripts/validate-shareable.mjs', '--list'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0);
  const files = JSON.parse(result.stdout);
  assert.ok(Array.isArray(files));
  assert.equal(files.length, 33);
  assert.deepEqual(files, [...files].sort());
  assert.equal(new Set(files).size, files.length);
  for (const file of files) {
    assert.doesNotMatch(file, /^(?:work|\.git|node_modules)\//);
    assert.ok(!['config.json', 'linear-latest.json', 'catalog.json'].includes(file));
    await readFile(join(root, file));
  }
  for (const required of ['README.md', 'CODEX_SNAPSHOT.md', 'web/icons/relation-child.svg', 'lib/dri.mjs', 'lib/shareability.mjs', 'scripts/write-codex-catalog.mjs', 'scripts/validate-shareable.mjs', 'skills/focus-shelf/SKILL.md', 'skills/generate-focus-shelf-icon/SKILL.md', 'examples/dri.example.json', 'test/snapshot-v2.test.mjs']) assert.ok(files.includes(required));
});

test('C02 shareable publication tree contains no private identifiers or data payloads', async () => {
  const violations = [];
  async function scan(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (['.git', 'work', 'node_modules'].includes(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await scan(path);
      else {
        const content = await readFile(path, 'utf8');
        // Only generic synthetic pollution markers belong in the shared test.
        for (const forbidden of ['SYNTHETIC_' + 'PUBLICATION_POLLUTION']) {
          if (content.toLowerCase().includes(forbidden.toLowerCase())) violations.push(path);
        }
        assert.ok(!['config.json', 'linear-latest.json', 'catalog.json', 'dri.json'].includes(entry.name), `external user data in publication tree: ${path}`);
      }
    }
  }
  await scan(root);
  assert.deepEqual(violations, []);
});
