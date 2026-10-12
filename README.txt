B-1 evidence

1. Flood with ACKs withheld (bench-raw.jsonl, harness zzBenchB1.test.ts.txt; scratch, not committed)
   Run from apps/server: NODE_OPTIONS=--expose-gc vp test run src/terminal/zzBenchB1.test.ts
   Real effect RpcServer + production withTerminalOutputWindow, one terminal.attach request.
   "base" = handler copied verbatim from ws.ts at 3f70c831c6 (Stream.callback + Queue.offer).
   "fix"  = terminalOutputStream(attach, resync) from the final branch code (8 MiB budget).
   Flood: 10,000 output events x 4096 distinct bytes (39.1 MiB), no client ACK, then one ACK.
   base: retained heap 40.0 / 39.9 / 39.9 MiB; listener stays subscribed; next chunk after ACK
         = 9,935 values, 41,349,513 bytes; ACK->chunk 121.6 / 121.6 / 103.8 ms (synchronous).
   fix:  retained heap 0.2 / 0.2 / -0.1 MiB (noise); listener released at ~2,000 events (8 MiB);
         next chunk after ACK = 1 fresh snapshot, 278 bytes; ACK->chunk 0.5 / 0.3 / 0.3 ms.
   (Re-run on the final round-3 code.)

2. Steady-state retention, review round 1 finding P1 (steady-state-retention.jsonl, harness
   zzRetainB1.test.ts.txt). Mailbox kept continuously non-empty (~256 KiB standing backlog),
   5,000 pull cycles, 75,000 x 4 KiB events (293 MiB) delivered.
   round 1 commit b79ba7b05a: retained heap 298.9 / 298.8 / 297.4 MiB (consumed slots kept).
   final code: retained heap 0.1 / 0.0 / -0.9 MiB.

3. round2-tests-on-round2-code.log: the two tests added for review round 2 run against the
   round-2 source (9874a3ea12) with only the tests updated: both fail (resync replayed the new
   snapshot plus 2 events from the closed session; a second queued 48 KiB snapshot did not
   overflow a 32 KiB budget). They pass on the final code.

4. round3-test-on-round3-code.log: the test added for review round 3 ("does not repeat output in
   flight while a stalled stream resyncs") run against b7962bacc2's Manager.ts: fails (the
   resumed stream received the in-flight output again after the snapshot that held it).
   Passes on the final code.

5. round4-tests-on-round4-code.log: the two tests for review round 4 run against 6d30d3dc18's
   Manager.ts: both fail (a newer polled activity event ended the round-3 cutoff and the
   in-flight output was repeated; a reopened session's spawn error at sequence 1 was dropped
   after silent eviction). Both pass on the final code.

6. fix-tests.log: focused test runs on the final code 326f7071b5+round-5 commit (3 consecutive runs of 170 tests passed
   before the last test-only type fix; final run 170 passed).
