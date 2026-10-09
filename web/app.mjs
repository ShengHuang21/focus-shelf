import { createLocalClient } from '../lib/local-client.mjs';
import { safeURL } from '../lib/validation.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const link = (url, label) => safeURL(url) ? `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(label)}</a>` : `<span>${escape(label)}</span>`;
const prKey = item => `${item.repository}#${item.number}`;

export function renderShelf({ config, snapshot, catalog, overlays = {}, readOnly = true, readOnlyReason = '', saveState = 'idle', showArchived = false }) {
  const issues = snapshot?.issues ?? [];
  const visible = issues.filter(item => showArchived || !overlays.archived?.[item.id]);
  const pins = (config?.pins ?? []).map(pin => link(pin.url, pin.title)).join('');
  const rows = visible.map(item => {
    const archived = Boolean(overlays.archived?.[item.id]);
    const prs = (catalog?.pullRequests ?? []).filter(pr => pr.issueId === item.id).map(pr => {
      const key = prKey(pr); const status = overlays.prStatus?.[key] ?? pr.state;
      return `<label class="pr">${link(pr.url, key)} <select data-pr="${escape(key)}" ${readOnly ? 'disabled' : ''}>${['open', 'merged', 'closed'].map(value => `<option ${value === status ? 'selected' : ''}>${value}</option>`).join('')}</select></label>`;
    }).join('');
    return `<article class="ticket"><div class="ticket-heading">${link(item.url, item.id)}<span class="status">${escape(item.status?.name)}</span><button data-archive="${escape(item.id)}" ${readOnly ? 'disabled' : ''}>${archived ? 'Restore' : 'Archive'}</button></div><h2>${escape(item.title)}</h2><label>Memo<textarea data-memo="${escape(item.id)}" ${readOnly ? 'disabled' : ''}>${escape(overlays.memos?.[item.id] ?? '')}</textarea></label>${prs}</article>`;
  }).join('');
  return `<header><div><p class="eyebrow">LOCAL WORKSPACE</p><h1>Focus Shelf</h1></div><button id="reload">Reload local snapshot</button></header><p class="notice" role="status">${readOnly ? `Read-only: ${escape(readOnlyReason || 'Configure a profile to save overlays')}` : 'Writer window · browser-local saves'} · ${escape(saveState)}</p><nav>${pins}</nav><section class="toolbar"><label><input id="show-archived" type="checkbox" ${showArchived ? 'checked' : ''}> Show archived</label><button id="report">Create local report</button>${readOnly ? '<button id="takeover">Try writer lock</button>' : ''}</section><section class="tickets">${rows || '<div class="empty"><h2>Your shelf is ready</h2><p>No issues yet. Configure your local profile and explicitly ask Codex to refresh a snapshot.</p></div>'}</section><section id="report-panel" hidden><h2>Local report</h2><textarea id="report-text" readonly></textarea></section><footer>Configuration and snapshots stay on this computer. Opening or editing the shelf does not refresh external services.</footer>`;
}

export function createReport({ snapshot, catalog, overlays = {} }) {
  const excluded = new Set(catalog?.presentation?.report?.excludedIssueIds ?? []);
  return (snapshot?.issues ?? []).filter(item => !overlays.archived?.[item.id] && !excluded.has(item.id)).map(item => {
    const prs = (catalog?.pullRequests ?? []).filter(pr => pr.issueId === item.id).map(pr => `${prKey(pr)} ${overlays.prStatus?.[prKey(pr)] ?? pr.state}`).join('\n');
    return `${item.id} — ${item.title}\n${item.status?.name ?? ''}${overlays.memos?.[item.id] ? '\n' + overlays.memos[item.id] : ''}${prs ? '\n' + prs : ''}`;
  }).join('\n\n');
}

if (typeof document !== 'undefined') {
  let shelf;
  let client;
  let showArchived = false;
  const main = document.querySelector('main');
  async function reload() {
    const response = await fetch('/api/shelf', { cache: 'no-store' });
    if (!response.ok) throw new Error('Local snapshot unavailable');
    const next = await response.json();
    if (client) client.acceptShelf(next);
    else client = await createLocalClient({ config: next.config, storage: window.localStorage, locks: navigator.locks });
    shelf = next; render();
  }
  function render() {
    main.innerHTML = renderShelf({ ...shelf, overlays: client.getOverlays(), readOnly: client.readOnly, readOnlyReason: client.readOnlyReason, saveState: client.saveState, showArchived });
    const errors = () => { const node = main.querySelector('.notice'); node.textContent = `Save failed · ${client.readOnlyReason || 'Local storage or input unavailable'}`; node.classList.add('error'); };
    const action = (fn, repaint = true) => { try { fn(); if (repaint) render(); else main.querySelector('.notice').textContent = 'Writer window · browser-local saved'; } catch { errors(); } };
    main.querySelector('#reload').onclick = () => reload().catch(errors);
    main.querySelector('#show-archived').onchange = event => { showArchived = event.target.checked; render(); };
    main.querySelector('#takeover')?.addEventListener('click', async () => { await client.acquireWriter(); render(); });
    main.querySelectorAll('[data-memo]').forEach(node => { node.onchange = () => action(() => client.setMemo(node.dataset.memo, node.value), false); });
    main.querySelectorAll('[data-archive]').forEach(node => { node.onclick = () => action(() => client.setArchived(node.dataset.archive, !client.isArchived(node.dataset.archive))); });
    main.querySelectorAll('[data-pr]').forEach(node => { node.onchange = () => action(() => client.setPRStatus(node.dataset.pr, node.value)); });
    main.querySelector('#report').onclick = () => { main.querySelector('#report-panel').hidden = false; main.querySelector('#report-text').value = createReport({ ...shelf, overlays: client.getOverlays() }); };
  }
  window.addEventListener('pagehide', () => client?.close());
  reload().catch(() => { main.textContent = 'Focus Shelf could not load local configuration. Check FOCUS_SHELF_HOME and reload.'; });
}
