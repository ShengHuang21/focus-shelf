import test from 'node:test';
import assert from 'node:assert/strict';
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

test('data home must be external and explicit', async t => {
  const home = await temporaryHome(t);
  assert.equal(resolveDataHome({ home, repositoryRoot: new URL('..', import.meta.url).pathname }), home);
  assert.throws(() => resolveDataHome({ home: new URL('../data', import.meta.url).pathname, repositoryRoot: new URL('..', import.meta.url).pathname }), /INVALID_HOME/);
});
