// Local browser pages, the real Worker, and its existing ledger. The server key stays in the Worker. Headers are never recorded.
// Defaults to unarmed. Start only after the coordinated live go-ahead and a fresh production build.
import { createServer as httpServer, request as httpRequest } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync, realpathSync, openSync, closeSync, unlinkSync, renameSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';

export const RECORDING_PROFILES = Object.freeze({
  rehearsal: Object.freeze({ run: 'sample-sketch-faithful-2026-11-04', ceilingMicros: 5_000_000, poolCapMicros: 26_000_000, recordName: 'live-rehearsal-approved-run.json' }),
  'night-204': Object.freeze({ run: 'motifold-night-204-2026-11-04', ceilingMicros: 23_000_000, poolCapMicros: 44_048_076, recordName: 'live-night-204-approved-run.json' }),
  'focused-cute-test': Object.freeze({ run: 'motifold-cute-test-2026-11-04', ceilingMicros: 5_000_000, poolCapMicros: 47_616_543, initialCommittedMicros: 42_616_543, priorPoolCapMicros: 44_048_076, recordName: 'live-cute-test-approved-run.json' }),
});

export function recordingProfile(name = 'rehearsal') {
  if (!Object.hasOwn(RECORDING_PROFILES, name)) throw Error('Unknown approved recording profile');
  const profile = RECORDING_PROFILES[name];
  if (!profile) throw Error('Unknown approved recording profile');
  return profile;
}

/** The focused allowance is a new approval, never a renamed or reset old recording run. */
function cuteBaseline(saved, profile) {
  if (profile !== RECORDING_PROFILES['focused-cute-test']) return;
  if (saved.initialBalance?.committedMicros !== profile.initialCommittedMicros || saved.initialBalance?.capMicros !== profile.priorPoolCapMicros || saved.initialBalance?.dailyMicros !== null) throw Error('The focused test baseline changed; preserve the approved starting exposure');
}

/** Readonly startup proof, before an approval is created or rewritten or a Worker starts. */
export function validateFocusedCuteStart(snapshot, saved = null) {
  const profile = RECORDING_PROFILES['focused-cute-test'];
  if (!(snapshot?.attempts instanceof Map) || !Array.isArray(snapshot.pendingAttempts) || snapshot.pendingAttempts.length) throw Error('The focused test requires a drained readonly ledger snapshot');
  const balance = snapshot.balance;
  if (![balance?.capMicros, balance?.committedMicros].every(n => Number.isSafeInteger(n) && n >= 0) || balance.dailyMicros !== null) throw Error('Invalid focused test balance');
  if (!saved) {
    cuteBaseline({ initialBalance: balance }, profile);
    return;
  }
  if (saved.version !== 1 || saved.run !== profile.run || saved.ceilingMicros !== profile.ceilingMicros || !Array.isArray(saved.attempts)) throw Error('The focused test approval changed');
  cuteBaseline(saved, profile);
  const owned = new Map(saved.attempts);
  if (owned.size !== saved.attempts.length) throw Error('Duplicate focused test ownership');
  let exposure = 0;
  for (const [id, entry] of owned) {
    if (typeof id !== 'string' || !Number.isSafeInteger(entry?.reservation) || entry.reservation < 0 || typeof entry.noCharge !== 'boolean') throw Error('Invalid focused test ownership');
    const row = snapshot.attempts.get(id);
    if (!row) {
      if (!entry.noCharge) throw Error('A provisional focused test attempt prevents restart');
      continue;
    }
    if (row.id !== id || row.pool !== 'dev' || !['settled', 'released'].includes(row.state)) throw Error('An unknown or unfinished focused test attempt prevents restart');
    const charge = attemptExposure(row);
    if (!Number.isSafeInteger(charge) || charge < 0 || charge > entry.reservation) throw Error('Invalid focused test settlement');
    exposure += charge;
  }
  if (exposure > profile.ceilingMicros || balance.committedMicros !== profile.initialCommittedMicros + exposure) throw Error('The focused test cumulative baseline changed');
  if (balance.capMicros !== profile.poolCapMicros && !(owned.size === 0 && balance.capMicros === profile.priorPoolCapMicros)) throw Error('The focused test dev cap changed');
}

