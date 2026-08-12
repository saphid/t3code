# Approved SwiftUI phone lane

`personal/swiftui-approved` is the only branch allowed to build the private
SwiftUI app for Alex's physical iPhone. It is based on Theo's active
`t3code/rebuild-mobile-app-swift` branch until SwiftUI reaches upstream `main`.

Each local feature remains in its T3 thread worktree based on Theo's SwiftUI
branch. Alex can promote a focused, tested change to this lane as a pre-PR
candidate for physical-phone proof, or promote an already reviewed upstream PR.
The manifest records each source commit and the stable patch ID of its approved
integration commit. When conflict resolution did not change the source patch, it
also records and verifies that exact source patch ID. Candidate branches remain
separate and are not pushed upstream as part of this composite lane; after phone
proof they can become focused PRs in the normal way. Squashed or conflict-resolved
promotions are pinned by their integration patch and the final approved-tree
digest instead of claiming false patch equivalence with a multi-commit source.
Personal signing is a separate, digest-pinned overlay.

The current promoted candidates add clipboard image paste, live working
duration, full thread menus, debug build/base-distance identity, app and
environment versions with build and release changelog links, swipe-revealed
message timestamps, keyboard-aware composer height, and an orange Dev label in
the Debug home title. The richer base-distance badge supersedes the older
standalone dev badge patch, so that older patch is not duplicated in this lane.

The device installer runs `scripts/t3-swift-approved/verify.sh` before resolving
or touching a phone. The verifier rejects a dirty worktree, another branch, an
unrecorded patch, a changed approved file, or any path outside the approved
feature, signing, and policy sets. A detached build is accepted only when its
commit is exactly `origin/personal/swiftui-approved`.

Every physical install must supply a positive `T3_SWIFT_BUILD_NUMBER`. Before
building, the installer reads the currently installed private bundle and
rejects an equal or lower build number. This prevents an older worktree or the
project default from silently replacing a newer approved phone build.

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
