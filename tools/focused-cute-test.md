# Focused source test

Ryu separately approved up to $5 of new exposure for the user-selected `cute_test` MIDI and WAV, for neutral Arrange and Sad Recompose. This does not reopen either previous recording allowance.

The immutable `focused-cute-test` profile uses run `motifold-cute-test-2026-11-04` and a separate private `live-cute-test-approved-run.json`. Its starting committed exposure is exactly $42.616543, including every earlier uncertain and historical hold. Its cumulative dev cap is $47.616543, not the old cap plus $5. The public $100 and personal $1 allocations remain untouched.

First startup accepts only the existing $44.048076 cap and exact starting exposure. Restart requires the same saved baseline and owned settlements, with the approved new cap. No owned unknown, pending or provisional work can restart. An empty approval may survive a failed initial Worker launch while the prior cap is still present. Deleting a used approval or resetting the ledger does not grant another allowance. Historical expired holds remain fully counted.

Only the exact `x-motifold-record-case` tags `cute-arrange` and `cute-sad-recompose` can spend. The former allows reading, placement, neutral inside-only Arrange planning and writing. The latter allows reading, Sad planning/theme and seeded writing at the normal freedom 2. Use the ordinary Sad preset with no extra direction text. Expand, other moods, fit-form and `fix` requests are refused before reservation. Tags identify the operator's approved jobs, not cryptographic proof of a file's contents. The operator must select only the two approved files and retain their hashes and accepted reading with the receipts. No file discovery is performed by the guard.

Run only from the final reviewed production build. The initial command is unarmed:

```
node tools/live-rehearsal.mjs --profile focused-cute-test --start-worker --isolate-settled --wave-width 1 --out output/cute-test
```

Only the coordinated operator adds `--armed` after the import fix and all checks pass. This preparation does not start a Worker or create a real approval. The profile requires one serial owned Worker, full worst-case reservations, durable ownership before dispatch and settlement isolation. It never retries a request or performs a repair. A new unknown stops further calls and retains its full hold. The old night-run review cannot authorize continuation of this new unknown. Receipts remain private and never contain keys.

The $5 ceiling is a stop-loss, not a promise that both jobs or options finish. Keep ordinary source/edit/export work available after refusal. Further calls require operator review of the remaining reservation-inclusive headroom.
