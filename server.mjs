import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { readFile, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDataHome, validateConfig } from './lib/config.mjs';
import { safeHome, readJSON } from './lib/files.mjs';
import { validateSnapshot, validateCatalog } from './lib/snapshot.mjs';
import { validateDri } from './lib/dri.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const staticFiles = new Set(['web/index.html', 'web/app.mjs', 'web/styles.css', 'lib/local-client.mjs', 'lib/validation.mjs']);

function openInChrome(url) {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/open', ['-a', 'Google Chrome', url], { timeout: 10_000 }, error => error ? reject(error) : resolve());
  });
}

async function readJSONBody(request, limit = 4096) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function loadShelfState(home) {
  const state = { schemaVersion: 1, config: null, snapshot: null, catalog: null, dri: null, availability: { config: 'missing', snapshot: 'missing', catalog: 'missing', dri: 'missing' } };
  async function load(name, field, validate) {
    try { state[field] = validate(await readJSON(home, name)); state.availability[field] = 'ready'; }
    catch (error) { state.availability[field] = error.code === 'ENOENT' ? 'missing' : 'invalid'; }
  }
  await load('config.json', 'config', validateConfig);
  if (state.config) await load('dri.json', 'dri', validateDri);
  if (state.config) await load('linear-latest.json', 'snapshot', value => validateSnapshot(value, state.config));
  if (state.snapshot) await load('catalog.json', 'catalog', value => validateCatalog(value, state.config, state.snapshot));
  return state;
}

function approvedExternalLinks(state) {
  return new Set([
    ...(state.config?.pins ?? []).map(item => item.url),
    ...(state.snapshot?.issues ?? []).map(item => item.url),
    ...(state.catalog?.pullRequests ?? []).map(item => item.url),
  ]);
}

export async function startServer({ home = process.env.FOCUS_SHELF_HOME, port = 8770, openExternal = openInChrome } = {}) {
  home = resolveDataHome({ home });
  let actualPort;
  const server = createServer(async (request, response) => {
    const send = (status, body, type = 'text/plain; charset=utf-8') => { response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; connect-src 'self'; style-src 'self'; script-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" }); response.end(body); };
    if (request.headers.host !== `localhost:${actualPort}`) return send(403, 'Invalid Host');
    let path;
    try { path = decodeURIComponent((request.url ?? '').split('?')[0]); } catch { return send(404, 'Not found'); }
    if (path.includes('..') || path.includes('\\') || path.includes('\0')) return send(404, 'Not found');
    if (path === '/api/open-in-chrome') {
      response.setHeader('Allow', 'POST');
      if (request.method !== 'POST') return send(405, 'POST only');
      if (request.headers.origin !== `http://localhost:${actualPort}`) return send(403, 'Invalid Origin');
      if (!String(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) return send(415, 'JSON only');
      let body;
      try { body = await readJSONBody(request); } catch { return send(400, 'Invalid request'); }
      if (!body || Object.keys(body).length !== 1 || typeof body.url !== 'string') return send(400, 'Invalid request');
      const state = await loadShelfState(home);
      if (!approvedExternalLinks(state).has(body.url)) return send(403, 'Unapproved link');
      try { await openExternal(body.url); } catch { return send(502, 'Chrome could not open the link'); }
      return send(204, '');
    }
    if (request.method !== 'GET') { response.setHeader('Allow', 'GET'); return send(405, 'GET only'); }
    if (path === '/api/shelf') {
      return send(200, JSON.stringify(await loadShelfState(home)), 'application/json; charset=utf-8');
    }
    const file = path === '/' ? 'web/index.html' : path.slice(1);
    if (!staticFiles.has(file)) return send(404, 'Not found');
    try {
      let current = root;
      for (const part of file.split('/')) { current = join(current, part); if ((await lstat(current)).isSymbolicLink()) return send(404, 'Not found'); }
      const content = await readFile(resolve(root, file));
      return send(200, content, file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8');
    } catch { return send(404, 'Not found'); }
  });
  await safeHome(home);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, 'localhost', resolve); });
  actualPort = server.address().port;
  return { origin: `http://localhost:${actualPort}`, close: () => new Promise(resolve => server.close(resolve)) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
