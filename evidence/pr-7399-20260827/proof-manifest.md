# PR 7399 simulator proof

- Base source: `22b22f1463b83963d851bd0574a36a20f224a28d`
- Base retained binary SHA-256: `c9c701284f58c1c0203870d42f083120a8df488c1f7e29e892a7218b75222eb2`
- Rebuilt retained binary SHA-256: `190ffe443643082119953b1e3df6771fda9a798beec116eaa5887f30f5f84efa`
- Installed rebuilt binary SHA-256: `190ffe443643082119953b1e3df6771fda9a798beec116eaa5887f30f5f84efa`
- Simulator: `B0B16E05-D2DE-4243-B27B-6837D50FDFE6`, iOS 26.5, normal Debug identity `com.t3tools.t3code.swiftui.dev`
- Driver: XcodeBuildMCP 2.7.0 with AXe 1.8.0 through the canonical leased lane
- Capture dimensions: 1206 x 2622 pixels
- Base rich-row accessibility: `Done. Project pingdotgg/t3code. Provider Codex. on Alex’s MacBook Pro`
- Rebuilt rich-row accessibility: `Completed 29 minutes ago. Project pingdotgg/t3code. Provider Codex. on Alex’s MacBook Pro`
- Focused test result: 20/20 passed in `HomeThreadMetadataTests`
- Known fixture limit: the retained showcase rows are projection-only. A typed `thread.meta.update` reached the server and failed its invariant because no orchestration event stream exists. The live proof therefore uses an equal-value control; focused tests prove `latestTurnCompletedAt` wins over a divergent `updatedAt`.
- Lease cleanup: app terminated; lane inspection reports `active: false`; simulator remains booted as found.

## Capture hashes

- `before-light.png`: `2deb82a4d44343b0263b1a3f4d5e4cbcdbb3a2a90dc890a52568445eaff46e0a`
- `before-dark.png`: `9a2630829cb16aa5e389a8f888d9b989bd230b131cc1aba273a96cc226e8f966`
- `after-light.png`: `83401b95cd0cbea042c46d8c4a575521c18ab2e257bd1695cf434275f60dbbac`
- `after-dark.png`: `741161347691b7f879c58ac6661743094852cdb4029f155498cdcdb82a6c9b45`
