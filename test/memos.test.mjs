import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, lstat, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startServer } from '../server.mjs';
import { config, temporaryHome } from './helpers.mjs';

async function fixture(t) {
  const home = await temporaryHome(t);
  await writeFile(join(home, 'config.json'), JSON.stringify(config));
  const server = await startServer({ home, port: 0 });
  t.after(() => server.close());
  const put = (id, value, expectedRevision, origin = server.origin) => fetch(`${server.origin}/api/memos`, {
    method: 'PUT', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, value, expectedRevision }),
  });
  return { home, server, put };
}

test('Memo is saved in the external home and read back by another browser session', async t => {
  const { home, server, put } = await fixture(t);
  assert.deepEqual(await (await fetch(`${server.origin}/api/memos`)).json(), { revision: 0, memos: {} });
  const saved = await put('DEMO-1', '一句中文 Memo', 0);
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { revision: 1, memos: { 'DEMO-1': '一句中文 Memo' } });
  const anotherSession = await fetch(`${server.origin}/api/memos`, { cache: 'no-store' });
  assert.deepEqual(await anotherSession.json(), { revision: 1, memos: { 'DEMO-1': '一句中文 Memo' } });
  const secondServer = await startServer({ home, port: 0 });
  t.after(() => secondServer.close());
  assert.deepEqual(await (await fetch(`${secondServer.origin}/api/memos`)).json(), { revision: 1, memos: { 'DEMO-1': '一句中文 Memo' } });
  const file = JSON.parse(await readFile(join(home, 'memos.json'), 'utf8'));
  assert.deepEqual(file.memos, { 'DEMO-1': '一句中文 Memo' });
  assert.equal((await lstat(join(home, 'memos.json'))).mode & 0o777, 0o600);
});

test('Memo writes reject stale revisions, foreign origins and invalid content without losing saved text', async t => {
  const { home, server, put } = await fixture(t);
  assert.equal((await put('DEMO-1', 'first', 0)).status, 200);
  const attempts = await Promise.all([put('DEMO-1', 'second', 1), put('DEMO-1', 'third', 1)]);
  assert.deepEqual(attempts.map(response => response.status).sort(), [200, 409]);
  assert.equal((await put('DEMO-1', 'stale', 1)).status, 409);
  assert.equal((await put('DEMO-1', 'foreign', 2, 'https://attacker.example')).status, 403);
  assert.equal((await put('../bad', 'invalid', 2)).status, 400);
  assert.equal((await put('DEMO-1', 'x'.repeat(10001), 2)).status, 400);
  const state = await (await fetch(`${server.origin}/api/memos`)).json();
  assert.ok(['second', 'third'].includes(state.memos['DEMO-1']));
  assert.equal(JSON.parse(await readFile(join(home, 'memos.json'), 'utf8')).revision, state.revision);
});

test('Memo file identity mismatch or symlink is never served or overwritten', async t => {
  const { home, server, put } = await fixture(t);
  const path = join(home, 'memos.json');
  await writeFile(path, JSON.stringify({ schemaVersion: 1, namespace: 'other profile', revision: 1, memos: { 'DEMO-1': 'PRIVATE_SENTINEL' } }));
  const response = await fetch(`${server.origin}/api/memos`);
  assert.equal(response.status, 409);
  assert.doesNotMatch(await response.text(), /PRIVATE_SENTINEL/);
  assert.equal((await put('DEMO-1', 'new', 0)).status, 409);
  assert.match(await readFile(path, 'utf8'), /PRIVATE_SENTINEL/);
  const secondHome = await temporaryHome(t);
  await writeFile(join(secondHome, 'private.json'), 'PRIVATE_SENTINEL');
  await writeFile(path, 'not-json');
  const broken = await fetch(`${server.origin}/api/memos`);
  assert.equal(broken.status, 500);
  assert.equal((await put('DEMO-1', 'new', 0)).status, 500);
  await rm(path);
  await symlink(join(secondHome, 'private.json'), path);
  assert.equal((await fetch(`${server.origin}/api/memos`)).status, 500);
  assert.equal((await put('DEMO-1', 'new', 0)).status, 500);
  assert.equal(await readFile(join(secondHome, 'private.json'), 'utf8'), 'PRIVATE_SENTINEL');
});