/** These exact operator tags authorize only the two requested jobs, never matrix or repair work. */
export function focusedCuteRequest(entry) {
  if (!['cute-arrange', 'cute-sad-recompose'].includes(entry.captureCase) || !entry.input || entry.input.fix != null) return false;
  if (['read_bars', 'read_piece', 'study_score'].includes(entry.shape)) return true;
  const input = entry.input;
  if (entry.captureCase === 'cute-arrange') {
    if (input.intent !== 'arrange' || input.tuneOnly || input.seed) return false;
    if (entry.shape === 'distribute') return true;
    return ['plan_options', 'arrange'].includes(entry.shape) && input.moreBars === 0 && input.where === 'inside';
  }
  if (input.ask !== 'The mood I want: sad.' || input.freedom !== 2 || input.intent === 'expand') return false;
  if (['plan_recompose', 'write_theme'].includes(entry.shape)) return input.where === 'after' && Number.isInteger(input.moreBars) && input.moreBars > 0;
  return entry.shape === 'arrange' && input.where === 'inside' && input.moreBars === 0 && !!input.seed;
}

export function validateFocusedCuteMode({ startWorker, isolate, waveWidth }) {
  if (!startWorker || !isolate || waveWidth !== 1) throw Error('focused-cute-test requires serial --start-worker --isolate-settled');
}

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

/** Maintenance receipts are not model calls and must never enter the recorded answer bundle. */
export function recordedCall(entry) {
  if (typeof entry.sent !== 'boolean' || !entry.shape) return null;
  const { version, model, ...reply } = entry.reply ?? { status: 'fallback', reason: 'unreachable' };
  return { shape: entry.shape, input: entry.input, reply, ms: entry.ms ?? 0, thinking: entry.thinking ?? [], version, model, usage: entry.receipt?.usage, ...(entry.captureCase ? { captureCase: entry.captureCase, attemptId: entry.attemptId } : {}) };
}

/** One approved rehearsal retains its ceiling and attempt identities across operator restarts. */
export function approvedRun(file, balance, profile = RECORDING_PROFILES.rehearsal) {
  const saved = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { version: 1, run: profile.run, ceilingMicros: profile.ceilingMicros, started: new Date().toISOString(), initialBalance: balance, attempts: [] };
  if (saved.version !== 1 || saved.run !== profile.run || saved.ceilingMicros !== profile.ceilingMicros || !Array.isArray(saved.attempts)) throw Error('The approved rehearsal record changed; review before running');
  cuteBaseline(saved, profile);
  const owned = new Map(saved.attempts);
  for (const [id, entry] of owned) if (typeof id !== 'string' || !Number.isSafeInteger(entry.reservation) || entry.reservation < 0 || typeof entry.noCharge !== 'boolean') throw Error('Invalid retained rehearsal attempt');
  const persist = () => { saved.attempts = [...owned]; writeFileSync(`${file}.tmp`, JSON.stringify(saved, null, 2), { mode: 0o600 }); renameSync(`${file}.tmp`, file); };
  persist();
  return { owned, persist, snapshot: () => saved };
}

/** Startup-only operator review. It validates retained holds without changing financial state. */
export function reviewRetainedNightHolds(run, ledger, audit = null) {
  const saved = run.snapshot(), profile = RECORDING_PROFILES['night-204'];
  const iso = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
  if (saved.run !== profile.run || saved.ceilingMicros !== profile.ceilingMicros || !iso(saved.started)) throw Error('The retained night run identity changed; review before running');
  const snapshot = ledger.snapshot([...run.owned.keys()]);
  if (!(snapshot?.attempts instanceof Map) || !Array.isArray(snapshot.pendingAttempts)) throw Error('A complete readonly startup ledger snapshot is required');
  if (snapshot.pendingAttempts.length) throw Error('Pending ledger attempts must finish before a night restart');
  const uncertain = [];
  for (const [id, entry] of run.owned) {
    const row = snapshot.attempts.get(id);
    if (!row) {
      if (!entry.noCharge) throw Error('A provisional owned attempt prevents a night restart');
      continue;
    }
    if (row.state === 'uncertain') {
      if (row.pool !== 'dev' || row.id !== id || !Number.isSafeInteger(row.reserved_micros) || row.reserved_micros <= 0 || row.reserved_micros !== entry.reservation || row.charged_micros != null) throw Error('The retained uncertain reservation does not match its owned attempt');
      uncertain.push({ attemptId: id, reservationMicros: row.reserved_micros });
    } else if (!['settled', 'released'].includes(row.state)) throw Error('An unfinished owned attempt prevents a night restart');
  }
  if (!uncertain.length && audit === null) return null;
  if (!audit) throw Error('Retained uncertain holds require an explicit --review-uncertain operator audit');
  const keys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('|') === [...expected].sort().join('|');
  if (!keys(audit, ['version', 'run', 'started', 'ceilingMicros', 'reviewedAt', 'uncertain', 'noPendingAttempts', 'noProvisionalAttempts', 'preserveEveryHold']) || audit.version !== 1 || audit.run !== saved.run || audit.started !== saved.started || audit.ceilingMicros !== saved.ceilingMicros || !iso(audit.reviewedAt) || Date.parse(audit.reviewedAt) < Date.parse(saved.started) || Date.parse(audit.reviewedAt) > Date.now() + 60_000 || audit.noPendingAttempts !== true || audit.noProvisionalAttempts !== true || audit.preserveEveryHold !== true || !Array.isArray(audit.uncertain)) throw Error('The operator audit must match this retained run and preserve every hold');
  const reviewed = new Map();
  for (const hold of audit.uncertain) {
    if (!keys(hold, ['attemptId', 'reservationMicros']) || typeof hold.attemptId !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(hold.attemptId) || !Number.isSafeInteger(hold.reservationMicros) || hold.reservationMicros <= 0 || reviewed.has(hold.attemptId)) throw Error('Invalid or duplicate uncertain hold in the operator audit');
    reviewed.set(hold.attemptId, hold.reservationMicros);
  }
  if (!uncertain.length || reviewed.size !== uncertain.length || uncertain.some(hold => reviewed.get(hold.attemptId) !== hold.reservationMicros)) throw Error('The operator audit must name every exact retained uncertain UUID and reservation');
  return { ...audit, uncertain: uncertain.sort((a, b) => a.attemptId.localeCompare(b.attemptId)) };
}

