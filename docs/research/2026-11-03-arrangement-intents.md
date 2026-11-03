# Arrangement, expansion and recomposition

The default is a faithful arrangement. It keeps the supplied notes, key, metre, timing, phrase order, character and harmony. It can redistribute voices, change instrumentation and add a supporting accompaniment or counterline inside the existing theme. It does not select a new mood or add bars.

This is a deliberately narrow product promise. It is not a claim that all musicians use the word arrangement this narrowly. Berklee describes arrangement as work on an existing composition that can also change harmony, tempo, genre or form. Its account supports separating instrumentation from more transformative choices and labelling those choices explicitly. [Berklee, Arranger](https://www.berklee.edu/careers/roles/arranger)

## The middle ground

Expand continues the same piece with requested new sections, transitions, related material or a return. The written source remains fixed. New music should grow from identifiable phrases, motifs, bass or accompaniment. A requested mood may guide the new material. Without one, the source character remains the starting point.

This is a product interpretation of established developmental procedures. Ithaca's teaching handout separates expansion at a beginning, middle or ending from more substantial pitch and rhythmic alterations. It also lists sequence, imitation and fragmentation. Puget Sound distinguishes interval changes from rhythmic change, inversion, augmentation and diminution. These are ways of deriving material, rather than a rule that every new passage must transform the original in every dimension. [Ithaca College, Basic Developmental Techniques](https://musictech.ithaca.edu/MusicTech/Form/Handouts/DevTech.html), [University of Puget Sound, Melodic Alteration](https://musictheory.pugetsound.edu/mt21c/MelodicAlteration.html)

Recompose writes a new piece within the chosen freedom. Close retains the whole tune and its stated key and metre. Reshaped retains the whole recognisable tune with more rhythmic and harmonic freedom. Themes retains recognisable phrases. Motif develops a distinctive shorter gesture. Seed permits a less explicit relationship to identified source material, and does not promise that a listener will recognise the original theme.

## Theme, motif and inspiration

A theme is a recognisable musical statement with phrase shape and an arrival. It can contain multiple motifs. A motif is a smaller distinctive musical gesture. Neither is defined by an invariant number of bars. Open Music Theory discusses motives below the idea and phrase levels. Puget Sound describes the motive as a small identifiable melodic idea and shows several motives within one theme. This supports finding the actual unit in the input instead of always labelling the opening one or two bars as its motif. [Open Music Theory, Foundational Concepts for Phrase-Level Forms](https://viva.pressbooks.pub/openmusictheory/chapter/foundational-concepts/), [University of Puget Sound, Motive](https://musictheory.pugetsound.edu/mt21c/MotiveSection.html)

Inspiration is not a third unit of formal segmentation. Here it means an influence on character, texture or process. That is a product description, not a scholarly measurement. A generic mood or shared chord progression is not sufficient evidence that a theme or motif has survived. The prompt asks what specific source gesture remains and what is permitted to change.

## Orchestration policy

Faithful work balances the existing layers before adding new ones. The Open Music Theory orchestration chapter describes foregrounding a melody through register, timbre and contrasting accompanimental rhythm, and balancing doubled lines through instrument strength and register. The prompt applies those principles without forcing a new climax, three simultaneous layers, a busier repeat or reharmonisation. Those were existing prompt instructions that conflicted with a conservative default. [Open Music Theory, Core Principles of Orchestration](https://viva.pressbooks.pub/openmusictheory/chapter/core-principles-of-orchestration/)

## API and verification

`ArrangeInput` and `DistributeInput` accept an optional `intent` of `arrange` or `expand`. New clients send it explicitly. Explicit Arrange requires `where` of `inside` and zero extra bars. Its layout rejects `tuneOnly` because omitting the original bass and harmony contradicts that contract.

Older inputs remain valid. Without `intent`, an arrangement request with extra bars or `where` of `after` is treated as expansion. A request without extension is treated as faithful. Older tune-only layout requests keep their earlier behaviour. Recomposition keeps its existing separate endpoints, source seed and freedom rather than acquiring a third enum value.

Planning, layout, theme writing and orchestration prompt versions all change so older cached model answers cannot stand in for the new policies. Tests check accepted and rejected request combinations, the separation of prompt policies, source-harmony priority and propagation of freedom through the three recomposition stages. These checks prove the request and prompt contracts. They do not judge the musical quality of a model response or replace listening to a live run.

All runtime prose is newly written. Research sources are cited here, with no copied examples, tunes, composer names or film names added to the prompts. Research checked on 3 November 2026. No paid model request was made for this work.
