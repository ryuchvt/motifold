// Packages actual local captures. This tool has no provider transport and never writes a ledger.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, renameSync } from 'node:fs';
import { resolve, join, relative, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { inspectArchive } from './live-rehearsal-inspect.mjs';
import { buildPerformanceSources } from './performance-source.mjs';

const MOODS = ['Neutral', 'Sad', 'Tender', 'Hopeful', 'Dreamy', 'Pastoral', 'Wonder', 'Storybook', 'Playful', 'Heroic', 'Epic', 'Pulse', 'Action', 'Tense', 'Dark'];
const ORIGINAL_SHA = '782c244e9d31572a3c3225c6af170a75ea94224b7e92ea1e1a6d6183ddb70d54';
const SOURCE_SHA = 'a8b4ee04a41ee125b8e7e042fe6c5dd3baf82fe65fd588eac6823770a9b8304f';
const slug = text => text.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const stable = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const equal = (a, b) => stable(a) === stable(b);
const demand = (condition, message) => { if (!condition) throw Error(message); };
const safePath = name => typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(name) && !name.includes('..') && !name.includes('//');
const json = value => strToU8(JSON.stringify(value, null, 2) + '\n');
const reasonOf = error => error?.code ? 'Captured files are missing or unreadable.' : error instanceof SyntaxError ? 'Captured summary is invalid JSON.' : /\/Users\/|authorization|bearer|api[_-]?key/i.test(error?.message ?? '') ? 'The capture could not be verified.' : String(error?.message ?? error).slice(0, 240);
const write = (file, bytes) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(`${file}.tmp`, bytes); renameSync(`${file}.tmp`, file); };
const answerOf = reply => { const { cached, model, version, ...answer } = reply; return answer; };
const identity = call => stable({ shape: call.shape, input: call.input, version: call.version, model: call.model });
/** Optional display metadata, copied from an authenticated selected plan without interpreting its chords. */
function plannedHarmony(plan) {
  if (!Array.isArray(plan?.why)) return undefined;
  const spans = [], text = (value, limit) => typeof value === 'string' && !!value.trim() && value.length <= limit && !/[\u0000-\u001f\u007f]/.test(value);
  for (const span of plan.why) {
    if (span?.chords === undefined || typeof span.chords === 'string' && !span.chords.trim()) continue;
    if (!text(span?.from, 12) || !text(span?.to, 12) || !text(span?.chords, 400)) return undefined;
    spans.push({ from: span.from, to: span.to, chords: span.chords });
  }
  return spans.length && spans.length <= 40 ? spans : undefined;
}
const PHASES = { 'read-study': ['read_piece', 'study_score'], layout: ['distribute'], 'layout-range-repair': ['distribute'], plan: ['plan_options', 'plan_recompose'], 'a-preview': ['arrange'], 'b-preview': ['arrange'], 'a-full': ['arrange', 'write_theme'], 'b-full': ['arrange', 'write_theme'] };
for (const label of ['a', 'b']) for (const ordinal of [1, 2]) PHASES[`${label}-note-range-repair-${ordinal}`] = ['arrange'];

export function expectedRecipes(templates) {
  const recipe = (intent, ensemble, mood = 'Neutral') => ({ id: `${intent}-${slug(mood)}-${slug(ensemble.name)}`, intent, ensemble: ensemble.name, instruments: [...ensemble.instruments], mood, bars: intent === 'arrange' ? 24 : intent === 'expand' ? 40 : 32, moreBars: intent === 'expand' ? 16 : intent === 'recompose' ? 32 : 0, where: intent === 'expand' ? 'both' : intent === 'recompose' ? 'after' : 'inside', tuneOnly: false, freedom: 2 });
  return ['arrange', 'expand', 'recompose'].flatMap(intent => templates.flatMap(ensemble => (intent === 'recompose' ? MOODS : ['Neutral']).map(mood => recipe(intent, ensemble, mood))));
}

function successful(receipt, fresh = false) {
  const row = receipt.receipt, reply = receipt.reply;
  return receipt.sent === true && reply?.status === 'ok' && (!fresh || reply.cached === false) && row?.state === 'settled' && Number.isSafeInteger(row.charged_micros) && row.charged_micros >= 0 && typeof reply.version === 'string' && typeof reply.model === 'string' && Number.isFinite(receipt.ms) && receipt.ms >= 0 && Array.isArray(receipt.thinking) && receipt.thinking.every(line => typeof line.text === 'string' && Number.isFinite(line.at) && line.at >= 0);
}