/** Every admission accounts for actual settlements and all retained or provisional reservations. */
export function createGuard({ upstream, ledger, shapes, reserve, ceilingMicros = 5_000_000, armed = false, record = () => {}, owned = new Map(), persist = () => {}, afterSettled, continueSettledFailures = false, requireCaptureCase = false, allowRequest, waveWidth = 1 }) {
  upstream = localOrigin(upstream);
  if (![1, 2, 4].includes(waveWidth)) throw Error('Wave width must be 1, 2 or 4');
  const concurrent = waveWidth > 1;
  if (concurrent && (typeof afterSettled !== 'function' || typeof ledger.snapshot !== 'function')) throw Error('Concurrent waves require owned Worker isolation and atomic ledger snapshots');
  let chain = Promise.resolve();
  let stopped = false;
  let activeWave = null;
  const terminal = (entry) => { if (concurrent && activeWave && activeWave.id === entry.waveId) activeWave.seal(); };
  const exposure = () => [...owned].reduce((sum, [id, pending]) => sum + (ledger.attempt(id) ? attemptExposure(ledger.attempt(id)) : pending.noCharge ? 0 : pending.reservation), 0);
  // The readonly snapshot prevents a row appearing between balance and attempt reads from
  // disappearing from both sums. A reservation not visible in SQLite is still fully owned here.
  const waveBudget = (reservation) => {
    const snapshot = ledger.snapshot([...owned.keys()]);
    if (!(snapshot?.attempts instanceof Map) || !snapshot.balance) return 'invalid-ledger';
    let committed = 0, provisional = 0;
    for (const [id, pending] of owned) {
      const row = snapshot.attempts.get(id);
      committed += row ? attemptExposure(row) : pending.noCharge ? 0 : pending.reservation;
      if (!row && !pending.noCharge) provisional += pending.reservation;
    }
    return budgetDecision({ ...snapshot.balance, committedMicros: snapshot.balance.committedMicros + provisional, todayMicros: snapshot.balance.todayMicros + provisional }, committed, reservation, ceilingMicros);
  };
  const block = (response, entry, reason) => {
    terminal(entry);
    const reply = { status: 'fallback', reason: reason === 'session-ceiling' || reason.endsWith('ceiling') ? 'budget' : reason };
    record({ ...entry, sent: false, blocked: reason, reply, sessionExposureMicros: exposure() });
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(reply));
  };
  const forward = (request, response, body, entry) => new Promise((done) => {
    const started = Date.now();
    let finishing = false;
    const headers = { ...request.headers, host: new URL(upstream).host };
    const incoming = new URL(request.url, 'http://127.0.0.1');
    const targetUrl = new URL(upstream);
    targetUrl.pathname = incoming.pathname;
    targetUrl.search = incoming.search;
    const target = httpRequest(targetUrl, { method: request.method, headers }, (source) => {
      if (entry && (source.statusCode < 200 || source.statusCode >= 300)) terminal(entry);
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
            try {
              const event = JSON.parse(eventText);
              if (event.kind === 'thinking') thinking.push({ at: Date.now() - started, text: event.text });
              if (event.kind === 'result') terminal(entry);
            } catch {}
          }
          if (!String(source.headers['content-type'] ?? '').includes('event-stream')) {
            try { if (JSON.parse(Buffer.concat(chunks).toString('utf8'))?.status) terminal(entry); } catch {}
          }
        }
        response.write(chunk);
      });
      const finish = async () => {
        if (finishing) return;
        finishing = true;
        let isolation;
        if (entry) {
          const text = Buffer.concat(chunks).toString('utf8');
          const reply = resultOf(text);
          const row = ledger.attempt(entry.attemptId);
          // The trusted Worker explicitly identifies cache hits. Neither they nor local refusals dispatched Meta.
          const cached = reply?.status === 'ok' && reply.cached === true;
          const refused = reply?.status === 'fallback' && ['bad-input', 'disabled', 'busy', 'empty', 'today', 'quota', 'closed', 'conflict', 'duplicate', 'stopped'].includes(reply.reason);
          if (!row && (cached || refused)) { owned.get(entry.attemptId).noCharge = true; persist(); }
          record({ ...entry, sent: true, ms: Date.now() - started, httpStatus: source.statusCode, reply, thinking, response: text, receipt: row, sessionExposureMicros: exposure(), balance: ledger.balance() });
          // A rejected answer with reported usage has settled. The night recorder may move on
          // after isolating that runtime; it does not automatically retry the failed request.
          const settledFailure = continueSettledFailures && reply?.status === 'fallback' && ['failed', 'rejected'].includes(reply.reason) && row?.state === 'settled' && Number.isSafeInteger(row.charged_micros) && row.charged_micros >= 0;
          if (!reply || (reply.status === 'fallback' && !['bad-input', 'disabled', 'busy', 'empty', 'daily', 'visitor'].includes(reply.reason) && !settledFailure)) stopped = true;
          if (afterSettled && !stopped && ((reply?.status === 'ok' && !cached) || settledFailure)) {
            if ((!settledFailure && reply.cached !== false) || row?.state !== 'settled' || (concurrent && (!Number.isSafeInteger(row.charged_micros) || row.charged_micros < 0))) {
              stopped = true;
              record({ kind: 'worker-isolation', phase: 'blocked-missing-settlement', attemptId: entry.attemptId });
            } else isolation = { attemptId: entry.attemptId, shape: entry.shape };
          }
        }
        // The result and settled receipt are complete before maintenance begins. The serial chain
        // keeps the next browser call (including ledger polling) out of the retiring runtime.
        response.end();
        if (isolation && waveWidth === 1) {
          record({ kind: 'worker-isolation', phase: 'starting', ...isolation });
          try { await afterSettled(isolation); record({ kind: 'worker-isolation', phase: 'ready', ...isolation }); }
          catch { stopped = true; record({ kind: 'worker-isolation', phase: 'failed', ...isolation }); }
        }
        done(isolation);
      };
      source.once('end', () => { void finish().catch(() => { stopped = true; response.end(); done(); }); });
      source.once('error', () => { if (finishing) return; finishing = true; stopped = true; if (entry) record({ ...entry, sent: true, reply: null, transportError: true, receipt: ledger.attempt(entry.attemptId), sessionExposureMicros: exposure() }); response.destroy(); done(); });
    });
    target.once('error', () => {
      if (finishing) return;
      finishing = true;
      stopped = true;
      if (entry) record({ ...entry, sent: true, reply: null, transportError: true, receipt: ledger.attempt(entry.attemptId), sessionExposureMicros: exposure() });
      if (!response.headersSent) response.writeHead(502);
      response.end('The local Worker connection failed. Further calls are blocked.'); done();
    });
    // Let settlement finish even when the browser closes its side of the stream.
    response.on('error', () => {});
    if (body) target.end(body); else request.pipe(target);
  });
  // Further requests can join while the wave is still in flight. It seals when full
  // or at its first terminal result, and drains completely before one owned-runtime restart.
  // GETs wait behind the wave; they cannot prevent the remaining paid slots from joining.
  const queue = [];
  let draining = false, scheduled = false, nextWave = 0;
  const schedule = () => {
    if (draining || scheduled) return;
    scheduled = true;
    setImmediate(() => { scheduled = false; void drain(); });
  };
  const enqueue = (kind, run, response, entry = {}) => new Promise((done) => {
    const job = { kind, run, response, entry, done };
    if (kind === 'paid' && activeWave && !activeWave.sealed && !stopped) joinWave(activeWave, job);
    else { queue.push(job); schedule(); }
  });
  const runQueued = async (job, wave) => {
    try { return await job.run(wave); }
    catch (error) {
      stopped = true;
      try {
        if (!job.response.headersSent) block(job.response, job.entry, 'guard-error'); else job.response.end();
        record({ kind: 'guard-error', message: error.message });
      } catch { job.response.end(); }
    }
  };
  const joinWave = (wave, job) => {
    if (wave.sealed || wave.jobs.length >= waveWidth) throw Error('A sealed wave cannot admit another request');
    const waveSlot = wave.jobs.length;
    wave.jobs.push(job);
    // Admission is synchronous until the HTTP request is started, including durable ownership
    // and atomic ledger accounting. A new slot therefore sees all earlier provisional holds.
    wave.results.push(runQueued(job, { waveId: wave.id, waveSlot, waveCapacity: waveWidth }).finally(() => wave.seal()));
    if (wave.jobs.length === waveWidth) wave.seal();
  };
  const drain = async () => {
    if (draining) return;
    draining = true;
    let currentJob;
    try {
      while (queue.length) {
        const first = currentJob = queue.shift();
        if (first.kind === 'get') { await runQueued(first); first.done(); continue; }
        const waveId = ++nextWave;
        let seal;
        const wave = activeWave = { id: waveId, jobs: [], results: [], sealed: false, complete: new Promise(done => { seal = done; }), seal() { if (!this.sealed) { this.sealed = true; seal(); } } };
        record({ kind: 'worker-wave', phase: 'releasing', waveId, capacity: waveWidth });
        joinWave(wave, first);
        // A queued GET cannot obstruct paid requests for this still-open wave.
        while (!wave.sealed && !stopped && wave.jobs.length < waveWidth) {
          const paid = queue.findIndex(job => job.kind === 'paid');
          if (paid < 0) break;
          joinWave(wave, queue.splice(paid, 1)[0]);
        }
        await wave.complete;
        const results = await Promise.all(wave.results);
        activeWave = null;
        const settled = results.filter(Boolean);
        if (!stopped && settled.length) {
          const isolation = { ...settled[0], waveId, attemptIds: settled.map(item => item.attemptId), shapes: settled.map(item => item.shape) };
          record({ kind: 'worker-isolation', phase: 'starting', ...isolation });
          try { await afterSettled(isolation); record({ kind: 'worker-isolation', phase: 'ready', ...isolation }); }
          catch { stopped = true; record({ kind: 'worker-isolation', phase: 'failed', ...isolation }); }
        }
        record({ kind: 'worker-wave', phase: stopped ? 'stopped' : 'drained', waveId, size: wave.jobs.length });
        wave.jobs.forEach(job => job.done());
        currentJob = undefined;
      }
    } catch {
      stopped = true;
      // An audit/maintenance failure cannot leave orphaned jobs eligible for later release.
      const waiting = new Set([currentJob, ...(activeWave?.jobs ?? []), ...queue.splice(0)].filter(Boolean));
      activeWave = null;
      for (const job of waiting) {
        if (!job.response.writableEnded) { if (!job.response.headersSent) job.response.writeHead(503); job.response.end('The local guard stopped.'); }
        job.done();
      }
    } finally { draining = false; if (queue.length) schedule(); }
  };
  const handle = async (request, response) => {
    if (!request.url?.startsWith('/') || request.url.startsWith('//')) { response.writeHead(400); response.end('Only origin-form local paths are allowed'); return; }
    const url = new URL(request.url, 'http://127.0.0.1');
    const route = /^\/api\/spark\/([a-z_]+)$/.exec(url.pathname);
    if (!route) {
      if (url.pathname.startsWith('/api/') && !(['/api/ledger', '/api/access'].includes(url.pathname) && request.method === 'GET')) return block(response, {}, 'unknown-route');
      if (concurrent) {
        if (request.method !== 'GET') return block(response, {}, 'unknown-route');
        return enqueue('get', () => forward(request, response), response);
      }
      chain = chain.then(() => forward(request, response));
      return chain;
    }
    const chunks = []; let size = 0;
    for await (const chunk of request) { size += chunk.length; if (size > 64 * 1024) { response.writeHead(413); response.end(); return; } chunks.push(chunk); }
    const body = Buffer.concat(chunks);
    let input;
    try { input = JSON.parse(body); } catch { return block(response, {}, 'bad-input'); }
    const captureCase = request.headers['x-motifold-record-case'];
    const entry = { at: new Date().toISOString(), shape: route[1], attemptId: input.attemptId, input: input.input, ...(typeof captureCase === 'string' && /^[a-z0-9-]{1,120}$/.test(captureCase) ? { captureCase } : {}) };
    const operation = async (wave) => {
      if (concurrent && wave) Object.assign(entry, wave);
      if (response.destroyed || request.aborted) { record({ ...entry, sent: false, blocked: 'browser-left-before-release', sessionExposureMicros: exposure() }); return; }
      if (!armed) return block(response, entry, 'rehearsal-unarmed');
      if (stopped) return block(response, entry, 'rehearsal-stopped');
      if (requireCaptureCase && !entry.captureCase) return block(response, entry, 'recording-case-required');
      if (request.headers['x-motifold-key'] !== undefined) return block(response, entry, 'own-key-outside-dev-budget');
      if (request.method !== 'POST' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(entry.attemptId ?? '') || !shapes[entry.shape]) return block(response, entry, 'bad-input');
      if (allowRequest && !allowRequest(entry)) return block(response, entry, 'recording-scope');
      if (owned.has(entry.attemptId) || ledger.attempt(entry.attemptId)) return block(response, entry, 'reused-attempt-id');
      const reservation = reserve(shapes[entry.shape].maxOutputTokens);
      const reason = concurrent ? waveBudget(reservation) : budgetDecision(ledger.balance(), exposure(), reservation, ceilingMicros);
      if (reason) return block(response, entry, reason);
      owned.set(entry.attemptId, { reservation, noCharge: false });
      persist(); // Durable before the HTTP request can reach the Worker or Meta.
      record({ ...entry, sent: 'releasing', reservationMicros: reservation, sessionExposureMicros: exposure(), balance: ledger.balance() });
      return await forward(request, response, body, { ...entry, reservationMicros: reservation });
    };
    if (concurrent) return enqueue('paid', operation, response, entry);
    chain = chain.then(operation).catch((error) => { stopped = true; block(response, entry, 'guard-error'); record({ kind: 'guard-error', message: error.message }); });
  };
  const server = httpServer((request, response) => { void handle(request, response).catch(() => { stopped = true; if (!response.destroyed) { response.writeHead(400); response.end('The local request could not be read. Further calls are blocked.'); } }); });
  return { server, exposure, stop: () => { stopped = true; } };
}

