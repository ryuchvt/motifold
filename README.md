# Motifold

Motifold turns a musical sketch into an orchestral score you can read, change and take into your DAW. You bring a melody or a piano part, as MIDI or MusicXML, or one line you sing, hum or play into a recording. It works out what you played, reads it, asks what it can't tell, and writes the rest as notes.

You choose how free it gets. **Arrange** keeps your melody exactly as it is and builds around it. **Recompose** takes your melody as a motif and writes a new piece from it, with its own key, metre and form.

I write to picture, so I often play an idea in with no click. A file like that has no bars that mean anything, and anything that reads notation needs bars. Most tools stop there. Motifold starts there.

## Try it with no key

Run it (below) or open the hosted site, then press **Watch it work**. That plays back real runs of the app on my own piano theme, through the same screens, with the model's real thinking as it came. It costs nothing and needs no key or login. Every step says it's a replay, when it was recorded, and how long it took live. The recordings and what was sent to the model are in `public/demo/`.

To try your own piece, give it your own Meta Model API key. The key stays in that browser tab, goes with each call and is never stored. The hosted site also lets anyone try one piece on my credit, with a limit per visitor and a limit a day, until that runs out.

## What Muse Spark does

Muse Spark 1.3 makes every musical decision, through strict JSON schemas on the Responses API. Six calls run in a chain, and each is fixed on the server.

| Call | What it decides |
| --- | --- |
| `read_bars` | The metre and the bars of a piece played with no click, from the notes alone |
| `read_piece` | Who has the tune, what each track is, the sections, what's missing, and what to ask you |
| `distribute` | Who plays each of your lines, for the instruments you chose |
| `plan_options` | Two whole arrangements in words, with chords and levels bar by bar, before a note exists |
| `plan_recompose` | Two new pieces from your motif, each with its own key, metre, tempo and form |
| `arrange` | The notes, one section at a time, with each real line written once |

What it's told about music is in `server/brain.ts`, in my own words: harmony on a fixed tune, film harmony, variation, form, orchestration, dynamics and scoring to picture. A plan names its chords bar by bar, so you can read the harmony and reject it before anything is written.

## What the code does

The code measures and checks, and never makes a musical decision. It reads a free performance into a tempo map, beat by beat, so the score and the MIDI keep your timing. It moves your notes onto instruments without adding any and counts them. It checks every new note against what's sounding and the instrument's range. It copies doublings exactly, so a full orchestra stays within what one call can write. It carries levels through to the page, to MIDI velocity and to a mod wheel curve. On a recomposition it measures how often the motif's shape really comes back, as written, upside down or backwards. It says all of this on screen, and it doesn't tell you the music is good. That's your ear.

Muse Spark 1.3 is the only AI model Motifold uses. Every call goes from the server to Meta's Model API, on my key or on yours.

A recording becomes notes in your browser with no model at all. YIN finds the pitch every 10 ms, and the code turns that into notes where the pitch holds, where it changes and where the level jumps on the same pitch. Nothing is uploaded. It hears one line at a time, so chords need MIDI or MusicXML. On my own recorded piano melody it found 44 of the 52 notes I played and added 6 that I didn't. That's one recording, so it says nothing yet about yours.

Every call goes through a ledger that reserves the worst case first and stops at a cap, so no one can spend more than I've allowed.

## Run it

You need Node 22 or later.

```
npm install
npm run server
```

Open the address it prints and press **Watch it work**. No key is needed for that. To let your own runs be live on the local server too, copy `.dev.vars.example` to `.dev.vars` and put your key in it. Or paste your key on the first page.

`npm test` runs the tests.

## What it can't do yet

It writes notes and levels, and no marks like pizzicato or mutes. No choir. Audio is one line at a time, and very soft high notes can go missing. I've tested it on short orchestral sketches of mine, so I'm not claiming it does this for everyone's music. A live mood takes several minutes, because it thinks about every section. It sounds like a good notation program in the browser, and it's your own instruments that say how it really sounds.

## Made before the event

I wrote all the code in this repo during the building period, from October 27 to November 4. This repo starts from a snapshot of my private working repo, so its first commit holds the work up to that day and the commits after it show the rest. My private repo also holds an earlier practice tool that isn't part of this.

These things are older. I wrote early design documents before October 27. The piano theme and the recordings in `public/demo/` are my own composition and my own playing, and they're input data. The principles Muse Spark is told to use come from what I read, and I wrote them down for this app in my own words. The knowledge is older than the event.

## What I read

Rimsky-Korsakov's Principles of Orchestration and Goetschius, both public domain. [Open Music Theory](https://human.libretexts.org/Bookshelves/Music/Music_Theory/Open_Music_Theory_2e_(Gotham_et_al.)) (CC BY-SA 4.0). [Murphy on the major tritone progression](https://mtosmt.org/issues/mto.06.12.2/mto.06.12.2.murphy.html) and his article Scoring Loss. [Schneller on modal interchange](https://api.equinoxpub.com/articles/20221). [Moreira on polychords](https://www.mtosmt.org/issues/mto.25.31.4/mto.25.31.4.moreira.html). [Eerola, Friberg and Bresin on musical cues and emotion](https://pmc.ncbi.nlm.nih.gov/articles/PMC3726864). [Farbood and Upham on musical tension](https://pmc.ncbi.nlm.nih.gov/articles/PMC3874841). [McAdams, Goodchild and Soden on orchestral grouping](https://mtosmt.org/issues/mto.22.28.3/mto.22.28.3.mcadams.html). No text or examples are copied from them, and no composer or film is named to the model.

## Sounds and data

The instrument sounds in `public/samples/` are from Versilian Studios' [VSCO 2 Community Edition](https://versilian-studios.com/vsco-community/), which is CC0. `scripts/build-samples.py` builds them. No model makes any sound. The test fixtures include Bach's Arioso BWV 1056, arranged by Sam Franko, typeset by Hermógenes Hebert Pereira Oliveira for the [Mutopia Project](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1902), [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).

## Libraries

| Library | Licence | What it does here |
| --- | --- | --- |
| [@xmldom/xmldom](https://github.com/xmldom/xmldom) | MIT | Reads MusicXML |
| [fflate](https://github.com/101arrowz/fflate) | MIT | Compressed files |
| [OpenSheetMusicDisplay](https://github.com/opensheetmusicdisplay/opensheetmusicdisplay) | BSD 3-Clause | Draws the score |
| [Kalam](https://github.com/itfoundry/kalam), a typeface | SIL Open Font License 1.1 | The section names |
| [JetBrains Mono](https://www.jetbrains.com/lp/mono/), a typeface | SIL Open Font License 1.1 | The labels |
| [jsdom](https://github.com/jsdom/jsdom) | MIT | Lets the tests draw scores without a browser |
| [React](https://react.dev) | MIT | The interface |
| [Vite](https://vite.dev) | MIT | Builds the app |
| [Vitest](https://vitest.dev) | MIT | Runs the tests |
| [TypeScript](https://www.typescriptlang.org) | Apache 2.0 | The language |

## Licence

Copyright 2026 Chawanvit Vuthikornudomkit. All rights reserved. The source is available to view under the [Motifold Source-Available License](LICENSE), and no other use is granted.
