// Loopback assets and artifact collector. The separate guarded entry at 8788 owns provider access and money.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const safeArtifact = (caseId, file) => /^[a-z0-9][a-z0-9-]{0,159}$/.test(caseId) && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,119}\.(?:zip|musicxml|mid|json|txt)$/.test(file) && !file.includes('..');
export async function collect(req, res, output) {
  const match = /^\/__night\/artifacts\/([^/]+)\/([^/]+)$/.exec((req.url ?? '').split('?')[0]);
  if (!match) return false;
  if (req.method !== 'POST' || !safeArtifact(match[1], match[2])) { res.writeHead(400); res.end('Invalid artifact'); return true; }
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 20 * 1024 * 1024) { res.writeHead(413); res.end('Too large'); return true; } chunks.push(chunk); }
  const folder = resolve(output, match[1]); await mkdir(folder, { recursive: true });
  const target = resolve(folder, match[2]);
  await writeFile(`${target}.tmp`, Buffer.concat(chunks), { mode: 0o600 }); await rename(`${target}.tmp`, target);
  res.writeHead(204, { 'Cache-Control': 'no-store' }); res.end(); return true;
}
export async function startNightServer({ port = 5218, output = resolve(ROOT, 'output/night-capture'), listen = true } = {}) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid local port');
  output = resolve(output);
  let handler = (_req, _res, next) => next();
  const server = await createServer({ configFile: false, root: ROOT, plugins: [{ name: 'night-capture-local-collector', configureServer(vite) { vite.middlewares.use((req, res, next) => handler(req, res, next)); } }], server: { host: '127.0.0.1', port, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8788' } }, appType: 'mpa' });
  try {
    const { NIGHT_RECIPES, NIGHT_SOURCE } = await server.ssrLoadModule('/tools/night-capture-matrix.ts');
    const source = await readFile(resolve(ROOT, NIGHT_SOURCE.path));
    if (createHash('sha256').update(source).digest('hex') !== NIGHT_SOURCE.sha256) throw Error('The public source changed. Freeze and review it before capture.');
    const manifest = { source: NIGHT_SOURCE, recipes: NIGHT_RECIPES, outcomes: 204, frozenAt: new Date().toISOString() };
    if (!listen) { await server.close(); return manifest; }
    await mkdir(output, { recursive: true });
    await writeFile(resolve(output, `manifest-${Date.now()}.json`), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    await writeFile(resolve(output, `source-${NIGHT_SOURCE.sha256}.musicxml`), source, { mode: 0o600 });
    handler = async (req, res, next) => {
      // Reject cross-origin writes before the collector, or any accidental browser key reaching the guarded proxy.
      const origin = req.headers.origin;
      if (origin && origin !== `http://127.0.0.1:${port}`) { res.writeHead(403); res.end('Local origin only'); return; }
      if (req.url?.startsWith('/api/') && req.headers['x-motifold-key']) { res.writeHead(400); res.end('Use the guarded local key'); return; }
      try {
        if (req.url === '/__night/manifest' && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(manifest)); return; }
        if (req.url === '/__night/source.musicxml' && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'application/xml', 'Cache-Control': 'no-store' }); res.end(source); return; }
        if (await collect(req, res, output)) return;
        next();
      } catch { res.writeHead(500); res.end('Local capture failed'); }
    };
    await server.listen();
    return { server, manifest, output, url: `http://127.0.0.1:${port}/tools/night-capture.html` };
  } catch (error) { await server.close(); throw error; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), at = flag => args.indexOf(flag), value = flag => at(flag) < 0 ? undefined : args[at(flag) + 1];
  const result = await startNightServer({ port: Number(value('--port') ?? 5218), output: value('--output'), listen: !args.includes('--matrix') });
  if (args.includes('--matrix')) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else { process.stdout.write(`${result.url}\nArtifacts: ${result.output}\nNo recipe has started. API proxy is fixed to guarded127.0.0.1:8788.\n`); for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await result.server.close(); process.exit(0); }); }
}
