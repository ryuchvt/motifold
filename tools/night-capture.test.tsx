// @vitest-environment jsdom
// Real hook and real download packaging. Only the model replies and collector are local fakes.
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { parseScore } from '../score';
import { useArrange, type Arranged } from '../app/useArrange';
import { setTransport } from '../app/spark';
import { TEMPLATES } from '../app/orchestra';
import { emptyScore, packageFiles, scoreTracks } from '../app/arrange';
import { distribute } from '../server/shapes';
import { fixCurrent } from '../app/fixContext';
import { captureHookDownload, claimRegisterRepair, runNightRecipe, type NightIO } from './night-capture-client';
import { NIGHT_RECIPES } from './night-capture-matrix';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const xmlText = readFileSync('public/demo/sample-sketch/sample-sketch.musicxml', 'utf8');
const score = parseScore(xmlText), loaded = { xmlText, score, fileName: 'sample-sketch.musicxml' };
const shared = JSON.parse(readFileSync('public/demo/sample-sketch/shared.json', 'utf8'));
const saved = JSON.parse(readFileSync('public/demo/sample-sketch/arrange-neutral.json', 'utf8'));
let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; setTransport(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

it('enumerates102 unique recipes and204 outcomes in the approved priority order', () => {
  expect(NIGHT_RECIPES).toHaveLength(102);
  expect(new Set(NIGHT_RECIPES.map(item => item.id)).size).toBe(102);
  expect(NIGHT_RECIPES.slice(0, 6).map(item => item.ensemble)).toEqual(TEMPLATES.map(item => item.name));
  expect(NIGHT_RECIPES.slice(6, 12).every(item => item.intent === 'expand' && item.bars === 40 && item.moreBars === 16 && item.where === 'both' && item.mood === 'Neutral' && !item.tuneOnly)).toBe(true);
  expect(NIGHT_RECIPES.slice(12, 27).every(item => item.intent === 'recompose' && item.ensemble === 'Full orchestra' && item.bars === 32 && item.freedom === 2)).toBe(true);
  expect(NIGHT_RECIPES.filter(item => item.intent === 'recompose')).toHaveLength(90);
});

type NewRepair = 'new-fixed' | 'new-repeat' | 'new-fallback' | 'new-drop' | 'new-add' | 'new-rhythm' | 'new-dyn' | 'new-role' | 'new-art' | 'new-unrelated' | 'new-three-bars';
async function setup(failure?: 'notes' | 'theme' | 'zero-adds' | 'grouped-theme' | 'range-fixed' | 'range-repeat' | 'range-fallback' | 'range-other-flags' | 'layout-fallback' | 'b-empty-theme' | 'b-invalid-theme' | 'wonder-empty-art' | NewRepair) {
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('No real network is allowed'); }));
  const requests: { shape: string; input: any }[] = [];
  let context = 'idle';
  const repairClaims = new Set<string>();
  const recordedPlan = saved.find((call: any) => call.shape === 'plan_options').reply.answer.options[0];
  const plans = (recompose: boolean, expand: boolean) => ['A', 'B'].map(name => ({ ...recordedPlan, name: `Synthetic ${name}`, ...(recompose ? { motif: { from: '1', to: '2', what: 'A rising gesture' }, fifths: 0, time: '3/4', qpm: 80 } : {}), why: recompose ? [1, 9, 17, 25].map(from => ({ from: String(from), to: String(from + 7), what: 'A line', principle: 'Continue', chords: 'C', variation: 'Keep the gesture' })) : [...recordedPlan.why, ...(expand ? [{ from: '25', to: '32', what: 'Continue', principle: 'Connect', chords: 'C' }, { from: '33', to: '40', what: 'Finish', principle: 'Return', chords: 'C' }] : [])] }));
  setTransport(async (shape, input) => {
    claimRegisterRepair(context, shape, repairClaims);
    const asked = input as any; requests.push({ shape, input });
    if (shape === 'read_piece' || shape === 'study_score') return structuredClone(shared.find((call: any) => call.shape === shape).reply);
    if (shape === 'distribute') {
      const count = requests.filter(call => call.shape === 'distribute').length;
      if (failure === 'layout-fallback') return { status: 'fallback', reason: 'unknown-charge' };
      if (failure === 'range-fallback' && count === 2) return { status: 'fallback', reason: 'network' };
      const reply = structuredClone(saved.find((call: any) => call.shape === shape).reply);
      if (failure?.startsWith('range-') && (count === 1 || failure === 'range-repeat')) reply.answer.plan.find((entry: any) => entry.part === 'Double Bass').octave = 3;
      if (failure === 'range-other-flags') reply.answer.plan = reply.answer.plan.filter((entry: any) => !(entry.line === 'Piano upper' && entry.from === '1'));
      return reply;
    }
    if (shape === 'plan_options') return { status: 'ok', cached: false, answer: { options: plans(false, asked.moreBars > 0) } };
    if (shape === 'plan_recompose') return { status: 'ok', cached: false, answer: { options: plans(true, false) } };
    if (shape === 'write_theme' && asked.chosen.name === 'Synthetic B' && (failure === 'b-empty-theme' || failure === 'b-invalid-theme')) return { status: 'ok', cached: false, answer: { lines: failure === 'b-empty-theme' ? [] : [{ role: 'tune', bar: '1', events: 'invalid@0+3' }] } };
    if (shape === 'write_theme') return failure === 'theme'  ? { status: 'fallback', reason: 'failed' } : { status: 'ok', cached: false, answer: { lines: Array.from({ length: 32 }, (_, index) => ({ role: 'tune', bar: String(index + 1), events: 'C5@0+3' })) } };
    if (shape === 'arrange') {
      if (failure === 'notes') return { status: 'fallback', reason: 'budget' };
      if (failure === 'zero-adds') return { status: 'ok', cached: false, answer: { adds: [], doubles: [] } };
      const from = Number(asked.window?.from ?? '1'), to = Number(asked.window?.to ?? '24');
      if (failure === 'wonder-empty-art' && asked.seed) {
        const adds = Array.from({ length: to - from + 1 }, (_, index) => {
          const bar = String(from + index);
          if (asked.chosen.name === 'Synthetic B' && bar === '28') return [
            { part: 'Violin I', bar, events: 'C5@0+2 E4@2.5+0.5', dyn: 'mp', role: 'melody', art: '' },
            ...(asked.fix ? [{ part: 'Trumpet 1', bar, events: 'C4@0+2 E4@2.5+0.5', dyn: 'mp', role: 'melody', art: '' }] : []),
          ];
          return [{ part: 'Violin I', bar, events: `${asked.chosen.name === 'Synthetic B' ? 'D5' : 'C5'}@0+3`, dyn: 'mp', role: 'melody' }];
        }).flat();
        const doubles = asked.chosen.name === 'Synthetic B' && from <= 28 && to >= 28 && !asked.fix ? [{ from: '28', to: '28', of: 'Violin I', part: 'Trumpet 1', octave: -1 }] : [];
        return { status: 'ok', cached: false, answer: { adds, doubles } };
      }
      if (failure?.startsWith('new-') && asked.seed) {
        if (asked.fix && failure === 'new-fallback') return { status: 'fallback', reason: 'unknown-charge' };
        const adds = Array.from({ length: to - from + 1 }, (_, index) => {
          const bar = String(from + index), bad = bar === '10' || (failure === 'new-three-bars' && bar === '11');
          return [{ part: 'Violin I', bar, events: bad ? 'A3@0+1 G3@1+1 F3@2+1' : `${asked.chosen.name === 'Synthetic B' ? 'D5' : 'C5'}@0+3`, dyn: bad ? 'p<mf' : 'mp', role: bad ? 'countermelody' : 'melody', art: bad ? 'pizz' : '' }, { part: 'Cello', bar, events: 'C3@0+3', dyn: 'p', role: 'bass', art: '' }, ...(bar === '30' ? [{ part: 'Flute 1', bar, events: 'B3@0+1.5 C4@1.5+1.5', dyn: 'mp', role: 'melody', art: '' }] : [])];
        }).flat();
        const doubles = from <= 10 && to >= 10 ? [{ from: '10', to: '10', of: 'Violin I', part: 'Violin II', octave: 0 }] : [];
        if (asked.fix && failure !== 'new-repeat') {
          for (const add of adds) add.events = add.events.replaceAll('F3', 'F4').replaceAll('B3', 'B4');
          if (failure === 'new-drop') adds.splice(adds.findIndex(add => add.part === 'Cello'), 1);
          if (failure === 'new-add') adds.push({ part: 'Cello', bar: String(from), events: 'G2@0+3', dyn: 'p', role: 'bass', art: '' });
          if (failure === 'new-rhythm') adds[0]!.events = adds[0]!.events.replace('@0+', '@0.01+');
          if (failure === 'new-dyn') adds[0]!.dyn = 'ff';
          if (failure === 'new-role') adds[0]!.role = 'harmony';
          if (failure === 'new-art') adds[0]!.art = '';
          if (failure === 'new-unrelated') adds.find(add => add.part === 'Cello')!.events = 'C4@0+3';
        }
        return { status: 'ok', cached: false, answer: { adds, doubles } };
      }
      if (asked.seed && failure === 'grouped-theme') return { status: 'ok', cached: false, answer: { adds: ['Violin I', 'Violin II'].flatMap(part => Array.from({ length: to - from + 1 }, (_, index) => ({ part, bar: String(from + index), events: 'C5@0+3', dyn: 'mp', role: 'melody', art: '' }))), doubles: [] } };
      if (asked.seed || from > 24) return { status: 'ok', cached: false, answer: { adds: Array.from({ length: to - from + 1 }, (_, index) => ({ part: 'Violin I', bar: String(from + index), events: `${asked.chosen.name === 'Synthetic B' ? 'D5' : 'C5'}@0+3`, dyn: 'mp', role: 'melody', art: '' })), doubles: [] } };
      const receipt = saved.find((call: any) => call.shape === 'arrange' && call.input.chosen.name === recordedPlan.name && call.input.window.from === String(from));
      if (!receipt) throw Error(`No local fixture window ${from}`);
      return structuredClone(receipt.reply);
    }
    throw Error(`Unexpected shape ${shape}`);
  });
  let current!: Arranged;
  function Host() { current = useArrange(loaded, score.parts[0]!, { from: 0, to: 23 }, null); return null; }
  root = createRoot(document.body.appendChild(document.createElement('div')));
  await act(async () => root!.render(createElement(Host)));
  const files = new Map<string, Uint8Array>(), phases: string[] = [];
  const io: NightIO = {
    invoke: async action => { await act(async () => { await action(); }); },
    settle: async () => { await act(async () => { await Promise.resolve(); }); },
    capture: captureHookDownload, phase: (caseId, phase) => { context = `${caseId}-${phase}`; phases.push(phase); },
    save: async (_caseId, file, data) => { files.set(file, data); },
  };
  return { current: () => current, io, files, phases, requests };
}

