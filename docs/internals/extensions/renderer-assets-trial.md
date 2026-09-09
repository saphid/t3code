# Real renderer-assets agent trial

Work spine: saphid/personal-ops#128. Source and all execution: lxso2, /home/saphid/projects/t3-extensions-integration. Artifacts: /home/saphid/artifacts/t3-extensions-health-rounds-20260909/renderer-assets/.

## Result

An independent format-4 package loaded the actual Ghostty core, PTY trampoline and Symbols Nerd Font through public ClientHost.readAsset: 1,808,620 bytes total. Its own client instantiated the core, parsed the ABI type layout, linked the trampoline and loaded the font. It performed exactly three asset reads per attempt and released its temporary font registration. No private application import, Vite URL, direct network fetch or PTY operation is present.

before-restart-exit.json and after-restart-exit.json both record exit 0. Before restart: three installed checks, all 54 measured transfers matched source bytes, five repeated complete client loads succeeded. After a real server restart: the installation retained its exact content hash, the real client loaded all three assets again, and uninstall denied the old asset identity. Parent visually inspected the screenshot. The fixture installation was removed after proof; unrelated test packages remain.

The exact installed package hash was cd9728870cff4e6b9b2fa1f3e5e8f22ea871ec7b3dc0c6af9d8d443d720a474a. The server was stopped by its captured PID, start ticks and boot identity using pidfd SIGTERM; no forced kill. The isolated server-10 remains on port8196 with production buildv15. This was not a live user backend.

## Local comparison

Measurements alternate identical native static GET and authenticated plugin POST in the same Chromium browser/origin with cache:no-store. Each has one first sample plus eight later samples. Measured time includes fetching/reading bytes, and excludes the SDK digest check and WASM/font initialization. Every returned body was separately verified against the expected SHA-256. This small local sample is not evidence of complete panel or remote-network performance parity.

| Asset                             | Native median (ms) | Plugin median (ms) | Native observed p95 (ms) | Plugin observed p95 (ms) |
| --------------------------------- | -----------------: | -----------------: | -----------------------: | -----------------------: |
| ghostty-vt.wasm                   |              20.15 |              13.00 |                    31.40 |                    14.20 |
| ghostty-write-pty.wasm            |               2.60 |               5.75 |                     2.90 |                     7.60 |
| SymbolsNerdFontMono-Regular.woff2 |              10.60 |              16.90 |                    14.40 |                    22.60 |

Five repeated full public-client checks, including three reads, client hashing, WASM/trampoline and font loading, took 114.9, 112.6, 112.8, 116.1, 131.7 ms. There is no matching full-native-initialization benchmark here, so these are absolute observations only. The font and tiny trampoline show plugin-route overhead; the core was faster in this small sample, which is not a general speed claim.

## Builder and monitor loop

Builder thread: 1974eaac-6458-474a-9702-6acde394a4ef. Monitor thread: 38b51e2c-e58d-448c-b208-44f706a70773. Both persisted codex-secondary/gpt-5.6-luna with medium reasoning. Their final bounded reports and actual exit receipts are in builder/ and monitor/. They completed; no worker remains running for this slice.

The first client fetched every asset twice. It also reported a loaded font when font APIs were unavailable. Parent review required per-attempt byte reuse, explicit unsupported failure, validation after non-cancellable awaits, and finally-based font cleanup. The corrected focused tests execute the actual exported client using injected React hooks, covering read counts/order, retry cancellation, stale suppression and font failure/cleanup. The monitor verified the corrected source and receipts; parent separately performed the real browser/restart proof.

The monitor initially hand-transcribed a malformed test hash and a misleading timestamp. It regenerated both from actual files/clock. This is a reporting failure, distinct from a framework defect. Do not accept manually maintained digest strings or a test label as proof of a specific frozen source.

## Reproduction and remaining work

builder/generate-package.mjs reproduces the installable package from the repository's actual existing assets. builder/test.mjs validates it with the real public SDK and exercises the client. builder/provenance.json records sources, hashes and licensing references. This artifact-only diagnostic is not a separately shipped product and must carry the applicable license notices if later distributed. proof.mjs plus run-proof.py records the installed comparison; restart.py and captured server process receipts record the restart.

This closes the binary-asset prerequisite. It does not implement a VT renderer, terminal input/output, create/resize/close/clear/restart operations, composer integration, keyboard behavior, accessibility or full native Terminal parity. Real relay/tunnel, mobile and V2 execution remain unproven. The next slice must use public scoped terminal contracts; reusing native attach under a read-only grant would silently acquire launch authority and is unacceptable.
