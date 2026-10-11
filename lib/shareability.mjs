import { readdir, readFile, lstat, realpath } from 'node:fs/promises';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { fail } from './validation.mjs';

const allow = new Set(['package.json', 'README.md', 'CODEX_SNAPSHOT.md', '.gitignore', 'server.mjs', 'web/index.html', 'web/app.mjs', 'web/styles.css', 'web/icons/relation-child.svg', 'lib/config.mjs', 'lib/dri.mjs', 'lib/files.mjs', 'lib/validation.mjs', 'lib/snapshot.mjs', 'lib/local-client.mjs', 'lib/shareability.mjs', 'scripts/write-codex-snapshot.mjs', 'scripts/write-codex-catalog.mjs', 'scripts/validate-shareable.mjs', 'skills/focus-shelf/SKILL.md', 'skills/generate-focus-shelf-icon/SKILL.md', 'config/team-dri.json', 'examples/config.example.json', 'examples/dri.example.json', 'examples/snapshot.example.json', 'examples/catalog.example.json']);
const ignored = new Set(['.git', 'work', 'node_modules']);
export async function validateShareableTree(root, { denylistPath = process.env.FOCUS_SHELF_DENYLIST_FILE } = {}) {
  const forbidden = [];
  if (denylistPath) {
    try {
      if (!isAbsolute(denylistPath) || (await lstat(denylistPath)).isSymbolicLink()) fail('INVALID_DENYLIST');
      const relativePath = relative(await realpath(root), await realpath(denylistPath));
      if (!relativePath || (!relativePath.startsWith('../') && relativePath !== '..' && !isAbsolute(relativePath))) fail('INVALID_DENYLIST');
      const stat = await lstat(denylistPath);
      if (!stat.isFile() || stat.size > 65536) fail('INVALID_DENYLIST');
      const entries = JSON.parse(await readFile(resolve(denylistPath), 'utf8'));
      if (!Array.isArray(entries) || entries.some(item => typeof item !== 'string' || !item.trim() || item.length > 1000)) fail('INVALID_DENYLIST');
      forbidden.push(...entries);
    } catch { fail('INVALID_DENYLIST', 'provide a JSON string array in an external local file'); }
  }
  const files = [];
  async function scan(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const name = relative(root, path).split('\\').join('/');
      if (entry.isSymbolicLink()) fail('UNSHAREABLE_TREE', 'symlink');
      if (directory === root && ignored.has(entry.name)) continue;
      if (entry.isDirectory()) { await scan(path); continue; }
      if (!allow.has(name) && !/^test\/[A-Za-z0-9_-]+\.(test\.)?mjs$/.test(name)) fail('UNSHAREABLE_TREE', 'unapproved file');
      const content = await readFile(path, 'utf8');
      for (const marker of forbidden) if (content.toLowerCase().includes(marker.toLowerCase())) fail('UNSHAREABLE_TREE', 'private identity');
      if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|ghp_[A-Za-z0-9]{20,}|lin_api_[A-Za-z0-9]+/.test(content)) fail('UNSHAREABLE_TREE', 'credential');
      files.push(name);
    }
  }
  await scan(root);
  return { valid: true, files: files.sort(), excluded: [...ignored] };
}
