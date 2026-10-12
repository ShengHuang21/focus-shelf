import { randomUUID } from 'node:crypto';
import { rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readJSON, safeHome } from './files.mjs';
import { namespace, record, fail } from './validation.mjs';

const fileName = 'memos.json';
const validId = id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(id);

export function createMemoStore(home) {
  let pending = Promise.resolve();

  async function read(config) {
    if (!config) fail('MEMO_IDENTITY_MISMATCH');
    let value;
    try { value = await readJSON(home, fileName); }
    catch (error) {
      if (error.code === 'ENOENT') return { revision: 0, memos: {} };
      fail('MEMO_STORAGE_INVALID');
    }
    if (!record(value) || Object.keys(value).sort().join(',') !== 'memos,namespace,revision,schemaVersion'
      || value.schemaVersion !== 1 || value.namespace !== namespace(config)) fail('MEMO_IDENTITY_MISMATCH');
    if (!Number.isSafeInteger(value.revision) || value.revision < 0 || !record(value.memos)
      || Object.entries(value.memos).some(([id, memo]) => !validId(id) || typeof memo !== 'string' || memo.length > 10000)) fail('MEMO_STORAGE_INVALID');
    return { revision: value.revision, memos: value.memos };
  }

  async function write(config, input) {
    if (!record(input) || Object.keys(input).sort().join(',') !== 'expectedRevision,id,value'
      || !validId(input.id) || typeof input.value !== 'string' || input.value.length > 10000
      || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) fail('INVALID_MEMO');
    const task = async () => {
      const current = await read(config);
      if (current.revision !== input.expectedRevision) fail('MEMO_REVISION_CONFLICT');
      const next = { revision: current.revision + 1, memos: { ...current.memos, [input.id]: input.value } };
      const root = await safeHome(home);
      const temporary = join(root, `.memos-${randomUUID()}.tmp`);
      const content = JSON.stringify({ schemaVersion: 1, namespace: namespace(config), ...next });
      if (Buffer.byteLength(content) > 1024 * 1024) fail('MEMO_STORAGE_FULL');
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
