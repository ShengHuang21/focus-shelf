import test from 'node:test';
import assert from 'node:assert/strict';
import { lstat, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startServer } from '../server.mjs';
import { config, temporaryHome } from './helpers.mjs';

async function fixture(t) {
  const home = await temporaryHome(t);
  await writeFile(join(home, 'config.json'), JSON.stringify(config));
  const server = await startServer({ home, port: 0 });
  t.after(() => server.close());
  const put = (body, origin = server.origin) => fetch(`${server.origin}/api/archive`, {
    method: 'PUT', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { home, server, put };
}

test('Archive is saved in the external home and shared across browser sessions', async t => {
  const { home, server, put } = await fixture(t);
  assert.deepEqual(await (await fetch(`${server.origin}/api/archive`)).json(), { revision: 0, archived: {}, initialized: false });
  assert.equal((await put({ id: 'DEMO-1', archived: true, expectedRevision: 0 })).status, 200);
  assert.deepEqual(await (await fetch(`${server.origin}/api/archive`)).json(), { revision: 1, archived: { 'DEMO-1': true }, initialized: true });
  const secondServer = await startServer({ home, port: 0 });
  t.after(() => secondServer.close());
  assert.deepEqual(await (await fetch(`${secondServer.origin}/api/archive`)).json(), { revision: 1, archived: { 'DEMO-1': true }, initialized: true });
  assert.equal((await lstat(join(home, 'archive.json'))).mode & 0o777, 0o600);
  assert.equal((await put({ id: 'DEMO-1', archived: false, expectedRevision: 1 })).status, 200);
  assert.deepEqual((await (await fetch(`${server.origin}/api/archive`)).json()).archived, {});
});

test('Legacy browser Archive is imported once without overwriting newer file state', async t => {
  const { server, put } = await fixture(t);
  assert.equal((await put({ legacyIds: ['DEMO-1', 'DEMO-2'], expectedRevision: 0 })).status, 200);
  assert.equal((await put({ legacyIds: ['DEMO-3'], expectedRevision: 0 })).status, 409);
  assert.equal((await put({ id: 'DEMO-1', archived: false, expectedRevision: 1 })).status, 200);
  assert.deepEqual((await (await fetch(`${server.origin}/api/archive`)).json()).archived, { 'DEMO-2': true });
});

test('Archive rejects stale revisions, foreign origins and invalid files without losing records', async t => {
  const { home, server, put } = await fixture(t);
  assert.equal((await put({ id: 'DEMO-1', archived: true, expectedRevision: 0 })).status, 200);
  assert.equal((await put({ id: 'DEMO-1', archived: false, expectedRevision: 0 })).status, 409);
  assert.equal((await put({ id: 'DEMO-2', archived: true, expectedRevision: 1 }, 'https://attacker.example')).status, 403);
  assert.equal((await put({ id: '../bad', archived: true, expectedRevision: 1 })).status, 400);
  assert.deepEqual((await (await fetch(`${server.origin}/api/archive`)).json()).archived, { 'DEMO-1': true });
  const path = join(home, 'archive.json');
  await writeFile(path, JSON.stringify({ schemaVersion: 1, namespace: 'other profile', revision: 1, archived: { 'DEMO-1': true } }));
  assert.equal((await fetch(`${server.origin}/api/archive`)).status, 409);
  assert.equal((await put({ id: 'DEMO-2', archived: true, expectedRevision: 1 })).status, 409);
  await rm(path);
  const other = join(home, 'other.json');
  await writeFile(other, 'PRIVATE_SENTINEL');
  await symlink(other, path);
  assert.equal((await fetch(`${server.origin}/api/archive`)).status, 500);
  assert.equal(await readFile(other, 'utf8'), 'PRIVATE_SENTINEL');
});
