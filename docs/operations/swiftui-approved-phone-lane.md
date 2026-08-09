# Approved SwiftUI phone lane

`personal/swiftui-approved` is the only branch allowed to build the private
SwiftUI app for Alex's physical iPhone. It is based on Theo's active
`t3code/rebuild-mobile-app-swift` branch until SwiftUI reaches upstream `main`.

Each local feature remains in its T3 thread worktree based on Theo's SwiftUI
branch. Alex can promote a focused, tested change to this lane as a pre-PR
candidate for physical-phone proof, or promote an already reviewed upstream PR.
The manifest records either source and its stable patch ID. Candidate branches
remain separate and are not pushed upstream as part of this composite lane;
after phone proof they can become focused PRs in the normal way. The verifier
compares each recorded patch to its integration commit and, when the source
object is available locally, to the source commit. Its offline sync clone relies
on the recorded IDs and digest-pinned final tree. Personal signing is a separate,
digest-pinned overlay.

The device installer runs `scripts/t3-swift-approved/verify.sh` before resolving
or touching a phone. The verifier rejects a dirty worktree, another branch, an
unrecorded patch, a changed approved file, or any path outside the approved
feature, signing, and policy sets. A detached build is accepted only when its
commit is exactly `origin/personal/swiftui-approved`.

The manifest is the reviewed root of trust. It pins the feature tree, personal
overlay, verifier, sync job, verifier tests, and this policy. Changing the
manifest is therefore a promotion decision, even when all other digests still
match.

Physical-device builds from this lane are Debug-only. The Personal Team overlay
uses intentionally empty Debug entitlements because the free signing profile
cannot provision the upstream capabilities. App Groups, widgets, incoming Share
extension handoff, push notifications, associated domains, and Sign in with
Apple are consequently not claimed or tested by this private phone build.
Release and TestFlight builds continue to use upstream release signing instead
of this overlay through upstream release tooling; the guarded private-phone
installer cannot select Release. The upstream background-mode declarations also
remain in the shared Info.plist, but push registration and background delivery
are unavailable without the missing Debug entitlements.

Home resolves pull-request metadata at most once per checkout identity between
foreground activations. The lookup observes the server's cached VCS status
stream instead of invalidating its shared source-control cache, so timer ticks,
search text, shelf expansion, and project filtering must never retry it.
Returning from the background deliberately clears the local cache so PR state
and transient failures receive one bounded observation.

The two-hour sync job may merge Theo's branch automatically only when the merge
leaves every approved feature and personal overlay digest unchanged and the
native test entry point passes. A conflict, protected-file change, or unexpected
script failure pushes nothing and creates or comments on one reconciliation
issue. A PID-owned atomic lock rejects concurrent runs, replaces a lock only
after its owning process is gone, and alerts if a live owner holds it for more
than three hours without repeating that alert on every scheduled run. The
job-owned scratch checkout self-recovers after an
interrupted merge. If GitHub alert delivery is unavailable, the
job retains a durable `needs-reconciliation` marker beside its scratch checkout.
The sync runs both the source-gate test suite and native tests before pushing.
Removing, replacing, or adding a feature is always a human promotion with a new
manifest.

Physical installation remains a separate confirmation boundary. Passing this
source gate proves branch eligibility; it does not authorize installing or
launching an app on the phone.