export function sqliteLedger(file) {
  return import('node:sqlite').then(({ DatabaseSync }) => {
    const db = new DatabaseSync(file, { readOnly: true });
    const committed = "COALESCE(SUM(CASE state WHEN 'settled' THEN charged_micros WHEN 'released' THEN 0 ELSE reserved_micros END),0)";
    const balance = () => {
        const pool = db.prepare('SELECT cap_micros,daily_micros FROM pools WHERE id=?').get('dev');
        if (!pool) throw Error('The existing dev pool is absent');
        return { capMicros: pool.cap_micros, dailyMicros: pool.daily_micros, committedMicros: db.prepare(`SELECT ${committed} AS amount FROM attempts WHERE pool=?`).get('dev').amount, todayMicros: db.prepare(`SELECT ${committed} AS amount FROM attempts WHERE pool=? AND day=?`).get('dev', Math.floor(Date.now() / 86_400_000)).amount };
    };
    const attempt = (id) => {
        const row = db.prepare('SELECT id,shape,pool,state,reserved_micros,charged_micros,detail FROM attempts WHERE id=?').get(id);
        if (!row) return null;
        let detail = {}; try { detail = JSON.parse(row.detail ?? '{}'); } catch {}
        const { usage, searches, ms, reservedMicros, chargedMicros, overBound, unusable, rejected } = detail;
        return { id: row.id, shape: row.shape, pool: row.pool, state: row.state, reserved_micros: row.reserved_micros, charged_micros: row.charged_micros, usage, searches, ms, reservedMicros, chargedMicros, overBound, unusable, rejected };
    };
    return {
      close: () => db.close(), balance, attempt,
      snapshot(ids) {
        // BEGIN establishes one readonly SQLite view for both aggregates and per-attempt rows.
        // No financial state, quota, lease or hold is changed by this transaction.
        db.exec('BEGIN');
        try {
          // Expired unowned holds no longer prove active work. Their full reservation
          // still remains in balance(); the startup gate separately checks every owned row.
          const pendingAttempts = db.prepare("SELECT id FROM attempts WHERE pool=? AND state IN ('reserved','dispatched') AND (lease_until IS NULL OR lease_until > ?)").all('dev', Date.now()).map(row => row.id);
          const result = { balance: balance(), attempts: new Map(ids.map(id => [id, attempt(id)])), pendingAttempts };
          db.exec('COMMIT'); return result;
        }
        catch (error) { db.exec('ROLLBACK'); throw error; }
      },
    };
  });
}

