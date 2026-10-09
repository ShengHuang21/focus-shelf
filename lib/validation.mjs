export const fail = (code, detail = '') => { throw new Error(`${code}${detail ? ': ' + detail : ''}`); };
export const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function exact(value, fields, code) {
  if (!record(value) || Object.keys(value).some(key => !fields.includes(key)) || fields.some(key => !(key in value))) fail(code, 'fields');
}
export const text = value => typeof value === 'string' && value.length > 0 && value.length <= 2000;
export const iso = value => text(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
export function safeURL(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}
export const identity = config => config && /^[A-Za-z0-9_-]+$/.test(config.profileId ?? '') && (!config.linear || (text(config.linear.ownerId) && text(config.linear.workspaceSlug)));
export const namespace = config => JSON.stringify([config.profileId, config.linear?.ownerId ?? null, config.linear?.workspaceSlug ?? null]);