it.each(['arrange', 'expand'] as const)('captures actual-hook %s A and B ZIPs after previews, with no real network', async intent => {
  const { current, io, files, phases, requests } = await setup();
  const recipe = NIGHT_RECIPES.find(item => item.intent === intent && item.ensemble === 'String orchestra')!;
  const result = await runNightRecipe(recipe, current, io, `${intent}-local-smoke`);
  expect(result.status, result.error).toBe('complete'); expect(result.outcomes).toHaveLength(2);
  expect(phases).toEqual(['reset', 'read-study', 'confirm-piano-skip-questions', 'layout', 'plan', 'a-preview', 'b-preview', 'a-full', 'b-full', 'complete']);
  for (const label of ['a', 'b']) {
    const zip = unzipSync(files.get(`${label}.zip`)!);
    expect(Object.keys(zip).some(name => name.startsWith('parts/'))).toBe(true);
    expect(files.has(`${label}-parts-01-Violin-I.mid`)).toBe(true);
    expect(parseScore(strFromU8(zip['score.musicxml']!)).parts.every(part => part.measures.length === recipe.bars)).toBe(true);
    const summary = JSON.parse(strFromU8(files.get(`${label}-summary.json`)!));
    expect(summary).toMatchObject({ status: 'complete', label: label.toUpperCase(), selected: label === 'a' ? 0 : 1, recipe: { intent, tuneOnly: false }, missing: [] });
    expect(summary.zip.sha256).toMatch(/^[0-9a-f]{64}$/);
  }
  expect(requests.find(call => call.shape === 'distribute')!.input).toMatchObject({ intent, answers: [], tracks: [{ line: 'Piano upper', instrument: 'Piano' }, { line: 'Piano lower', instrument: 'Piano' }] });
  expect(requests.filter(call => call.shape === 'arrange').some(call => call.input.chosen.name === 'Synthetic B' && call.input.window.from !== '1')).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
});

