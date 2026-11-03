// One local browser, the real Worker, and its existing ledger. The server key stays in the Worker. Headers are never recorded.
// Defaults to unarmed. Start only after the coordinated live go-ahead and a fresh production build.
import { createServer as httpServer, request as httpRequest } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync, realpathSync, openSync, closeSync, unlinkSync, renameSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

export function localOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw Error('Only a loopback HTTP origin is allowed');
  return url.origin;
}

export function attemptExposure(row) {
  if (row.state === 'released') return 0;
  return row.state === 'settled' ? Number(row.charged_micros ?? 0) : Number(row.reserved_micros);
}

export function budgetDecision(balance, exposure, reservation, ceiling) {
  if (![balance?.capMicros, balance?.committedMicros, exposure, reservation, ceiling].every((n) => Number.isSafeInteger(n) && n >= 0)) return 'invalid-ledger';
  if (balance.dailyMicros !== null && ![balance.dailyMicros, balance.todayMicros].every((n) => Number.isSafeInteger(n) && n >= 0)) return 'invalid-ledger';
  if (exposure + reservation > ceiling) return 'session-ceiling';
  if (balance.committedMicros + reservation > balance.capMicros) return 'pool-ceiling';
  if (balance.dailyMicros !== null && balance.todayMicros + reservation > balance.dailyMicros) return 'daily-ceiling';
  return null;
}

export function resultOf(text) {
  try { const value = JSON.parse(text); if (value.status) return value; } catch {}
  for (const line of text.split('\n')) {
    if (!line.startsWith('data:')) continue;
    try { const event = JSON.parse(line.slice(5)); if (event.kind === 'result') return event.result; } catch {}
  }
  return null;
}

/** One approved rehearsal retains its ceiling and attempt identities across operator restarts. */
export function approvedRun(file, balance) {
  const saved = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { version: 1, run: 'sample-sketch-faithful-2026-11-04', ceilingMicros: 5_000_000, started: new Date().toISOString(), initialBalance: balance, attempts: [] };
  if (saved.version !== 1 || saved.run !== 'sample-sketch-faithful-2026-11-04' || saved.ceilingMicros !== 5_000_000 || !Array.isArray(saved.attempts)) throw Error('The approved rehearsal record changed; review before running');
  const owned = new Map(saved.attempts);
  for (const [id, entry] of owned) if (typeof id !== 'string' || !Number.isSafeInteger(entry.reservation) || entry.reservation < 0 || typeof entry.noCharge !== 'boolean') throw Error('Invalid retained rehearsal attempt');
  const persist = () => { saved.attempts = [...owned]; writeFileSync(`${file}.tmp`, JSON.stringify(saved, null, 2), { mode: 0o600 }); renameSync(`${file}.tmp`, file); };
  persist();
  return { owned, persist, snapshot: () => saved };
}

