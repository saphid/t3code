Measurements execute the actual mobile usePullRequestFilesViewed hook with React DOM/jsdom. Only transport/query/permission dependencies are mocked. No simulator or live server was used.

base-test-benchmark.log: hook source restored from 511d20c6f2, benchmark-harness.tsx placed at apps/mobile/src/features/pull-requests/usePullRequestFilesViewed.test.tsx. Cost regression failed with 3,000,500 path reads; behavior and timing cases passed.
fixed-test-benchmark.log: same harness and command against the memoized Set implementation.
Command: ./node_modules/.bin/vp test run apps/mobile/src/features/pull-requests/usePullRequestFilesViewed.test.tsx --silent=false --reporter=verbose

Benchmark has 5 warmup samples plus 31 measured samples for each size, 500 unviewed server records, two lookup passes over prebuilt paths. Timings cover lookup work only, excluding React rendering and index construction. Desktop Node 24.15.0; not native device timings. Median milliseconds: 500 loaded files 6.321276 before / 0.067631 after; 3000 loaded files 33.015830 before / 0.738945 after. Timing is observational, not a CI threshold. Algorithmic work changes from O(loaded files * server records) to O(server records) per answer plus O(loaded files) lookups per pass.

The benchmark was removed from the committed test suite after independent review. benchmark-harness.tsx retains the complete harness used for these logs, including imports relative to the original mobile test location. To repeat in a disposable checkout, temporarily copy it to that location and run the command above against the base hook and then the fixed hook. Restore the permanent test afterward.
final-tests.log: final committed suite (2 meaningful regression tests), 2 passed / 0 failed.
lint.log and typecheck.log: final targeted checks, clean.
committed.diff: full final diff from 511d20c6f2.