it('repairs at most two bad new-note bars through real askFix, preserves both identities and exports both actual ZIPs', async () => {
  const { current, io, files, phases, requests } = await setup('new-fixed');
  const recipe = NIGHT_RECIPES.find(item => item.intent === 'recompose' && item.ensemble === 'Full orchestra' && item.mood === 'Neutral')!;
  const result = await runNightRecipe(recipe, current, io, 'new-note-repair');
  expect(result.status, result.error).toBe('complete');
  const fixes = requests.filter(call => call.input.fix);
  expect(fixes.map(call => [call.input.chosen.name, call.input.window.from, call.input.window.to])).toEqual([['Synthetic A', '10', '10'], ['Synthetic A', '30', '30'], ['Synthetic B', '10', '10'], ['Synthetic B', '30', '30']]);
  expect(fixes.every(call => call.input.fix.ask.length <= 400 && call.input.seed.theme.includes(`Bar ${call.input.window.from} tune:`))).toBe(true);
  expect(fixes[0]!.input.fix.current).toContain(JSON.stringify({ dyn: 'p<mf', role: 'countermelody', art: 'pizz' }));
  expect(phases.filter(phase => phase.includes('note-range-repair'))).toEqual(['a-note-range-repair-1', 'a-note-range-repair-2', 'b-note-range-repair-1', 'b-note-range-repair-2']);
  for (const label of ['a', 'b']) {
    const summary = JSON.parse(strFromU8(files.get(`${label}-summary.json`)!));
    const proof = JSON.parse(strFromU8(files.get(`${label}-note-range-repair.json`)!));
    expect(summary).toMatchObject({ chosen: label === 'a' ? 0 : 1, selected: 0, plan: { name: `Synthetic ${label.toUpperCase()}` }, check: { outOfRange: [], unreadable: 0, overBars: 0, pastBarEnd: 0 } });
    expect(proof.status).toBe('complete'); expect(proof.repairs).toHaveLength(2);
    expect(fixes.find(call => call.input.chosen.name === summary.plan.name)!.input.fix.current).toBe(fixCurrent(proof.repairs[0].before, ['10']));
    const parsed = parseScore(strFromU8(unzipSync(files.get(`${label}.zip`)!)['score.musicxml']!));
    expect(parsed.parts).toHaveLength(recipe.instruments.length); expect(parsed.parts.every(part => part.measures.length === 32)).toBe(true);
  }
  expect(files.get('a-score.musicxml')).not.toEqual(files.get('b-score.musicxml'));
  expect(fetch).not.toHaveBeenCalled();
});

