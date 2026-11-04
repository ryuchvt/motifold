import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { unzipSync, strFromU8 } from 'fflate';
import { parseScore } from '../score';
import { scoreTracks, type PlacedCheck } from '../app/arrange';
import { placementRangeWords } from '../app/placementRepair';
import { fixCurrent } from '../app/fixContext';
import { assertNewNoteRangeRepair, newNoteRangeRepairs, repairReviewJson, reviewedNoteRepairPhases, type NoteRangeRepair } from './new-note-range-repair';
import { useArrange, type Arranged } from '../app/useArrange';
import { setOwnKey, setTransport } from '../app/spark';
import { NIGHT_RECIPES, NIGHT_SOURCE, type NightRecipe } from './night-capture-matrix';

export interface NightIO {
  settle(): Promise<void>;
  invoke(action: () => unknown | Promise<unknown>): Promise<void>;
  save(caseId: string, name: string, bytes: Uint8Array): Promise<void>;
  capture(action: () => void): Promise<Uint8Array>;
  phase(caseId: string, phase: string): void;
  observations?(): Promise<NightRequest[]>;
  stopped?(): boolean;
  allowReviewedRepairPhases?(phases: readonly string[]): void;
}
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value, null, 2));
export interface NightRequest { shape: string; status: string; reason?: string; attemptId?: string; caseId?: string; input?: unknown; cached?: boolean; model?: string; version?: string }
function fail(condition: unknown, message: string): asserts condition { if (!condition) throw Error(message); }

/** Defend each register-repair phase against repeated physical dispatch. */
export function claimRegisterRepair(context: string, shape: string, claimed: Set<string>, reviewedPhases: ReadonlySet<string> = new Set()): void {
  const layout = context.endsWith('-layout-range-repair'), notes = /-[ab]-note-range-repair-[12]$/.test(context) || /-a-note-range-repair-[34]$/.test(context) && reviewedPhases.has(context);
  fail(!context.includes('-note-range-repair-') || notes, 'New-note repair phase exceeds the bounded allowance');
  if (!layout && !notes) return;
  fail(shape === (layout ? 'distribute' : 'arrange'), 'Repair phase does not permit this request');
  fail(!claimed.has(context), 'Register repair was already attempted');
  claimed.add(context);
}

/** One bounded technical layout request; it cannot authorize changing source note classes or timing. */
export function registerRepairWords(check: PlacedCheck): string | null {
  if (check.notes !== NIGHT_SOURCE.notes || check.placed !== NIGHT_SOURCE.notes || check.notPlaced.length || check.together.length || check.ignored || !check.outOfRange.length) return null;
  return placementRangeWords(check.outOfRange);
}
const digest = async (data: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(data).buffer))].map(byte => byte.toString(16).padStart(2, '0')).join('');
function options(now: Arranged) { fail(now.options.status === 'ready', `Options ${now.options.status}`); return now.options; }
function notes(now: Arranged, index: number, full: boolean, allowRange = false) {
  const value = options(now).notes[index];
  fail(value?.status === 'ready', `Notes ${index} ${value?.status ?? 'absent'}`);
  fail(!value.writing, 'Writing has not settled');
  if (full) fail(!value.preview && !value.missing?.length, 'Unfinished writing windows');
  fail(!value.check.overBars && !value.check.unreadable && !value.check.pastBarEnd && (allowRange || !value.check.outOfRange.length), 'New-note range, occupied-bar, unreadable or overflow failure');
  return value;
}
const diagnostic = (now: Arranged) => ({
  piece: now.piece, studyStatus: now.study.status, tracks: now.tracks, confirmed: now.tracksConfirmed,
  placed: now.placed, recompose: now.recompose, recomposed: now.recomposed, themeWrite: now.themeWrite, themeReason: now.themeReason,
  options: now.options, trying: now.trying,
});

