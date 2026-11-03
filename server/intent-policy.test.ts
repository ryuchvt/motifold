import { describe, expect, it } from 'vitest';
import { CHORDS_ON_A_TUNE, EXPANDING, FAITHFUL_ARRANGEMENT, FAITHFUL_HARMONY, FAITHFUL_LAYOUT, FAITHFUL_TEXTURE, FAITHFUL_WRITING, FREE_HARMONY, FREEDOM, MATERIAL_IDENTITY, MOODS, ORNAMENT, PIANO_TO_ORCHESTRA, RECOMPOSING, TEXTURE } from './brain';
import { arrange, arrangementIntent, distribute, planOptions, planRecompose, writeTheme, type ArrangeInput, type DistributeInput, type RecomposePlan, type WriteInput } from './shapes';

const source: ArrangeInput = {
  piece: { title: 'Original sketch', composer: null, instrument: 'Piano' }, fifths: -1, time: '3/4',
  written: [{ bar: '1', notes: 'F4 A4 C5', rhythm: '3x3', at: '0 0 0', staves: '1 1 1' }, { bar: '2', notes: 'Bb3 F4 D5', rhythm: '3x3', at: '0 0 0', staves: '1 1 1' }],
  returns: [], lines: ['Piano'], tracks: [], answers: [], ask: null, moreBars: 0, where: 'inside', reading: null, instruments: ['Violin I', 'Cello'], cues: [],
};
const chosen = { name: 'Two lines', idea: 'Balance the sketch', why: [{ from: '1', to: '2', what: 'The tune leads', principle: 'Keep the source', chords: 'F | Bb' }] };
const write = (change: Partial<WriteInput> = {}): WriteInput => ({ ...source, chosen, ...change });
const layout = (change: Partial<DistributeInput> = {}): DistributeInput => ({ ...source, instruments: ['Violin I', 'Cello'], roles: [], ...change });
const recomposed: RecomposePlan = { ...chosen, motif: { from: '1', to: '1', what: 'The rising third' }, fifths: -1, time: '3/4', qpm: 80, why: [] };

describe('intent is a bounded input contract', () => {
  it.each([null, false, 3, 'recompose', 'ARRANGE', {}, []])('rejects an unknown intent %j on all relevant shapes', intent => {
    expect(planOptions.parse({ ...source, intent })).toBeNull();
    expect(arrange.parse({ ...write(), intent })).toBeNull();
    expect(distribute.parse({ ...layout(), intent })).toBeNull();
  });
  it.each([{ where: 'both', moreBars: 0 }, { where: 'after', moreBars: 0 }, { where: 'both', moreBars: 8 }, { where: 'inside', moreBars: 8 }])('rejects a contradictory explicit faithful request %j', controls => {
    expect(planOptions.parse({ ...source, ...controls, intent: 'arrange' })).toBeNull();
    expect(arrange.parse({ ...write(), ...controls, intent: 'arrange' })).toBeNull();
  });
  it('keeps explicit faithful and expansion requests separate through parsing', () => {
    expect(planOptions.parse({ ...source, intent: 'arrange' })).toMatchObject({ intent: 'arrange', where: 'inside', moreBars: 0 });
    expect(arrange.parse(write({ intent: 'expand', where: 'both', moreBars: 8 }))).toMatchObject({ intent: 'expand', where: 'both', moreBars: 8 });
    expect(distribute.parse(layout({ intent: 'arrange' }))).toMatchObject({ intent: 'arrange' });
  });
  it('does not silently drop the source harmony through a faithful tune-only layout', () => {
    expect(distribute.parse(layout({ intent: 'arrange', tuneOnly: true }))).toBeNull();
    expect(distribute.parse(layout({ intent: 'expand', tuneOnly: true }))).toMatchObject({ intent: 'expand', tuneOnly: true });
    expect(distribute.parse(layout({ tuneOnly: true }))).not.toBeNull();
  });
  it('preserves old extension and recomposition requests without injecting a new field', () => {
    const legacy = planOptions.parse({ ...source, where: 'both', moreBars: 8 })!;
    expect(legacy).not.toHaveProperty('intent');
    expect(arrangementIntent(legacy)).toBe('expand');
    expect(arrangementIntent(source)).toBe('arrange');
    expect(planRecompose.parse({ ...source, where: 'after', moreBars: 32 })).not.toBeNull();
    expect(writeTheme.parse({ ...source, where: 'after', moreBars: 32, chosen: recomposed })).not.toBeNull();
  });
});

