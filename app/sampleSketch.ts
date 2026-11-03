import sampleUrl from '../test-fixtures/Sample_sketch.mid?url';
// The selected piano performance and its already saved bar reading. No model is contacted here.
import { parseScore } from '../score';
import savedBars from '../test-fixtures/sample-sketch-bars.json';
import { attacksOf, playedFromMidi, readWithinBars } from './timing';
import { scoreOfReading } from './timingScore';

export const SAMPLE_FILE = 'Sample_sketch.mid';
export const SAMPLE_SHA256 = '782c244e9d31572a3c3225c6af170a75ea94224b7e92ea1e1a6d6183ddb70d54';

export async function sketchPreview(bytes: Uint8Array) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer));
  const hash = [...digest].map((n) => n.toString(16).padStart(2, '0')).join('');
  if (hash !== SAMPLE_SHA256) throw new Error('The local sample MIDI does not match its saved answers.');
  const played = playedFromMidi(bytes);
  const attacks = attacksOf(played);
  const reading = readWithinBars(attacks, savedBars.answer.meter, savedBars.answer.starts);
  if (!reading.place.every(Number.isFinite)) throw new Error('The saved sample bars could not be read.');
  const xmlText = scoreOfReading(played, attacks, reading, 'Sample sketch');
  return { fileName: SAMPLE_FILE, xmlText, score: parseScore(xmlText) };
}

export async function openSampleSketch() {
  const response = await fetch(sampleUrl);
  if (!response.ok) throw new Error('The piano sketch could not be opened.');
  return sketchPreview(new Uint8Array(await response.arrayBuffer()));
}
