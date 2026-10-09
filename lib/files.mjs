import { lstat, readFile, realpath, mkdir } from 'node:fs/promises';
import { resolve, parse, join } from 'node:path';
import { resolveDataHome, repositoryRoot } from './config.mjs';

export async function safeHome(home, create = false) {
  const target = resolveDataHome({ home });
  let current = parse(target).root;
  for (const part of target.slice(current.length).split('/').filter(Boolean)) {
    current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        // macOS exposes these OS-owned aliases for its temporary directories.
        const systemAlias = ['/var', '/tmp'].includes(current) && (await realpath(current)) === `/private${current}`;
        if (!systemAlias) throw new Error('INVALID_HOME: symlink');
      }
    }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (create) await mkdir(target, { recursive: true });
  try { resolveDataHome({ home: await realpath(target), repositoryRoot }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return target;
}

export async function readJSON(home, name) {
  const root = await safeHome(home);
  const path = resolve(root, name);
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error('INVALID_FILE');
  return JSON.parse(await readFile(path, 'utf8'));
}