it('exports the real-hook Trumpet28 octave repair when only absent/empty art differs, retaining both raw forms', async () => {
  const { current, io, files, phases, requests } = await setup('wonder-empty-art');
  const recipe = NIGHT_RECIPES.find(item => item.intent === 'recompose' && item.ensemble === 'Full orchestra' && item.mood === 'Wonder')!;
  const result = await runNightRecipe(recipe, current, io, 'empty-art-local');
  expect(result.status, result.error).toBe('complete'); expect(result.outcomes).toHaveLength(2);
  const fixes = requests.filter(call => call.input.fix);
  expect(fixes).toHaveLength(1);
  expect(fixes[0]!.input).toMatchObject({ chosen: { name: 'Synthetic B' }, window: { from: '28', to: '28' } });
  expect(fixes[0]!.input.fix.current).toContain('C4@0+2 E3@2.5+0.5');
  expect(fixes[0]!.input.fix.current).toContain(JSON.stringify({ dyn: 'mp', role: 'melody', art: null }));
  expect(phases.filter(phase => phase.includes('note-range-repair'))).toEqual(['b-note-range-repair-1']);
  const proof = JSON.parse(strFromU8(files.get('b-note-range-repair.json')!));
  const original = proof.repairs[0].before.find((add: any) => add.part === 'Trumpet 1' && add.bar === '28');
  const repaired = proof.repairs[0].after.find((add: any) => add.part === 'Trumpet 1' && add.bar === '28');
  expect(original).toEqual({ part: 'Trumpet 1', bar: '28', events: 'C4@0+2 E3@2.5+0.5', dyn: 'mp', role: 'melody' });
  expect(repaired).toEqual({ ...original, events: 'C4@0+2 E4@2.5+0.5', art: '' });
  for (const label of ['a', 'b']) {
    const summary = JSON.parse(strFromU8(files.get(`${label}-summary.json`)!));
    expect(summary).toMatchObject({ status: 'complete', label: label.toUpperCase(), chosen: label === 'a' ? 0 : 1, check: { outOfRange: [] } });
    expect(parseScore(strFromU8(unzipSync(files.get(`${label}.zip`)!)['score.musicxml']!)).parts.every(part => part.measures.length === 32)).toBe(true);
  }
  expect(fetch).not.toHaveBeenCalled();
});