/** Resolve the exact take used, then replace a matching cache receipt only with genuine fresh metadata. */
export function canonicalCalls(requests, receipts, caseId) {
  demand(Array.isArray(requests) && requests.length > 0, 'Missing captured request provenance');
  const calls = [], seen = new Map();
  for (const request of requests.filter(request => request.status === 'ok')) {
    if (caseId !== null) {
      const prefix = `${caseId}-`;
      demand(typeof request.caseId === 'string' && request.caseId.startsWith(prefix), 'Captured request belongs to another case');
      const phase = request.caseId.slice(prefix.length);
      demand(Object.hasOwn(PHASES, phase) && PHASES[phase].includes(request.shape), 'Captured request has an invalid phase');
    }
    const matches = receipts.filter(row => successful(row) && row.attemptId === request.attemptId && row.captureCase === (caseId === null ? undefined : request.caseId) && row.shape === request.shape && equal(row.input, request.input));
    demand(matches.length === 1, `Missing or ambiguous receipt for ${request.shape}`);
    const used = matches[0];
    demand((request.version === undefined || request.version === used.reply.version) && (request.model === undefined || request.model === used.reply.model), 'Captured prompt metadata disagrees with receipt');
    const fresh = receipts.filter(row => successful(row, true) && row.shape === used.shape && equal(row.input, used.input) && row.reply.version === used.reply.version && row.reply.model === used.reply.model && equal(answerOf(row.reply), answerOf(used.reply)));
    demand(fresh.length > 0, `Missing fresh provenance for ${request.shape}`);
    const source = fresh.find(row => row.attemptId === used.attemptId) ?? fresh[0];
    const usage = source.receipt.usage;
    demand(usage && ['inputTokens', 'cachedTokens', 'outputTokens'].every(key => Number.isSafeInteger(usage[key]) && usage[key] >= 0), 'Missing actual provider usage');
    const { model, version, ...reply } = source.reply;
    const call = { shape: source.shape, input: source.input, reply, ms: source.ms, thinking: source.thinking, version, model, usage };
    const key = identity(call), previous = seen.get(key);
    demand(!previous || equal(previous.reply, call.reply), 'Conflicting answers for an identical recorded request');
    if (!previous) { seen.set(key, call); calls.push(call); }
  }
  demand(calls.some(call => call.shape === 'read_piece') && calls.some(call => call.shape === 'study_score'), 'Missing original reading or Study provenance');
  return calls;
}

const noteKey = note => stable([note.start, note.length, note.height, note.velocity ?? null]);
function containsNotes(whole, source) {
  const bag = new Map();
  for (const note of whole) { const key = noteKey(note); bag.set(key, (bag.get(key) ?? 0) + 1); }
  for (const note of source) { const key = noteKey(note), left = bag.get(key) ?? 0; if (!left) return false; bag.set(key, left - 1); }
  return true;
}
const midiNotes = midi => midi.tracks.flatMap(track => track.notes.map(note => [note.tick, note.length, note.height, note.velocity])).sort((a, b) => stable(a).localeCompare(stable(b)));
function cleanCheck(check) {
  return check && Number.isSafeInteger(check.notes) && check.notes >= 0 && check.overBars === 0 && check.unreadable === 0 && check.pastBarEnd === 0 && Array.isArray(check.outOfRange) && check.outOfRange.length === 0;
}

