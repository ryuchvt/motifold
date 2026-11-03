// Only loaded in Vite's ui mode. These fixed answers are for interface exploration, not a live demonstration.
import xmlText from '../test-fixtures/arioso.musicxml?raw';
import saved from '../test-fixtures/arioso-arrangement.json';
import { parseScore } from '../score';
import { newBarNumbers, type ArrangeInput, type RecomposePlan, type StudyScoreAnswer, type WriteInput } from '../server/shapes';
import { setTransport, type SparkReply, type Transport } from './spark';

export const previewScore = { fileName: 'Arioso.musicxml', xmlText, score: parseScore(xmlText) };
const ok = (answer: unknown): SparkReply => ({ status: 'ok', answer, cached: true });
export const previewTransport: Transport = async (shape, unknownInput, think) => {
  const input = unknownInput as ArrangeInput & Partial<WriteInput>;
  think('Using a fixed local sample answer. No request is sent to a model.');
  await new Promise<void>((resolve) => setTimeout(resolve, 300));
  if (shape === 'read_piece') return ok(saved.read.answer);
  if (shape === 'distribute') return ok(saved.distribute.answer);
  if (shape === 'plan_options') return ok(saved.plan.answer);
  if (shape === 'study_score') {
    const answer: StudyScoreAnswer = {
      overview: 'A local sample for exploring the score workspace. The answers here are fixed.',
      sections: saved.read.answer.sections.map((s, index) => ({ ...s, form: String.fromCharCode(65 + index), mood: '', what: 'A section of the supplied sketch.' })),
      harmony: [], moments: [],
    };
    return ok(answer);
  }
  if (shape === 'plan_recompose') {
    const options: RecomposePlan[] = saved.plan.answer.options.map((plan, index) => ({ ...plan,
      name: `Sample recomposition ${index + 1}`, motif: { from: input.written[0]!.bar, to: input.written[1]?.bar ?? input.written[0]!.bar, what: 'The opening of the sample sketch' },
      fifths: input.fifths ?? 0, time: input.time ?? '4/4', qpm: 90,
      why: [{ from: '1', to: String(input.moreBars), what: 'A fixed sample plan', principle: 'UI sample', variation: 'Explore the controls' }],
    }));
    return ok({ options });
  }
  if (shape === 'write_theme') return ok({ lines: [] });
  if (shape === 'arrange') {
    const name = input.chosen?.name;
    const index = name === saved.plan.answer.options[1]!.name || name?.endsWith('2') ? 1 : 0;
    const bars = [...input.written.map((w) => w.bar), ...newBarNumbers(input)];
    const from = input.window ? bars.indexOf(input.window.from) : 0;
    const to = input.window ? bars.indexOf(input.window.to) : bars.length - 1;
    return ok({ adds: saved.notes[index]!.adds.filter((a) => bars.indexOf(a.bar) >= from && bars.indexOf(a.bar) <= to), doubles: [] });
  }
  return { status: 'fallback', reason: 'not-prepared' };
};
export const installUiPreview = () => setTransport(previewTransport);