it('claims each physical new-note repair phase once and rejects an extra ordinal or another shape', () => {
  const claimed = new Set<string>(), phase = 'local-a-note-range-repair-1';
  expect(() => claimRegisterRepair(phase, 'distribute', claimed)).toThrow(); expect(claimed.size).toBe(0);
  claimRegisterRepair(phase, 'arrange', claimed);
  expect(() => claimRegisterRepair(phase, 'arrange', claimed)).toThrow('already attempted');
  for (const label of ['a', 'b']) for (const ordinal of [3, 4]) expect(() => claimRegisterRepair(`local-${label}-note-range-repair-${ordinal}`, 'arrange', claimed)).toThrow('bounded allowance');
});
it('requires a same-run reviewed phase grant for A repairs three and four without extending other cases or options', () => {
  const claimed = new Set<string>(), reviewed = new Set(['recovery-a-note-range-repair-3', 'recovery-a-note-range-repair-4']);
  for (const ordinal of [1, 2, 3, 4]) claimRegisterRepair(`recovery-a-note-range-repair-${ordinal}`, 'arrange', claimed, reviewed);
  expect(claimed.size).toBe(4);
  for (const phase of ['recovery-a-note-range-repair-3', 'recovery-a-note-range-repair-4']) expect(() => claimRegisterRepair(phase, 'arrange', claimed, reviewed)).toThrow('already attempted');
  for (const phase of ['other-a-note-range-repair-3', 'other-a-note-range-repair-4', 'recovery-b-note-range-repair-3', 'recovery-b-note-range-repair-4', 'recovery-a-note-range-repair-5']) expect(() => claimRegisterRepair(phase, 'arrange', claimed, reviewed)).toThrow('bounded allowance');
  expect(() => claimRegisterRepair('recovery-a-note-range-repair-3', 'write_theme', new Set(), reviewed)).toThrow('does not permit');
});
it('checks selected plan ownership after saving repair progress and before invoking askFix', async () => {
  const { current, io, files, requests } = await setup('new-fixed');
  const save = io.save; let changed = false;
  io.save = async (caseId, file, data) => {
    await save(caseId, file, data);
    if (!changed && file === 'progress.json' && JSON.parse(strFromU8(data)).phase === 'a-note-range-repair-1') {
      changed = true;
      await act(async () => current().setChords(0, 0, 'F'));
    }
  };
  const recipe = NIGHT_RECIPES.find(item => item.intent === 'recompose' && item.ensemble === 'Full orchestra' && item.mood === 'Neutral')!;
  const result = await runNightRecipe(recipe, current, io, 'stale-repair-owner');
  expect(changed).toBe(true); expect(result.status).toBe('failed'); expect(result.error).toBe('Range repair changed selected plan ownership');
  expect(requests.filter(call => call.input.fix)).toHaveLength(0); expect(files.has('a.zip')).toBe(false); expect(fetch).not.toHaveBeenCalled();
});

