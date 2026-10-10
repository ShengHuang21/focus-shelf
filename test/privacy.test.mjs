import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { validateShareableTree } from '../lib/shareability.mjs';
import { temporaryHome } from './helpers.mjs';

async function publication(t) {
  const root = await temporaryHome(t);
  await mkdir(join(root, 'web'));
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'focus-shelf', private: true, type: 'module' }));
  await writeFile(join(root, 'README.md'), '# Focus Shelf\nSynthetic instructions.');
  await writeFile(join(root, 'web/index.html'), '<!doctype html><title>Focus Shelf</title>');
  return root;
}

test('C02 publication validator accepts a safe allowlisted tree', async t => {
  assert.equal((await validateShareableTree(await publication(t))).valid, true);
});

test('C02 publication validator rejects external user data and unapproved files', async t => {
  for (const name of ['config.json', 'linear-latest.json', 'catalog.json', 'dri.json', '.env', 'unexpected.txt']) {
    const root = await publication(t);
    await writeFile(join(root, name), '{}');
    await assert.rejects(validateShareableTree(root), /UNSHAREABLE_TREE/);
  }
});

test('C02 publication validator rejects symlinks even to allowed content', async t => {
  const root = await publication(t);
  const outside = await temporaryHome(t);
  await writeFile(join(outside, 'safe.mjs'), 'export const value = 1;');
  await symlink(join(outside, 'safe.mjs'), join(root, 'web/app.mjs'));
  await assert.rejects(validateShareableTree(root), /UNSHAREABLE_TREE/);
});

test('C02 publication validator detects private identities in otherwise allowed files', async t => {
  const external = await temporaryHome(t);
  const probes = ['SYNTHETIC_PERSON_MARKER', 'SYNTHETIC_COMPANY_MARKER', 'SYNTHETIC_TICKET_MARKER'];
  const denylistPath = join(external, 'local-denylist.json');
  await writeFile(denylistPath, JSON.stringify(probes));
  for (const probe of probes) {
    const root = await publication(t);
    await writeFile(join(root, 'README.md'), `# Focus Shelf\n${probe}`);
    await assert.rejects(validateShareableTree(root, { denylistPath }), /UNSHAREABLE_TREE/);
  }
});

test('C02 optional local denylist must remain outside the publication root', async t => {
  const root = await publication(t);
  const denylistPath = join(root, 'local-denylist.json');
  await writeFile(denylistPath, '["SYNTHETIC_PRIVATE_MARKER"]');
  await assert.rejects(validateShareableTree(root, { denylistPath }), /INVALID_DENYLIST/);
});
