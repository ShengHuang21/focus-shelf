import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { validateConfig, resolveDataHome } from '../lib/config.mjs';
import { config, temporaryHome } from './helpers.mjs';

test('synthetic non-default identity is accepted and preserved', () => {
  assert.deepEqual(validateConfig(config), config);
});

test('missing identity and unknown config fields fail with validation errors', () => {
  assert.throws(() => validateConfig({ ...config, profileId: '' }), /INVALID_CONFIG/);
  assert.throws(() => validateConfig({ ...config, token: 'synthetic-disallowed' }), /INVALID_CONFIG/);
});

test('invalid timezone and credential-bearing pins are rejected', () => {
  assert.throws(() => validateConfig({ ...config, timezone: 'Invalid/Zone' }), /INVALID_CONFIG/);
  assert.throws(() => validateConfig({ ...config, pins: [{ id: 'p1', title: 'Demo', url: 'https://demo:demo@example.com', icon: 'link' }] }), /INVALID_CONFIG/);
});

test('default data home is the ignored checkout folder; explicit external homes still work', async t => {
  const root = new URL('..', import.meta.url).pathname;
  const previous = process.env.FOCUS_SHELF_HOME;
  delete process.env.FOCUS_SHELF_HOME;
  try { assert.equal(resolveDataHome({ repositoryRoot: root }), join(root, '.focus-shelf')); }
  finally {
    if (previous === undefined) delete process.env.FOCUS_SHELF_HOME;
    else process.env.FOCUS_SHELF_HOME = previous;
  }
  const home = await temporaryHome(t);
  assert.equal(resolveDataHome({ home, repositoryRoot: root }), home);
  assert.equal(resolveDataHome({ home: join(root, '.focus-shelf'), repositoryRoot: root }), join(root, '.focus-shelf'));
  assert.throws(() => resolveDataHome({ home: root, repositoryRoot: root }), /INVALID_HOME/);
  assert.throws(() => resolveDataHome({ home: join(root, 'data'), repositoryRoot: root }), /INVALID_HOME/);
  assert.throws(() => resolveDataHome({ home: '', repositoryRoot: root }), /INVALID_HOME/);
});