/** The only music-writing calls here are the app's actual hook methods. No answer is invented by the harness. */
export async function runNightRecipe(recipe: NightRecipe, current: () => Arranged, io: NightIO, caseId = `${recipe.id}-${Date.now().toString(36)}`) {
  fail(NIGHT_RECIPES.some(item => JSON.stringify(item) === JSON.stringify(recipe)), 'Unknown or edited recipe');
  const result: { caseId: string; recipe: NightRecipe; source: typeof NIGHT_SOURCE; started: string; status: string; phase: string; outcomes: unknown[]; error?: string } = { caseId, recipe, source: NIGHT_SOURCE, started: new Date().toISOString(), status: 'running', phase: 'starting', outcomes: [] };
  const save = (name: string, value: unknown) => io.save(caseId, name, bytes(value));
  const step = async (phase: string, action: () => unknown | Promise<unknown>) => {
    fail(!io.stopped?.(), 'Capture stopped before next phase');
    result.phase = phase; io.phase(caseId, phase); await save('progress.json', result);
    await io.invoke(action); await io.settle();
    fail(!io.stopped?.(), 'Capture stopped');
  };
  const waitFor = async (ready: () => boolean, label: string) => {
    const deadline = Date.now() + 15 * 60_000;
    while (!ready()) { fail(Date.now() < deadline, `Timed out waiting for ${label}`); fail(!io.stopped?.(), 'Capture stopped'); await io.settle(); }
  };
  const exportOutcome = async (label: 'a' | 'b', index: number) => {
    let held = notes(current(), index, true, true);
    fail(current().trying?.kind === 'option' && current().trying?.index === index, 'Export selection does not own this outcome');
    const repairs: NoteRangeRepair[] = [];
    if (held.check.outOfRange.length) {
      const input = options(current()).input, plan = options(current()).plans[index];
      const hashJson = (value: unknown) => digest(new TextEncoder().encode(repairReviewJson(value)));
      const identity = { sourceSha256: NIGHT_SOURCE.sha256, recipeSha256: await hashJson(recipe), planSha256: await hashJson(plan), rawAddsSha256: await hashJson(held.adds), label: label.toUpperCase() };
      const proposed = newNoteRangeRepairs(held.check, identity);
      fail(proposed, 'New-note range failure is not eligible for bounded repair');
      const reviewedPhases = reviewedNoteRepairPhases(identity, held.check, caseId);
      if (reviewedPhases.length) io.allowReviewedRepairPhases?.(reviewedPhases);
      const proof: unknown[] = [];
      for (const [ordinal, repair] of proposed.entries()) {
        const before = structuredClone(held.adds);
        fail(fixCurrent(before, [repair.bar]).length < 8000, 'Range-repair bar context would be truncated');
        await save(`${label}-note-range-repair.json`, { status: 'asking', repairs: proof, repair, before });
        await step(`${label}-note-range-repair-${ordinal + 1}`, () => {
          fail(options(current()).input === input && options(current()).plans[index] === plan, 'Range repair changed selected plan ownership');
          return current().askFix(index, repair.bar, repair.bar, repair.ask);
        });
        const after = notes(current(), index, true, true);
        await save(`${label}-note-range-repair.json`, { status: current().fixing, repairs: proof, repair, before, after: after.adds });
        fail(current().fixing === 'none' && !current().fixingReason, 'New-note range repair unavailable');
        fail(options(current()).input === input && options(current()).plans[index] === plan, 'Range repair changed selected plan ownership');
        assertNewNoteRangeRepair(before, after.adds, repair);
        proof.push({ repair, before, after: after.adds }); repairs.push(repair); held = after;
      }
      await save(`${label}-note-range-repair.json`, { status: 'complete', repairs: proof });
    }
    held = notes(current(), index, true);
    fail(current().trying?.kind === 'option' && current().trying?.index === index, 'Export selection does not own this outcome');
    const observed = await io.observations?.() ?? [];
    if (recipe.intent === 'recompose') {
      fail((current().recomposed?.tuneBars ?? 0) > 0, 'Theme failed or contains no tune');
      const lastTheme = observed.filter(call => call.shape === 'write_theme').at(-1);
      fail(!lastTheme || lastTheme.status === 'ok', 'Theme request failed');
    }
    const zip = await io.capture(() => current().download());
    const files = unzipSync(zip);
    fail(Object.keys(files).length <= 100 && Object.values(files).reduce((total, data) => total + data.byteLength, 0) <= 20 * 1024 * 1024, 'Package entry or size limit exceeded');
    fail(files['score.musicxml'] && files['all-parts.mid'], 'Incomplete hook download');
    const score = parseScore(strFromU8(files['score.musicxml']));
    fail(score.parts.length > 0 && score.parts.every(part => part.measures.length === recipe.bars), 'Export has the wrong bar count');
    const noteCount = scoreTracks(score).reduce((sum, track) => sum + track.notes.length, 0);
    fail(noteCount > 0, 'All-rest exported score');
    await io.save(caseId, `${label}.zip`, zip);
    for (const [name, data] of Object.entries(files)) {
      fail(/^(?:parts\/)?[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}\.(?:musicxml|mid|txt)$/.test(name) && !name.includes('..'), 'Unsafe package filename');
      await io.save(caseId, `${label}-${name.replace('/', '-')}`, data);
    }
    const outcome = { caseId, recipe, status: 'complete', label: label.toUpperCase(), chosen: label === 'a' ? 0 : 1, selected: index, plan: options(current()).plans[index], bars: recipe.bars, parts: score.parts.map(part => part.name), notes: noteCount, check: held.check, missing: held.missing ?? [], source: NIGHT_SOURCE, sourceLayout: current().placed.status === 'ready' ? current().placed : null, theme: current().recomposed, ...(repairs.length ? { noteRangeRepairs: repairs } : {}), zip: { file: `${caseId}/${label}.zip`, sha256: await digest(zip) }, requests: observed };
    result.outcomes.push(outcome); await save(`${label}-summary.json`, outcome); await save('progress.json', result);
  };
  try {
    await step('reset', () => current().startAgain());
    await step('read-study', () => current().askPiece());
    await waitFor(() => current().piece.status !== 'asking' && current().study.status !== 'asking', 'reading and Study');
    fail(current().piece.status === 'ready' && current().study.status === 'ready', 'Reading or Study unavailable');
    await step('confirm-piano-skip-questions', () => {
      const reading = current().piece;
      fail(reading.status === 'ready', 'Reading missing');
      fail(reading.lines.length === 2 && reading.lines.every(line => /^Piano (?:upper|lower)$/.test(line)), 'Frozen source lines changed');
      for (const line of reading.lines) current().setTrack(line, 'Piano');
      // Skipping means no answer entries, exactly as the visible UI does.
      current().confirmTracks();
    });
    fail(Object.keys(current().answered).length === 0, 'Questions were unexpectedly answered');
    const words = recipe.mood === 'Neutral' ? '' : `The mood I want: ${recipe.mood.toLowerCase()}.`;
    if (recipe.intent !== 'recompose') {
      const intent = recipe.intent;
      await step('layout', () => current().askPlaced(recipe.instruments, '', false, intent));
      let placement = current().placed;
      fail(placement.status === 'ready', 'Layout unavailable');
      const repair = registerRepairWords(placement.check);
      if (repair) {
        const before = placement.check;
        await save('range-repair.json', { ask: repair, before, status: 'asking' });
        await step('layout-range-repair', () => current().askPlaced(recipe.instruments, repair, false, intent));
        placement = current().placed;
        await save('range-repair.json', { ask: repair, before, after: placement, status: placement.status });
        fail(placement.status === 'ready', 'Range repair unavailable');
      }
      fail(!placement.check.notPlaced.length && !placement.check.outOfRange.length && !placement.check.together.length && !placement.check.ignored && placement.check.notes === NIGHT_SOURCE.notes && placement.check.placed === NIGHT_SOURCE.notes, 'Layout needs repair');
      await step('plan', () => current().askOptions('', recipe.moreBars, recipe.where, intent));
      fail(options(current()).plans.length === 2, 'Expected exactly A and B');
      await step('a-preview', () => current().askPreview(0)); notes(current(), 0, false);
      await step('b-preview', () => current().askPreview(1)); notes(current(), 1, false);
      for (const [index, label] of [[0, 'a'], [1, 'b']] as const) {
        await step(`${label}-full`, () => current().askNotes(index));
        await exportOutcome(label, index);
      }
    } else {
      await step('plan', () => current().askRecompose(words, 32, recipe.instruments, 2));
      const plans = current().recompose;
      fail(plans.status === 'ready' && plans.plans.length === 2, 'Recomposition plans unavailable');
      for (const [index, label] of [[0, 'a'], [1, 'b']] as const) {
        await step(`${label}-full`, () => current().writeRecomposed(index));
        // A failed B theme deliberately leaves A playable. It cannot be captured
        // under B's name. Fixed freedom2 keeps the exact chosen plan object.
        fail(!current().themeWrite, 'Theme unavailable or still pending');
        fail(current().recomposed?.plan === plans.plans[index] && options(current()).plans[0] === plans.plans[index], 'Selected recomposition does not own this theme');
        // Each recomposition becomes the sole active option at index zero.
        await exportOutcome(label, 0);
      }
    }
    result.status = 'complete'; result.phase = 'complete';
  } catch (error) {
    result.status = 'failed'; result.error = error instanceof Error ? error.message : String(error);
    await save('failure.json', { result, diagnostic: diagnostic(current()) });
  }
  await save('summary.json', result); io.phase(caseId, result.status); return result;
}

