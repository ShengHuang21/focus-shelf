import { resolve, relative, isAbsolute, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exact, fail, text, safeURL, identity } from './validation.mjs';

export const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
export function validateConfig(value) {
  const code = 'INVALID_CONFIG';
  exact(value, ['schemaVersion', 'profileId', 'linear', 'timezone', 'pins'], code);
  if (value.schemaVersion !== 1 || !identity(value)) fail(code, 'identity');
  if (value.linear !== null) {
    exact(value.linear, ['ownerId', 'workspaceSlug'], code);
    if (!text(value.linear.ownerId) || !/^[A-Za-z0-9_-]+$/.test(value.linear.workspaceSlug)) fail(code, 'linear');
  }
  try { new Intl.DateTimeFormat('en', { timeZone: value.timezone }).format(); } catch { fail(code, 'timezone'); }
  if (!text(value.timezone)) fail(code, 'timezone');
  if (!Array.isArray(value.pins) || value.pins.length > 50) fail(code, 'pins');
  const seen = new Set();
  for (const pin of value.pins) {
    exact(pin, ['id', 'title', 'url', 'icon'], code);
    if (!text(pin.id) || seen.has(pin.id) || !text(pin.title) || !safeURL(pin.url) || !['link', 'code', 'book', 'work', 'home'].includes(pin.icon)) fail(code, 'pin');
    seen.add(pin.id);
  }
  return structuredClone(value);
}

export function resolveDataHome({ repositoryRoot: root = repositoryRoot, home = process.env.FOCUS_SHELF_HOME ?? join(root, '.focus-shelf') } = {}) {
  if (!text(home) || !isAbsolute(home)) fail('INVALID_HOME', 'set an absolute FOCUS_SHELF_HOME');
  const target = resolve(home);
  const inside = relative(resolve(root), target);
  if (!inside || (inside !== '.focus-shelf' && !inside.startsWith('..' + sep) && inside !== '..' && !isAbsolute(inside))) fail('INVALID_HOME', 'home must be .focus-shelf or outside repository');
  return target;
}