it.each(['new-repeat', 'new-fallback', 'new-drop', 'new-add', 'new-rhythm', 'new-dyn', 'new-role', 'new-art', 'new-unrelated', 'new-three-bars'] as const)('rejects %s without another repair, B theme or export', async failure => {
  const { current, io, files, requests } = await setup(failure);
  const recipe = NIGHT_RECIPES.find(item => item.intent === 'recompose' && item.ensemble === 'Full orchestra' && item.mood === 'Neutral')!;
  const result = await runNightRecipe(recipe, current, io, failure);
  expect(result.status).toBe('failed'); expect(requests.filter(call => call.input.fix)).toHaveLength(failure === 'new-three-bars' ? 0 : 1);
  expect(requests.filter(call => call.shape === 'write_theme')).toHaveLength(1);
  expect(files.has('a.zip')).toBe(false); expect(files.has('b.zip')).toBe(false); expect(files.has('failure.json')).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
});

it('captures two real-hook recompositions from their own plans at active option zero', async () => {
  const { current, io, files, requests } = await setup();
  const recipe = NIGHT_RECIPES.find(item => item.intent === 'recompose' && item.ensemble === 'String orchestra' && item.mood === 'Neutral')!;
  const result = await runNightRecipe(recipe, current, io, 'recompose-local-smoke');
  expect(result.status, result.error).toBe('complete');
  const summaries = ['a', 'b'].map(label => JSON.parse(strFromU8(files.get(`${label}-summary.json`)!)));
  expect(summaries.map(summary => [summary.chosen, summary.selected, summary.plan.name])).toEqual([[0, 0, 'Synthetic A'], [1, 0, 'Synthetic B']]);
  expect(requests.find(call => call.shape === 'plan_recompose')!.input).toMatchObject({ moreBars: 32, freedom: 2, answers: [], ask: null });
  expect(requests.filter(call => call.shape === 'write_theme').map(call => call.input.chosen.name)).toEqual(['Synthetic A', 'Synthetic B']);
  expect(requests.filter(call => call.shape === 'arrange').every(call => call.input.seed.theme.includes('tune: C5@0+3'))).toBe(true);
  expect(files.get('a-score.musicxml')).not.toEqual(files.get('b-score.musicxml'));
});

it.each(['b-empty-theme', 'b-invalid-theme'] as const)('retains verified A after an ok-but-unusable B theme without arranging or exporting B: %s', async failure => {
  const { current, io, files, requests } = await setup(failure);
  const recipe = NIGHT_RECIPES.find(item => item.intent === 'recompose' && item.ensemble === 'String orchestra' && item.mood === 'Neutral')!;
  const result = await runNightRecipe(recipe, current, io, `failed-${failure}`);
  expect(result.status).toBe('failed'); expect(result.error).toBe('Theme unavailable or still pending');
  expect(result.outcomes).toHaveLength(1);
  expect(requests.filter(call => call.shape === 'write_theme').map(call => call.input.chosen.name)).toEqual(['Synthetic A', 'Synthetic B']);
  expect(requests.filter(call => call.shape === 'arrange')).toHaveLength(4);
  expect(requests.filter(call => call.shape === 'arrange').every(call => call.input.chosen.name === 'Synthetic A')).toBe(true);
  expect(files.has('a.zip')).toBe(true); expect(files.has('a-summary.json')).toBe(true);
  expect(files.has('b.zip')).toBe(false); expect(files.has('b-summary.json')).toBe(false);
  expect(current().themeWrite).toMatchObject({ status: 'unavailable', index: 1, reason: 'malformed', plan: { name: 'Synthetic B' } });
  expect(current().recomposed?.plan.name).toBe('Synthetic A');
  const failureFile = JSON.parse(strFromU8(files.get('failure.json')!));
  expect(failureFile.diagnostic.themeWrite).toMatchObject({ status: 'unavailable', index: 1, reason: 'malformed' });
  // The user can still export every byte of the accepted A payloads.
  const retained = unzipSync(await captureHookDownload(() => current().download()));
  const accepted = unzipSync(files.get('a.zip')!);
  expect(Object.keys(retained)).toEqual(Object.keys(accepted));
  for (const name of Object.keys(accepted)) expect(retained[name]).toEqual(accepted[name]);
  expect(fetch).not.toHaveBeenCalled();
});

