import Foundation
import Testing
@testable import T3Code

@Suite("Web V2 home thread metadata")
struct HomeThreadMetadataTests {
    private let now = Date(timeIntervalSince1970: 10_000)

    @Test
    func statusLabelsFollowTheWebV2RowVocabulary() {
        let expected: [(FeatureThreadState, HomeThreadStatus, String?)] = [
            (.idle, .ready, nil),
            (.queued, .working, "Working"),
            (.working, .working, "Working"),
            (.monitoring, .monitoring, "Monitoring"),
            (.waitingForApproval, .approval, "Approval"),
            (.waitingForInput, .input, "Input"),
            (.failed, .failed, "Failed"),
            (.completed, .done, "Done"),
        ]

        for (state, status, label) in expected {
            let thread = FeatureThread(
                id: state.rawValue,
                projectID: "project",
                title: "Task",
                state: state
            )
            #expect(thread.homeStatus == status)
            #expect(thread.homeStatusLabel == label)
        }
    }

    @Test
    func futureWorkingStartClampsToZeroSeconds() {
        #expect(workingDuration(startedAtOffset: 5) == "0s")
    }

    @Test
    func workingDurationUsesSecondsBelowOneMinute() {
        #expect(workingDuration(startedAtOffset: -42) == "42s")
    }

    @Test
    func queuedThreadsUseWorkingDuration() {
        #expect(workingDuration(state: .queued, startedAtOffset: -42) == "42s")
    }

    @Test
    func workingDurationSwitchesToMinutesAtOneMinute() {
        #expect(workingDuration(startedAtOffset: -60) == "1m")
    }

    @Test
    func workingDurationSwitchesToHoursAtOneHour() {
        #expect(workingDuration(startedAtOffset: -3_600) == "1h 0m")
    }

    @Test
    func workingDurationUsesHoursAndRemainingMinutes() {
        #expect(workingDuration(startedAtOffset: -5_465) == "1h 31m")
    }

    @Test
    func accessibilityDurationSpellsOutSingularUnits() {
        #expect(accessibilityDuration(startedAtOffset: -1) == "1 second")
        #expect(accessibilityDuration(startedAtOffset: -60) == "1 minute")
        #expect(accessibilityDuration(startedAtOffset: -3_600) == "1 hour")
    }

    @Test
    func futureAccessibilityDurationClampsToZeroSeconds() {
        #expect(accessibilityDuration(startedAtOffset: 5) == "0 seconds")
    }

    @Test
    func accessibilityDurationSpellsOutPluralHours() {
        #expect(accessibilityDuration(startedAtOffset: -7_200) == "2 hours")
    }

