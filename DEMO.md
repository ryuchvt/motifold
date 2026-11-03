# The recorded walkthrough

I compare two ways to arrange my piano theme for strings, then finish A. The saved path includes the source reading, harmony analysis, layout, both first-section previews, all of A and its direct export. B has only a preview. The public replay opens when its complete index is present in `public/demo/`.

I use my own `Sample_sketch.mid`. Its SHA-256 is `782c244e9d31572a3c3225c6af170a75ea94224b7e92ea1e1a6d6183ddb70d54`. The accepted reading has 24 bars of 3/4 and two piano parts. It contains 114 notes. Three very soft notes remain in the original 117-note MIDI but are excluded from that notation reading.

## Follow the recording

1. Choose Watch it work, then Start recorded walkthrough. It opens the exact accepted MusicXML. The original MIDI is a separate download.
2. In Study, confirm both `Piano upper` and `Piano lower` as Piano.
3. Skip all three questions. I leave “Is the held middle note a second tune?”, “Are the added thirds part of the tune?” and “Does the piece end on bar 24?” unanswered.
4. In Setup, use Arrange and String orchestra. Keep all source notes and harmony. Leave the optional direction empty. Stay neutral and add no bars.
5. Choose Create. Compare A, `Held middle voices with repeat contrast`, and B, `Pulsed support with brief answers`. Their previews cover bars 1 to 8.
6. Choose A and write the rest. Its remaining recorded sections are bars 9 to 13, 14 to 21 and 22 to 24. B has no recorded continuation.
7. Export A directly while it is selected. Download MIDI includes the MusicXML, separate part files and a separate MIDI of the new notes.

The finished A has five string parts over 24 bars and 211 played notes. The layout contains 169 notes, including source doublings. A adds 42 checked notes. All source-layout note pitches, starts, lengths and velocities remain unchanged. The replay export matches every file payload in the actual live export. ZIP container timestamps can differ.

The actual A export is `public/demo/sample-sketch/neutral-strings-a.zip`, SHA-256 `452c77e4c1c5c9a45d1e4c9f58fe7be9ded8aa5b3a9cf958408ca752eeaecc78`. It has nine files. Its MusicXML and MIDI agree on all 211 notes. This verifies the recorded data and export, not the quality of the music.

## How I captured it

These are successful real calls to Muse Spark 1.3. I retained their exact requests, replies, thinking summaries, model, prompt version, elapsed time and available usage. Capturing the run required local retries and fresh Worker isolation between some stages. I assembled the successful stages into this recorded walkthrough. I do not claim an uninterrupted live session or a production network fix. Failed and uncertain attempts remain in the private spending audit.

| Recorded call | Prompt version | Recorded elapsed time |
| --- | --- | --- |
| Reading | `read-piece-5` | 101.600 s |
| Harmony analysis | `study-score-m1` | 134.219 s |
| String layout | `distribute-5` | 75.548 s |
| A and B plans | `plan-options-9` | 133.007 s |
| A preview, 1 to 8 | `arrange-14` | 17.824 s |
| B preview, 1 to 8 | `arrange-14` | 54.946 s |
| A continuation, 9 to 13 | `arrange-14` | 88.122 s |
| A continuation, 14 to 21 | `arrange-14` | 73.644 s |
| A ending, 22 to 24 | `arrange-14` | 38.314 s |

The fresh reading and successful harmony analysis are in `shared.json`. The remaining successful calls are in `arrange-neutral.json`. Redundant cached copies are omitted so each request has one canonical take. Playback can shorten the wait while displaying its actual recorded duration. The opening uses the accepted XML directly and makes no new bar-reading call.

The replay uses no credit. Other ensembles, answers, moods, chord edits or rewrites have no prepared reply unless I recorded that exact request. It stops on an unprepared request rather than sending it to Meta. Ordinary local score edits and exports still work. The local Hopeful and Dark UI examples are separate saved runs.