it('rejects a stale A snapshot as B even when its theme status is clear', async () => {
  const { current, io, files } = await setup();
  const recipe = NIGHT_RECIPES.find(item => item.intent === 'recompose' && item.ensemble === 'String orchestra' && item.mood === 'Neutral')!;
  let prior: Arranged | null = null, usePrior = false;
  const invoke = io.invoke, phase = io.phase;
  io.phase = (caseId, value) => { if (value === 'b-full') prior = current(); phase(caseId, value); };
  io.invoke = async action => { await invoke(action); if (prior) usePrior = true; };
  const result = await runNightRecipe(recipe, () => usePrior ? prior! : current(), io, 'wrong-plan-snapshot');
  expect(result.status).toBe('failed'); expect(result.error).toBe('Selected recomposition does not own this theme');
  expect(files.has('a.zip')).toBe(true); expect(files.has('b.zip')).toBe(false);
  expect(current().recomposed?.plan.name).toBe('Synthetic B');
  expect(fetch).not.toHaveBeenCalled();
});

it('fresh multiwindow recomposition keeps player-grouped reply order and supplies the theme as context rather than pre-added notes', async () => {
  const { current, io, files, requests } = await setup('grouped-theme');
  const recipe = NIGHT_RECIPES.find(item => item.intent === 'recompose' && item.ensemble === 'String orchestra' && item.mood === 'Neutral')!;
  const result = await runNightRecipe(recipe, current, io, 'grouped-theme-local-smoke');
  expect(result.status, result.error).toBe('complete');
  for (const label of ['a', 'b']) {
    const summary = JSON.parse(strFromU8(files.get(`${label}-summary.json`)!));
    const writes = requests.filter(call => call.shape === 'arrange' && call.input.chosen.name === summary.plan.name);
    expect(writes).toHaveLength(4);
    const expected = writes.flatMap(call => ['Violin I', 'Violin II'].flatMap(part => Array.from({ length: Number(call.input.window.to) - Number(call.input.window.from) + 1 }, (_, index) => [part, String(Number(call.input.window.from) + index)])));
    expect(summary.check.adds.map((add: { part: string; bar: string }) => [add.part, add.bar])).toEqual(expected);
    expect(summary.notes).toBe(64);
    expect(writes[1]!.input.earlier).toBe('Violin I: C5@0+3 / Violin II: C5@0+3');
    expect(writes[1]!.input.seed.theme).toContain('Bar 9 tune: C5@0+3');
  }
  expect(fetch).not.toHaveBeenCalled();
});

it.each(['notes', 'theme'] as const)('retains diagnostic failure and rejects a bad %s outcome without exporting it', async failure => {
  const { current, io, files } = await setup(failure);
  const recipe = NIGHT_RECIPES.find(item => item.intent === (failure === 'theme' ? 'recompose' : 'arrange') && item.ensemble === 'String orchestra')!;
  const result = await runNightRecipe(recipe, current, io, `failed-${failure}`);
  expect(result.status).toBe('failed'); expect(files.has('failure.json')).toBe(true); expect(files.has('a-summary.json')).toBe(false);
});

it('exports a valid zero-addition faithful arrangement with all114 original source events retained', async () => {
  const { current, io, files } = await setup('zero-adds');
  const recipe = NIGHT_RECIPES.find(item => item.intent === 'arrange' && item.ensemble === 'String orchestra')!;
  const result = await runNightRecipe(recipe, current, io, 'source-only-local-smoke');
  expect(result.status, result.error).toBe('complete');
  const eventKeys = (xml: string) => scoreTracks(parseScore(xml)).flatMap(track => track.notes.map(note => JSON.stringify([note.height, note.start, note.length, note.velocity])));
  const original = eventKeys(xmlText);
  expect(original).toHaveLength(114);
  for (const label of ['a', 'b']) {
    const summary = JSON.parse(strFromU8(files.get(`${label}-summary.json`)!));
    expect(summary.check.notes).toBe(0);
    const available = eventKeys(strFromU8(files.get(`${label}-score.musicxml`)!));
    for (const event of original) { const at = available.indexOf(event); expect(at, event).toBeGreaterThanOrEqual(0); available.splice(at, 1); }
    expect(summary.notes).toBeGreaterThanOrEqual(114);
  }
});

