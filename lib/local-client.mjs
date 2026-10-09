import { identity, namespace, text, fail } from './validation.mjs';

export async function createLocalClient({ config, storage, locks }) {
  config = structuredClone(config);
  const valid = identity(config);
  const key = valid ? `focus-shelf:v1:${namespace(config)}` : null;
  let closed = false;
  let mismatched = false;
  let generation = 0;
  let release;
  let state = { memos: {}, archived: {}, prStatus: {} };
  const client = {
    readOnly: true,
    readOnlyReason: valid ? 'Web Locks unavailable' : 'Missing profile identity',
    saveState: 'idle',
    close() { closed = true; generation++; client.readOnly = true; client.readOnlyReason = 'Client closed'; release?.(); release = null; },
    async acquireWriter() {
      if (closed) fail('CLIENT_CLOSED');
      if (!valid || mismatched || !locks?.request) return;
      if (!client.readOnly) return;
      const requestGeneration = generation;
      const current = () => !closed && !mismatched && generation === requestGeneration;
      // Let a just-released lock callback finish before requesting availability.
      await Promise.resolve();
      await Promise.resolve();
      if (!current()) return;
      let signal;
      const ready = new Promise(resolve => { signal = resolve; });
      const held = locks.request(`focus-shelf:${namespace(config)}`, { mode: 'exclusive', ifAvailable: true }, async lock => {
        if (!current()) { signal(); return; }
        if (!lock) { client.readOnlyReason = 'Another window is the writer'; signal(); return; }
        try { load(); } catch { client.readOnlyReason = 'Local storage unavailable'; client.saveState = 'failed'; signal(); return; }
        client.readOnly = false; client.readOnlyReason = ''; signal();
        await new Promise(resolve => { release = resolve; });
      });
      held.catch(() => { if (current()) { client.readOnly = true; client.readOnlyReason = 'Web Lock failed'; } signal(); });
      await ready;
    },
    acceptShelf(shelf) {
      if (!identity(shelf?.config) || namespace(shelf.config) !== namespace(config) || (shelf.snapshot && (shelf.snapshot.ownerId !== config.linear?.ownerId || shelf.snapshot.source?.workspaceSlug !== config.linear?.workspaceSlug))) {
        mismatched = true; generation++; client.readOnly = true; client.readOnlyReason = 'Identity changed; reload this profile'; release?.(); release = null; fail('IDENTITY_MISMATCH');
      }
    },
    setMemo(id, value) { if (!text(id) || typeof value !== 'string' || value.length > 10000) fail('INVALID_OVERLAY'); save(next => { next.memos[id] = value; }); },
    getMemo: id => Object.hasOwn(state.memos, id) ? state.memos[id] : '',
    setArchived(id, value) { if (!text(id) || typeof value !== 'boolean') fail('INVALID_OVERLAY'); save(next => { next.archived[id] = value; }); },
    isArchived: id => Object.hasOwn(state.archived, id) && state.archived[id] === true,
    setPRStatus(id, value) { if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+$/.test(id) || !['open', 'merged', 'closed'].includes(value)) fail('INVALID_OVERLAY'); save(next => { next.prStatus[id] = value; }); },
    getPRStatus: id => Object.hasOwn(state.prStatus, id) ? state.prStatus[id] : null,
    getOverlays: () => structuredClone(state),
  };
  function load() {
    const raw = storage.getItem(key);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.memos || !parsed.archived || !parsed.prStatus) fail('STORAGE_FAILED');
    state = { memos: parsed.memos, archived: parsed.archived, prStatus: parsed.prStatus };
  }
  function save(change) {
    if (closed || mismatched || client.readOnly) fail('READ_ONLY');
    const next = structuredClone(state);
    change(next);
    try { storage.setItem(key, JSON.stringify(next)); }
    catch { client.saveState = 'failed'; fail('STORAGE_FAILED'); }
    state = next; client.saveState = 'saved';
  }
  if (valid) { try { load(); } catch { client.readOnlyReason = 'Local storage unavailable'; } }
  await client.acquireWriter();
  return client;
}
