// Builds three distinct source downloads from the selected, owned fixture. No model or network is involved.
import { createHash } from 'node:crypto';
import { unzipSync, strToU8 } from 'fflate';

const demand = (condition, message) => { if (!condition) throw Error(message); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => strToU8(JSON.stringify(value, null, 2) + '\n');

/** Wall-clock seconds from the MIDI's own tempo map, including its original DAW lead-in. */
export function midiSecondsAt(midi, tick) {
  let previous = 0, seconds = 0, qpm = 120;
  for (const mark of [...midi.tempos].sort((a, b) => a.tick - b.tick)) {
    if (mark.tick > tick) break;
    seconds += (mark.tick - previous) / midi.ppq * 60 / qpm;
    previous = mark.tick; qpm = mark.qpm;
  }
  return seconds + (tick - previous) / midi.ppq * 60 / qpm;
}

/** Match each pitch's chronological occurrences, rather than assuming array order across tracks. */
export function performanceTiming(original, mapped) {
  const source = original.tracks.flatMap(track => track.notes).sort((a, b) => a.tick - b.tick || a.height - b.height);
  const target = mapped.tracks.flatMap(track => track.notes).sort((a, b) => a.tick - b.tick || a.height - b.height);
  demand(source.length === target.length && source.length > 0, 'Performance MIDI note count changed');
  const firstSource = midiSecondsAt(original, source[0].tick), firstMapped = midiSecondsAt(mapped, target[0].tick);
  const onset = [], duration = [];
  for (const height of new Set(source.map(note => note.height))) {
    const a = source.filter(note => note.height === height), b = target.filter(note => note.height === height);
    demand(a.length === b.length, 'Performance MIDI pitch count changed');
    for (let k = 0; k < a.length; k++) {
      demand(a[k].velocity === b[k].velocity, 'Performance MIDI velocity changed');
      const sourceAt = midiSecondsAt(original, a[k].tick), mappedAt = midiSecondsAt(mapped, b[k].tick);
      onset.push(Math.abs((mappedAt - firstMapped) - (sourceAt - firstSource)) * 1000);
      const sourceDuration = midiSecondsAt(original, a[k].tick + a[k].length) - sourceAt;
      const mappedDuration = midiSecondsAt(mapped, b[k].tick + b[k].length) - mappedAt;
      duration.push(Math.abs(mappedDuration - sourceDuration) * 1000);
    }
  }
  const median = values => { const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; };
  return {
    notes: source.length,
    normalizedTo: 'First musical note at time zero',
    originalDawLeadSeconds: midiSecondsAt(original, original.firstTick),
    originalInitialNoteLeadSeconds: firstSource - midiSecondsAt(original, original.firstTick),
    removedBeforeFirstNoteSeconds: firstSource - firstMapped,
    onsetMedianAbsoluteMs: median(onset), onsetMaxAbsoluteMs: Math.max(...onset),
    durationMedianAbsoluteMs: median(duration), durationMaxAbsoluteMs: Math.max(...duration),
  };
}

export function buildPerformanceSources({ original, sourceXml, savedBars, readers }) {
  const played = readers.playedFromMidi(original), attacks = readers.attacksOf(played);
  const reading = readers.readWithinBars(attacks, savedBars.answer.meter, savedBars.answer.starts);
  const mappedBytes = readers.mappedMidi(played, attacks, reading);
  const raw = readers.readMidi(original), mapped = readers.readMidi(mappedBytes);
  const acceptedFiles = unzipSync(readers.packageFiles(sourceXml, null, 'Interpreted notation. Nearby attacks are grouped and note durations are interpreted.'));
  const acceptedBytes = acceptedFiles['all-parts.mid'], accepted = readers.readMidi(acceptedBytes);
  demand(raw.tracks.flatMap(track => track.notes).length === 117 && mapped.tracks.flatMap(track => track.notes).length === 117 && accepted.tracks.flatMap(track => track.notes).length === 114, 'The selected source counts changed');
  demand(mapped.tempos.length === 50 && accepted.tempos.length === 50 && mapped.tempos.every((mark, i) => mark.tick === accepted.tempos[i].tick && Math.abs(Math.round(60_000_000 / mark.qpm) - Math.round(60_000_000 / accepted.tempos[i].qpm)) <= 1), 'The performance map does not match the accepted 50 tempo anchors');
  demand(JSON.stringify(mapped.times) === JSON.stringify(accepted.times), 'The performance map metre changed');
  const timing = performanceTiming(raw, mapped);
  demand(timing.onsetMaxAbsoluteMs < 2 && timing.durationMaxAbsoluteMs < 2, 'The selected performance changed beyond MIDI tick rounding');
  const manifest = {
    originalMidiNotes: 117, acceptedScoreNotes: 114, originalMidiSha256: sha(original), acceptedXmlSha256: sha(strToU8(sourceXml)),
    performanceTempoMapNotes: 117, performanceTempoMapSha256: sha(mappedBytes), acceptedMidiSha256: sha(acceptedBytes), tempoMarks: 50,
    normalization: timing,
    files: [
      { file: 'original-performance-117.mid', notes: 117, sha256: sha(original), label: 'Original performance MIDI. The exact original 117 notes and file bytes, including its DAW lead-in.' },
      { file: 'performance-tempo-map-117.mid', notes: 117, sha256: sha(mappedBytes), label: 'Performance with tempo map. Preserves rubato, velocities and note-offs within MIDI tick rounding. The DAW lead-in is removed and the first musical note starts at time zero.' },
      { file: 'accepted-score-114.mid', notation: 'accepted-score.musicxml', notes: 114, sha256: sha(acceptedBytes), label: 'Interpreted notation MIDI. Nearby attacks are grouped and note durations are interpreted for readable lines. Three very soft notes are omitted. This is the source used by the recorded arrangements.' },
    ],
  };
  const checklist = 'THREE DIFFERENT SOURCES\n\n1. original-performance-117.mid is the byte-exact original. It includes the original DAW lead-in. Keep it as the untouched performance archive.\n\n2. performance-tempo-map-117.mid has all 117 notes on the accepted 24 bars of 3/4, with 50 tempo anchors. Its first musical note starts at time zero. It preserves the rubato, velocities and individual note-offs within MIDI tick rounding. Import its tempo map when comparing the performed timing.\n\n3. accepted-score-114.mid and accepted-score.musicxml are interpreted notation. Nearby attacks are grouped and note durations are interpreted for readable piano lines. They omit three very soft notes. They are not a timing-identical copy of the performance. The recorded arrangements preserve this accepted notation source.\n\nNo source download contains a DAW audio render.\n';
  return { manifest, files: {
    'original-performance-117.mid': original,
    'performance-tempo-map-117.mid': mappedBytes,
    'accepted-score-114.mid': acceptedBytes,
    'accepted-score.musicxml': strToU8(sourceXml),
    'manifest.json': json(manifest),
    'render-checklist.txt': strToU8(checklist),
  } };
}
