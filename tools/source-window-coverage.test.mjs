// @vitest-environment jsdom
// Actual hook and ZIP export; canned local replies only, with fetch forbidden.
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { strFromU8 } from 'fflate';
import { parseScore } from '../score/index.ts';
import * as arrange from '../app/arrange.ts';
import * as timing from '../app/timing.ts';
import * as repair from './new-note-range-repair.ts';
import { fixCurrent } from '../app/fixContext.ts';
import { readMidi } from '../app/midi.ts';
import { useArrange } from '../app/useArrange.ts';
import { setTransport } from '../app/spark.ts';
import { newBarNumbers } from '../server/shapes.ts';
import { NIGHT_RECIPES } from './night-capture-matrix.ts';
import { captureHookDownload, runNightRecipe } from './night-capture-client.ts';
import { validateOutcome } from './build-night-catalog.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const sourceXml = readFileSync('public/demo/sample-sketch/sample-sketch.musicxml', 'utf8'), score = parseScore(sourceXml);
const loaded = { xmlText: sourceXml, score, fileName: 'sample-sketch.musicxml' };
const shared = JSON.parse(readFileSync('public/demo/sample-sketch/shared.json', 'utf8'));
const brass = JSON.parse(readFileSync('public/demo/sample-sketch/outcomes/arrange-neutral-brass-quintet-a/run.json', 'utf8'));
const layout = brass.filter(call => call.shape === 'distribute').at(-1).reply;
const readers = { parseScore, ...arrange, ...timing, ...repair, fixCurrent, readMidi, newBarNumbers };
// Authentic recent Brass plan boundary pattern, with original source-only gaps.
const spans = [[[1, 7], [9, 11], [17, 23], [25, 32], [33, 40]], [[1, 7], [12, 16], [17, 23], [25, 30], [31, 36], [37, 40]]];
let root;
afterEach(() => { act(() => root?.unmount()); root = null; setTransport(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

async function capture(intent = 'expand', gap = false) {
  vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('fetch', vi.fn(() => { throw Error('No real request'); }));
  const recipe = NIGHT_RECIPES.find(item => item.intent === intent && item.ensemble === 'Brass quintet' && item.mood === 'Neutral');
  const plans = ['A', 'B'].map((name, index) => ({ name: `Canned ${name}`, idea: 'Retain source spans and complete the ending', ...(intent === 'recompose' ? { motif: { from: '1', to: '2', what: 'Opening' }, fifths: 0, time: '3/4', qpm: 80 } : {}), why: (intent === 'recompose' ? [[1, 7], [9, 16], [17, 24], [25, 32]] : spans[index].filter(([from]) => intent !== 'arrange' || from <= 24)).flatMap(([from, to]) => gap && intent === 'expand' && from === 33 ? [[33, 35], [37, 40]] : gap && intent === 'expand' && to === 36 ? [[from, 35]] : [[from, to]]).map(([from, to]) => ({ from: String(from), to: String(to), what: 'A requested span', principle: 'Continue from this material', chords: 'C' })) }));
  const rows = [], files = new Map(); let context;
  setTransport(async (shape, input) => {
    let reply;
    if (shape === 'read_piece' || shape === 'study_score') reply = structuredClone(shared.find(call => call.shape === shape).reply);
    else if (shape === 'distribute') reply = structuredClone(layout);
    else if (shape === 'plan_options' || shape === 'plan_recompose') reply = { status: 'ok', answer: { options: plans } };
    else if (shape === 'write_theme') reply = { status: 'ok', answer: { lines: Array.from({ length: 32 }, (_, i) => ({ role: 'tune', bar: String(i + 1), events: 'C4@0+3' })) } };
    else if (shape === 'arrange') {
      const from = Number(input.window.from), to = Number(input.window.to);
      reply = { status: 'ok', answer: { adds: Array.from({ length: to - from + 1 }, (_, i) => from + i).filter(bar => intent === 'recompose' || bar > 24).map(bar => ({ part: 'Trumpet 1', bar: String(bar), events: 'C4@0+3', dyn: 'p', role: 'melody', art: '' })), doubles: [] } };
    } else throw Error('Unexpected request ' + shape);
    reply = { ...reply, cached: false, sources: [], model: 'local-canned-model', version: `local-${shape}` };
    rows.push({ sent: true, attemptId: `local-window-${rows.length}`, captureCase: context, shape, input: structuredClone(input), reply: structuredClone(reply), ms: 1, thinking: [], receipt: { state: 'settled', reserved_micros: 1, charged_micros: 1, usage: { inputTokens: 1, cachedTokens: 0, outputTokens: 1 } } });
    return reply;
  });
  let current;
  function Host() { current = useArrange(loaded, score.parts[0], { from: 0, to: 23 }, null); return null; }
  root = createRoot(document.body.appendChild(document.createElement('div'))); await act(async () => root.render(createElement(Host)));
  const result = await runNightRecipe(recipe, () => current, {
    invoke: async action => { await act(async () => { await action(); }); }, settle: async () => { await act(async () => { await Promise.resolve(); }); }, capture: captureHookDownload,
    phase: (id, phase) => { context = `${id}-${phase}`; }, save: async (_id, name, data) => { files.set(name, data); },
    observations: async () => rows.map(row => ({ shape: row.shape, status: 'ok', input: row.input, attemptId: row.attemptId, caseId: row.captureCase, model: row.reply.model, version: row.reply.version })),
  }, `${intent}-canned-source-gaps`);
  expect(result.status, result.error).toBe('complete'); expect(fetch).not.toHaveBeenCalled();
  const outcomes = ['a', 'b'].map(label => ({ summary: JSON.parse(strFromU8(files.get(`${label}-summary.json`))), archive: files.get(`${label}.zip`) }));
  return { recipe, rows, outcomes };
}
function verify(x, outcome = x.outcomes[0]) { return validateOutcome(outcome.summary, outcome.archive, { recipe: x.recipe, readers, receipts: x.rows, sourceXml }); }
function sync(outcome, rows) { outcome.summary.requests = outcome.summary.requests.map(request => { const row = rows.find(row => row.attemptId === request.attemptId); return { ...request, input: row.input, caseId: row.captureCase }; }); }

it.each(['arrange', 'expand'])('validates actual-hook paired %s exports with only the requested Brass-shaped source spans', async intent => {
  const x = await capture(intent);
  for (const [index, outcome] of x.outcomes.entries()) {
    const result = verify(x, outcome), windows = result.calls.filter(call => call.shape === 'arrange').map(call => [Number(call.input.window.from), Number(call.input.window.to)]);
    expect(windows).toEqual(spans[index].filter(([from]) => intent !== 'arrange' || from <= 24));
    expect(result.placement.acceptedSourceNotes).toBe(114); expect(result.placement.placed).toBe(114);
    expect(result.inspection.parts.every(part => part.bars === (intent === 'expand' ? 40 : 24))).toBe(true);
  }
});
it('still rejects a never-requested new expansion bar despite a full40-bar real-hook export', async () => {
  const x = await capture('expand', true);
  expect(() => verify(x)).toThrow('Missing new bars');
});
it('still requires every Recompose bar despite a full32-bar real-hook export and accepted theme', async () => {
  const x = await capture('recompose');
  expect(() => verify(x)).toThrow('Missing new bars');
});
it.each(['missing-planned', 'outside-window', 'unexpected-window', 'overlap', 'duplicate-success', 'wrong-owner'])('rejects %s while original source preservation remains required', async fault => {
  const x = await capture(), outcome = x.outcomes[0];
  const calls = x.rows.filter(row => row.shape === 'arrange' && row.captureCase.includes('-a-'));
  if (fault === 'missing-planned') outcome.summary.requests = outcome.summary.requests.filter(request => request.attemptId !== calls[1].attemptId);
  if (fault === 'outside-window') calls[0].reply.answer.adds.push({ part: 'Trumpet 1', bar: '40', events: 'D4@1+1', dyn: 'p', role: 'melody', art: '' });
  if (fault === 'unexpected-window') calls[0].input.window.to = '8';
  if (fault === 'overlap') calls[1].input.window.from = '7';
  if (fault === 'duplicate-success') { const row = { ...structuredClone(calls[0]), attemptId: 'duplicate-local-success' }; x.rows.push(row); outcome.summary.requests.push({ ...outcome.summary.requests.find(request => request.attemptId === calls[0].attemptId), attemptId: row.attemptId }); }
  if (fault === 'wrong-owner') calls[0].captureCase = calls[0].captureCase.replace('-a-preview', '-b-preview');
  sync(outcome, x.rows);
  expect(() => verify(x)).toThrow();
});