export function validateOutcome(summary, archive, { recipe, readers, receipts, sourceXml }) {
  demand(summary?.status === 'complete' && equal(summary.recipe, recipe), 'Incomplete or mismatched capture recipe');
  demand(summary.source?.sha256 === SOURCE_SHA && summary.source.bars === 24, 'Source metadata changed');
  demand(summary.bars === recipe.bars && Array.isArray(summary.missing) && summary.missing.length === 0 && !summary.writing && !summary.preview, 'Missing writing windows');
  demand(['A', 'B'].includes(summary.label) && summary.chosen === (summary.label === 'A' ? 0 : 1), 'Invalid selected outcome');
  demand(cleanCheck(summary.check), 'New notes have a hard acceptance failure');
  demand(summary.zip?.sha256 === sha(archive), 'Captured ZIP hash mismatch');
  const files = unzipSync(archive);
  demand(Object.keys(files).every(name => safePath(name) && /\.(?:mid|musicxml|txt)$/.test(name)), 'Unsafe ZIP entry');
  demand(Object.values(files).reduce((sum, bytes) => sum + bytes.length, 0) <= 100 * 1024 * 1024, 'Oversized uncompressed export');
  const inspection = inspectArchive(archive, readers, recipe.bars);
  demand(inspection.parts.length > 0 && inspection.notes > 0 && summary.notes === inspection.notes, 'Empty or mismatched exported note count');
  const all = readers.readMidi(files['all-parts.mid']);
  const stems = Object.entries(files).filter(([name]) => /^parts\/[^/]+\.mid$/.test(name));
  const score = readers.parseScore(strFromU8(files['score.musicxml']));
  demand(stems.length === readers.scoreTracks(score).length && stems.length > 0, 'Missing individual part MIDI files');
  const stemNotes = stems.flatMap(([, bytes]) => { const part = readers.readMidi(bytes); demand(part.ppq === all.ppq, 'Part MIDI timing grid mismatch'); return midiNotes(part); }).sort((a, b) => stable(a).localeCompare(stable(b)));
  demand(equal(stemNotes, midiNotes(all)), 'Part MIDI notes disagree with complete MIDI');
  const label = summary.label.toLowerCase();
  const selectedPhase = call => summary.caseId === null ? equal(call.input?.chosen, summary.plan) : [`${summary.caseId}-${label}-preview`, `${summary.caseId}-${label}-full`, `${summary.caseId}-${label}-note-range-repair-1`, `${summary.caseId}-${label}-note-range-repair-2`].includes(call.caseId);
  const requests = summary.requests?.filter(call => !['arrange', 'write_theme'].includes(call.shape) || selectedPhase(call));
  demand(requests?.filter(call => ['arrange', 'write_theme'].includes(call.shape)).every(call => equal(call.input?.chosen, summary.plan)), 'Selected outcome phase uses another plan');
  const calls = canonicalCalls(requests, receipts, summary.caseId);
  const original = readers.parseScore(sourceXml);
  const frozenInput = readers.pieceInput(original, original.parts[0], 0, original.parts[0].measures.length - 1);
  demand(calls.filter(call => ['read_piece', 'study_score'].includes(call.shape)).every(call => equal(call.input, frozenInput)), 'Reading or Study does not belong to the frozen source');
  const allWrites = calls.filter(call => call.shape === 'arrange' && equal(call.input.chosen, summary.plan));
  const writes = allWrites.filter(call => !call.input.fix), fixes = allWrites.filter(call => call.input.fix);
  demand(writes.length > 0, 'No authentic writing for selected plan');
  demand(allWrites.every(call => equal(call.input.instruments, recipe.instruments)), 'Writing does not match the captured recipe');
  const plans = calls.filter(call => call.shape === (recipe.intent === 'recompose' ? 'plan_recompose' : 'plan_options') && call.reply.answer.options?.some(plan => equal(plan, summary.plan)));
  demand(plans.length === 1, 'Selected plan has no unique authentic planning receipt');
  demand(equal(plans[0].reply.answer.options[summary.chosen], summary.plan), 'A/B label does not match its actual plan');
  const asked = plans[0].input;
  demand(equal(asked.instruments, recipe.instruments) && asked.moreBars === recipe.moreBars && asked.where === recipe.where && !(asked.answers?.length) && !(asked.cues?.length), 'Actual planning request differs from the catalog recipe');
  if (recipe.intent === 'recompose') {
    demand(asked.freedom === 2, 'Recomposition does not use the recorded Reshaped2 freedom');
    const direction = recipe.mood === 'Neutral' ? '' : `The mood I want: ${recipe.mood.toLowerCase()}.`;
    demand((asked.ask ?? '').trim() === direction, 'Recorded mood differs from catalog');
  } else demand(asked.intent === recipe.intent && !asked.ask?.trim(), 'Arrange/Expand recording is not the exact neutral intent');
  const exported = readers.parseScore(strFromU8(files['score.musicxml']));
  let placement = null, baseXml;
  if (recipe.intent === 'recompose') {
    const themes = calls.filter(call => call.shape === 'write_theme' && equal(call.input.chosen, summary.plan));
    const observedThemes = summary.requests.filter(call => call.shape === 'write_theme' && equal(call.input?.chosen, summary.plan));
    demand(themes.length > 0 && observedThemes.at(-1)?.status === 'ok' && summary.theme?.tuneBars > 0 && !summary.themeReason && themes.some(call => call.reply.answer.lines?.some(line => line.role === 'tune')), 'Missing or failed theme step');
    baseXml = readers.emptyScore(summary.plan.name, recipe.instruments, { fifths: summary.plan.fifths, time: summary.plan.time, qpm: Math.max(30, Math.min(220, summary.plan.qpm)), bars: recipe.bars });
  } else {
    const captured = summary.sourceLayout;
    demand(captured?.status === 'ready', 'Missing actual source placement');
    const layouts = calls.filter(call => call.shape === 'distribute' && equal(call.reply.answer, captured.answer));
    demand(layouts.length === 1 && equal(layouts[0].input.instruments, recipe.instruments) && layouts[0].input.intent === recipe.intent && !layouts[0].input.tuneOnly, 'Placement provenance mismatch');
    const source = readers.parseScore(sourceXml), input = layouts[0].input;
    const rebuilt = readers.placeNotes(source, input, layouts[0].reply.answer, recipe.instruments, false);
    const check = rebuilt.check;
    demand(check.notes === 114 && check.placed === 114 && !check.notPlaced.length && !check.outOfRange.length && !check.together.length && !check.ignored && equal(check, captured.check), 'Source placement does not preserve all 114 accepted attacks');
    baseXml = readers.scoreOfParts(source, input, rebuilt.parts);
    const layout = readers.parseScore(baseXml);
    const sourceClock = page => page.parts[0].measures.slice(0, source.parts[0].measures.length).map(measure => ({
      bar: measure.number,
      start: measure.start / page.ticksPerQuarter,
      length: measure.length / page.ticksPerQuarter,
      metre: measure.time,
      tempos: measure.tempos.map(mark => ({ beat: mark.onset / page.ticksPerQuarter, qpm: mark.qpm })),
    }));
    demand(equal(sourceClock(exported), sourceClock(source)), 'Export changed a source tempo offset or metre');
    const fullTracks = readers.scoreTracks(exported);
    for (const track of readers.scoreTracks(layout)) demand(containsNotes(fullTracks.filter(part => part.name === track.name).flatMap(part => part.notes), track.notes), 'Export changed a recorded source-layout event');
    placement = { acceptedSourceNotes: 114, placed: check.placed, rangeOctaveMoves: check.moved, sourceLayoutNotes: readers.scoreTracks(layout).reduce((sum, track) => sum + track.notes.length, 0) };
  }
  const input = writes[0].input, bars = [...input.written.map(bar => bar.bar), ...readers.newBarNumbers(input)];
  demand(bars.length === recipe.bars && new Set(bars).size === bars.length, 'Recorded writing grid has the wrong length');
  const planned = readers.writingWindows(summary.plan.why, bars);
  const expectedWindows = planned.length ? planned : [{ from: bars[0], to: bars.at(-1) }];
  const actualWindows = writes.map(call => call.input.window ?? { from: bars[0], to: bars.at(-1) });
  const observedWrites = requests.filter(call => call.shape === 'arrange' && !call.input?.fix && call.status === 'ok');
  demand(observedWrites.length === writes.length && equal(actualWindows, expectedWindows), 'Missing, repeated or unexpected authenticated plan window');
  const coverage = new Map(bars.map(bar => [bar, 0]));
  for (const call of writes) {
    demand(equal(call.input.written, input.written) && call.input.moreBars === input.moreBars, 'Writing windows use different score grids');
    const from = call.input.window ? bars.indexOf(call.input.window.from) : 0, to = call.input.window ? bars.indexOf(call.input.window.to) : bars.length - 1;
    demand(from >= 0 && to >= from, 'Invalid recorded writing window');
    const these = bars.slice(from, to + 1);
    demand(readers.withDoubles(call.reply.answer, bars).every(add => these.includes(add.bar)), 'Written answer contains a bar outside its authenticated window');
    for (const bar of these) coverage.set(bar, coverage.get(bar) + 1);
  }
  // The hook leaves unrequested source spans alone. Their notes and clock were
  // proved above; every new bar (or every Recompose bar) still needs a window.
  const required = new Set(recipe.intent === 'recompose' ? bars : readers.newBarNumbers(input));
  demand([...coverage].every(([bar, count]) => count <= 1 && (!required.has(bar) || count === 1)), 'Missing new bars or overlapping authenticated writing windows');
  let adds = writes.flatMap(call => readers.withDoubles(call.reply.answer, bars));
  // Only a preview followed by further windows takes useArrange's unfinished/resume branch.
  // A one-call preview is reused as-is; a fresh recomposition also retains raw reply order.
  const preview = `${summary.caseId}-${summary.label.toLowerCase()}-preview`;
  const resumed = writes.length > 1 && recipe.intent !== 'recompose' && (summary.caseId === null || requests.some(call => call.shape === 'arrange' && call.caseId === preview && call.status === 'ok'));
  if (resumed) adds.sort((a, b) => bars.indexOf(a.bar) - bars.indexOf(b.bar));
  const base = readers.parseScore(baseXml);
  let check = readers.checkOption({ ...summary.plan, adds }, base, input);
  const fixRequests = requests.filter(call => call.shape === 'arrange' && equal(call.input?.chosen, summary.plan) && call.input?.fix);
  if (fixes.length || fixRequests.length || summary.noteRangeRepairs?.length) {
    const proposed = readers.newNoteRangeRepairs(check);
    demand(proposed && fixes.length === proposed.length && fixRequests.length === fixes.length, 'Invalid bounded new-note repair count');
    demand(equal(summary.noteRangeRepairs, proposed), 'Range-repair metadata differs from the authentic failure');
    for (const [ordinal, repair] of proposed.entries()) {
      const fix = fixes[ordinal], observed = fixRequests[ordinal];
      demand(observed.status === 'ok' && observed.caseId === `${summary.caseId}-${summary.label.toLowerCase()}-note-range-repair-${ordinal + 1}` && equal(observed.input, fix.input), 'Range repair was retried, mislabeled or did not succeed');
      const context = readers.fixCurrent(adds, [repair.bar]);
      demand(context.length < 8000 && equal(fix.input.fix, { ask: repair.ask, current: context }) && equal(fix.input.window, { from: repair.bar, to: repair.bar }), 'Range repair has the wrong pre-repair context or bar');
      const stripped = value => { const { window, earlier, seed, fix, ...rest } = value; return rest; };
      demand(equal(stripped(fix.input), stripped(input)) && fix.input.earlier === undefined, 'Range repair changed the writing input or plan');
      let seed;
      if (input.seed) {
        const { theme, ...originalSeed } = input.seed;
        const themes = calls.filter(call => call.shape === 'write_theme' && equal(call.input.chosen, summary.plan));
        demand(themes.length === 1, 'Range repair has no unique selected theme');
        const text = themes[0].reply.answer.lines.filter(line => line.bar === repair.bar).map(line => `Bar ${line.bar} ${line.role}: ${line.events}`).join(' / ').slice(0, 8000);
        seed = { ...originalSeed, ...(text ? { theme: text } : {}) };
      }
      demand(equal(fix.input.seed, seed), 'Range repair lost or changed the selected theme seed');
      const replacement = readers.withDoubles(fix.reply.answer, bars);
      demand(replacement.every(add => add.bar === repair.bar), 'Range repair returned an unrelated bar');
      const next = [...adds.filter(add => add.bar !== repair.bar), ...replacement];
      readers.assertNewNoteRangeRepair(adds, next, repair);
      adds = next; check = readers.checkOption({ ...summary.plan, adds }, base, input);
      demand(!check.overBars && !check.unreadable && !check.pastBarEnd && !check.outOfRange.some(note => note.bar === repair.bar), 'Range repair did not clear its bar safely');
    }
  }
  demand(equal(check, summary.check), 'Capture checks disagree with the actual written answers');
  const rebuiltXml = readers.withOption(baseXml, base, check);
  demand(rebuiltXml === strFromU8(files['score.musicxml']), 'Export does not reproduce the authenticated writing');
  const regenerated = unzipSync(readers.packageFiles(rebuiltXml, check, 'Validation only'));
  const midiFiles = Object.keys(regenerated).filter(name => name.endsWith('.mid')).sort();
  demand(equal(midiFiles, Object.keys(files).filter(name => name.endsWith('.mid')).sort()), 'Export MIDI roster disagrees with authenticated score');
  for (const name of midiFiles) demand(sha(regenerated[name]) === sha(files[name]), 'MIDI notes, tempos, dynamics or part mapping disagree with authenticated score');
  return { files, calls, inspection, placement, advisoryClashes: summary.check.clashes ?? [] };
}

