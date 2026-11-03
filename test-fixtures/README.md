# Test music

`Sample_sketch.mid` is my own piano performance. It is the selected input for the interface preview and the video. The file has 117 notes. Its saved reading is 24 bars in 3/4.

SHA-256 of the exact MIDI is `782c244e9d31572a3c3225c6af170a75ea94224b7e92ea1e1a6d6183ddb70d54`.

`sample-sketch-bars.json` and `sample-sketch-arrangement.json` hold the saved answers for that performance. The local interface preview uses these answers with no model request. They do not replace the final replay recordings.

`sample-sketch-preview.json` contains the complete saved Rising Hymn and Lament in A minor arrangements from two separate Hopeful and Dark runs. Both use the same piano source and full orchestra with 16 added bars. Recorded doublings are expanded without changing the notes. The five recorded D1 range warnings in the Dark arrangement remain. The preview labels these as different saved mood runs.

`contract-score.musicxml` and `contract-arrangement.json` are synthetic test data. They exercise printed bar labels, ties, piano staves, placement, concurrent requests, retries and exports. They are not an example composition or a model run.
