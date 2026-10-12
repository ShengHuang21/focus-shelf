import { randomUUID } from 'node:crypto';
import { rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readJSON, safeHome } from './files.mjs';
import { namespace, record, fail } from './validation.mjs';

const fileName = 'pr-status.json';
const validKey = key => typeof key === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+$/.test(key);
const validStatus = value => ['open', 'ready-review', 'merged', 'closed'].includes(value);
const validSelection = value => validStatus(value) || record(value)
  && Object.keys(value).sort().join(',') === 'observedAt,status'
  && validStatus(value.status) && typeof value.observedAt === 'string'
  && !Number.isNaN(Date.parse(value.observedAt));

export function createPRStatusStore(home) {
  let pending = Promise.resolve();

  async function read(config) {
    if (!config) fail('PR_STATUS_IDENTITY_MISMATCH');
    let value;
    try { value = await readJSON(home, fileName); }
    catch (error) {
      if (error.code === 'ENOENT') return { revision: 0, statuses: {} };
      fail('PR_STATUS_STORAGE_INVALID');
    }
    if (!record(value) || Object.keys(value).sort().join(',') !== 'namespace,revision,schemaVersion,statuses'
      || value.schemaVersion !== 1 || value.namespace !== namespace(config)) fail('PR_STATUS_IDENTITY_MISMATCH');
    if (!Number.isSafeInteger(value.revision) || value.revision < 0 || !record(value.statuses)
      || Object.entries(value.statuses).some(([key, selection]) => !validKey(key) || !validSelection(selection))) fail('PR_STATUS_STORAGE_INVALID');
    return { revision: value.revision, statuses: value.statuses };
  }

  async function write(config, input) {
    if (!record(input) || Object.keys(input).sort().join(',') !== 'expectedRevision,key,observedAt,status'
      || !validKey(input.key) || !validStatus(input.status)
      || typeof input.observedAt !== 'string' || Number.isNaN(Date.parse(input.observedAt))
      || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) fail('INVALID_PR_STATUS');
    const task = async () => {
      const current = await read(config);
      if (current.revision !== input.expectedRevision) fail('PR_STATUS_REVISION_CONFLICT');
      const next = { revision: current.revision + 1, statuses: { ...current.statuses, [input.key]: { status: input.status, observedAt: input.observedAt } } };
      const root = await safeHome(home);
      const temporary = join(root, `.pr-status-${randomUUID()}.tmp`);
      const content = JSON.stringify({ schemaVersion: 1, namespace: namespace(config), ...next });
      if (Buffer.byteLength(content) > 1024 * 1024) fail('PR_STATUS_STORAGE_FULL');
      try {
        await writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
        await rename(temporary, join(root, fileName));
      } catch (error) {
        await rm(temporary, { force: true });
        throw error;
      }
      return next;
    };
    pending = pending.then(task, task);
    return pending;
  }

  return { read, write };
}