function tutorialFallback(repo, recipes, readers, receipts, sourceXml) {
  const folder = join(repo, 'public/demo/sample-sketch');
  const index = JSON.parse(readFileSync(join(repo, 'public/demo/index.json'), 'utf8'));
  const piece = index.pieces.find(piece => piece.id === 'sample-sketch');
  const verified = piece?.legacyVerifiedExport ?? piece?.verifiedExport;
  if (!verified || verified.plan !== 'Held middle voices with repeat contrast') return null;
  const saved = [...JSON.parse(readFileSync(join(folder, 'shared.json'), 'utf8')), ...JSON.parse(readFileSync(join(folder, 'arrange-neutral.json'), 'utf8'))];
  const requests = saved.map(call => {
    const found = receipts.filter(row => successful(row, true) && row.captureCase === undefined && row.shape === call.shape && equal(row.input, call.input) && row.reply.model === call.model && row.reply.version === call.version && equal(answerOf(row.reply), answerOf(call.reply)) && row.ms === call.ms && equal(row.thinking, call.thinking) && equal(row.receipt.usage, call.usage));
    demand(found.length === 1, 'Original tutorial provenance is missing or ambiguous');
    return { shape: call.shape, input: call.input, status: 'ok', attemptId: found[0].attemptId };
  });
  const recipe = recipes.find(recipe => recipe.id === 'arrange-neutral-string-orchestra');
  const layoutCall = saved.find(call => call.shape === 'distribute'), source = readers.parseScore(sourceXml);
  const rebuilt = readers.placeNotes(source, layoutCall.input, layoutCall.reply.answer, recipe.instruments, false);
  const baseXml = readers.scoreOfParts(source, layoutCall.input, rebuilt.parts), base = readers.parseScore(baseXml);
  const plan = saved.find(call => call.shape === 'plan_options').reply.answer.options.find(plan => plan.name === verified.plan);
  const writes = saved.filter(call => call.shape === 'arrange' && equal(call.input.chosen, plan));
  const bars = writes[0].input.written.map(bar => bar.bar), adds = writes.flatMap(call => readers.withDoubles(call.reply.answer, bars));
  const summary = { caseId: null, recipe, status: 'complete', label: 'A', chosen: 0, plan, bars: 24, notes: verified.notes, missing: [], source: { sha256: SOURCE_SHA, bars: 24 }, sourceLayout: { status: 'ready', answer: layoutCall.reply.answer, check: rebuilt.check }, check: readers.checkOption({ ...plan, adds }, base, writes[0].input), requests, zip: { sha256: verified.sha256 } };
  demand(verified.file === '/demo/sample-sketch/neutral-strings-a.zip', 'Unexpected original tutorial export path');
  const archive = new Uint8Array(readFileSync(join(folder, 'neutral-strings-a.zip')));
  return { recipe, caseId: 'legacy-tutorial', legacy: true, outcomes: new Map([['a', { summary, archive, ...validateOutcome(summary, archive, { recipe, readers, receipts, sourceXml }) }]]), reasons: new Map([['b', 'The original B has only a preview.']]) };
}