export async function captureHookDownload(action: () => void): Promise<Uint8Array> {
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL, originalClick = HTMLAnchorElement.prototype.click;
  const held = new Map<string, Blob>(); const captured: Blob[] = [];
  URL.createObjectURL = blob => { fail(blob instanceof Blob, 'Hook export is not a Blob'); const url = `blob:night-${held.size}`; held.set(url, blob); return url; };
  URL.revokeObjectURL = () => {};
  HTMLAnchorElement.prototype.click = function() { const blob = held.get(this.href); if (blob) captured.push(blob); else originalClick.call(this); };
  try { action(); } finally { URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; HTMLAnchorElement.prototype.click = originalClick; }
  fail(captured.length === 1, 'Expected exactly one real hook ZIP');
  const blob = captured[0]!;
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
  return new Uint8Array(await new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob); }));
}

async function boot() {
  const nativeFetch = window.fetch.bind(window);
  let context = 'idle', stopped = false, active = false, status: unknown = { status: 'loading-source' };
  const repairClaims = new Set<string>();
  const reviewedRepairPhases = new Set<string>();
  const observations: Promise<NightRequest>[] = [];
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
    if (url.origin !== location.origin) throw Error('External requests are disabled in the capture harness');
    if (!url.pathname.startsWith('/api/')) return nativeFetch(input, init);
    fail(active && /^\/api\/spark\/(?:read_piece|study_score|distribute|plan_options|plan_recompose|write_theme|arrange)$/.test(url.pathname), 'Unexpected API call');
    if (stopped) return Response.json({ status: 'fallback', reason: 'capture-stopped' });
    claimRegisterRepair(context, url.pathname.split('/').at(-1)!, repairClaims, reviewedRepairPhases);
    const headers = new Headers(init?.headers); headers.delete('x-motifold-key'); headers.set('x-motifold-record-case', context);
    const caseId = context;
    const request = JSON.parse(String(init?.body)) as { attemptId: string; input: unknown };
    const response = await nativeFetch(input, { ...init, headers });
    observations.push(response.clone().text().then(text => {
      let reply: { status?: string; reason?: string; cached?: boolean; model?: string; version?: string } = {};
      try { reply = JSON.parse(text); } catch { for (const line of text.split('\n')) if (line.startsWith('data:')) { try { const event = JSON.parse(line.slice(5)); if (event.kind === 'result') reply = event.result; } catch {} } }
      return { shape: url.pathname.split('/').at(-1)!, status: reply.status ?? 'malformed', attemptId: request.attemptId, caseId, input: request.input, ...(reply.reason ? { reason: reply.reason } : {}), ...(reply.cached !== undefined ? { cached: reply.cached } : {}), ...(reply.model ? { model: reply.model } : {}), ...(reply.version ? { version: reply.version } : {}) };
    }).catch(() => ({ shape: url.pathname.split('/').at(-1)!, status: 'network', attemptId: request.attemptId, caseId, input: request.input })));
    return response;
  };
  setOwnKey(null); setTransport(null);
  const response = await nativeFetch('/__night/source.musicxml'); fail(response.ok, 'Frozen source unavailable');
  const xmlText = await response.text();
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(xmlText)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  fail(hash === NIGHT_SOURCE.sha256, 'Frozen source hash mismatch');
  const score = parseScore(xmlText), loaded = { fileName: 'sample-sketch.musicxml', xmlText, score };
  let current!: Arranged;
  function Host() { current = useArrange(loaded, score.parts[0]!, { from: 0, to: 23 }, null); return null; }
  const root = createRoot(document.getElementById('night-root')!); root.render(createElement(Host));
  const settle = () => new Promise<void>(resolve => setTimeout(resolve, 30));
  await settle();
  const show = () => { document.getElementById('night-status')!.textContent = JSON.stringify(status, null, 2); };
  status = { status: 'idle', source: NIGHT_SOURCE, recipes: NIGHT_RECIPES.length }; show();
  const api = {
    recipes: structuredClone(NIGHT_RECIPES), source: NIGHT_SOURCE,
    status: () => structuredClone(status),
    stop: () => { stopped = true; },
    start: async (id: string) => {
      fail(!active, 'Another capture is active');
      const recipe = NIGHT_RECIPES.find(item => item.id === id); fail(recipe, 'Unknown recipe ID');
      active = true; stopped = false; observations.length = 0;
      reviewedRepairPhases.clear();
      try {
        const result = await runNightRecipe(recipe, () => current, {
          settle, invoke: async action => { await action(); }, stopped: () => stopped,
          allowReviewedRepairPhases: phases => { for (const phase of phases) reviewedRepairPhases.add(phase); },
          observations: () => Promise.all(observations), capture: captureHookDownload,
          phase: (caseId, phase) => { context = `${caseId}-${phase}`; status = { status: 'running', caseId, recipe: recipe.id, phase }; show(); },
          save: async (caseId, name, data) => { const saved = await nativeFetch(`/__night/artifacts/${caseId}/${name}`, { method: 'POST', body: data as BodyInit }); fail(saved.ok, 'Local artifact save failed'); },
        });
        status = result; show(); return structuredClone(result);
      } finally { active = false; context = 'idle'; }
    },
  };
  (window as unknown as { night: typeof api }).night = api;
}
if (typeof document !== 'undefined' && document.getElementById('night-root')) void boot().catch(error => { document.getElementById('night-status')!.textContent = `Harness failed before start: ${error.message}`; });
