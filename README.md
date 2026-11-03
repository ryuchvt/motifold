# Motifold

Motifold turns a musical sketch into an orchestral score you can read, change and take into your DAW. You bring a melody or a piano part, as MIDI or MusicXML, or one line you sing, hum or play into a recording. It works out what you played, reads it, asks what it can't tell, and writes the rest as notes.

You choose the job. **Arrange** is neutral. It keeps your notes, harmony, key, metre, timing, character and section order, and adds no bars. It can voice your music for different instruments and add a supporting counterline within your theme. **Expand** develops the same piece with related new material or sections. Your written notes stay, and a mood is optional. **Recompose** writes a new piece within the freedom you choose, from keeping the whole tune to drawing on a small idea from it.

I write to picture, so I often play an idea in with no click. A file like that has no bars that mean anything, and anything that reads notation needs bars. Most tools stop there. Motifold starts there.

## Try it

Give it your own Meta Model API key to try your own piece. The key stays in that browser tab, goes with each call and is never stored. The hosted site also lets anyone try one piece on my credit, with a limit per visitor and a limit a day, until that runs out.

The free **Watch it work** door opens the verified recorded walkthrough when its complete index is published in `public/demo/`. A replay uses the same screens, spends no credit and keeps the real model, prompt version and elapsed time in each saved call. It follows one exact prepared direction. Changes without a recorded answer stop there and never become a paid call.

The recorded path uses my exact `Sample_sketch.mid`, read as 24 bars of 3/4. It includes the reading, harmony analysis, String orchestra layout, two first-section previews and the complete selected A arrangement with its export. The original MIDI has 117 notes. Its accepted notation reading has 114, because the existing import threshold excludes three very soft notes at velocities 1, 5 and 4. Those notes remain in the original MIDI download. The recorded walkthrough opens the exact accepted MusicXML directly, so it does not make a new bar-reading call. The exact steps and capture history are in [DEMO.md](DEMO.md).

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

Faithful Arrange keeps the source harmony and character. Mood and freer development belong in Expand or Recompose. A theme is a recognisable musical statement. A motif is a smaller distinctive gesture within it. Inspiration is a broader influence and does not promise that the original theme will be recognisable. The chosen freedom states what must remain. My source-backed reasoning is in [the intent research note](docs/research/2026-11-04-arrangement-intents.md).

## What the code does

The code measures and checks, and never makes a musical decision. It reads a free performance into a tempo map, beat by beat, so the score and the MIDI keep your timing. It moves your notes onto instruments without adding any and counts them. It checks every new note against what's sounding and the instrument's range. It copies doublings exactly, so a full orchestra stays within what one call can write. It carries levels through to the page, to MIDI velocity and to a mod wheel curve. On a recomposition it measures how often the motif's shape really comes back, as written, upside down or backwards. It says all of this on screen, and it doesn't tell you the music is good. That's your ear.

Muse Spark 1.3 is the only AI model Motifold uses. Live calls go from the server to Meta's Model API, on my key or on yours. A recorded replay reads local saved replies and never contacts the provider.

A recording becomes notes in your browser with no model at all. YIN finds the pitch every 10 ms, and the code turns that into notes where the pitch holds, where it changes and where the level jumps on the same pitch. Nothing is uploaded. It hears one line at a time, so chords need MIDI or MusicXML. On my own recorded piano melody it found 44 of the 52 notes I played and added 6 that I didn't. That's one recording, so it says nothing yet about yours.

Calls on my shared credit go through a ledger that reserves the worst case first and stops at a cap. Calls on your own key bill your Meta account.

## Run it

You need Node 22 or later.

```
npm install
npm run server
```

Open the address it prints. For live calls, copy `.dev.vars.example` to `.dev.vars` and put your key in it. Or paste your key on the first page.

To explore the interface with no model calls, run `npm run dev:ui` and open http://127.0.0.1:5199. It opens my `Sample_sketch.mid` piano performance with its saved bar reading and two separately saved Hopeful and Dark arrangements. Every screen labels it as a sample. The preview server refuses API calls, and the sample answers are excluded from the production build. This sample is for checking the interface, not for filming a live demonstration.

`npm test` runs the tests.

## What it can't do yet

It writes notes, dynamics and plucked string parts, but not a general set of articulations or mutes. No choir. Audio is one line at a time, and very soft high notes can go missing. I've tested it on short orchestral sketches of mine, so I'm not claiming it does this for everyone's music. Live planning and writing can take several minutes. It sounds like a notation program in the browser, and it's your own instruments that say how it really sounds.

## Made before the event

I wrote all the code in this repo during the building period, from October 27 to November 4. This repo starts from a snapshot of my private working repo, so its first commit holds the work up to that day and the commits after it show the rest. My private repo also holds an earlier practice tool that isn't part of this.

These things are older. I wrote early design documents before October 27. The piano theme and the recordings in `public/demo/` are my own composition and my own playing, and they're input data. The principles Muse Spark is told to use come from what I read, and I wrote them down for this app in my own words. The knowledge is older than the event.

## What I read

Rimsky-Korsakov's Principles of Orchestration and Goetschius, both public domain. [Open Music Theory](https://human.libretexts.org/Bookshelves/Music/Music_Theory/Open_Music_Theory_2e_(Gotham_et_al.)) (CC BY-SA 4.0). [Murphy on the major tritone progression](https://mtosmt.org/issues/mto.06.12.2/mto.06.12.2.murphy.html) and his article Scoring Loss. [Schneller on modal interchange](https://api.equinoxpub.com/articles/20221). [Moreira on polychords](https://www.mtosmt.org/issues/mto.25.31.4/mto.25.31.4.moreira.html). [Eerola, Friberg and Bresin on musical cues and emotion](https://pmc.ncbi.nlm.nih.gov/articles/PMC3726864). [Farbood and Upham on musical tension](https://pmc.ncbi.nlm.nih.gov/articles/PMC3874841). [McAdams, Goodchild and Soden on orchestral grouping](https://mtosmt.org/issues/mto.22.28.3/mto.22.28.3.mcadams.html). No text or examples are copied from them, and no composer or film is named to the model.

## Sounds and data

The instrument sounds in `public/samples/` are from Versilian Studios' [VSCO 2 Community Edition](https://versilian-studios.com/vsco-community/), which is CC0. `scripts/build-samples.py` builds them. No model makes any sound. The selected example and video input is my own piano performance, `test-fixtures/Sample_sketch.mid`.

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