/** A private accounting report. Public manifests deliberately omit identities and ledger amounts. */
export function exposureReport(receipts) {
  const attempts = new Map();
  for (const row of receipts) {
    if (!row.attemptId || !row.captureCase || row.sent === false) continue;
    if (row.sent === 'releasing' || row.sent === true) attempts.set(row.attemptId, row);
  }
  let settledMicros = 0, uncertainMicros = 0, pendingMicros = 0;
  for (const row of attempts.values()) {
    const receipt = row.receipt;
    if (receipt?.state === 'settled') settledMicros += receipt.charged_micros;
    else if (receipt?.state === 'released' || row.reply?.status === 'ok' && row.reply.cached === true || !receipt && row.reply?.status === 'fallback' && ['bad-input', 'disabled', 'busy', 'empty', 'today', 'quota', 'closed', 'conflict', 'duplicate', 'stopped'].includes(row.reply.reason)) continue;
    else if (receipt?.state === 'uncertain' || row.sent === true) uncertainMicros += receipt?.reserved_micros ?? row.reservationMicros ?? 0;
    else pendingMicros += row.reservationMicros ?? 0;
  }
  const newExposureMicros = settledMicros + uncertainMicros + pendingMicros;
  return { settledMicros, uncertainMicros, pendingMicros, newExposureMicros, ceilingMicros: 23_000_000, remainingMicros: 23_000_000 - newExposureMicros, previousDevCommittedMicros: 21_048_076, cumulativeDevExposureMicros: 21_048_076 + newExposureMicros, approvedDevCapMicros: 44_048_076, publicReserveMicros: 100_000_000, personalReserveMicros: 1_000_000 };
}

