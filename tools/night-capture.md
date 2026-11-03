# Local capture harness

The operator starts each recipe explicitly. Loading the harness never starts a model request.

```
node tools/night-capture-server.mjs --matrix
node tools/night-capture-server.mjs --port 5218 --output output/night-capture
```

Open the printed loopback URL. `window.night.recipes` lists102 recipes in capture priority order. `window.night.start('arrange-neutral-string-orchestra')` starts one recipe through the actual React `useArrange` hook. `window.night.status()` returns its phase or final result. Starting another recipe while one is running is rejected. No batch begins automatically.

The proxy is fixed to `http://127.0.0.1:8788`. The separate guarded entry must own that address before any start. The harness never owns a key or ledger, and does not establish a spending allowance. The operator configures and checks the approved guard separately. `stop()` prevents future requests and phases. A request already sent still settles through the guard. It is not refunded or aborted by this tool.

The source is the exact public accepted MusicXML. Server startup checks its SHA256 and freezes its bytes in memory and the private output folder. The client checks the hash again before exposing start. It reads and waits for Study, confirms both Piano tracks, and leaves all questions unanswered. Arrange and Expand call the real placement and planning methods, preview both options, and fully write and export A then B. Recompose plans32 bars at freedom2, then writes A and B independently. Each becomes active option zero, so the original chosen plan index is recorded separately. No Keep is used.

Each case is `<recipe.id>-<start time in base36>`. Its folder contains progress and final summary JSON, an outcome summary and untouched actual hook-download ZIP per completed A/B outcome, plus extracted XML and MIDI files. Nested `parts/` files are flattened only in these inspection copies. ZIP entries keep their original names and bytes. Each request carries `x-motifold-record-case` for joining the guarded receipts. Summaries retain request inputs and attempt IDs, never authorization headers or keys. The output folder is gitignored and files use private permissions.

A failed or unfinished stage, missing writing windows, unsafe ranges, unreadable notes, occupied bars, overflow, missing tune, empty exported score or wrong exported length stops the recipe and leaves failure diagnostics. A faithful arrangement or expansion may add no notes while retaining the source, including in a source-only writing window. Those checks do not judge musical quality. No failed result becomes a complete catalog entry.

Local checks use the real hook and ZIP packaging with fake model replies and no provider requests.

```
npx vitest run tools/night-capture.test.tsx
npx vitest run tools/night-capture-server.test.mjs
npx tsc -p tools/tsconfig.night.json
```