/** Serial release means each next request sees the previous request's actual settlement or retained reservation. */
export function createGuard({ upstream, ledger, shapes, reserve, ceilingMicros = 5_000_000, armed = false, record = () => {}, owned = new Map(), persist = () => {} }) {
  upstream = localOrigin(upstream);
  let chain = Promise.resolve();
  let stopped = false;
  const exposure = () => [...owned].reduce((sum, [id, pending]) => sum + (ledger.attempt(id) ? attemptExposure(ledger.attempt(id)) : pending.noCharge ? 0 : pending.reservation), 0);
  const block = (response, entry, reason) => {
    const reply = { status: 'fallback', reason: reason === 'session-ceiling' || reason.endsWith('ceiling') ? 'budget' : reason };
    record({ ...entry, sent: false, blocked: reason, reply, sessionExposureMicros: exposure() });
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(reply));
  };
  const forward = (request, response, body, entry) => new Promise((done) => {
    const started = Date.now();
    const headers = { ...request.headers, host: new URL(upstream).host };
    const incoming = new URL(request.url, 'http://127.0.0.1');
    const targetUrl = new URL(upstream);
    targetUrl.pathname = incoming.pathname;
    targetUrl.search = incoming.search;
    const target = httpRequest(targetUrl, { method: request.method, headers }, (source) => {
      response.writeHead(source.statusCode ?? 502, source.headers);
      const chunks = [], thinking = [], decoder = new TextDecoder();
      let eventBuffer = '';
      source.on('data', (chunk) => {
        if (entry) {
          chunks.push(chunk);
          eventBuffer += decoder.decode(chunk, { stream: true }).replaceAll('\r', '');
          for (let end = eventBuffer.indexOf('\n\n'); end >= 0; end = eventBuffer.indexOf('\n\n')) {
            const eventText = eventBuffer.slice(0, end).split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('');
            eventBuffer = eventBuffer.slice(end + 2);
            try { const event = JSON.parse(eventText); if (event.kind === 'thinking') thinking.push({ at: Date.now() - started, text: event.text }); } catch {}
          }
        }
        response.write(chunk);
      });
      const finish = () => {
        if (entry) {
          const text = Buffer.concat(chunks).toString('utf8');
          const reply = resultOf(text);
          const row = ledger.attempt(entry.attemptId);
          // A received local validation/refusal response with no ledger attempt never reached Meta.
          if (!row && reply?.status === 'fallback' && ['bad-input', 'disabled', 'busy', 'empty', 'today', 'quota', 'closed', 'conflict', 'duplicate', 'stopped'].includes(reply.reason)) { owned.get(entry.attemptId).noCharge = true; persist(); }
          record({ ...entry, sent: true, ms: Date.now() - started, httpStatus: source.statusCode, reply, thinking, response: text, receipt: row, sessionExposureMicros: exposure(), balance: ledger.balance() });
          if (!reply || (reply.status === 'fallback' && !['bad-input', 'disabled', 'busy', 'empty', 'daily', 'visitor'].includes(reply.reason))) stopped = true;
        }
        response.end(); done();
      };
      source.once('end', finish);
      source.once('error', () => { stopped = true; if (entry) record({ ...entry, sent: true, reply: null, transportError: true, receipt: ledger.attempt(entry.attemptId), sessionExposureMicros: exposure() }); response.destroy(); done(); });
    });
    target.once('error', () => {
      stopped = true;
      if (entry) record({ ...entry, sent: true, reply: null, transportError: true, receipt: ledger.attempt(entry.attemptId), sessionExposureMicros: exposure() });
      if (!response.headersSent) response.writeHead(502);
      response.end('The local Worker connection failed. Further calls are blocked.'); done();
    });
    // Let settlement finish even when the browser closes its side of the stream.
    response.on('error', () => {});
    if (body) target.end(body); else request.pipe(target);
  });
  const handle = async (request, response) => {
    if (!request.url?.startsWith('/') || request.url.startsWith('//')) { response.writeHead(400); response.end('Only origin-form local paths are allowed'); return; }
    const url = new URL(request.url, 'http://127.0.0.1');
    const route = /^\/api\/spark\/([a-z_]+)$/.exec(url.pathname);
    if (!route) {
      if (url.pathname.startsWith('/api/') && !(url.pathname === '/api/ledger' && request.method === 'GET')) return block(response, {}, 'unknown-route');
      return forward(request, response);
    }
    const chunks = []; let size = 0;
    for await (const chunk of request) { size += chunk.length; if (size > 64 * 1024) { response.writeHead(413); response.end(); return; } chunks.push(chunk); }
    const body = Buffer.concat(chunks);
    let input;
    try { input = JSON.parse(body); } catch { return block(response, {}, 'bad-input'); }
    const entry = { at: new Date().toISOString(), shape: route[1], attemptId: input.attemptId, input: input.input };
    const operation = async () => {
      if (response.destroyed || request.aborted) { record({ ...entry, sent: false, blocked: 'browser-left-before-release', sessionExposureMicros: exposure() }); return; }
      if (!armed) return block(response, entry, 'rehearsal-unarmed');
      if (stopped) return block(response, entry, 'rehearsal-stopped');
      if (request.headers['x-motifold-key'] !== undefined) return block(response, entry, 'own-key-outside-dev-budget');
      if (request.method !== 'POST' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(entry.attemptId ?? '') || !shapes[entry.shape]) return block(response, entry, 'bad-input');
      if (owned.has(entry.attemptId) || ledger.attempt(entry.attemptId)) return block(response, entry, 'reused-attempt-id');
      const reservation = reserve(shapes[entry.shape].maxOutputTokens);
      const reason = budgetDecision(ledger.balance(), exposure(), reservation, ceilingMicros);
      if (reason) return block(response, entry, reason);
      owned.set(entry.attemptId, { reservation, noCharge: false });
      persist(); // Durable before the HTTP request can reach the Worker or Meta.
      record({ ...entry, sent: 'releasing', reservationMicros: reservation, sessionExposureMicros: exposure(), balance: ledger.balance() });
      await forward(request, response, body, { ...entry, reservationMicros: reservation });
    };
    chain = chain.then(operation).catch((error) => { stopped = true; block(response, entry, 'guard-error'); record({ kind: 'guard-error', message: error.message }); });
  };
  const server = httpServer((request, response) => { void handle(request, response).catch(() => { stopped = true; if (!response.destroyed) { response.writeHead(400); response.end('The local request could not be read. Further calls are blocked.'); } }); });
  return { server, exposure, stop: () => { stopped = true; } };
}