export function buildCatalog({ repo, input, output, receipts, readers, templates, publish = false }) {
  const recipes = expectedRecipes(templates); demand(recipes.length === 102, 'Expected exactly 102 recipes and 204 outcomes');
  const sourceFolder = join(repo, 'public/demo/sample-sketch'), sourceXml = readFileSync(join(sourceFolder, 'sample-sketch.musicxml'), 'utf8');
  const original = new Uint8Array(readFileSync(join(sourceFolder, 'Sample_sketch.mid')));
  demand(sha(original) === ORIGINAL_SHA && sha(strToU8(sourceXml)) === SOURCE_SHA, 'Frozen source asset hash changed');
  const sourceTracks = readers.scoreTracks(readers.parseScore(sourceXml));
  demand(sourceTracks.reduce((sum, track) => sum + track.notes.length, 0) === 114 && readers.readMidi(original).tracks.reduce((sum, track) => sum + track.notes.length, 0) === 117, 'Frozen source note counts changed');
  const savedBars = JSON.parse(readFileSync(join(repo, 'test-fixtures/sample-sketch-bars.json'), 'utf8'));
  const sources = buildPerformanceSources({ original, sourceXml, savedBars, readers });
  const candidates = [], warnings = [];
  try { const old = tutorialFallback(repo, recipes, readers, receipts, sourceXml); if (old) candidates.push(old); }
  catch (error) { warnings.push(`Original tutorial not added to catalog: ${error.message}`); }
  if (existsSync(input)) for (const folder of readdirSync(input, { withFileTypes: true }).filter(entry => entry.isDirectory() && /^[a-z0-9-]+$/.test(entry.name))) {
    const caseId = folder.name, found = { caseId, recipe: recipes.find(recipe => caseId.startsWith(`${recipe.id}-`)), outcomes: new Map(), reasons: new Map() };
    for (const label of ['a', 'b']) {
      const file = join(input, caseId, `${label}-summary.json`); if (!existsSync(file)) continue;
      try {
        const summary = JSON.parse(readFileSync(file, 'utf8')), recipe = recipes.find(recipe => recipe.id === summary.recipe?.id);
        demand(recipe && summary.caseId === caseId && summary.label === label.toUpperCase(), 'Unknown capture case');
        found.recipe = recipe; demand(summary.zip?.file === `${caseId}/${label}.zip`, 'ZIP path does not belong to outcome');
        const archive = new Uint8Array(readFileSync(join(input, caseId, `${label}.zip`)));
        const checked = validateOutcome(summary, archive, { recipe, readers, receipts, sourceXml });
        found.outcomes.set(label, { summary, archive, ...checked });
      } catch (error) { found.reasons.set(label, reasonOf(error)); }
    }
    // A valid A survives a later failed B. Never combine A/B from different capture cases.
    const path = join(input, caseId, 'summary.json');
    if (existsSync(path)) { try { const saved = JSON.parse(readFileSync(path, 'utf8')); found.recipe ??= recipes.find(recipe => equal(recipe, saved.recipe)); found.error = saved.error ? reasonOf(new Error(saved.error)) : undefined; } catch {} }
    if (found.recipe) candidates.push(found);
  }
  const catalog = { version: 1, pieceId: 'sample-sketch', recorded: '2026-11-04', outcomes: [] }, pack = {}, results = [];
  let promotion = null;
  const base = '/demo/sample-sketch/outcomes';
  for (const recipe of recipes) {
    const cases = candidates.filter(candidate => candidate.recipe.id === recipe.id).sort((a, b) => b.outcomes.size - a.outcomes.size || Number(!!a.legacy) - Number(!!b.legacy) || b.caseId.localeCompare(a.caseId));
    const chosen = cases[0];
    if (recipe.id === 'arrange-neutral-string-orchestra' && chosen && !chosen.legacy && chosen.outcomes.size === 2) promotion = chosen;
    for (const [option, label] of [[0, 'a'], [1, 'b']]) {
      const id = `${recipe.id}-${label}`, held = chosen?.outcomes.get(label);
      const entry = { id, runKey: recipe.id, intent: recipe.intent, ensemble: recipe.ensemble, mood: recipe.mood, option, name: held?.summary.plan?.name ?? `${recipe.ensemble} ${label.toUpperCase()}`, bars: recipe.bars, sourceBars: 24, ...(recipe.intent === 'recompose' ? { freedom: 2 } : {}), status: held ? 'complete' : 'unavailable' };
      if (!held) entry.reason = chosen?.reasons.get(label) ?? chosen?.error ?? (chosen ? 'This outcome has no complete capture.' : 'Not recorded.');
      else {
        const url = `${base}/${id}`;
        Object.assign(entry, { xml: `${url}/score.musicxml`, midi: `${url}/all-parts.mid`, zip: `${url}/arrangement.zip`, run: `${url}/run.json`, xmlSha256: sha(held.files['score.musicxml']), midiSha256: sha(held.files['all-parts.mid']) });
        const harmony = plannedHarmony(held.summary.plan);
        if (harmony) entry.planHarmony = harmony;
        const manifest = { id, recipe, option, plan: held.summary.plan.name, status: 'complete', verified: held.inspection, placement: held.placement, advisoryClashes: held.advisoryClashes, audio: { status: 'not-rendered', expectedFile: 'audio/render.wav' }, provenance: 'Actual successful Meta calls. The recorded stages may include cold retries. No uninterrupted live session is claimed.' };
        const assets = { ...held.files, 'arrangement.zip': held.archive, 'run.json': json(held.calls), 'manifest.json': json(manifest), 'audio/README.txt': strToU8('No DAW bounce is available yet. Put the real render.wav here after rendering this exact score.\n'), 'render-checklist.txt': strToU8('No rendered audio is included.\nImport all-parts.mid into your DAW at bar 1. Keep its tempo and metre map.\nLoad licensed instruments for each part. Check the advisory clashes by ear.\nRender audio/render.wav and verify that it follows this exact score.\n') };
        for (const [name, data] of Object.entries(assets)) {
          pack[`${id}/${name}`] = data;
          if (publish) write(join(sourceFolder, 'outcomes', id, name), data);
        }
        results.push({ id, caseId: chosen.caseId, zipSha256: held.inspection.sha256, calls: held.calls.length, placement: held.placement });
      }
      catalog.outcomes.push(entry);
    }
  }
  const complete = catalog.outcomes.filter(entry => entry.status === 'complete').length;
  const pairs = recipes.filter(recipe => catalog.outcomes.filter(entry => entry.runKey === recipe.id && entry.status === 'complete').length === 2).length;
  const attempted = new Set(candidates.filter(candidate => !candidate.legacy).map(candidate => candidate.recipe.id));
  const failed = catalog.outcomes.filter(entry => entry.status !== 'complete' && attempted.has(entry.runKey)).length;
  const publicReport = { version: 1, recorded: catalog.recorded, expectedOutcomes: 204, complete, completePairs: pairs, failedOrIncomplete: failed, unrecorded: 204 - complete - failed, unavailable: 204 - complete, outcomes: catalog.outcomes.map(({ id, status, reason }) => ({ id, status, ...(reason ? { reason } : {}) })), source: sources.manifest, audio: 'No rendered audio is included. Render audio only from the matching outcome score and MIDI.' };
  let tutorialCalls = null;
  if (promotion) {
    const unique = new Map();
    for (const held of promotion.outcomes.values()) for (const call of held.calls) {
      const key = identity(call), previous = unique.get(key);
      demand(!previous || equal(previous.reply, call.reply), 'Verified tutorial pair has conflicting recorded answers');
      if (!previous) unique.set(key, call);
    }
    tutorialCalls = [...unique.values()];
    pack['guided-neutral-strings.json'] = json(tutorialCalls);
    publicReport.guidedTutorial = { runKey: 'guided-neutral-strings', completeOptions: [0, 1] };
  }
  pack['manifest.json'] = json(publicReport);
  pack['generation-notes.txt'] = strToU8(`This pack contains ${complete} verified complete outcomes from the planned 204. The manifest lists what is available and why the rest is unavailable.\n\nI have not added DAW audio yet. My DAW bounces are pending. No audio file in this pack is presented as rendered music.\n\nI may record more outcomes later, including after this morning. This generation does not claim that all 204 are complete. The calls are real saved Meta replies and may include successful stages assembled after cold retries. Actual model, prompt version, thinking and elapsed time stay in each run.json.\n`);
  for (const [name, data] of Object.entries(sources.files)) pack[`source/${name}`] = data;
  const packBytes = zipSync(pack), report = { ...publicReport, generatedAt: new Date().toISOString(), captureMayContinue: true, dawAudioStatus: 'pending-real-bounces', results, warnings, budget: exposureReport(receipts), renderPack: { file: 'Motifold_DAW_Render_Pack.zip', path: join(output, 'Motifold_DAW_Render_Pack.zip'), sha256: sha(packBytes), bytes: packBytes.length } };
  write(join(output, 'Motifold_DAW_Render_Pack.zip'), packBytes); write(join(output, 'build-report.json'), json(report));
  if (publish) {
    write(join(sourceFolder, 'catalog.json'), json(catalog));
    const indexFile = join(repo, 'public/demo/index.json'), index = JSON.parse(readFileSync(indexFile, 'utf8'));
    const piece = index.pieces.find(piece => piece.id === 'sample-sketch'); demand(piece, 'Existing genuine tutorial is missing');
    for (const [name, data] of Object.entries(sources.files)) write(join(sourceFolder, 'source', name), data);
    piece.mappedMidi = '/demo/sample-sketch/source/performance-tempo-map-117.mid';
    piece.acceptedMidi = '/demo/sample-sketch/source/accepted-score-114.mid';
    piece.catalog = '/demo/sample-sketch/catalog.json';
    if (promotion) {
      const a = promotion.outcomes.get('a'), b = promotion.outcomes.get('b');
      write(join(sourceFolder, 'guided-neutral-strings.json'), json(tutorialCalls));
      piece.tutorial = { runKey: 'guided-neutral-strings', acceptedLabel: 'Saved accepted bar analysis.', rawNoteCount: 117, acceptedNoteCount: 114, completeOptions: [0, 1] };
      piece.runs = [...piece.runs.filter(run => run.key !== 'guided-neutral-strings'), { key: 'guided-neutral-strings', mode: 'arrange', ensemble: 'String orchestra', mood: 'Neutral', selfContained: true }];
      piece.guide = [
        'This is a recorded walkthrough and uses no credit.',
        'The accepted bar analysis is saved. Confirm both Piano upper and Piano lower as Piano.',
        'Skip all questions and leave the optional direction blank.',
        'In Setup, use Arrange and String orchestra. Keep all source notes, stay neutral and add no bars.',
        `Choose Create. Compare A, ${a.summary.plan.name}, and B, ${b.summary.plan.name}. Both have recorded opening previews and complete continuations.`,
        'Choose A or B and write the rest. Either recorded option can finish across bars 1 to 24.',
        'Export the selected option directly. Other settings and rewrites have no prepared reply.',
      ];
      piece.words = 'Compare two recorded string arrangements of my piano sketch, then finish A or B. This walkthrough uses no credit.';
      piece.legacyVerifiedExport ??= piece.verifiedExport;
      piece.verifiedExport = { file: `${base}/${promotion.recipe.id}-a/arrangement.zip`, sha256: a.inspection.sha256, plan: a.summary.plan.name, parts: a.inspection.parts.length, bars: 24, notes: a.inspection.notes, sourceLayoutNotes: a.placement.sourceLayoutNotes, newNotes: a.summary.check.notes };
    } else if (!piece.tutorial && candidates.some(candidate => candidate.legacy)) {
      piece.tutorial = { runKey: 'arrange-neutral', acceptedLabel: 'Saved accepted bar analysis.', rawNoteCount: 117, acceptedNoteCount: 114, completeOptions: [0] };
    }
    write(indexFile, json(index));
  }
  return { catalog, report, pack: packBytes };
}