it('uses one real-hook neutral technical layout repair, retains both requests, then captures both actual exports', async () => {
  const { current, io, files, phases, requests } = await setup('range-fixed');
  const recipe = NIGHT_RECIPES.find(item => item.intent === 'arrange' && item.ensemble === 'String orchestra')!;
  const result = await runNightRecipe(recipe, current, io, 'one-register-repair');
  expect(result.status, result.error).toBe('complete');
  const layouts = requests.filter(call => call.shape === 'distribute');
  expect(layouts).toHaveLength(2);
  expect(layouts[0]!.input.ask).toBeNull();
  expect(layouts[1]!.input.ask).toContain('Register repair only');
  expect(layouts[1]!.input.ask).toContain('Double Bass E1..G4');
  expect(layouts[1]!.input.ask).toMatch(/Double Bass bar\d+:[A-G]/);
  expect(layouts[1]!.input.ask.length).toBeLessThanOrEqual(400);
  expect(layouts[1]!.input.written).toEqual(layouts[0]!.input.written);
  expect(distribute.parse(layouts[1]!.input)).not.toBeNull();
  expect(requests.find(call => call.shape === 'plan_options')!.input).toMatchObject({ ask: null, intent: 'arrange', moreBars: 0 });
  expect(phases.filter(phase => phase === 'layout-range-repair')).toHaveLength(1);
  const repair = JSON.parse(strFromU8(files.get('range-repair.json')!));
  expect(repair.before).toMatchObject({ notes: 114, placed: 114, notPlaced: [], together: [], ignored: 0 });
  expect(repair.before.outOfRange.length).toBeGreaterThan(0);
  expect(repair.after.check).toMatchObject({ notes: 114, placed: 114, outOfRange: [], notPlaced: [], together: [], ignored: 0 });
  const original = scoreTracks(score).flatMap(track => track.notes).map(note => JSON.stringify([note.height % 12, note.start, note.length, note.velocity]));
  expect(original).toHaveLength(114);
  for (const label of ['a', 'b']) {
    const summary = JSON.parse(strFromU8(files.get(`${label}-summary.json`)!));
    expect(summary.sourceLayout.check.moved).toBeGreaterThan(0);
    const exported = parseScore(strFromU8(unzipSync(files.get(`${label}.zip`)!)['score.musicxml']!));
    expect(exported.parts.every(part => part.measures.length === 24)).toBe(true);
    const available = scoreTracks(exported).flatMap(track => track.notes).map(note => JSON.stringify([note.height % 12, note.start, note.length, note.velocity]));
    for (const note of original) { const index = available.indexOf(note); expect(index, note).toBeGreaterThanOrEqual(0); available.splice(index, 1); }
  }
  expect(fetch).not.toHaveBeenCalled();
});

it.each(['range-repeat', 'range-fallback', 'range-other-flags', 'layout-fallback'] as const)('stops %s without a third layout call or any writing/export', async failure => {
  const { current, io, files, phases, requests } = await setup(failure);
  const recipe = NIGHT_RECIPES.find(item => item.intent === 'arrange' && item.ensemble === 'String orchestra')!;
  const result = await runNightRecipe(recipe, current, io, `stopped-${failure}`);
  expect(result.status).toBe('failed');
  expect(requests.filter(call => call.shape === 'distribute')).toHaveLength(failure === 'range-repeat' || failure === 'range-fallback' ? 2 : 1);
  expect(phases.filter(phase => phase === 'layout-range-repair')).toHaveLength(failure === 'range-repeat' || failure === 'range-fallback' ? 1 : 0);
  expect(requests.some(call => call.shape === 'plan_options' || call.shape === 'arrange')).toBe(false);
  expect(files.has('failure.json')).toBe(true); expect(files.has('a.zip')).toBe(false); expect(files.has('b.zip')).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});

it('still rejects a genuinely all-rest full exported score', async () => {
  const { current, io, files } = await setup('zero-adds');
  const recipe = NIGHT_RECIPES.find(item => item.intent === 'arrange' && item.ensemble === 'String orchestra')!;
  const empty = emptyScore('Empty export', recipe.instruments, { fifths: 0, time: '3/4', qpm: 80, bars: 24 });
  io.capture = async () => packageFiles(empty, null, 'An empty full-score export must not pass.');
  const result = await runNightRecipe(recipe, current, io, 'empty-full-score');
  expect(result.status).toBe('failed'); expect(result.error).toBe('All-rest exported score');
  expect(files.has('a-summary.json')).toBe(false); expect(files.has('failure.json')).toBe(true);
});