export function sqliteLedger(file) {
  return import('node:sqlite').then(({ DatabaseSync }) => {
    const db = new DatabaseSync(file, { readOnly: true });
    const committed = "COALESCE(SUM(CASE state WHEN 'settled' THEN charged_micros WHEN 'released' THEN 0 ELSE reserved_micros END),0)";
    return {
      close: () => db.close(),
      balance() {
        const pool = db.prepare('SELECT cap_micros,daily_micros FROM pools WHERE id=?').get('dev');
        if (!pool) throw Error('The existing dev pool is absent');
        return { capMicros: pool.cap_micros, dailyMicros: pool.daily_micros, committedMicros: db.prepare(`SELECT ${committed} AS amount FROM attempts WHERE pool=?`).get('dev').amount, todayMicros: db.prepare(`SELECT ${committed} AS amount FROM attempts WHERE pool=? AND day=?`).get('dev', Math.floor(Date.now() / 86_400_000)).amount };
      },
      attempt(id) {
        const row = db.prepare('SELECT id,shape,pool,state,reserved_micros,charged_micros,detail FROM attempts WHERE id=?').get(id);
        if (!row) return null;
        let detail = {}; try { detail = JSON.parse(row.detail ?? '{}'); } catch {}
        const { usage, searches, ms, reservedMicros, chargedMicros, overBound, unusable, rejected } = detail;
        return { id: row.id, shape: row.shape, pool: row.pool, state: row.state, reserved_micros: row.reserved_micros, charged_micros: row.charged_micros, usage, searches, ms, reservedMicros, chargedMicros, overBound, unusable, rejected };
      },
    };
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('After the coordinated go-ahead and a fresh production build:\nnode tools/live-rehearsal.mjs --repo <repo> --start-worker --armed [--out <local receipts directory>]\nOpen http://127.0.0.1:8788/?record and use one browser flow. The proxy starts no model call itself.\nWithout --armed, all model requests are refused. The existing ledger and its $26 cap are never reset or raised.');
    return;
  }
  const value = (name, fallback) => { const at = args.indexOf(name); return at < 0 ? fallback : args[at + 1]; };
  const repo = resolve(value('--repo', process.cwd()));
  const output = resolve(value('--out', join(repo, 'output/live-rehearsal', new Date().toISOString().replaceAll(':', '-'))));
  const upstream = localOrigin(value('--upstream', 'http://127.0.0.1:8790'));
  const port = Number(value('--port', '8788'));
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === Number(new URL(upstream).port)) throw Error('Invalid guard port');
  const shared = resolve(process.env.HOME, '.config/phasecraft/motifold-dev-ledger');
  if (realpathSync(join(repo, '.wrangler/state')) !== realpathSync(shared)) throw Error('Refusing a fresh or different ledger');
  const { readdirSync } = await import('node:fs');
  const dbDir = join(shared, 'v3/do/motifold-LedgerObject');
  const files = readdirSync(dbDir).filter((name) => name.endsWith('.sqlite') && name !== 'metadata.sqlite');
  if (files.length !== 1) throw Error('Expected exactly one existing shared ledger database');
  const ledger = await sqliteLedger(join(dbDir, files[0]));
  const { createServer } = await import('vite');
  const modules = await createServer({ root: repo, configFile: false, server: { middlewareMode: true }, appType: 'custom' });
  const { SHAPES } = await modules.ssrLoadModule('/server/shapes.ts');
  const { reservationMicros } = await modules.ssrLoadModule('/server/prices.ts');
  await modules.close();
  mkdirSync(output, { recursive: true });
  const baseline = ledger.balance();
  if (baseline.capMicros !== 26_000_000) throw Error('The existing approved dev cap changed; review before running');
  const lockPath = join(shared, 'live-rehearsal.lock');
  const lock = openSync(lockPath, 'wx', 0o600);
  writeFileSync(lock, JSON.stringify({ pid: process.pid, started: new Date().toISOString(), output }));
  let child;
  process.once('exit', () => { child?.kill(); closeSync(lock); unlinkSync(lockPath); });
  const run = approvedRun(join(shared, 'live-rehearsal-approved-run.json'), baseline);
  const baselineFile = join(output, 'baseline.json');
  if (!existsSync(baselineFile)) writeFileSync(baselineFile, JSON.stringify({ at: new Date().toISOString(), repo, upstream, port, ceilingMicros: 5_000_000, armed: args.includes('--armed'), balance: baseline, approvedRun: run.snapshot() }, null, 2));
  const calls = [];
  const guard = createGuard({ upstream, ledger, shapes: SHAPES, reserve: reservationMicros, owned: run.owned, persist: run.persist, armed: args.includes('--armed'), record(entry) {
    appendFileSync(join(output, 'receipts.jsonl'), JSON.stringify(entry) + '\n');
    if (entry.sent !== 'releasing' && entry.shape) {
      const { version, model, ...reply } = entry.reply ?? { status: 'fallback', reason: 'unreachable' };
      calls.push({ shape: entry.shape, input: entry.input, reply, ms: entry.ms ?? 0, thinking: entry.thinking ?? [], version, model, usage: entry.receipt?.usage });
      writeFileSync(join(output, `calls-${process.pid}.json`), JSON.stringify(calls, null, 2));
      console.log(JSON.stringify({ shape: entry.shape, sent: entry.sent, status: entry.reply?.status, reason: entry.blocked ?? entry.reply?.reason, state: entry.receipt?.state, chargedMicros: entry.receipt?.charged_micros, sessionExposureMicros: entry.sessionExposureMicros }));
    }
  } });
  if (args.includes('--start-worker')) {
    if (!existsSync(join(repo, 'dist/index.html')) || !existsSync(join(repo, '.dev.vars'))) throw Error('Build production assets and provide the existing ignored .dev.vars first');
    child = spawn(join(repo, 'node_modules/.bin/wrangler'), ['dev', '--local', '--var', 'MODE:dev', '--ip', '127.0.0.1', '--port', new URL(upstream).port, '--persist-to', shared, '--log-level', 'warn'], { cwd: repo, stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
    child.on('exit', () => { guard.stop(); });
    child.on('error', () => { guard.stop(); });
  }
  let ready = false;
  for (let tries = 0; tries < 100; tries++) {
    try { const response = await fetch(`${upstream}/api/ledger`); const balance = await response.json(); if (balance.capMicros === baseline.capMicros && balance.committedMicros === ledger.balance().committedMicros) { ready = true; break; } } catch {}
    await new Promise((done) => setTimeout(done, 250));
  }
  try {
    if (!ready) throw Error('The local dev Worker is not ready on the expected existing ledger');
    await new Promise((done, reject) => { guard.server.once('error', reject); guard.server.listen(port, '127.0.0.1', done); });
  } catch (error) { child?.kill(); ledger.close(); throw error; }
  console.log(`Local ${args.includes('--armed') ? 'ARMED' : 'UNARMED'} rehearsal: http://127.0.0.1:${port}/?record`);
  console.log(`Receipts: ${output}. New exposure ceiling $5. Existing ledger cap unchanged.`);
  const finish = () => { guard.stop(); guard.server.close(); child?.kill(); ledger.close(); process.exit(0); };
  process.once('SIGINT', finish); process.once('SIGTERM', finish);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