/** Only manages the child this rehearsal started; it never retries an API request. */
export function ownedWorker({ launch, ready, isDown, onUnexpectedExit, exitTimeoutMs = 10_000, readyTries = 100, readyDelayMs = 250 }) {
  let child;
  const expected = new WeakSet();
  const waitDown = async () => {
    for (let n = 0; n < readyTries; n++) {
      if (await isDown()) return;
      await new Promise((done) => setTimeout(done, readyDelayMs));
    }
    throw Error('The old Worker port is still listening; no successor was started');
  };
  const stop = async () => {
    const previous = child;
    child = undefined;
    if (!previous || previous.exitCode !== null || previous.signalCode !== null) return;
    expected.add(previous);
    await new Promise((done, reject) => {
      const timer = setTimeout(() => { previous.kill('SIGKILL'); reject(Error('The owned Worker did not exit cleanly')); }, exitTimeoutMs);
      previous.once('exit', () => { clearTimeout(timer); done(); });
      previous.kill('SIGTERM');
    });
    await waitDown();
  };
  const start = async () => {
    if (child) throw Error('The owned Worker is already running');
    if (!(await isDown())) throw Error('The Worker port is already occupied; refusing an unowned runtime');
    const next = child = launch();
    next.once('exit', () => { if (!expected.has(next)) onUnexpectedExit(); });
    next.once('error', () => { onUnexpectedExit(); });
    for (let n = 0; n < readyTries && next.exitCode === null && next.signalCode === null; n++) {
      try { if (await ready()) return; } catch {}
      await new Promise((done) => setTimeout(done, readyDelayMs));
    }
    await stop();
    throw Error('The owned Worker did not become ready on the existing ledger');
  };
  return { start, stop, kill: () => { if (child) { expected.add(child); child.kill(); } }, restart: async () => { await stop(); await start(); } };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('After a fresh production build:\nnode tools/live-rehearsal.mjs --repo <repo> --start-worker --armed --isolate-settled [--profile rehearsal|night-204|focused-cute-test] [--wave-width 1|2|4] [--out <receipts directory>]\nProfiles are explicit approvals, not fresh allowances on restart. rehearsal retains its $5 ceiling. night-204 retains its $23 batch ceiling. focused-cute-test is the separately approved $5 above $42.616543 committed, for a $47.616543 cumulative dev cap. It requires serial owned isolation and exact cute-arrange/cute-sad-recompose tags. Existing holds, the $100 public pool and the $1 personal reserve are preserved.\nThe night profile may proceed after a charged, settled rejection; it never retries a request. Unknown charges stop the guard.\nWave width defaults to 1. Widths 2 and 4 are optional for night-204 with owned isolation: more pages may join until capacity or the first terminal result. All released calls must finish before a single restart. This is a local capture option, not a production network fix.\nWithout --armed, all model requests are refused.');
    console.log('A night-204 restart refuses retained owned uncertain holds by default. Only an explicit --review-uncertain <local operator audit.json> can validate the exact retained run and UUID/reservation set after active and owned unfinished work has drained. This does not release holds, grant an allowance, retry requests or acknowledge a later unknown charge.');
    return;
  }
  const value = (name, fallback) => { const at = args.indexOf(name); return at < 0 ? fallback : args[at + 1]; };
  const profileName = value('--profile', 'rehearsal');
  const profile = recordingProfile(profileName);
  const reviewPath = value('--review-uncertain', null);
  if (args.includes('--review-uncertain') && (profileName !== 'night-204' || typeof reviewPath !== 'string' || reviewPath.startsWith('--'))) throw Error('--review-uncertain requires the night-204 profile and a local operator audit JSON path');
  const repo = resolve(value('--repo', process.cwd()));
  const output = resolve(value('--out', join(repo, 'output/live-rehearsal', new Date().toISOString().replaceAll(':', '-'))));
  const upstream = localOrigin(value('--upstream', 'http://127.0.0.1:8790'));
  const isolate = args.includes('--isolate-settled');
  if (isolate && !args.includes('--start-worker')) throw Error('--isolate-settled requires the guard-owned --start-worker');
  const waveWidth = Number(value('--wave-width', '1'));
  const focusedCute = profileName === 'focused-cute-test';
  if (focusedCute) validateFocusedCuteMode({ startWorker: args.includes('--start-worker'), isolate, waveWidth });
  if (![1, 2, 4].includes(waveWidth) || (waveWidth > 1 && (!isolate || profileName !== 'night-204'))) throw Error('--wave-width 2 or 4 requires the approved night-204 profile and --start-worker --isolate-settled');
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
  const { POOLS } = await modules.ssrLoadModule('/server/pools.ts');
  if (POOLS.find((pool) => pool.id === 'dev')?.capMicros !== profile.poolCapMicros) throw Error('The configured dev cap does not match this approved recording profile');
  await modules.close();
  mkdirSync(output, { recursive: true });
  const approvalFile = join(shared, profile.recordName);
  const saved = focusedCute && existsSync(approvalFile) ? JSON.parse(readFileSync(approvalFile, 'utf8')) : null;
  const startup = focusedCute ? ledger.snapshot(saved?.attempts?.map(([id]) => id) ?? []) : null;
  const baseline = startup?.balance ?? ledger.balance();
  if (focusedCute) validateFocusedCuteStart(startup, saved);
  else if (![26_000_000, profile.poolCapMicros].includes(baseline.capMicros)) throw Error('The existing approved dev cap changed; review before running');
  const lockPath = join(shared, 'live-rehearsal.lock');
  const lock = openSync(lockPath, 'wx', 0o600);
  writeFileSync(lock, JSON.stringify({ pid: process.pid, started: new Date().toISOString(), output }));
  let worker;
  process.once('exit', () => { worker?.kill(); closeSync(lock); unlinkSync(lockPath); });
  const run = approvedRun(approvalFile, baseline, profile);
  const retainedHoldReview = profileName === 'night-204' ? reviewRetainedNightHolds(run, ledger, reviewPath === null ? null : JSON.parse(readFileSync(resolve(reviewPath), 'utf8'))) : null;
  if (retainedHoldReview) appendFileSync(join(output, 'receipts.jsonl'), JSON.stringify({ kind: 'retained-hold-review', at: new Date().toISOString(), review: retainedHoldReview }) + '\n');
  const baselineFile = join(output, 'baseline.json');
  if (!existsSync(baselineFile)) writeFileSync(baselineFile, JSON.stringify({ at: new Date().toISOString(), repo, upstream, port, profile: profileName, waveWidth, ceilingMicros: profile.ceilingMicros, armed: args.includes('--armed'), balance: baseline, approvedRun: run.snapshot() }, null, 2));
  const calls = [];
  const guard = createGuard({ upstream, ledger, shapes: SHAPES, reserve: reservationMicros, ceilingMicros: profile.ceilingMicros, waveWidth, owned: run.owned, persist: run.persist, armed: args.includes('--armed'), continueSettledFailures: profileName === 'night-204', requireCaptureCase: profileName === 'night-204' || focusedCute, allowRequest: focusedCute ? focusedCuteRequest : undefined, afterSettled: isolate ? () => worker.restart() : undefined, record(entry) {
    appendFileSync(join(output, 'receipts.jsonl'), JSON.stringify(entry) + '\n');
    const call = recordedCall(entry);
    if (call) {
      calls.push(call);
      writeFileSync(join(output, `calls-${process.pid}.json`), JSON.stringify(calls, null, 2));
      console.log(JSON.stringify({ shape: entry.shape, sent: entry.sent, status: entry.reply?.status, reason: entry.blocked ?? entry.reply?.reason, state: entry.receipt?.state, chargedMicros: entry.receipt?.charged_micros, sessionExposureMicros: entry.sessionExposureMicros }));
    }
  } });
  const ready = async () => {
    const response = await fetch(`${upstream}/api/ledger`, { signal: AbortSignal.timeout(1000) });
    const balance = await response.json();
    return response.ok && balance.capMicros === profile.poolCapMicros && balance.committedMicros === ledger.balance().committedMicros;
  };
  const isDown = () => new Promise((done) => {
    const socket = createConnection({ host: '127.0.0.1', port: new URL(upstream).port });
    const finish = (down) => { socket.destroy(); done(down); };
    socket.once('connect', () => finish(false));
    socket.once('error', (error) => finish(error.code === 'ECONNREFUSED'));
    socket.setTimeout(1000, () => finish(false));
  });
  if (args.includes('--start-worker')) {
    if (!existsSync(join(repo, 'dist/index.html')) || !existsSync(join(repo, '.dev.vars'))) throw Error('Build production assets and provide the existing ignored .dev.vars first');
    worker = ownedWorker({ ready, isDown, onUnexpectedExit: guard.stop, launch: () => spawn(join(repo, 'node_modules/.bin/wrangler'), ['dev', '--local', '--var', 'MODE:dev', '--ip', '127.0.0.1', '--port', new URL(upstream).port, '--persist-to', shared, '--log-level', 'warn'], { cwd: repo, stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } }) });
  }
  try {
    if (worker) await worker.start();
    else if (!(await ready())) throw Error('The local dev Worker is not ready on the expected existing ledger');
    await new Promise((done, reject) => { guard.server.once('error', reject); guard.server.listen(port, '127.0.0.1', done); });
  } catch (error) { worker?.kill(); ledger.close(); throw error; }
  console.log(`Local ${args.includes('--armed') ? 'ARMED' : 'UNARMED'} rehearsal: http://127.0.0.1:${port}/?record`);
  console.log(`Receipts: ${output}. Profile ${profileName}; new exposure ceiling $${profile.ceilingMicros / 1_000_000}. Existing holds remain counted.`);
  const finish = () => { guard.stop(); guard.server.close(); worker?.kill(); ledger.close(); process.exit(0); };
  process.once('SIGINT', finish); process.once('SIGTERM', finish);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
