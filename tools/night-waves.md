# Optional two-page capture waves

The recording guard defaults to serial release. Production server code is unchanged.

An operator may add `--wave-width 2` to the existing `night-204` command only with `--start-worker --isolate-settled`. Use two independent browser pages and hooks, with different recipe IDs. Do not run concurrent choices on the same hook.

A wave starts one request in the owned fresh runtime. A second request may join while the first is still in flight, including several seconds later. The wave seals at two released slots or when its first request finishes. Requests arriving after that wait for the next wave. Both released operations must finish before maintenance begins. If both are known and at least one made a fresh charged call, the guard restarts its one owned Worker once. Cache-only waves need no restart. A charged settled rejection follows the existing night-profile policy. An unknown, absent settlement or invalid charge freezes new paid work while the other already-released stream finishes.

Read-only GETs queue behind the whole wave and its restart. A queued GET cannot block the second page from joining a still-open wave. The existing owned-Worker code waits for the old process and port to stop before starting its successor. No second Worker shares the SQLite ledger.

The same persistent approved-run file retains the $23 ceiling and all earlier attempts across restarts and width changes. Before every release, one readonly SQLite transaction snapshots the dev balance and all owned attempt rows. A durable owned reservation absent from that snapshot is added to session exposure and the pool and daily totals. Provisional reservations are never treated as free merely because their Worker row is not visible yet. A first reservation is persisted synchronously before another slot can be admitted. Existing holds, the public allowance and the personal reserve remain separate.

The guard records wave IDs and slots alongside the existing call receipts. It does not automatically retry or start a model request. This option has only local fake-upstream tests. Whether two simultaneous outbound calls work in the local runtime must be established by the operator under the existing approved ceiling. It is not a proven production connection fix or a promise of twice the speed.
