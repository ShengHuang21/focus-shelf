import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import { writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { startServer } from '../server.mjs';
import { config, snapshot, catalog, dri, temporaryHome } from './helpers.mjs';

test('C04/C05 API projects valid snapshot/catalog and rejects non-GET methods', async t => {
  const home = await temporaryHome(t);
  for (const [name, value] of Object.entries({ 'config.json': config, 'linear-latest.json': snapshot, 'catalog.json': catalog, 'dri.json': dri })) {
    await writeFile(join(home, name), JSON.stringify(value));
  }
  const server = await startServer({ home, port: 0 });
  t.after(() => server.close());
  const state = await (await fetch(`${server.origin}/api/shelf`)).json();
  assert.deepEqual(Object.keys(state).sort(), ['availability', 'catalog', 'config', 'dri', 'schemaVersion', 'snapshot']);
  assert.deepEqual(state.snapshot, snapshot);
  assert.deepEqual(state.catalog, catalog);
  assert.deepEqual(state.dri, dri);
  assert.equal(state.availability.snapshot, 'ready');
  assert.equal(state.availability.catalog, 'ready');
  for (const method of ['POST', 'PUT', 'DELETE']) {
    assert.equal((await fetch(`${server.origin}/api/shelf`, { method })).status, 405);
  }
});

test('rendered snapshot links open only approved current URLs in Google Chrome', async t => {
  const home = await temporaryHome(t);
  for (const [name, value] of Object.entries({ 'config.json': config, 'linear-latest.json': snapshot, 'catalog.json': catalog })) {
    await writeFile(join(home, name), JSON.stringify(value));
  }
  const opened = [];
  const server = await startServer({ home, port: 0, openExternal: async url => opened.push(url) });
  t.after(() => server.close());
  const headers = { Origin: server.origin, 'Content-Type': 'application/json' };
  let response = await fetch(`${server.origin}/api/open-in-chrome`, { method: 'POST', headers, body: JSON.stringify({ url: snapshot.issues[0].url }) });
  assert.equal(response.status, 204);
  assert.deepEqual(opened, [snapshot.issues[0].url]);
  response = await fetch(`${server.origin}/api/open-in-chrome`, { method: 'POST', headers, body: JSON.stringify({ url: 'https://example.com/not-rendered' }) });
  assert.equal(response.status, 403);
  response = await fetch(`${server.origin}/api/open-in-chrome`, { method: 'POST', headers: { ...headers, Origin: 'https://attacker.example' }, body: JSON.stringify({ url: snapshot.issues[0].url }) });
  assert.equal(response.status, 403);
  assert.equal((await fetch(`${server.origin}/api/open-in-chrome`)).status, 405);
});

test('C04/C05 API omits mismatched snapshot and invalid or sensitive catalog without passing extras', async t => {
  const home = await temporaryHome(t);
  await writeFile(join(home, 'config.json'), JSON.stringify(config));
  await writeFile(join(home, 'linear-latest.json'), JSON.stringify({ ...snapshot, ownerId: 'other-owner', privateNote: 'SYNTHETIC_PRIVATE_SENTINEL' }));
  await writeFile(join(home, 'catalog.json'), JSON.stringify(catalog));
  const server = await startServer({ home, port: 0 });
  t.after(() => server.close());
  let response = await fetch(`${server.origin}/api/shelf`);
  let raw = await response.text();
  let state = JSON.parse(raw);
  assert.equal(state.snapshot, null);
  assert.equal(state.catalog, null);
  assert.equal(state.dri, null);
  assert.equal(state.availability.snapshot, 'invalid');
  assert.doesNotMatch(raw, /SYNTHETIC_PRIVATE_SENTINEL|privateNote/);
  await writeFile(join(home, 'linear-latest.json'), JSON.stringify(snapshot));
  for (const invalid of [{ ...catalog, ownerId: 'other-owner' }, { ...catalog, rawPayload: 'SYNTHETIC_PRIVATE_SENTINEL' }]) {
    await writeFile(join(home, 'catalog.json'), JSON.stringify(invalid));
    response = await fetch(`${server.origin}/api/shelf`);
    raw = await response.text();
    state = JSON.parse(raw);
    assert.deepEqual(state.snapshot, snapshot);
    assert.equal(state.catalog, null);
    assert.equal(state.availability.catalog, 'invalid');
    assert.doesNotMatch(raw, /SYNTHETIC_PRIVATE_SENTINEL|rawPayload/);
  }
});

test('clean checkout starts on loopback and displays empty state without credentials', async t => {
  const home = await temporaryHome(t);
  const server = await startServer({ home, port: 0 });
  t.after(() => server.close());
  const response = await fetch(`${server.origin}/`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Focus Shelf/);
  assert.match(html, /app\.mjs\?v=20261010\.7/);
  const state = await (await fetch(`${server.origin}/api/shelf`)).json();
  assert.equal(state.schemaVersion, 1);
  assert.equal(state.snapshot, null);
  assert.equal(state.catalog, null);
  assert.equal(state.availability.config, 'missing');
});

test('configured external data is read without contacting a remote service', async t => {
  const home = await temporaryHome(t);
  await writeFile(join(home, 'config.json'), JSON.stringify(config));
  const server = await startServer({ home, port: 0 });
  t.after(() => server.close());
  const state = await (await fetch(`${server.origin}/api/shelf`)).json();
  assert.deepEqual(state.config, config);
});

test('optional private DRI map is validated and invalid data is omitted', async t => {
  const home = await temporaryHome(t);
  await writeFile(join(home, 'config.json'), JSON.stringify(config));
  await writeFile(join(home, 'dri.json'), JSON.stringify(dri));
  const server = await startServer({ home, port: 0 });
  t.after(() => server.close());
  let state = await (await fetch(`${server.origin}/api/shelf`)).json();
  assert.deepEqual(state.dri, dri);
  assert.equal(state.availability.dri, 'ready');
  await writeFile(join(home, 'dri.json'), JSON.stringify({ ...dri, token: 'private' }));
  state = await (await fetch(`${server.origin}/api/shelf`)).json();
  assert.equal(state.dri, null);
  assert.equal(state.availability.dri, 'invalid');
});

test('occupied requested port fails safely', async t => {
  const occupied = net.createServer();
  await new Promise(resolve => occupied.listen(0, 'localhost', resolve));
  t.after(() => occupied.close());
  await assert.rejects(startServer({ home: await temporaryHome(t), port: occupied.address().port }), error => error.code === 'EADDRINUSE');
  assert.equal(occupied.listening, true);
});

test('Host, traversal and unapproved files are blocked', async t => {
  const home = await temporaryHome(t);
  const server = await startServer({ home, port: 0 });
  t.after(() => server.close());
  // Node's fetch normalizes Host; http.request sends the deliberate invalid header.
  const hostStatus = await new Promise((resolve, reject) => {
    const request = http.get(`${server.origin}/api/shelf`, { headers: { Host: 'attacker.example' } }, response => {
      response.resume();
      resolve(response.statusCode);
    });
    request.on('error', reject);
  });
  assert.equal(hostStatus, 403);
  assert.equal((await fetch(`${server.origin}/%2e%2e%2fpackage.json`)).status, 404);
  assert.equal((await fetch(`${server.origin}/package.json`)).status, 404);
});

test('C05 alternate loopback Host aliases cannot split the canonical browser origin', async t => {
  const server = await startServer({ home: await temporaryHome(t), port: 0 });
  t.after(() => server.close());
  const port = new URL(server.origin).port;
  for (const host of [`127.0.0.1:${port}`, `[::1]:${port}`]) {
    const status = await new Promise((resolve, reject) => {
      const request = http.get(`${server.origin}/api/shelf`, { headers: { Host: host } }, response => { response.resume(); resolve(response.statusCode); });
      request.on('error', reject);
    });
    assert.equal(status, 403);
  }
});

test('external config symlinks fail closed', async t => {
  const home = await temporaryHome(t);
  const elsewhere = await temporaryHome(t);
  await writeFile(join(elsewhere, 'config.json'), JSON.stringify(config));
  await symlink(join(elsewhere, 'config.json'), join(home, 'config.json'));
  const server = await startServer({ home, port: 0 });
  t.after(() => server.close());
  const state = await (await fetch(`${server.origin}/api/shelf`)).json();
  assert.equal(state.config, null);
  assert.equal(state.availability.config, 'invalid');
});
