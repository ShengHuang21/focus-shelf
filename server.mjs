import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { readFile, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDataHome, validateConfig } from './lib/config.mjs';
import { safeHome, readJSON } from './lib/files.mjs';
import { validateSnapshot, validateCatalog } from './lib/snapshot.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const staticFiles = new Set(['web/index.html', 'web/app.mjs', 'web/styles.css', 'lib/local-client.mjs', 'lib/validation.mjs']);

export async function startServer({ home = process.env.FOCUS_SHELF_HOME, port = 8770 } = {}) {
  home = resolveDataHome({ home });
  let actualPort;
  const server = createServer(async (request, response) => {
    const send = (status, body, type = 'text/plain; charset=utf-8') => { response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; connect-src 'self'; style-src 'self'; script-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" }); response.end(body); };
    if (request.headers.host !== `localhost:${actualPort}`) return send(403, 'Invalid Host');
    if (request.method !== 'GET') { response.setHeader('Allow', 'GET'); return send(405, 'GET only'); }
    let path;
    try { path = decodeURIComponent((request.url ?? '').split('?')[0]); } catch { return send(404, 'Not found'); }
    if (path.includes('..') || path.includes('\\') || path.includes('\0')) return send(404, 'Not found');
    if (path === '/api/shelf') {
      const state = { schemaVersion: 1, config: null, snapshot: null, catalog: null, availability: { config: 'missing', snapshot: 'missing', catalog: 'missing' } };
      async function load(name, field, validate) {
        try { state[field] = validate(await readJSON(home, name)); state.availability[field] = 'ready'; }
        catch (error) { state.availability[field] = error.code === 'ENOENT' ? 'missing' : 'invalid'; }
      }
      await load('config.json', 'config', validateConfig);
      if (state.config) await load('linear-latest.json', 'snapshot', value => validateSnapshot(value, state.config));
      if (state.snapshot) await load('catalog.json', 'catalog', value => validateCatalog(value, state.config, state.snapshot));
      return send(200, JSON.stringify(state), 'application/json; charset=utf-8');
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
