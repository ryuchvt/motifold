# The recorded tutorial and outcomes

This package uses my own piano composition and performance. The hands-on tutorial and outcome explorer use genuine recorded Muse Spark replies and make no new model calls. The index and catalog describe the available recordings.

## The guided A/B walkthrough

`index.json` selects `sample-sketch/guided-neutral-strings.json` as the self-contained tutorial run. It contains the reading, Study, placement, planning, both opening previews and both complete continuations. Either A or B can finish and export across all 24 bars.

The recorded recipe is Arrange, String orchestra, Neutral, no added bars and all source notes. Confirm both piano tracks, skip the questions and leave the optional direction blank. Choose Create, compare and audition A and B, choose one, write the rest and export it directly. The guide follows those actual controls. Back revisits a step, Skip removes the guide and Exit returns to the start.

The accepted bar analysis is saved. Opening the tutorial does not silently request a new bar reading. Replay matches the complete recorded request, including the source, selected plan, instruments, answers, windows, earlier notes and rewrite instructions. An unmatched choice returns `not-prepared` and never falls through to a provider. Exiting discards pending replay work.

## The source variants

- `sample-sketch/Sample_sketch.mid` is the untouched original with 117 attacks and its original DAW offset. Its SHA-256 is `782c244e9d31572a3c3225c6af170a75ea94224b7e92ea1e1a6d6183ddb70d54`. Browser playback starts at the first musical event while the download retains the offset.
- `sample-sketch/source/performance-tempo-map-117.mid` uses the saved tempo map with all 117 attacks. It preserves the played timing and key releases within MIDI tick rounding, with the first musical event at zero.
- `sample-sketch/source/accepted-score-114.mid` is the notation interpretation used for arranging. It has 114 accepted attacks in 24 bars of 3/4. Nearby attacks are grouped and note releases are interpreted. Three very soft attacks remain in the original performance files.

`sample-sketch/sample-sketch.musicxml` is the accepted score opened by the tutorial. The source manifest records the distinctions and fingerprints. These input files are separate from the generated outcome exports.

## The outcome catalog

`sample-sketch/catalog.json` lists the recorded directions, ensembles, moods where applicable, and A/B choices. Recording continues, so read the catalog for the current prepared status. A complete entry points to its actual score, MIDI and ZIP. Unavailable choices have no fabricated score or download and cannot become paid calls.

Each complete `sample-sketch/outcomes/<id>/` folder contains the matching MusicXML, combined and individual MIDI files, export ZIP, recorded calls, validation manifest and render instructions. Planned harmony comes from that option's recorded plan and can be compared with the written notes. Its free-text spans do not assign individual chord symbols to notes or beats.

## Playback and rendering

Muse Spark writes notes rather than audio. I rendered three saved results in my DAW using sample instruments. These are the piano sketch's Arrange A and Expand A for string orchestra, and Cute's Sad Full orchestra A. The original piano and Cute recordings are also included for comparison. No audio model was used.

The three result mixes and their 23 stems are bound to the exact exported score hashes. A full mix loads only on Play. Soloing loads only the selected instrument stems and leaves the complete downloads intact. The tutorial uses the Arrange A mix only after its complete score matches that export. Opening previews, option B, edits and unmatched scores use browser instruments with a visible label.

`audio-provenance.json` records the supplied WAV and web MP3 fingerprints. WAV masters remain outside the repository. Mixes use 256 kbps MP3 and stems use 128 kbps MP3, without normalisation or timing edits. Other saved results continue to use browser instruments.

Sound and library credits are in the [project README](../../README.md#sounds-and-data). Keep the bundled font and icon licence notices with their assets.

## Recording provenance and retained evidence

Each recorded call keeps its actual request, reply, elapsed time, thinking summaries, model and prompt version, with usage where available. Successful stages may be assembled after local cold Worker restarts. This does not establish an uninterrupted live session or a production transport fix. Replay may shorten the wait while showing the original recorded duration. Failed and uncertain attempts stay in the private spending audit.

`sample-sketch/shared.json`, `sample-sketch/arrange-neutral.json` and `sample-sketch/neutral-strings-a.zip` retain an earlier recording of this same sketch for regression and historical export checks. The index records that older export separately as `legacyVerifiedExport`. The current guided A/B run is self-contained.

Before publication, completed outcomes are reconstructed from authenticated selected-plan replies. Their bar coverage, source placement, tempo, metre, MusicXML, combined MIDI and part files are checked. Walkthrough tests block provider requests and compare downloaded ZIP payloads with the recorded export. This verifies the data and files. My ear still decides the musical result.