    @Test
    func accessibilityDurationSpellsOutHoursAndMinutes() {
        #expect(
            accessibilityDuration(startedAtOffset: -5_465)
                == "1 hour, 31 minutes"
        )
    }

    @Test
    func nonWorkingThreadsDoNotExposeWorkingDuration() {
        let idle = FeatureThread(
            id: "idle",
            projectID: "project",
            title: "Rest",
            state: .idle,
            workingStartedAt: now.addingTimeInterval(-10)
        )
        let monitoring = FeatureThread(
            id: "monitoring",
            projectID: "project",
            title: "Watch",
            state: .monitoring,
            workingStartedAt: now.addingTimeInterval(-10)
        )

        #expect(idle.homeWorkingDuration(at: now) == nil)
        #expect(monitoring.homeWorkingDuration(at: now) == nil)
    }

    @Test
    func completedThreadExposesTimeSinceLatestTurnCompleted() {
        let thread = FeatureThread(
            id: "done",
            projectID: "project",
            title: "Ship it",
            state: .completed,
            latestTurnCompletedAt: now.addingTimeInterval(-5_465)
        )

        #expect(thread.homeDoneDuration(at: now) == "1h 31m")
        #expect(thread.homeDoneAccessibilityDuration(at: now) == "1 hour, 31 minutes")
    }

    @Test
    func completedThreadShowsSecondsAndClampsFutureCompletion() {
        let recent = FeatureThread(
            id: "recent",
            projectID: "project",
            title: "Ship it",
            state: .completed,
            latestTurnCompletedAt: now.addingTimeInterval(-42)
        )
        let future = FeatureThread(
            id: "future",
            projectID: "project",
            title: "Clock skew",
            state: .completed,
            latestTurnCompletedAt: now.addingTimeInterval(30)
        )

        #expect(recent.homeDoneDuration(at: now) == "42s")
        #expect(future.homeDoneDuration(at: now) == "0s")
        #expect(future.homeDoneAccessibilityDuration(at: now) == "0 seconds")
    }

    @Test
    func completedThreadUsesDaysForLongDurations() {
        let thread = FeatureThread(
            id: "done",
            projectID: "project",
            title: "Ship it",
            state: .completed,
            latestTurnCompletedAt: now.addingTimeInterval(-(49 * 3_600))
        )

        #expect(thread.homeDoneDuration(at: now) == "2d 1h")
        #expect(thread.homeDoneAccessibilityDuration(at: now) == "2 days, 1 hour")
    }

    @Test
    func incompleteThreadDoesNotExposeDoneDuration() {
        let thread = FeatureThread(
            id: "working",
            projectID: "project",
            title: "Keep going",
            state: .working,
            latestTurnCompletedAt: now.addingTimeInterval(-60)
        )

        #expect(thread.homeDoneDuration(at: now) == nil)
        #expect(thread.homeDoneAccessibilityDuration(at: now) == nil)
    }

    @Test
    func freshCompletionUsesFastRefreshWhenPreferenceIsEnabled() {
        let thread = FeatureThread(
            id: "done",
            projectID: "project",
            title: "Ship it",
            state: .completed,
            latestTurnCompletedAt: now.addingTimeInterval(-30)
        )

        #expect(HomeThreadRefreshCadence.interval(
            threads: [thread],
            showDoneDuration: true,
            now: now
        ) == 1)
        #expect(HomeThreadRefreshCadence.interval(
            threads: [thread],
            showDoneDuration: false,
            now: now
        ) == 60)
    }

    @Test
    func workingThreadUsesFastRefreshRegardlessOfDoneDurationPreference() {
        let thread = FeatureThread(
            id: "working",
            projectID: "project",
            title: "Building",
            state: .working
        )

        for showDoneDuration in [false, true] {
            #expect(HomeThreadRefreshCadence.interval(
                threads: [thread],
                showDoneDuration: showDoneDuration,
                now: now
            ) == 1)
        }
    }

    @Test
    func oldAndFutureCompletionsUseMinuteRefresh() {
        for offset in [-60.0, 30.0] {
            let thread = FeatureThread(
                id: "done-\(offset)",
                projectID: "project",
                title: "Ship it",
                state: .completed,
                latestTurnCompletedAt: now.addingTimeInterval(offset)
            )
            #expect(HomeThreadRefreshCadence.interval(
                threads: [thread],
                showDoneDuration: true,
                now: now
            ) == 60)
        }
    }

    @Test
    func completionAtNowAndJustBeforeMinuteBoundaryUseFastRefresh() {
        for offset in [0.0, -59.999] {
            let thread = FeatureThread(
                id: "done-\(offset)",
                projectID: "project",
                title: "Ship it",
                state: .completed,
                latestTurnCompletedAt: now.addingTimeInterval(offset)
            )
            #expect(HomeThreadRefreshCadence.interval(
                threads: [thread],
                showDoneDuration: true,
                now: now
            ) == 1)
        }
    }

    @Test
    func completionRefreshSurvivesDelayedMinuteBoundaryTick() {
        let thread = FeatureThread(
            id: "done",
            projectID: "project",
            title: "Ship it",
            state: .completed,
            latestTurnCompletedAt: now.addingTimeInterval(-60)
        )

        #expect(!HomeThreadRefreshCadence.isFreshCompletion(thread, now: now))
        #expect(HomeThreadRefreshCadence.needsSecondPrecisionRefresh(thread, now: now))

        let outsideRecoveryWindow = FeatureThread(
            id: "older-done",
            projectID: "project",
            title: "Already refreshed",
            state: .completed,
            latestTurnCompletedAt: now.addingTimeInterval(-120)
        )
        #expect(!HomeThreadRefreshCadence.needsSecondPrecisionRefresh(outsideRecoveryWindow, now: now))

        let incomplete = FeatureThread(
            id: "incomplete",
            projectID: "project",
            title: "Still working",
            state: .working,
            latestTurnCompletedAt: now.addingTimeInterval(-60)
        )
        #expect(!HomeThreadRefreshCadence.needsSecondPrecisionRefresh(incomplete, now: now))
    }

    private func workingDuration(
        state: FeatureThreadState = .working,
        startedAtOffset: TimeInterval
    ) -> String? {
        FeatureThread(
            id: "working",
            projectID: "project",
            title: "Build",
            state: state,
            workingStartedAt: now.addingTimeInterval(startedAtOffset)
        )
        .homeWorkingDuration(at: now)
    }

    private func accessibilityDuration(startedAtOffset: TimeInterval) -> String {
        HomeWorkingDuration.accessibility(
            since: now.addingTimeInterval(startedAtOffset),
            now: now
        )
    }

    @Test
    func rowAttributionPrefersCurrentEnvironmentNameAndWireProviderName() {
        let thread = FeatureThread(
            id: "thread",
            projectID: "project",
            environmentID: "device",
            environmentName: "Old device name",
            title: "Build",
            branch: "feat/web-v2-home",
            worktreePath: "/worktrees/web-v2-home",
            providerID: "codex-work",
            providerName: "Codex Work"
        )
        let snapshot = FeatureSnapshot(
            environments: [
                FeatureEnvironment(
                    id: "device",
                    name: "leftbook",
                    endpoint: "https://leftbook.example"
                ),
            ],
            projects: [
                FeatureProject(
                    id: "project",
                    environmentID: "device",
                    name: "t3code",
                    path: "/work/t3code"
                ),
            ],
            providers: [FeatureProvider(id: "codex-work", name: "Config name")]
        )

        #expect(thread.homeEnvironmentLabel(in: snapshot) == "leftbook")
        #expect(thread.homeProviderLabel(in: snapshot) == "Codex Work")
        #expect(thread.branch == "feat/web-v2-home")
        #expect(thread.worktreePath == "/worktrees/web-v2-home")
    }

    @Test
    func rowAttributionFallsBackThroughProjectAndProviderCatalog() {
        let thread = FeatureThread(
            id: "thread",
            projectID: "project",
            title: "Build",
            providerID: "claude"
        )
        let snapshot = FeatureSnapshot(
            environments: [
                FeatureEnvironment(
                    id: "device",
                    name: "steambox",
                    endpoint: "https://steambox.example"
                ),
            ],
            projects: [
                FeatureProject(
                    id: "project",
                    environmentID: "device",
                    name: "t3code",
                    path: "/work/t3code"
                ),
            ],
            providers: [FeatureProvider(id: "claude", name: "Claude")]
        )

        #expect(thread.homeEnvironmentLabel(in: snapshot) == "steambox")
        #expect(thread.homeProviderLabel(in: snapshot) == "Claude")
    }

    @Test
    func rowContextCarriesHarnessIdentityAndCustomProviderFallback() throws {
        let knownThread = FeatureThread(
            id: "known",
            projectID: "project",
            title: "Use Claude",
            providerID: "work-claude"
        )
        let customThread = FeatureThread(
            id: "custom",
            projectID: "project",
            title: "Use a custom harness",
            providerID: "acme-agent",
            providerName: "Acme Agent"
        )
        let snapshot = FeatureSnapshot(
            projects: [
                FeatureProject(
                    id: "project",
                    environmentID: "device",
                    name: "t3code",
                    path: "/work/t3code"
                ),
            ],
            threads: [knownThread, customThread],
            providers: [
                FeatureProvider(id: "work-claude", name: "Claude Code", driver: "custom"),
                FeatureProvider(id: "acme-agent", name: "Acme Agent", driver: "custom"),
            ]
        )

        let contexts = HomeThreadRowContext.index(snapshot: snapshot)
        let known = try #require(contexts[knownThread.id])
        let custom = try #require(contexts[customThread.id])

        #expect(known.providerID == "work-claude")
        #expect(known.projectEnvironmentID == "device")
        #expect(known.projectWorkspaceRoot == "/work/t3code")
        #expect(known.providerDriver == "custom")
        #expect(known.providerName == "Claude Code")
        #expect(
            ProviderBrand.resolve(
                driver: known.providerDriver,
                providerID: known.providerID,
                providerName: known.providerName
            ) == .claude
        )
        #expect(custom.providerID == "acme-agent")
        #expect(custom.providerDriver == "custom")
        #expect(custom.providerName == "Acme Agent")
        #expect(
            ProviderBrand.resolve(
                driver: custom.providerDriver,
                providerID: custom.providerID,
                providerName: custom.providerName
            ) == nil
        )
    }

    @Test
    func pullRequestRequiresTheStatusToMatchTheThreadBranch() {
        let pullRequest = FeaturePullRequest(
            number: 5178,
            title: "Native SwiftUI client",
            state: "open",
            url: URL(string: "https://github.com/pingdotgg/t3code/pull/5178")
        )
        let thread = FeatureThread(
            id: "thread",
            projectID: "project",
            title: "Build",
            branch: "feature/native-pr-link"
        )

        #expect(HomeThreadPullRequest.related(
            to: thread,
            in: FeatureSourceControlStatus(
                branch: "feature/native-pr-link",
                pullRequest: pullRequest
            )
        ) == pullRequest)
        #expect(HomeThreadPullRequest.related(
            to: thread,
            in: FeatureSourceControlStatus(
                branch: "feature/another-thread",
                pullRequest: pullRequest
            )
        ) == nil)

        for missingBranch in [nil, "", "   "] {
            var missingThreadBranch = thread
            missingThreadBranch.branch = missingBranch
            #expect(HomeThreadPullRequest.related(
                to: missingThreadBranch,
                in: FeatureSourceControlStatus(
                    branch: "feature/native-pr-link",
                    pullRequest: pullRequest
                )
            ) == nil)
        }
        #expect(HomeThreadPullRequest.related(
            to: thread,
            in: FeatureSourceControlStatus(branch: nil, pullRequest: pullRequest)
        ) == nil)
    }

    @Test
    func pullRequestLinksOnlyOpenSafeWebURLs() {
        let safe = FeaturePullRequest(
            number: 42,
            title: "Safe",
            state: "open",
            url: URL(string: "https://github.com/pingdotgg/t3code/pull/42")
        )
        let customScheme = FeaturePullRequest(
            number: 43,
            title: "Unsafe",
            state: "open",
            url: URL(string: "t3code-swiftui://pull/43")
        )
        let credentialed = FeaturePullRequest(
            number: 44,
            title: "Credentialed",
            state: "open",
            url: URL(string: "https://token@example.com/pull/44")
        )
        let plainHTTP = FeaturePullRequest(
            number: 45,
            title: "Local",
            state: "open",
            url: URL(string: "HTTP://127.0.0.1/pull/45")
        )
        let missingURL = FeaturePullRequest(
            number: 46,
            title: "Missing",
            state: "open"
        )

        #expect(safe.shortLabel == "#42")
        #expect(safe.safeExternalURL == safe.url)
        #expect(customScheme.safeExternalURL == nil)
        #expect(credentialed.safeExternalURL == nil)
        #expect(plainHTTP.safeExternalURL == plainHTTP.url)
        #expect(missingURL.safeExternalURL == nil)
    }
}
