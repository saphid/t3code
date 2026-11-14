# Queued-edit save settlement proof

For [PR #29570](https://github.com/pingdotgg/t3code/pull/29570), published head4cdf8a7e5247b9c930fc76475f124476bee573f0.

The baseline is the actual pre-fix source f7936cf7ee96237dda7cffe308222d1f864bba44, overlaid for the complete two-file contribution in the owned task checkout and restored afterward. No baseline output was fabricated. Both sides use the repository scenario runner, real isolated server/client and actual attachment API, disposable app-created state and the devReplay showcase provider. The scenario holds one actual queued-run.edit WebSocket request, cancels the edit, then releases the request. A read-only draft-store probe selects the real draft preview URLs; URL.revokeObjectURL instrumentation observes release.

Baseline fails the same preview-revocation assertion on both attempts after settlement (exit1). Candidate passes all assertions on first attempt (exit0), then reopens the queued edit with its saved attachment. Screenshot/video show UI context; the preview cleanup difference is nonvisual and established by the assertions, not by differing screenshots. No browser-heap reclamation or server-deletion claim.

Linux exact published source:23/23 focused tests pass, exit0. Earlier sync overlapping baseline overlay is excluded from candidate evidence. Earlier app attempts are retained privately: one prior run passed only on retry; warming the app removed that startup race in the final run. This is one passing candidate scenario, not a stability benchmark.

Videos preserve the complete viewport recording at original speed; no comparative animation/performance claim. Raw traces are excluded because they contain pairing URLs. Native clients and live commercial providers were not exercised.
