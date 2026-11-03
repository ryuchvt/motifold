// Only loaded in Vite's ui mode. These fixed answers are for interface exploration, not a live demonstration.
import midiUrl from '../test-fixtures/Sample_sketch.mid?url';
import saved from '../test-fixtures/sample-sketch-preview.json';
import savedBars from '../test-fixtures/sample-sketch-bars.json';
import study from '../test-fixtures/sample-sketch-study.json';
import { sketchPreview } from './sampleSketch';
import { newBarNumbers, type ArrangeInput, type WriteInput } from '../server/shapes';
import { setTransport, type SparkReply, type Transport } from './spark';

export const initialSetup = { ensemble: 'Full orchestra', mood: 'Hopeful', moreBars: 16, intent: 'expand' as const, useMelodyOnly: true };
export const previewMessage = 'Saved Hopeful and Dark arrangements for Sample_sketch.mid. No model calls.';

export async function loadUiPreview() {
  const response = await fetch(midiUrl);
  if (!response.ok) throw new Error('The local sample MIDI could not be opened.');
  return sketchPreview(new Uint8Array(await response.arrayBuffer()));
}
const ok = (answer: unknown): SparkReply => ({ status: 'ok', answer, cached: true });
export const previewTransport: Transport = async (shape, unknownInput, think) => {
  const input = unknownInput as ArrangeInput & Partial<WriteInput>;
  think('Using a fixed local sample answer. No request is sent to a model.');
  await new Promise<void>((resolve) => setTimeout(resolve, 300));
  if (shape === 'read_bars') return ok(savedBars.answer);
  if (shape === 'read_piece') return ok(saved.read.answer);
  if (shape === 'distribute') return ok(saved.distribute.answer);
  if (shape === 'plan_options') return ok(saved.plan.answer);
  if (shape === 'study_score') {
    return JSON.stringify(input.written) === JSON.stringify(study.input.written)
      ? ok(study.reply.answer)
      : { status: 'fallback', reason: 'not-prepared' };
  }
  if (shape === 'plan_recompose' || shape === 'write_theme') return { status: 'fallback', reason: 'not-prepared' };
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
