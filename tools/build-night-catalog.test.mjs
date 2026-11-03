import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { unzipSync, zipSync, strFromU8 } from 'fflate';
import { parseScore } from '../score/index.ts';
import * as arrange from '../app/arrange.ts';
import { readMidi } from '../app/midi.ts';
import * as timing from '../app/timing.ts';
import { newBarNumbers } from '../server/shapes.ts';
import { TEMPLATES } from '../app/orchestra.ts';
import { buildCatalog, canonicalCalls, expectedRecipes, exposureReport, validateOutcome } from './build-night-catalog.mjs';

const readers = { parseScore, ...arrange, ...timing, readMidi, newBarNumbers };
const sourceXml = readFileSync('public/demo/sample-sketch/sample-sketch.musicxml', 'utf8');
const source = parseScore(sourceXml), recipe = expectedRecipes(TEMPLATES)[0];
const publicCalls = [...JSON.parse(readFileSync('public/demo/sample-sketch/shared.json', 'utf8')), ...JSON.parse(readFileSync('public/demo/sample-sketch/arrange-neutral.json', 'utf8'))];
const archive = new Uint8Array(readFileSync('public/demo/sample-sketch/neutral-strings-a.zip'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const folders = [];
afterEach(() => folders.splice(0).forEach(folder => rmSync(folder, { recursive: true, force: true })));
function fixture() {
  const caseId = `${recipe.id}-local-test`;
  const receipts = publicCalls.map((call, i) => ({ at: '2026-11-04T00:00:00Z', sent: true, attemptId: `local-${i}`, captureCase: `${caseId}-${i < 2 ? 'read-study' : i === 2 ? 'layout' : i === 3 ? 'plan' : i === 4 ? 'a-preview' : i === 5 ? 'b-preview' : 'a-full'}`, shape: call.shape, input: structuredClone(call.input), reply: { ...structuredClone(call.reply), model: call.model, version: call.version }, ms: call.ms, thinking: structuredClone(call.thinking), reservationMicros: 1_480_720, receipt: { state: 'settled', charged_micros: 100, reserved_micros: 1_480_720, usage: call.usage } }));
  const requests = receipts.map(row => ({ shape: row.shape, input: row.input, caseId: row.captureCase, status: 'ok', attemptId: row.attemptId, model: row.reply.model, version: row.reply.version }));
  const layout = publicCalls.find(call => call.shape === 'distribute'), placement = arrange.placeNotes(source, layout.input, layout.reply.answer, recipe.instruments, false);
  const base = parseScore(arrange.scoreOfParts(source, layout.input, placement.parts));
  const plan = publicCalls.find(call => call.shape === 'plan_options').reply.answer.options[0];
  const writes = publicCalls.filter(call => call.shape === 'arrange' && call.input.chosen.name === plan.name);
  const adds = writes.flatMap(call => arrange.withDoubles(call.reply.answer, writes[0].input.written.map(bar => bar.bar)));
  const summary = { caseId, recipe, status: 'complete', label: 'A', chosen: 0, plan, bars: 24, notes: 211, missing: [], source: { sha256: hash(new TextEncoder().encode(sourceXml)), bars: 24 }, sourceLayout: { status: 'ready', answer: layout.reply.answer, check: placement.check }, check: arrange.checkOption({ ...plan, adds }, base, writes[0].input), requests, zip: { file: `${caseId}/a.zip`, sha256: hash(archive) } };
  return { caseId, receipts, summary };
}

it('enumerates all204 outcomes and validates the real full A with source placement, actual calls and unchanged MIDI payloads', () => {
  const recipes = expectedRecipes(TEMPLATES);
  expect(recipes).toHaveLength(102);
  expect(recipes.filter(item => item.intent === 'recompose')).toHaveLength(90);
  expect(new Set(recipes.map(item => item.id)).size).toBe(102);
  const x = fixture();
  const result = validateOutcome(x.summary, archive, { recipe, readers, receipts: x.receipts, sourceXml });
  expect(result.inspection).toMatchObject({ parts: expect.any(Array), notes: 211, scoreAndMidiAgree: true });
  expect(result.placement).toMatchObject({ acceptedSourceNotes: 114, placed: 114, sourceLayoutNotes: 169 });
  expect(result.calls.filter(call => call.shape === 'arrange')).toHaveLength(4);
  expect(result.calls.every(call => !('attemptId' in call) && !('captureCase' in call))).toBe(true);
});

it('uses genuine fresh metadata for a matching cache hit and refuses missing original provenance', () => {
  const x = fixture(), first = x.receipts[0];
  const cached = { ...structuredClone(first), attemptId: 'cached-reading', ms: 4, thinking: [], reply: { ...first.reply, cached: true }, receipt: { state: 'settled', charged_micros: 0, reserved_micros: 0 } };
  x.summary.requests[0].attemptId = cached.attemptId;
  const calls = canonicalCalls(x.summary.requests, [...x.receipts, cached], x.caseId);
  expect(calls[0].ms).toBe(101600);
  expect(calls[0].thinking).toEqual(publicCalls[0].thinking);
  expect(calls[0].usage).toEqual(publicCalls[0].usage);
  expect(calls[0].reply.cached).toBe(false);
  expect(() => canonicalCalls(x.summary.requests, [...x.receipts.slice(1), cached], x.caseId)).toThrow('Missing fresh provenance');
  expect(() => canonicalCalls([{ ...x.summary.requests[0], caseId: `${x.caseId}-a-full` }], [...x.receipts, cached], x.caseId)).toThrow('invalid phase');
  expect(() => canonicalCalls([{ ...x.summary.requests[0], caseId: 'another-case-read-study' }], [...x.receipts, cached], x.caseId)).toThrow('another case');
});

it('retains both authentic layout takes and proves the final repaired placement; the repair phase permits only distribute', () => {
  const x = fixture(), initial = x.receipts.find(row => row.shape === 'distribute');
  const repair = structuredClone(initial);
  repair.attemptId = 'local-register-repair'; repair.captureCase = `${x.caseId}-layout-range-repair`;
  repair.input.ask = 'Register repair only: preserve source pitch classes, onsets, durations and harmony; fit the sounding ranges with whole octaves or existing voice redistribution.';
  initial.reply.answer.plan[0].octave = 3;
  x.receipts.push(repair);
  const request = { shape: repair.shape, input: repair.input, caseId: repair.captureCase, status: 'ok', attemptId: repair.attemptId };
  x.summary.requests.push(request);
  const result = validateOutcome(x.summary, archive, { recipe, readers, receipts: x.receipts, sourceXml });
  const layouts = result.calls.filter(call => call.shape === 'distribute');
  expect(layouts).toHaveLength(2);
  expect(layouts[0].reply.answer.plan[0].octave).toBe(3);
  expect(layouts[1].reply.answer).toEqual(x.summary.sourceLayout.answer);
  expect(result.placement.placed).toBe(114);
  expect(() => canonicalCalls([{ ...request, shape: 'plan_options' }], x.receipts, x.caseId)).toThrow('invalid phase');
});

function sourceOnly(x, moveOctave = false) {
  const layout = x.receipts.find(row => row.shape === 'distribute');
  if (moveOctave) layout.reply.answer.plan[0].octave = 1;
  const placed = arrange.placeNotes(source, layout.input, layout.reply.answer, recipe.instruments, false);
  const xml = arrange.scoreOfParts(source, layout.input, placed.parts), base = parseScore(xml);
  for (const row of x.receipts.filter(row => row.shape === 'arrange' && row.input.chosen.name === x.summary.plan.name)) row.reply.answer = { adds: [], doubles: [] };
  const input = x.receipts.find(row => row.shape === 'arrange').input;
  const check = arrange.checkOption({ ...x.summary.plan, adds: [] }, base, input);
  const exported = arrange.packageFiles(arrange.withOption(xml, base, check), check, 'A local source-only fixture');
  x.summary.check = check; x.summary.notes = arrange.scoreTracks(base).flatMap(track => track.notes).length;
  x.summary.sourceLayout = { status: 'ready', answer: layout.reply.answer, check: placed.check };
  x.summary.zip.sha256 = hash(exported);
  return exported;
}

it('accepts genuine source-only orchestration and recorded range-fitting octaves without requiring the original absolute pitches', () => {
  for (const moveOctave of [false, true]) {
    const x = fixture(), bytes = sourceOnly(x, moveOctave);
    const result = validateOutcome(x.summary, bytes, { recipe, readers, receipts: x.receipts, sourceXml });
    expect(result.inspection.notes).toBeGreaterThanOrEqual(114);
    expect(x.summary.check.notes).toBe(0);
    expect(result.placement.placed).toBe(114);
    if (moveOctave) expect(result.placement.rangeOctaveMoves).toBeGreaterThan(0);
  }
});

it('reproduces the hook stable bar ordering when a resumed preview reply groups its added notes by player', () => {
  const x = fixture();
  const writes = x.receipts.filter(row => row.shape === 'arrange' && row.input.chosen.name === x.summary.plan.name);
  for (const call of writes) call.reply.answer.adds.sort((a, b) => a.part.localeCompare(b.part) || Number(a.bar) - Number(b.bar));
  const layout = x.receipts.find(row => row.shape === 'distribute');
  const placed = arrange.placeNotes(source, layout.input, layout.reply.answer, recipe.instruments, false);
  const baseXml = arrange.scoreOfParts(source, layout.input, placed.parts), base = parseScore(baseXml), input = writes[0].input;
  const bars = input.written.map(bar => bar.bar), raw = writes.flatMap(call => arrange.withDoubles(call.reply.answer, bars));
  const adds = [...raw].sort((a, b) => bars.indexOf(a.bar) - bars.indexOf(b.bar));
  const check = arrange.checkOption({ ...x.summary.plan, adds }, base, input);
  expect(arrange.checkOption({ ...x.summary.plan, adds: raw }, base, input)).not.toEqual(check);
  const bytes = arrange.packageFiles(arrange.withOption(baseXml, base, check), check, 'A local resumed hook export');
  x.summary.check = check; x.summary.zip.sha256 = hash(bytes);
  expect(validateOutcome(x.summary, bytes, { recipe, readers, receipts: x.receipts, sourceXml }).inspection.notes).toBe(211);
});

it('keeps raw player-grouped order when a single preview already contains the whole arrangement', () => {
  const x = fixture(), oldName = x.summary.plan.name;
  const plan = { ...x.summary.plan, why: [] };
  x.summary.plan = plan;
  x.receipts.find(row => row.shape === 'plan_options').reply.answer.options[0] = plan;
  const writes = x.receipts.filter(row => row.shape === 'arrange' && row.input.chosen.name === oldName), first = writes[0];
  const raw = writes.flatMap(row => arrange.withDoubles(row.reply.answer, row.input.written.map(bar => bar.bar))).sort((a, b) => a.part.localeCompare(b.part) || Number(a.bar) - Number(b.bar));
  first.input.chosen = plan; delete first.input.window;
  first.reply.answer = { adds: raw, doubles: [] };
  const dropped = new Set(writes.slice(1).map(row => row.attemptId));
  x.receipts = x.receipts.filter(row => !dropped.has(row.attemptId));
  x.summary.requests = x.summary.requests.filter(row => !dropped.has(row.attemptId));
  const layout = x.receipts.find(row => row.shape === 'distribute');
  const placed = arrange.placeNotes(source, layout.input, layout.reply.answer, recipe.instruments, false);
  const baseXml = arrange.scoreOfParts(source, layout.input, placed.parts), base = parseScore(baseXml);
  const check = arrange.checkOption({ ...plan, adds: raw }, base, first.input);
  expect(check.adds.map(add => add.bar)).not.toEqual([...check.adds].sort((a, b) => Number(a.bar) - Number(b.bar)).map(add => add.bar));
  const bytes = arrange.packageFiles(arrange.withOption(baseXml, base, check), check, 'A one-call whole preview');
  x.summary.check = check; x.summary.zip.sha256 = hash(bytes);
  expect(validateOutcome(x.summary, bytes, { recipe, readers, receipts: x.receipts, sourceXml }).inspection.notes).toBe(211);
});

it('verifies a complete32-bar recomposition and refuses a failed or missing theme despite a playable full export', () => {
  const x = fixture(), recomposition = expectedRecipes(TEMPLATES).find(item => item.intent === 'recompose' && item.ensemble === 'String orchestra' && item.mood === 'Neutral');
  const plan = { name: 'Local recomposition fixture', idea: 'The source reshaped', fifths: 0, time: '3/4', qpm: 90, motif: { from: '1', to: '2', what: 'The opening' }, why: [{ from: '1', to: '32', what: 'A new treatment', principle: 'Keep the melody' }] };
  const baseXml = arrange.emptyScore(plan.name, recipe.instruments, { fifths: 0, time: '3/4', qpm: 90, bars: 32 }), base = parseScore(baseXml);
  const input = arrange.arrangeInput(base, base.parts[0], 0, 31, '', 0, null, { instruments: recipe.instruments, where: 'inside', freedom: 2 });
  const make = (shape, asked, answer, id) => ({ ...structuredClone(x.receipts[0]), attemptId: id, captureCase: `${x.caseId}-${shape === 'plan_recompose' ? 'plan' : 'a-full'}`, shape, input: asked, reply: { status: 'ok', cached: false, sources: [], answer, model: 'muse-spark-1.3', version: `${shape}-local-test` } });
  const notes = Array.from({ length: 32 }, (_, i) => ({ part: 'Violin I', bar: String(i + 1), events: 'C5@0+3', dyn: 'mf', role: 'melody', art: '' }));
  const calls = [make('plan_recompose', { ...publicCalls[3].input, moreBars: 32, where: 'after', freedom: 2 }, { options: [plan] }, 'local-plan'), make('write_theme', { ...publicCalls[3].input, moreBars: 32, where: 'after', freedom: 2, chosen: plan }, { lines: [{ bar: '1', role: 'tune', events: 'C5@0+3' }] }, 'local-theme')];
  for (let start = 1; start <= 32; start += 8) calls.push(make('arrange', { ...input, chosen: plan, window: { from: String(start), to: String(start + 7) } }, { adds: notes.slice(start - 1, start + 7), doubles: [] }, `local-write-${start}`));
  const receipts = [...x.receipts.slice(0, 2), ...calls];
  const adds = calls.filter(call => call.shape === 'arrange').flatMap(call => arrange.withDoubles(call.reply.answer, input.written.map(bar => bar.bar)));
  const check = arrange.checkOption({ ...plan, adds }, base, input), bytes = arrange.packageFiles(arrange.withOption(baseXml, base, check), check, 'Local32-bar fixture');
  const summary = { ...x.summary, recipe: recomposition, plan, bars: 32, notes: 32, sourceLayout: null, check, theme: { tuneBars: 1, bars: 32 }, zip: { ...x.summary.zip, sha256: hash(bytes) }, requests: receipts.map(row => ({ shape: row.shape, input: row.input, caseId: row.captureCase, attemptId: row.attemptId, status: 'ok' })) };
  expect(validateOutcome(summary, bytes, { recipe: recomposition, readers, receipts, sourceXml }).inspection.notes).toBe(32);
  expect(() => validateOutcome({ ...summary, themeReason: 'failed' }, bytes, { recipe: recomposition, readers, receipts, sourceXml })).toThrow('theme step');
  const failedTheme = { shape: 'write_theme', input: calls[1].input, status: 'fallback', reason: 'failed' };
  expect(() => validateOutcome({ ...summary, requests: [...summary.requests, failedTheme] }, bytes, { recipe: recomposition, readers, receipts, sourceXml })).toThrow('theme step');
});

it('verifies all40 expansion bars, including16 new bars, without truncating the original source', () => {
  const x = fixture(), expanded = expectedRecipes(TEMPLATES).find(item => item.intent === 'expand' && item.ensemble === 'String orchestra');
  const oldId = x.caseId; x.caseId = `${expanded.id}-local-test`;
  const plan = { ...structuredClone(x.summary.plan), why: [...x.summary.plan.why, { from: '25', to: '32', what: 'Continue', principle: 'Develop the source' }, { from: '33', to: '40', what: 'Finish', principle: 'Complete the phrase' }] };
  for (const row of x.receipts) {
    row.captureCase = row.captureCase.replace(oldId, x.caseId);
    if (row.shape === 'distribute') row.input.intent = 'expand';
    if (row.shape === 'plan_options' || row.shape === 'arrange') Object.assign(row.input, { intent: 'expand', moreBars: 16, where: 'both' });
    if (row.shape === 'plan_options') row.reply.answer.options[0] = plan;
    if (row.shape === 'arrange' && row.input.chosen.name === plan.name) row.input.chosen = plan;
  }
  const first = x.receipts.find(row => row.shape === 'arrange' && row.input.chosen.name === plan.name);
  for (const start of [25, 33]) {
    const extra = structuredClone(first); extra.attemptId = `tail-${start}`; extra.captureCase = `${x.caseId}-a-full`; extra.input.window = { from: String(start), to: String(start + 7) };
    extra.reply.answer = { adds: Array.from({ length: 8 }, (_, i) => ({ part: 'Violin I', bar: String(start + i), events: 'C5@0+3', dyn: 'mf', role: 'melody', art: '' })), doubles: [] };
    x.receipts.push(extra);
  }
  const layout = x.receipts.find(row => row.shape === 'distribute');
  const placed = arrange.placeNotes(source, layout.input, layout.reply.answer, recipe.instruments, false), baseXml = arrange.scoreOfParts(source, layout.input, placed.parts), base = parseScore(baseXml);
  const bars = [...first.input.written.map(bar => bar.bar), ...newBarNumbers(first.input)];
  const adds = x.receipts.filter(row => row.shape === 'arrange' && row.input.chosen.name === plan.name).flatMap(row => arrange.withDoubles(row.reply.answer, bars));
  const check = arrange.checkOption({ ...plan, adds }, base, first.input), bytes = arrange.packageFiles(arrange.withOption(baseXml, base, check), check, 'Local40-bar expansion');
  const summary = { ...x.summary, caseId: x.caseId, recipe: expanded, plan, bars: 40, notes: 227, check, sourceLayout: { status: 'ready', answer: layout.reply.answer, check: placed.check }, zip: { ...x.summary.zip, sha256: hash(bytes) }, requests: x.receipts.map(row => ({ shape: row.shape, input: row.input, caseId: row.captureCase, attemptId: row.attemptId, status: 'ok' })) };
  const result = validateOutcome(summary, bytes, { recipe: expanded, readers, receipts: x.receipts, sourceXml });
  expect(result.inspection.parts.every(part => part.bars === 40)).toBe(true);
  expect(result.placement.placed).toBe(114);
  expect(result.inspection.notes).toBe(227);
});

it('refuses uncompleted windows, hard acceptance failures, unproven requests and changed MIDI tempo maps', () => {
  const x = fixture(), options = { recipe, readers, receipts: x.receipts, sourceXml };
  expect(() => validateOutcome({ ...x.summary, missing: [{ from: '22', to: '24' }] }, archive, options)).toThrow('Missing writing');
  expect(() => validateOutcome({ ...x.summary, check: { ...x.summary.check, outOfRange: [{}] } }, archive, options)).toThrow('hard acceptance');
  expect(() => validateOutcome({ ...x.summary, requests: x.summary.requests.slice(1) }, archive, options)).toThrow('reading or Study');
  const files = unzipSync(archive), score = parseScore(strFromU8(files['score.musicxml']));
  files['all-parts.mid'] = arrange.midiFile(arrange.scoreTracks(score), 91, { beats: 3, beatType: 4 });
  const changed = zipSync(files);
  expect(() => validateOutcome({ ...x.summary, zip: { ...x.summary.zip, sha256: hash(changed) } }, changed, options)).toThrow(/MIDI notes, tempos/);
});

it('rejects a self-consistent XML/MIDI export that moves one source tempo offset despite retaining all50 marks, or changes source metre', () => {
  const x = fixture(), options = { recipe, readers, receipts: x.receipts, sourceXml };
  const xml = strFromU8(unzipSync(archive)['score.musicxml']);
  const shifted = xml.replace(/<forward><duration>(\d+)<\/duration><\/forward><sound tempo="([^"]+)"\/><backup><duration>\1<\/duration><\/backup>/, (_all, ticks, qpm) => `<forward><duration>${Number(ticks) + 1}</duration></forward><sound tempo="${qpm}"/><backup><duration>${Number(ticks) + 1}</duration></backup>`);
  expect(shifted).not.toBe(xml);
  expect(parseScore(shifted).parts[0].measures.flatMap(measure => measure.tempos)).toHaveLength(50);
  for (const changedXml of [shifted, xml.replace('<beats>3</beats>', '<beats>4</beats>')]) {
    const changed = arrange.packageFiles(changedXml, x.summary.check, 'A changed source clock');
    expect(() => validateOutcome({ ...x.summary, zip: { ...x.summary.zip, sha256: hash(changed) } }, changed, options)).toThrow('source tempo offset or metre');
  }
});

it('publishes only a verified A, leaves203 entries disabled, and preserves the original tutorial and117-note MIDI', () => {
  const folder = mkdtempSync(join(tmpdir(), 'motifold-catalog-')); folders.push(folder);
  const repo = join(folder, 'repo'), input = join(folder, 'capture'), output = join(folder, 'report'), publicFolder = join(repo, 'public/demo/sample-sketch');
  mkdirSync(publicFolder, { recursive: true });
  mkdirSync(join(repo, 'test-fixtures'), { recursive: true }); writeFileSync(join(repo, 'test-fixtures/sample-sketch-bars.json'), readFileSync('test-fixtures/sample-sketch-bars.json'));
  for (const name of ['sample-sketch.musicxml', 'Sample_sketch.mid', 'shared.json', 'arrange-neutral.json', 'neutral-strings-a.zip']) writeFileSync(join(publicFolder, name), readFileSync(`public/demo/sample-sketch/${name}`));
  const index = readFileSync('public/demo/index.json'); writeFileSync(join(repo, 'public/demo/index.json'), index);
  const x = fixture(); mkdirSync(join(input, x.caseId), { recursive: true });
  writeFileSync(join(input, x.caseId, 'a.zip'), archive); writeFileSync(join(input, x.caseId, 'a-summary.json'), JSON.stringify(x.summary));
  writeFileSync(join(input, x.caseId, 'summary.json'), JSON.stringify({ recipe, status: 'failed', error: 'The batch stopped before B completed.' }));
  const before = hash(readFileSync(join(publicFolder, 'arrange-neutral.json')));
  const result = buildCatalog({ repo, input, output, receipts: x.receipts, readers, templates: TEMPLATES, publish: true });
  expect(result.catalog.outcomes).toHaveLength(204);
  expect(result.report).toMatchObject({ complete: 1, completePairs: 0, failedOrIncomplete: 1, unrecorded: 202 });
  expect(result.catalog.outcomes.filter(item => item.status !== 'complete').every(item => !item.xml && !item.midi && !item.zip && !item.run)).toBe(true);
  expect(hash(readFileSync(join(publicFolder, 'arrange-neutral.json')))).toBe(before);
  expect(JSON.parse(readFileSync(join(repo, 'public/demo/index.json'))).pieces[0].runs).toEqual(JSON.parse(index).pieces[0].runs);
  const pack = unzipSync(result.pack);
  expect(readMidi(pack['source/original-performance-117.mid']).tracks.flatMap(track => track.notes)).toHaveLength(117);
  expect(pack['source/original-performance-117.mid']).toEqual(new Uint8Array(readFileSync('test-fixtures/Sample_sketch.mid')));
  expect(readMidi(pack['source/performance-tempo-map-117.mid']).tracks.flatMap(track => track.notes)).toHaveLength(117);
  expect(readMidi(pack['source/accepted-score-114.mid']).tracks.flatMap(track => track.notes)).toHaveLength(114);
  const publishedPiece = JSON.parse(readFileSync(join(repo, 'public/demo/index.json'))).pieces[0];
  expect(publishedPiece.mappedMidi).toBe('/demo/sample-sketch/source/performance-tempo-map-117.mid');
  expect(publishedPiece.acceptedMidi).toBe('/demo/sample-sketch/source/accepted-score-114.mid');
  expect(new Uint8Array(readFileSync(join(publicFolder, 'source/performance-tempo-map-117.mid')))).toEqual(pack['source/performance-tempo-map-117.mid']);
  const sourceManifest = JSON.parse(strFromU8(pack['source/manifest.json']));
  expect(sourceManifest.files).toHaveLength(3);
  expect(sourceManifest.normalization).toMatchObject({ notes: 117, originalDawLeadSeconds: 2698 });
  expect(strFromU8(pack['source/render-checklist.txt'])).toContain('note-offs within MIDI tick rounding');
  expect(strFromU8(pack['source/render-checklist.txt'])).toContain('Nearby attacks are grouped and note durations are interpreted');
  expect(Object.keys(pack).some(name => /\.(wav|mp3|flac)$/.test(name))).toBe(false);
  expect(JSON.stringify(JSON.parse(strFromU8(pack['manifest.json'])))).not.toContain('charged_micros');
});

it('retains pending and uncertain reservations in the private budget report without counting old untagged calls twice', () => {
  const rows = [
    { attemptId: 'old', sent: true, receipt: { state: 'uncertain', reserved_micros: 1_480_720 } },
    { attemptId: 'a', captureCase: 'local', sent: 'releasing', reservationMicros: 1_480_720 },
    { attemptId: 'a', captureCase: 'local', sent: true, receipt: { state: 'settled', charged_micros: 50_000 } },
    { attemptId: 'b', captureCase: 'local', sent: true, receipt: { state: 'uncertain', reserved_micros: 1_480_720 } },
    { attemptId: 'c', captureCase: 'local', sent: 'releasing', reservationMicros: 1_480_720 },
  ];
  expect(exposureReport(rows)).toMatchObject({ settledMicros: 50_000, uncertainMicros: 1_480_720, pendingMicros: 1_480_720, newExposureMicros: 3_011_440, cumulativeDevExposureMicros: 24_059_516 });
});

it('promotes only a verified same-case full A/B pair into a self-contained tutorial while preserving legacy files', () => {
  const folder = mkdtempSync(join(tmpdir(), 'motifold-paired-tutorial-')); folders.push(folder);
  const repo = join(folder, 'repo'), input = join(folder, 'captures'), output = join(folder, 'report'), sourceFolder = join(repo, 'public/demo/sample-sketch');
  mkdirSync(sourceFolder, { recursive: true });
  mkdirSync(join(repo, 'test-fixtures'), { recursive: true }); writeFileSync(join(repo, 'test-fixtures/sample-sketch-bars.json'), readFileSync('test-fixtures/sample-sketch-bars.json'));
  for (const name of ['sample-sketch.musicxml', 'Sample_sketch.mid', 'shared.json', 'arrange-neutral.json', 'neutral-strings-a.zip']) writeFileSync(join(sourceFolder, name), readFileSync(`public/demo/sample-sketch/${name}`));
  const oldIndex = JSON.parse(readFileSync('public/demo/index.json'));
  writeFileSync(join(repo, 'public/demo/index.json'), JSON.stringify(oldIndex));
  const x = fixture(), aZip = sourceOnly(x), layout = x.receipts.find(row => row.shape === 'distribute');
  const placement = arrange.placeNotes(source, layout.input, layout.reply.answer, recipe.instruments, false), baseXml = arrange.scoreOfParts(source, layout.input, placement.parts), base = parseScore(baseXml);
  const bPlan = publicCalls.find(call => call.shape === 'plan_options').reply.answer.options[1];
  const bRows = x.receipts.filter(row => row.shape === 'arrange' && row.input.chosen.name === x.summary.plan.name).map((row, i) => ({ ...structuredClone(row), attemptId: `local-b-${i}`, captureCase: `${x.caseId}-b-full`, input: { ...structuredClone(row.input), chosen: bPlan } }));
  const bCheck = arrange.checkOption({ ...bPlan, adds: [] }, base, bRows[0].input), bZip = arrange.packageFiles(arrange.withOption(baseXml, base, bCheck), bCheck, 'Local B orchestration');
  const common = x.summary.requests.filter(request => request.shape !== 'arrange');
  const bSummary = { ...structuredClone(x.summary), label: 'B', chosen: 1, plan: bPlan, check: bCheck, requests: [...common, ...bRows.map(row => ({ shape: row.shape, input: row.input, caseId: row.captureCase, attemptId: row.attemptId, status: 'ok' }))], zip: { file: `${x.caseId}/b.zip`, sha256: hash(bZip) } };
  mkdirSync(join(input, x.caseId), { recursive: true });
  for (const [label, summary, bytes] of [['a', x.summary, aZip], ['b', bSummary, bZip]]) {
    writeFileSync(join(input, x.caseId, `${label}.zip`), bytes); writeFileSync(join(input, x.caseId, `${label}-summary.json`), JSON.stringify(summary));
  }
  const result = buildCatalog({ repo, input, output, receipts: [...x.receipts, ...bRows], readers, templates: TEMPLATES, publish: true });
  expect(result.report).toMatchObject({ complete: 2, completePairs: 1 });
  const piece = JSON.parse(readFileSync(join(repo, 'public/demo/index.json'))).pieces[0];
  expect(piece.tutorial).toMatchObject({ runKey: 'guided-neutral-strings', completeOptions: [0, 1], rawNoteCount: 117, acceptedNoteCount: 114 });
  expect(piece.runs).toContainEqual({ key: 'guided-neutral-strings', mode: 'arrange', ensemble: 'String orchestra', mood: 'Neutral', selfContained: true });
  expect(piece.runs).toEqual(expect.arrayContaining(oldIndex.pieces[0].runs));
  expect(piece.legacyVerifiedExport).toEqual(oldIndex.pieces[0].legacyVerifiedExport ?? oldIndex.pieces[0].verifiedExport);
  const guided = JSON.parse(readFileSync(join(sourceFolder, 'guided-neutral-strings.json')));
  expect(guided.filter(call => call.shape === 'read_piece')).toHaveLength(1);
  expect(new Set(guided.filter(call => call.shape === 'arrange').map(call => call.input.chosen.name))).toEqual(new Set([x.summary.plan.name, bPlan.name]));
  expect(readFileSync(join(sourceFolder, 'shared.json'))).toEqual(readFileSync('public/demo/sample-sketch/shared.json'));
  buildCatalog({ repo, input, output, receipts: [...x.receipts, ...bRows], readers, templates: TEMPLATES, publish: true });
  const republished = JSON.parse(readFileSync(join(repo, 'public/demo/index.json'))).pieces[0];
  expect(republished.legacyVerifiedExport).toEqual(piece.legacyVerifiedExport);
  expect(republished.verifiedExport).toEqual(piece.verifiedExport);
  expect(new Set(republished.runs.map(run => run.key)).size).toBe(republished.runs.length);
});
