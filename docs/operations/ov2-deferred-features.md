# Deferred V2 features

These optional features were removed from the active V2 release manifest on 2026-09-22 at Alex's request so release repairs do not delay a working app. Restore each feature only after replaying it against the current V2 stack and passing the affected checks.

- feat(settings): show included fork changes: `7e25b2613941fff67ac5e34c4c9bec0f02090414`
- fix(release): use accessible build metadata tooltips: `aa73cae6ca0a1065ec2e8adee4a065250dac8c29`
- feat(desktop): add thread deep links: `53f000becc400e5073a7d73d9ba37a35c05eb3a7`
- feat(web): open file links externally: `8f67727eac9876ad195844ff244153cccaf3e418`
- fix(desktop): adapt nightly links and branding to OV2: `1adef623c214ec9ffe7780e5b664771a9aaa0718`
- fix(ov2): reconcile nightly callbacks and type inference: `f7ad21dad2a7aa9d8e80320663a722615bc3a832`
- style(web): format merged settings imports: `7f5d8aeae210deff0e8e78f8fefd7aecbafd57af`
- feat(scripts): report Nightly patches present in OV2 builds: `e4d9310aad75a94e7e742985521c7e5393375575`

GPT Live voice was restored on 2026-09-23. It was replayed from `165f817e42f`, `e7bc50f535d` and `5286805d436` onto the current V2 stack as `fix/ov2-voice-restore-20260923`, with contracts, server and web typechecks passing.

The obsolete replay-gate test patch `b53e8dd2714d0bc08c4d3de290936d8a1ebb04dd` was retired because upstream `e9bc38f7f4` already supplies event-driven arrival waiting and its test.
