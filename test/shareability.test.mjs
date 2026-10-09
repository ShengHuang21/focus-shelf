import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { renderShelf, createReport } from '../web/app.mjs';
import { config, snapshot, catalog } from './helpers.mjs';

const root = new URL('..', import.meta.url).pathname;

test('C11 rendering treats supplied titles and memo as text; report remains local', () => {
  const unsafe = { ...snapshot, issues: [{ ...snapshot.issues[0], title: '<img src=x onerror=alert(1)>' }] };
  const html = renderShelf({ config, snapshot: unsafe, catalog: null });
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img src=x/);
  const report = createReport({ config, snapshot, catalog: null, overlays: { memos: { 'DEMO-1': '<script>bad</script>' } } });
  assert.equal(typeof report, 'string');
  assert.match(report, /DEMO-1/);
});

test('C11 shared UI uses the canonical Focus Shelf hierarchy and compact visual frame', () => {
  const parent = { ...snapshot.issues[0], id: 'DEMO-10', uuid: '00000000-0000-4000-8000-000000000010', title: 'Synthetic user report', url: 'https://linear.example.test/demo-workspace/issue/DEMO-10', relations: [{ type: 'child', issueId: 'DEMO-11' }] };
  const child = { ...snapshot.issues[0], id: 'DEMO-11', uuid: '00000000-0000-4000-8000-000000000011', title: 'Synthetic engineering work', url: 'https://linear.example.test/demo-workspace/issue/DEMO-11', relations: [{ type: 'parent', issueId: 'DEMO-10' }] };
  const state = {
    config,
    snapshot: { ...snapshot, followedIssueIds: ['DEMO-10', 'DEMO-11'], issues: [parent, child] },
    catalog: { ...catalog, presentation: { ...catalog.presentation, tickets: [{ issueId: 'DEMO-11', label: 'Chat Recovery', glyph: '↻', tone: 'blue', description: 'Synthetic recovery topic illustration' }] } },
  };
  const html = renderShelf(state);
  assert.match(html, /Codex snapshot/);
  assert.match(html, /focus-group/);
  assert.match(html, /Handled by/);
  assert.match(html, /ticket-thumbnail/);
  assert.match(html, /status-pill/);
  assert.match(html, /Archive · 0/);
  assert.doesNotMatch(html, /Saved webpages|LOCAL WORKSPACE|Show archived/);
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

test('C11 an active child keeps a completed parent family in Current work', () => {
  const parent = { ...snapshot.issues[0], id: 'DEMO-10', uuid: '00000000-0000-4000-8000-000000000010', title: 'Completed context parent', url: 'https://linear.example.test/demo-workspace/issue/DEMO-10', status: { name: 'Done', type: 'completed' }, relations: [{ type: 'child', issueId: 'DEMO-11' }] };
  const child = { ...snapshot.issues[0], id: 'DEMO-11', uuid: '00000000-0000-4000-8000-000000000011', title: 'Active assigned child', url: 'https://linear.example.test/demo-workspace/issue/DEMO-11', status: { name: 'In Progress', type: 'started' }, relations: [{ type: 'parent', issueId: 'DEMO-10' }] };
  const html = renderShelf({ config, snapshot: { ...snapshot, followedIssueIds: ['DEMO-10'], issues: [parent, child] }, catalog });
  const current = html.slice(html.indexOf('Current work'), html.indexOf('<details id="archive-section"'));
  assert.match(current, /Completed context parent/);
  assert.match(current, /Active assigned child/);
  assert.doesNotMatch(html, /<h2><span>✓<\/span>Completed<\/h2>/);
});

test('C11 report uses memo, archive and repository-qualified manual PR state', () => {
  const second = { ...snapshot.issues[0], id: 'DEMO-2', uuid: '00000000-0000-4000-8000-000000000002', title: 'Archived synthetic issue', url: 'https://linear.example.test/demo-workspace/issue/DEMO-2' };
  const pullRequest = (repository, state) => ({ issueId: 'DEMO-1', repository, number: 42, url: `https://example.test/${repository}/pull/42`, baseBranch: 'main', state, purpose: 'Synthetic delivery', observedAt: snapshot.generatedAt });
  const state = {
    config, snapshot: { ...snapshot, issues: [...snapshot.issues, second] },
    catalog: { ...catalog, pullRequests: [pullRequest('demo/one', 'open'), pullRequest('demo/two', 'open')] },
    overlays: { memos: { 'DEMO-1': 'LOCAL_REPORT_MEMO' }, archived: { 'DEMO-2': true }, prStatus: { 'demo/one#42': 'merged', 'demo/two#42': 'closed' } },
  };
  const report = createReport(state);
  assert.match(report, /LOCAL_REPORT_MEMO/);
  assert.doesNotMatch(report, /Archived synthetic issue|DEMO-2/);
  assert.match(report, /demo\/one#42[^\n]*merged/);
  assert.match(report, /demo\/two#42[^\n]*closed/);
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
    assert.match(content, /assigned[\s\S]*prior followed[\s\S]*relations[\s\S]*Sprint/);
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
  assert.match(readme, /node scripts\/validate-shareable\.mjs --list/);
});

test('C02/C12 read-only --list emits the exact publication file list without excluded state', async () => {
  const result = spawnSync(process.execPath, ['scripts/validate-shareable.mjs', '--list'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0);
  const files = JSON.parse(result.stdout);
  assert.ok(Array.isArray(files));
  assert.equal(files.length, 27);
  assert.deepEqual(files, [...files].sort());
  assert.equal(new Set(files).size, files.length);
  for (const file of files) {
    assert.doesNotMatch(file, /^(?:work|\.git|node_modules)\//);
    assert.ok(!['config.json', 'linear-latest.json', 'catalog.json'].includes(file));
    await readFile(join(root, file));
  }
  for (const required of ['README.md', 'CODEX_SNAPSHOT.md', 'lib/shareability.mjs', 'scripts/validate-shareable.mjs', 'skills/focus-shelf/SKILL.md']) assert.ok(files.includes(required));
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
        assert.ok(!['config.json', 'linear-latest.json', 'catalog.json'].includes(entry.name), `external user data in publication tree: ${path}`);
      }
    }
  }
  await scan(root);
  assert.deepEqual(violations, []);
});
