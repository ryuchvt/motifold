import { parseScore, parseScoreFile, ScoreFileError, type Score } from "../score";
import { isMidi, midiScoreXml } from "./midi";

/** What can't be read yet, and what to do about it. */
const NOT_YET: [RegExp, string][] = [
  [/\.sib$/i, "Sibelius files are in a closed format, so Motifold can't read them. Export MusicXML from Sibelius and open that."],
  [/\.(mscz|mscx)$/i, "Motifold can't read MuseScore files yet. Export MusicXML from MuseScore and open that."],
  [/\.(wav|aif|aiff|mp3|m4a|flac|ogg)$/i, "Motifold works from notes, and can't read audio yet. Open MusicXML or a MIDI file."],
];

/** A score from whatever was opened: MusicXML, or a DAW's MIDI file turned into one. */
export function openedScore(bytes: Uint8Array, fileName: string): { xmlText: string; score: Score } {
  const refused = NOT_YET.find(([ending]) => ending.test(fileName));
  if (refused) throw new ScoreFileError(refused[1]);
  if (!isMidi(bytes)) return parseScoreFile(bytes);
  const xmlText = midiScoreXml(bytes, fileName.replace(/\.[^.]+$/, ""));
  return { xmlText, score: parseScore(xmlText) };
}
