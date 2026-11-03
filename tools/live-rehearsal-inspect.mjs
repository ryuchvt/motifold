// Read-only verification of the ZIP actually downloaded by the local browser.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';

export function inspectArchive(bytes, { parseScore, scoreTracks, readMidi }, expectedBars = null) {
  const files = unzipSync(bytes);
  if (!files['score.musicxml'] || !files['all-parts.mid']) throw Error('The ZIP is missing its score or complete MIDI');
  const score = parseScore(strFromU8(files['score.musicxml']));
  const midi = readMidi(files['all-parts.mid']);
  if (expectedBars !== null && score.parts.some((part) => part.measures.length !== expectedBars)) throw Error('The ZIP does not contain the expected full score');
  const sort = (notes) => notes.sort((a, b) => a[0] - b[0] || a[2] - b[2] || a[1] - b[1]);
  const written = sort(scoreTracks(score).flatMap((track) => track.notes.map((note) => [Math.round(note.start * midi.ppq), Math.round(note.length * midi.ppq), note.height])));
  const exported = sort(midi.tracks.flatMap((track) => track.notes.map((note) => [note.tick, note.length, note.height])));
  if (JSON.stringify(written) !== JSON.stringify(exported)) throw Error('The exported MIDI note pitches or timing disagree with its MusicXML score');
  return { sha256: createHash('sha256').update(bytes).digest('hex'), files: Object.keys(files).length, parts: score.parts.map((part) => ({ name: part.name, bars: part.measures.length })), tracks: midi.tracks.length, notes: exported.length, ppq: midi.ppq, scoreAndMidiAgree: true };
}

async function main() {
  const args = process.argv.slice(2);
  const value = (name, fallback) => { const at = args.indexOf(name); return at < 0 ? fallback : args[at + 1]; };
  const file = value('--zip');
  if (!file) throw Error('Use --zip <actual downloaded ZIP> [--repo <repo>] [--expected-bars 24]');
  const repo = resolve(value('--repo', process.cwd()));
  const expected = value('--expected-bars', null);
  const expectedBars = expected === null ? null : Number(expected);
  if (expectedBars !== null && (!Number.isInteger(expectedBars) || expectedBars < 1)) throw Error('Invalid expected bar count');
  const { createServer } = await import('vite');
  const modules = await createServer({ root: repo, configFile: false, server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { parseScore } = await modules.ssrLoadModule('/score/index.ts');
    const { scoreTracks } = await modules.ssrLoadModule('/app/arrange.ts');
    const { readMidi } = await modules.ssrLoadModule('/app/midi.ts');
    console.log(JSON.stringify(inspectArchive(new Uint8Array(readFileSync(resolve(file))), { parseScore, scoreTracks, readMidi }, expectedBars), null, 2));
  } finally { await modules.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
