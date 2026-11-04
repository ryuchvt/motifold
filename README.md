# Motifold

[Open app](https://motifold.chawanvit-vut.workers.dev) · [Recorded video walkthrough](https://www.youtube.com/watch?v=Z1bjtmefSEs) · [Run locally](#run-it)

Motifold turns a musical sketch into an orchestral score you can read, change and take into your DAW. You bring a melody or a piano part, as MIDI or MusicXML, or one line you sing, hum or play into a recording. It works out what you played, reads it, asks what it can't tell, and writes the rest as notes.

You choose the job. **Arrange** is neutral. It keeps the accepted score's notes, harmony, key, metre, timing, character and section order, and adds no bars. It can voice your music for different instruments and add a supporting counterline within your theme. **Expand** keeps that character and develops the same piece with a connected section, a return or a finished ending. Your written notes and harmony stay. **Recompose** writes a new piece within the freedom you choose, with a new mood and harmony if you want them. Its default keeps your whole tune recognisable, with small changes to the melody and new harmony.

I write to picture, so I often play an idea in with no click. A file like that has no bars that mean anything, and anything that reads notation needs bars. Most tools stop there. Motifold starts there.

## Try it

The recorded tutorial is free and needs no key at [motifold.chawanvit-vut.workers.dev](https://motifold.chawanvit-vut.workers.dev).

Give it your own Meta Model API key to try your own piece. The key stays in that browser tab and goes with each call. The server does not store it. The hosted site also lets anyone try one piece on my credit, with a limit per visitor and a limit a day, until that runs out.

The free **Start hands-on tutorial** path begins with my original piano performance, then shows its saved interpreted bars and tempo map. It guides actual Study, Setup, A/B comparison, writing and export controls. Both guided string options are complete. The model answers are real recorded replies. The activity panel shows their original duration while replay shortens the wait. No credit is used.

**Explore recorded outcomes** opens the complete prepared scores and downloads directly. The planned matrix has 204 outcomes across Arrange, Expand and Recompose. The catalog reports how many are actually prepared. Unrecorded choices say so and cannot silently become paid calls. Recorded lengths and Recompose freedom use fixed presets. Live runs retain the full controls.

My exact `Sample_sketch.mid` has 117 attacks and its original DAW offset. Its accepted notation has 114 attacks in 24 bars of 3/4. Three very soft attacks remain in the original MIDI. The notation groups nearby attacks and interprets note lengths for readable lines. A separate 117-note performance MIDI uses the saved tempo map while preserving rubato and note releases within MIDI tick rounding. All three versions are clearly labeled. The tutorial opens saved analysis and makes no new bar-reading call. See [DEMO.md](DEMO.md).

## What Muse Spark does

Muse Spark 1.3 makes the musical decisions through strict JSON schemas on the Responses API. Each stage has a fixed contract on the server. The selected job determines which stages run.

| Call | What it decides |
| --- | --- |
| `read_bars` | The metre and the bars of a piece played with no click, from the notes alone |
| `read_piece` | Who has the tune, what each track is, the sections, what's missing, and what to ask you |
| `study_score` | Harmony, formal sections and musical moments addressed to the supplied notes |
| `distribute` | Who plays each of your lines, for the instruments you chose |
| `plan_options` | Two faithful arrangements or expansions, according to the selected intent |
| `plan_recompose` | Two new pieces within the selected freedom |
| `write_theme` | The tune, counterline and bass of a recomposition before orchestration |
| `arrange` | The notes, one section at a time, with each real line written once |
| `fit_form` | Suggested section orders for confirmed timed moments |

What it's told about music is in `server/brain.ts`, in my own words: harmony on a fixed tune, film harmony, variation, form, orchestration, dynamics and scoring to picture. A plan names its chords bar by bar, so you can read the harmony and reject it before anything is written.

Faithful Arrange keeps the source harmony and character. A theme is a recognisable musical statement. A motif is a smaller distinctive gesture within it. Inspiration is a broader influence and does not promise that the original theme will be recognisable. The chosen freedom states what must remain.

## What the code does

The code measures and checks, and never makes a musical decision. It maps a free performance into musical bars and a tempo map. The performance MIDI keeps the played timing within MIDI tick rounding. The notation is a readable interpretation of nearby attacks and note lengths, which you accept before arranging. It moves your notes onto instruments without adding any and counts them. It checks every new note against what's sounding and the instrument's range. It copies doublings exactly, so a full orchestra stays within what one call can write. It carries levels through to the page, to MIDI velocity and to a mod wheel curve. On a recomposition it measures how often the motif's shape really comes back, as written, upside down or backwards. It says all of this on screen, and it doesn't tell you the music is good. That's your ear.

Muse Spark 1.3 is the only AI model Motifold uses. Live calls go from the server to Meta's Model API, on my key or on yours. A recorded replay reads local saved replies and never contacts the provider.

A recording becomes notes in your browser with no model at all. YIN finds the pitch every 10 ms, and the code turns that into notes where the pitch holds, where it changes and where the level jumps on the same pitch. Nothing is uploaded. It hears one line at a time, so chords need MIDI or MusicXML. On my own recorded piano melody it found 44 of the 52 notes I played and added 6 that I didn't. That's one recording, so it says nothing yet about yours.

Calls on my shared credit go through a ledger that reserves the worst case first and stops at a cap. Calls on your own key bill your Meta account.

## Run it

Use Git and Node.js 24 or 26 with npm. Node 22.13 or later within the 22.x release is also supported. Clone and start the app with these commands.

```sh
git clone https://github.com/ryuchvt/motifold.git
cd motifold
npm ci
npm run server
```

If you already cloned or downloaded the repository, run the last two commands from its root directory.

Open http://127.0.0.1:8788. This starts the app and Worker locally. Local replay needs no Cloudflare account, API key, deployment or environment file. The first install downloads the npm dependencies.

For the no-key judge walkthrough, choose **Start hands-on tutorial**. Play my piano sketch, open its saved accepted bars, and follow Study, Confirm tracks, Setup, Create, compare A and B, choose either plan, write its recorded continuation and Export. Use Arrange and String orchestra, keep all source notes, skip the unanswered questions and leave the direction blank. Both plans finish. After export, the three featured examples show the arrangement, expansion and Cute to Sad recomposition with their DAW audio and downloads. **Explore recorded outcomes** opens the other prepared scores directly.

These paths use the genuine saved model replies bundled in this repo. They do not make live Meta calls or use credit. Changed choices without a recorded reply say they are not prepared. The guided workflow and its evidence are described in [DEMO.md](DEMO.md) and [the recording provenance](public/demo/README.md).

To make new live calls on your own music, paste your Meta Model API key into **Use your own Meta key** on the first page. Alternatively, stop the local server, run `cp .dev.vars.example .dev.vars`, replace the placeholder in `.dev.vars` with your key, and restart `npm run server`. This project uses Wrangler's `.dev.vars` convention for local secrets, so the template is [.dev.vars.example](.dev.vars.example). The real `.dev.vars` is ignored by Git. New live calls use your Meta account credit and can take several minutes. No key is needed for the recorded walkthrough above.

The [video walkthrough](https://www.youtube.com/watch?v=Z1bjtmefSEs) shows saved replies from real Muse Spark calls. It does not claim that a fresh provider call is running during replay. The bundled evidence includes [the exact guided requests and replies](public/demo/sample-sketch/guided-neutral-strings.json), [source fingerprints](public/demo/sample-sketch/source/manifest.json), [outcome exports and validation manifests](public/demo/sample-sketch/outcomes), and [DAW audio provenance](public/demo/audio-provenance.json). Each complete outcome also includes its recorded calls in `run.json`. Timing, model and prompt versions are retained, with thinking summaries and usage where available.

For a separate developer interface preview, run `npm run dev:ui` and open http://127.0.0.1:5199. It opens my `Sample_sketch.mid` piano performance with its saved bar reading and two separately saved Hopeful and Dark arrangements. Every screen labels it as a sample. The preview server refuses API calls, and the sample answers are excluded from the production build. Use the normal local server and recorded tutorial above to reproduce the submitted workflow.

`npm test` runs the tests without paid calls. `npm run typecheck` checks app and Worker types. `npm run build` produces the app in `dist/`.

## What it can't do yet

It writes notes, dynamics and plucked string parts, but not a general set of articulations or mutes. No choir. Audio is one line at a time, and very soft high notes can go missing. I've tested it on short orchestral sketches of mine, so I'm not claiming it does this for everyone's music. Live planning and writing can take several minutes. It sounds like a notation program in the browser, and it's your own instruments that say how it really sounds.

## Made before the event

I wrote the application code during the building period, from October 27 to November 4. This repo begins with my November 2 snapshot of the event-built application. The commits after it show the incremental development, including experiments and fixtures that were later removed. Pre-event application code and its history are not included.

My piano theme and early design documents predate the event. The MIDI and audio inputs in `public/demo/` are my own composition and playing. The musical principles are established knowledge. The application and musical guidance were written during the event. I do not claim that every recording predates it.

## Sounds and data

The instrument sounds in `public/samples/` are from Versilian Studios' [VSCO 2 Community Edition](https://versilian-studios.com/vsco-community/), which is CC0. `scripts/build-samples.py` builds them. No model makes any sound. The selected example and video input is my own piano performance, `test-fixtures/Sample_sketch.mid`.

The public-domain MusicXML fixture in `test-fixtures/fur-elise.musicxml` is used only in score tests. Its source and public-domain notice are included in the file. It is not part of the recorded demonstration.

## Libraries

| Library | Licence | What it does here |
| --- | --- | --- |
| [@xmldom/xmldom](https://github.com/xmldom/xmldom) | MIT | Reads MusicXML |
| [fflate](https://github.com/101arrowz/fflate) | MIT | Compressed files |
| [OpenSheetMusicDisplay](https://github.com/opensheetmusicdisplay/opensheetmusicdisplay) | BSD 3-Clause | Draws the score |
| [Kalam](https://github.com/itfoundry/kalam), a typeface | SIL Open Font License 1.1 | The section names |
| [Lucide](https://lucide.dev) | ISC | Interface icons |
| [jsdom](https://github.com/jsdom/jsdom) | MIT | Lets the tests draw scores without a browser |
| [React](https://react.dev) | MIT | The interface |
| [Vite](https://vite.dev) | MIT | Builds the app |
| [Vitest](https://vitest.dev) | MIT | Runs the tests |
| [TypeScript](https://www.typescriptlang.org) | Apache 2.0 | The language |

## Licence

Copyright 2026 Chawanvit Vuthikornudomkit. All rights reserved. The source is available to view under the [Motifold Source-Available License](LICENSE), and no other use is granted.

Third-party components and assets keep their own licences. [Third-party notices](THIRD_PARTY_NOTICES.md) include the licence for a retired experiment retained in this repo's history.
