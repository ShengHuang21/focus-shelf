import { exact, fail, text, iso } from './validation.mjs';

export function validateDri(value) {
  const code = 'INVALID_DRI';
  exact(value, ['schemaVersion', 'source', 'workstreams'], code);
  exact(value.source, ['kind', 'observedAt', 'workbook', 'sheet', 'range'], code);
  if (value.schemaVersion !== 1 || value.source.kind !== 'manual-excel-import' || !iso(value.source.observedAt)
    || !text(value.source.workbook) || !text(value.source.sheet) || !/^[A-Z]+\d+:[A-Z]+\d+$/.test(value.source.range)) fail(code, 'source');
  if (!Array.isArray(value.workstreams) || value.workstreams.length > 100) fail(code, 'workstreams');
  const seen = new Set();
  for (const item of value.workstreams) {
    exact(item, ['domain', 'workstream', 'firstDri', 'secondDri', 'featureScope'], code);
    if (!text(item.domain) || (item.workstream !== null && !text(item.workstream))
      || (item.firstDri !== null && !text(item.firstDri)) || (item.secondDri !== null && !text(item.secondDri))
      || (item.featureScope !== null && !text(item.featureScope))) fail(code, 'entry');
    if (item.workstream !== null) {
      if (seen.has(item.workstream)) fail(code, 'duplicate workstream');
      seen.add(item.workstream);
    }
  }
  return structuredClone(value);
}
