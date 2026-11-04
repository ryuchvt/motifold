# Local capture harness

The operator starts each recipe explicitly. Loading the harness never starts a model request.

```
node tools/night-capture-server.mjs --matrix
node tools/night-capture-server.mjs --port 5218 --output output/night-capture
```

Open the printed loopback URL. `window.night.recipes` lists102 recipes in capture priority order. `window.night.start('arrange-neutral-string-orchestra')` starts one recipe through the actual React `useArrange` hook. `window.night.status()` returns its phase or final result. Starting another recipe while one is running is rejected. No batch begins automatically.

The proxy is fixed to `http://127.0.0.1:8788`. The separate guarded entry must own that address before any start. The harness never owns a key or ledger, and does not establish a spending allowance. The operator configures and checks the approved guard separately. `stop()` prevents future requests and phases. A request already sent still settles through the guard. It is not refunded or aborted by this tool.

The local recorder may make one technical new-note register request per bad bar, for at most two bars in a completed outcome. This uses the app's actual `askFix` under the same approved guard. It runs only after all writing windows finish and range is the only hard failure. Preview checks, source placement checks and the spending ceiling remain in force. This is not an automatic repair in the live composer UI.

One operator-reviewed exception permits four bars for the original Pulse Full orchestra option A. It requires the exact accepted source, recipe, selected-plan and expanded raw-note fingerprints, 635 notes and the six original low Violin II notes in bars 5, 7, 8 and 9. A fresh recovery case may reuse those same cached inputs. Other outcomes, including B, retain the two-bar bound. The recorder derives the grant from the original settled outcome in that run. The publisher independently derives it from the authenticated original writing, never a captured allowance field. Only that grant permits repair phases three and four. There is still one real `askFix` per bar, no automatic retry, and no local octave correction. The existing exposure ceiling applies before every physical request, so the exception does not promise that all four repairs or B will finish. The original failed capture remains private evidence.

Each request contains code-derived sounding ranges and at most 400 characters of neutral instructions. The complete pre-repair bar must fit the existing context bound. Raw note counts, pitch classes, onsets, durations, held markers, entry grouping and dyn/role/art must survive. Only whole-octave moves in the flagged part and bar may differ. All unrelated entries remain intact. A fallback, unknown charge, another hard failure, too many bad bars or any changed musical data stops the capture without another repair or export.

Private snapshots retain the before and after adds, and all original and repair receipts remain available. Publication authenticates each exact request and settled answer, verifies the shared pre-repair context and selected seed/theme, then replaces that bar in the authenticated original writing. It never appends the corrected bar to the old one. A/B ownership is scoped by each actual phase even when two plans have identical values. The final score, every MIDI file and normal source-preservation checks still have to reproduce exactly.

The source is the exact public accepted MusicXML. Server startup checks its SHA256 and freezes its bytes in memory and the private output folder. The client checks the hash again before exposing start. It reads and waits for Study, confirms both Piano tracks, and leaves all questions unanswered. Arrange and Expand call the real placement and planning methods, preview both options, and fully write and export A then B. Recompose plans32 bars at freedom2, then writes A and B independently. Each becomes active option zero, so the original chosen plan index is recorded separately. No Keep is used.

Each case is `<recipe.id>-<start time in base36>`. Its folder contains progress and final summary JSON, an outcome summary and untouched actual hook-download ZIP per completed A/B outcome, plus extracted XML and MIDI files. Nested `parts/` files are flattened only in these inspection copies. ZIP entries keep their original names and bytes. Each request carries `x-motifold-record-case` for joining the guarded receipts. Summaries retain request inputs and attempt IDs, never authorization headers or keys. The output folder is gitignored and files use private permissions.

A failed or unfinished stage, missing writing windows, unsafe ranges, unreadable notes, occupied bars, overflow, missing tune, empty exported score or wrong exported length stops the recipe and leaves failure diagnostics. A faithful arrangement or expansion may add no notes while retaining the source, including in a source-only writing window. Those checks do not judge musical quality. No failed result becomes a complete catalog entry.

Local checks use the real hook and ZIP packaging with fake model replies and no provider requests.

```
npx vitest run tools/night-capture.test.tsx
npx vitest run tools/night-capture-server.test.mjs
npx tsc -p tools/tsconfig.night.json
```
