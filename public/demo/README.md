# The recorded neutral arrangement

There is no public replay index until the actual successful calls are complete. The local UI examples are separate saved runs and are not a recording of this neutral tutorial.

The first package covers one source and one exact direction. Use `Sample_sketch.mid`, verified against SHA-256 `782c244e9d31572a3c3225c6af170a75ea94224b7e92ea1e1a6d6183ddb70d54`, and its exact 24-bar, 3/4 MusicXML reading. The direction is Arrange, String orchestra, neutral, zero added bars, inside the existing piece, keeping all notes and harmony. No mood, melody-only replacement or recomposition is prepared.

The original MIDI has 117 notes. The accepted notation reading has 114 notes. The existing import threshold leaves three very soft notes out of that notation, at velocities 1, 5 and 4. They remain in the original MIDI. The source notation and its MIDI export agree on all 114 accepted notes. This is a distinction between the original performance and its accepted score reading, not a loss introduced by arranging it.

After the real run completes, place its files in one `sample-sketch` directory here.

- `Sample_sketch.mid` is the exact input.
- `sample-sketch.musicxml` is the exact score sent to the reading. Open this XML directly for the prepared path. Do not silently run a new bar-reading request when opening it.
- `shared.json` holds the successful recorded reading and Study calls.
- `arrange-neutral.json` holds the successful placement, planning and note-writing calls for the exact recipe.

Each call keeps its actual `shape`, `input`, `reply`, `ms`, `thinking`, `version` and `model`. Keep actual usage when available. Do not invent thinking, elapsed time, a missing answer or notes for an unwritten option. Keep failed and uncertain attempts in the private spending audit. If a cold retry succeeded, use that successful receipt for the public tutorial. If two takes answered an identical request differently, select the take actually used rather than silently mixing them.

Only then add `index.json`, with a recorded date and one piece. The piece has `id`, `name`, `words`, source `midi` and `xml` URLs under `/demo/sample-sketch/`, the `recipe` below, actual `guide` steps, and one run whose key is `arrange-neutral`, mode is `arrange`, and mood is empty.

```
"recipe": {
  "intent": "arrange",
  "ensemble": "String orchestra",
  "moreBars": 0,
  "where": "inside",
  "useMelodyOnly": false
}
```

Write the guide from the real recorded decisions. State every answered question, confirmed instrument, selected option and rewrite shown. Mark an option that has only a first-section preview as such. State which option can finish and export. The tutorial must say it is recorded, it spends no credit, and other settings are unprepared. A timestamp for the package does not replace each call's real model, prompt version and time.

Replay matches the entire JSON request, including source notation, selected plan, intent, ensemble, answers, cues, both window endpoints, earlier written material and rewrite instructions. Changing a meaningful choice returns `not-prepared`. It never falls through to a provider. On exit or when selecting another recording, pending replay work is discarded.

Before publishing the index, verify the full guided path with API fetches rejected. It must reach the actual completed arrangement, preserve source notes, export MIDI and notation, and keep A and B distinct. A path shown in the video must have its real calls recorded. Do not expose a complete replay button for a partial recording.
