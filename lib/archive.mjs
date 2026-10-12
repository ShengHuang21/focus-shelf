import { randomUUID } from 'node:crypto';
import { rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readJSON, safeHome } from './files.mjs';
import { namespace, record, fail } from './validation.mjs';

const fileName = 'archive.json';
const validId = id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(id);

export function createArchiveStore(home) {
  let pending = Promise.resolve();

  async function read(config) {
    if (!config) fail('ARCHIVE_IDENTITY_MISMATCH');
    let value;
    try { value = await readJSON(home, fileName); }
    catch (error) {
      if (error.code === 'ENOENT') return { revision: 0, archived: {}, initialized: false };
      fail('ARCHIVE_STORAGE_INVALID');
    }
    if (!record(value) || Object.keys(value).sort().join(',') !== 'archived,namespace,revision,schemaVersion'
      || value.schemaVersion !== 1 || value.namespace !== namespace(config)) fail('ARCHIVE_IDENTITY_MISMATCH');
    if (!Number.isSafeInteger(value.revision) || value.revision < 0 || !record(value.archived)
      || Object.entries(value.archived).some(([id, archived]) => !validId(id) || archived !== true)) fail('ARCHIVE_STORAGE_INVALID');
    return { revision: value.revision, archived: value.archived, initialized: true };
  }

  async function write(config, input) {
    const importLegacy = record(input) && Object.keys(input).sort().join(',') === 'expectedRevision,legacyIds';
    const edit = record(input) && Object.keys(input).sort().join(',') === 'archived,expectedRevision,id';
    if ((!importLegacy && !edit) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0
      || importLegacy && (!Array.isArray(input.legacyIds) || input.legacyIds.length > 5000
        || input.legacyIds.some(id => !validId(id)))
      || edit && (!validId(input.id) || typeof input.archived !== 'boolean')) fail('INVALID_ARCHIVE');
    const task = async () => {
      const current = await read(config);
      if (current.revision !== input.expectedRevision || importLegacy && current.initialized) fail('ARCHIVE_REVISION_CONFLICT');
      const archived = { ...current.archived };
      if (importLegacy) for (const id of input.legacyIds) archived[id] = true;
      else if (input.archived) archived[input.id] = true;
      else delete archived[input.id];
      const next = { revision: current.revision + 1, archived, initialized: true };
      const root = await safeHome(home);
      const temporary = join(root, `.archive-${randomUUID()}.tmp`);
      const content = JSON.stringify({ schemaVersion: 1, namespace: namespace(config), revision: next.revision, archived });
      if (Buffer.byteLength(content) > 1024 * 1024) fail('ARCHIVE_STORAGE_FULL');
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