describe('the selected musical job controls the prompt', () => {
  it('keeps faithful layout conservative even when old mood words remain in the data', () => {
    const built = distribute.build(layout({ intent: 'arrange', ask: 'The mood I want: epic.' }));
    expect(built.instructions).toContain(FAITHFUL_LAYOUT);
    expect(built.instructions).toContain(FAITHFUL_TEXTURE);
    expect(built.instructions).not.toContain(PIANO_TO_ORCHESTRA);
    expect(built.instructions).not.toContain('Hold instruments back early');
    expect(built.instructions).not.toContain('Place only the composer');
  });
  it('preserves source harmony and character without forcing an emotional palette or extra layers', () => {
    for (const built of [planOptions.build({ ...source, intent: 'arrange', ask: 'Make it dark', source: 'The original bass and chords' }), arrange.build(write({ intent: 'arrange', ask: 'Make it dark' }))]) {
      expect(built.instructions).toContain(FAITHFUL_ARRANGEMENT);
      expect(built.instructions).toContain(FAITHFUL_HARMONY);
      expect(built.instructions).toContain(FAITHFUL_TEXTURE);
      for (const changing of [MOODS, FREE_HARMONY, CHORDS_ON_A_TUNE, ORNAMENT, TEXTURE]) expect(built.instructions).not.toContain(changing);
      expect(built.instructions).not.toContain('It outranks everything above');
    }
    expect(arrange.build(write({ intent: 'arrange' })).instructions).toContain(FAITHFUL_WRITING);
  });
  it('allows a mood and theme-derived new sections only in expansion planning', () => {
    const expanded = { ...source, intent: 'expand' as const, where: 'both' as const, moreBars: 8, ask: 'The mood I want: hopeful.' };
    const built = planOptions.build(expanded);
    expect(built.instructions).toContain(EXPANDING);
    expect(built.instructions).toContain(MOODS);
    expect(built.instructions).toContain('Without a requested mood, continue the source character');
    expect(built.instructions).not.toContain(FAITHFUL_ARRANGEMENT);
    expect(built.input).toContain('Write 8 new bars');
    const schema = built.schema as any;
    expect(schema.properties.options.items.properties.why.items.properties.from.enum).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
  });
  it('keeps the material distinction and selected freedom through planning, tune writing and orchestration', () => {
    const seed = { tune: 'The source', motif: 'The rising third', theme: 'The composed tune' };
    const jobs = [planRecompose.build({ ...source, moreBars: 32, freedom: 1 }), writeTheme.build({ ...source, moreBars: 32, freedom: 1, chosen: recomposed }), arrange.build(write({ freedom: 1, seed }))];
    for (const built of jobs) {
      expect(built.instructions).toContain(MATERIAL_IDENTITY);
      expect(built.instructions).toContain(RECOMPOSING);
      expect(built.instructions).toContain(FREEDOM[1]);
      expect(built.instructions).not.toContain(FAITHFUL_ARRANGEMENT);
      expect(built.instructions).not.toContain('Nothing of theirs is fixed');
    }
    expect(FREEDOM[3]).toContain('no mandatory bar count');
    expect(FREEDOM[4]).toContain('rather than assuming the opening');
    expect(FREEDOM[5]).toContain('not a promise that the original theme will be recognisable');
  });
  it('changes cache versions for every affected musical request', () => {
    expect([distribute.version, planOptions.version, arrange.version, planRecompose.version, writeTheme.version]).toEqual(['distribute-5', 'plan-options-9', 'arrange-14', 'plan-recompose-4', 'write-theme-3']);
  });
});
