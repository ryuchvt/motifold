# Third-party notices

Third-party components and assets retain their own licences. Motifold's source-available licence applies to its original application code and does not replace these licences. The current dependencies and sound credits are listed in [README.md](README.md#sounds-and-data).

## Historical Basic Pitch model

The event history retains an earlier experiment with [Spotify Basic Pitch](https://github.com/spotify/basic-pitch-ts), distributed under the [Apache License 2.0](licenses/Basic-Pitch-Apache-2.0.txt).

That experiment included `public/transcribe/model.json` and `public/transcribe/group1-shard1of1.bin`. The original commits credit Basic Pitch and TensorFlow.js. These assets and the Basic Pitch integration were removed in commit `6511c92` and are absent from the current application. The current audio transcription uses YIN without a model. Muse Spark is the current application's only runtime AI model.

The full upstream Apache licence is included here so recipients of the retained historical model files receive its terms. This notice does not restore the removed model to the application.