async function main() {
  const args = process.argv.slice(2), value = (flag, fallback) => { const at = args.indexOf(flag); return at < 0 ? fallback : args[at + 1]; };
  if (args.includes('--help')) { console.log('node tools/build-night-catalog.mjs --repo <repo> --input <output/night-capture> --receipts <receipts.jsonl>[,<old receipts.jsonl>] [--output output/night-catalog] [--publish]\nNo provider requests. Default validates and builds <output>/Motifold_DAW_Render_Pack.zip and <output>/build-report.json. No DAW audio is included. Captures may continue after this generation.\n--publish also writes verified catalog assets and adds the catalog pointer without replacing the original tutorial. Stop the local capture guard before publishing so asset writes cannot reload an active paid Worker.'); return; }
  const repo = resolve(value('--repo', process.cwd())), input = resolve(value('--input', join(repo, 'output/night-capture'))), output = resolve(value('--output', join(repo, 'output/night-catalog')));
  if (args.includes('--publish') && existsSync(join(process.env.HOME, '.config/phasecraft/motifold-dev-ledger/live-rehearsal.lock'))) throw Error('Stop the local capture guard before publishing assets. Validation and private pack generation remain available.');
  const receiptFiles = value('--receipts', '').split(',').filter(Boolean); demand(receiptFiles.length > 0, 'Pass the actual guard receipt JSONL files');
  const receipts = receiptFiles.flatMap(file => readFileSync(resolve(file), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)));
  const { createServer } = await import('vite');
  const modules = await createServer({ root: repo, configFile: false, server: { middlewareMode: true }, appType: 'custom' });
  try {
    const readers = { ...(await modules.ssrLoadModule('/score/index.ts')), ...(await modules.ssrLoadModule('/app/arrange.ts')), ...(await modules.ssrLoadModule('/app/midi.ts')), ...(await modules.ssrLoadModule('/app/timing.ts')), ...(await modules.ssrLoadModule('/app/fixContext.ts')), ...(await modules.ssrLoadModule('/tools/new-note-range-repair.ts')), newBarNumbers: (await modules.ssrLoadModule('/server/shapes.ts')).newBarNumbers };
    const { TEMPLATES } = await modules.ssrLoadModule('/app/orchestra.ts');
    const { report } = buildCatalog({ repo, input, output, receipts, readers, templates: TEMPLATES, publish: args.includes('--publish') });
    console.log(JSON.stringify({ complete: report.complete, completePairs: report.completePairs, unavailable: report.unavailable, budget: report.budget, renderPack: report.renderPack }, null, 2));
  } finally { await modules.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
