import Foundation
import Testing
@testable import T3Code

@Suite("Usage reporting")
struct UsageModelsTests {
    @Test
    func pastDayRequestsTwentyFourMinuteAlignedHourlyBuckets() throws {
        let timeZone = try #require(TimeZone(identifier: "America/Los_Angeles"))
        let now = try #require(
            ISO8601DateFormatter().date(from: "2026-08-18T12:34:56Z")
        )

        let input = UsageWindow.make(days: 1, now: now, timeZone: timeZone)
        let since = try #require(input.sinceTime)
        let until = try #require(input.untilTime)
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let sinceDate = try #require(parser.date(from: since))
        let untilDate = try #require(parser.date(from: until))

        #expect(input.resolution == .hour)
        #expect(untilDate.timeIntervalSince(sinceDate) == 24 * 60 * 60)
        #expect(Calendar.current.component(.second, from: untilDate) == 0)
        #expect(UsageWindow.hours(in: input).count == 24)
    }

    @Test
    func hourlyBucketsMergeAcrossEnvironmentsAndProviders() {
        let hour = "2026-08-18T12:00:00.000Z"
        let first = FeatureEnvironmentUsage(
            environmentID: "a",
            label: "First",
            summary: summary(provider: .codex, costUsd: 2, hourStart: hour),
            errorMessage: nil
        )
        let second = FeatureEnvironmentUsage(
            environmentID: "b",
            label: "Second",
            summary: summary(provider: .claude, costUsd: 3, hourStart: hour),
            errorMessage: nil
        )

        let merged = UsageMerger.merge([first, second])

        #expect(merged.hourly.count == 1)
        #expect(merged.hourly[0].hourStart == hour)
        #expect(merged.hourly[0].costUsd == 5)
        #expect(merged.hourly[0].byProvider[.codex]?.costUsd == 2)
        #expect(merged.hourly[0].byProvider[.claude]?.costUsd == 3)
    }

    @Test
    func mergeDoesNotCountReasoningTokensTwice() {
        let report = FeatureEnvironmentUsage(
            environmentID: "environment-a",
            label: "Studio",
            summary: summary(
                provider: .codex,
                costUsd: 12,
                uncachedInput: 100,
                cachedInput: 200,
                cacheCreation: 30,
                output: 40,
                reasoning: 10
            ),
            errorMessage: nil
        )

        let merged = UsageMerger.merge([report])

        #expect(merged.totalTokens == 370)
        #expect(merged.reasoningTokens == 10)
        #expect(merged.providers.first?.totalTokens == 370)
        #expect(merged.sessions == 1)
    }

    @Test
    func duplicateTranscriptSourcesAreCountedOnce() {
        let first = FeatureEnvironmentUsage(
            environmentID: "a",
            label: "First",
            summary: summary(provider: .codex, costUsd: 10),
            errorMessage: nil
        )
        let duplicate = FeatureEnvironmentUsage(
            environmentID: "b",
            label: "Second",
            summary: summary(provider: .codex, costUsd: 50),
            errorMessage: nil
        )

        let merged = UsageMerger.merge([duplicate, first])

        #expect(merged.costUsd == 10)
        #expect(merged.contributingEnvironments == ["a"])
        #expect(merged.duplicateSources == ["Second: /Users/theo/.codex"])
    }

    @Test
    func healthySourceOwnsFingerprintInsteadOfEarlierFailedSource() {
        let failed = FeatureEnvironmentUsage(
            environmentID: "a",
            label: "Failed",
            summary: summary(provider: .codex, costUsd: 50, sourceStatus: .failed),
            errorMessage: nil
        )
        let healthy = FeatureEnvironmentUsage(
            environmentID: "b",
            label: "Healthy",
            summary: summary(provider: .codex, costUsd: 10),
            errorMessage: nil
        )

        let merged = UsageMerger.merge([failed, healthy])

        #expect(merged.costUsd == 10)
        #expect(merged.contributingEnvironments == ["b"])
        #expect(merged.duplicateSources == ["Failed: /Users/theo/.codex"])
    }

    @Test
    func olderAndNewerContractsAreExcludedWithTheirActualDirection() {
        let current = FeatureEnvironmentUsage(
            environmentID: "current",
            label: "Current",
            summary: summary(provider: .codex, costUsd: 10),
            errorMessage: nil
        )
        let older = FeatureEnvironmentUsage(
            environmentID: "older",
            label: "Older",
            summary: summary(contractVersion: 2, provider: .claude, costUsd: 25),
            errorMessage: nil
        )
        let newer = FeatureEnvironmentUsage(
            environmentID: "newer",
            label: "Newer",
            summary: summary(contractVersion: 5, provider: .claude, costUsd: 50),
            errorMessage: nil
        )

        let merged = UsageMerger.merge([current, older, newer])

        #expect(merged.costUsd == 10)
        #expect(
            merged.contractMismatches.map(\.direction) == [.serverBehind, .clientBehind]
        )
        #expect(
            merged.contractMismatches[0].notice
                == "Older's server is behind this app's usage format and is excluded from totals."
        )
        #expect(
            merged.contractMismatches[1].notice
                == "This app is behind Newer's usage format, so that environment is excluded from totals."
        )
    }

    @Test
    func mixedConnectionStatesMergeOnlyCompatibleUniqueSources() {
        let local = FeatureEnvironmentUsage(
            environmentID: "a-local",
            label: "Local",
            summary: summary(provider: .codex, costUsd: 10),
            errorMessage: nil
        )
        let lanDuplicate = FeatureEnvironmentUsage(
            environmentID: "b-lan",
            label: "LAN",
            summary: summary(
                contractVersion: minimumCompatibleUsageContractVersion,
                provider: .codex,
                costUsd: 99
            ),
            errorMessage: nil
        )
        let relay = FeatureEnvironmentUsage(
            environmentID: "c-relay",
            label: "Relay",
            summary: summary(provider: .claude, costUsd: 20),
            errorMessage: nil
        )
        let tunnelNewer = FeatureEnvironmentUsage(
            environmentID: "d-tunnel",
            label: "Tunnel",
            summary: summary(contractVersion: 5, provider: .claude, costUsd: 50),
            errorMessage: nil
        )
        let older = FeatureEnvironmentUsage(
            environmentID: "e-older",
            label: "Older",
            summary: summary(contractVersion: 2, provider: .claude, costUsd: 25),
            errorMessage: nil
        )
        let offline = FeatureEnvironmentUsage(
            environmentID: "f-offline",
            label: "Offline",
            summary: nil,
            errorMessage: "This environment could not report usage."
        )
        let failed = FeatureEnvironmentUsage(
            environmentID: "g-failed",
            label: "Failed",
            summary: nil,
            errorMessage: "This environment could not report usage."
        )

        let merged = UsageMerger.merge([
            local,
            lanDuplicate,
            relay,
            tunnelNewer,
            older,
            offline,
            failed,
        ])

        #expect(merged.costUsd == 30)
        #expect(merged.contributingEnvironments == ["a-local", "c-relay"])
        #expect(merged.duplicateSources == ["LAN: /Users/theo/.codex"])
        #expect(
            merged.contractMismatches.map(\.direction) == [.clientBehind, .serverBehind]
        )
    }

    @Test
    func calendarWindowStaysInclusiveAcrossDaylightSavingTime() throws {
        let timeZone = try #require(TimeZone(identifier: "America/Los_Angeles"))
        let now = try #require(
            ISO8601DateFormatter().date(from: "2024-03-10T19:00:00Z")
        )

        let window = UsageWindow.make(days: 7, now: now, timeZone: timeZone)

        #expect(window.sinceDay == "2024-03-04")
        #expect(window.untilDay == "2024-03-10")
        #expect(UsageWindow.days(in: window).count == 7)
    }

    @Test
    func refreshRecomputesTheSelectedWindowAfterMidnight() throws {
        let timeZone = try #require(TimeZone(identifier: "Australia/Sydney"))
        let beforeMidnight = try #require(
            ISO8601DateFormatter().date(from: "2026-08-10T13:59:00Z")
        )
        let afterMidnight = try #require(
            ISO8601DateFormatter().date(from: "2026-08-10T14:01:00Z")
        )
        var state = UsageLoadState(days: 30, now: beforeMidnight, timeZone: timeZone)
        let initial = state.begin(days: 30, now: beforeMidnight, timeZone: timeZone)
        let previous = FeatureEnvironmentUsage(
            environmentID: "current",
            label: "Current",
            summary: summary(provider: .codex, costUsd: 10),
            errorMessage: nil
        )
        let receivedInitial = state.receive([previous], for: initial)
        #expect(receivedInitial)

        let refresh = state.begin(days: 30, now: afterMidnight, timeZone: timeZone)

        #expect(refresh.input.untilDay == "2026-08-11")
        #expect(refresh.input.sinceDay == "2026-07-13")
        #expect(state.windowInput.untilDay == "2026-08-10")
        #expect(state.merged.costUsd == 10)

        let current = FeatureEnvironmentUsage(
            environmentID: "current",
            label: "Current",
            summary: summary(provider: .codex, costUsd: 11),
            errorMessage: nil
        )
        let receivedRefresh = state.receive([current], for: refresh)
        #expect(receivedRefresh)
        #expect(state.windowInput.untilDay == "2026-08-11")
        #expect(state.merged.costUsd == 11)
    }

    @Test(arguments: [7, 30, 90])
    func refreshAndRetryRecomputeEveryWindowLength(days: Int) throws {
        let timeZone = try #require(TimeZone(identifier: "Australia/Sydney"))
        let firstDay = try #require(
            ISO8601DateFormatter().date(from: "2026-08-10T12:00:00Z")
        )
        let nextDay = try #require(
            ISO8601DateFormatter().date(from: "2026-08-11T12:00:00Z")
        )
        var state = UsageLoadState(days: 30, now: firstDay, timeZone: timeZone)

        let refresh = state.begin(days: days, now: firstDay, timeZone: timeZone)
        #expect(UsageWindow.days(in: refresh.input).count == days)
        let recordedRefreshFailure = state.fail(TestUsageError.unavailable, for: refresh)
        #expect(recordedRefreshFailure)

        let retry = state.begin(days: days, now: nextDay, timeZone: timeZone)
        #expect(UsageWindow.days(in: retry.input).count == days)
        #expect(retry.input.untilDay == "2026-08-11")
        #expect(state.errorMessage == nil)
    }

    @Test
    func failedRefreshKeepsTheLastTruthfulTotalsAndWindow() throws {
        let timeZone = try #require(TimeZone(identifier: "Australia/Sydney"))
        let now = try #require(
            ISO8601DateFormatter().date(from: "2026-08-10T12:00:00Z")
        )
        var state = UsageLoadState(days: 30, now: now, timeZone: timeZone)
        let initial = state.begin(days: 30, now: now, timeZone: timeZone)
        let previous = FeatureEnvironmentUsage(
            environmentID: "current",
            label: "Current",
            summary: summary(provider: .codex, costUsd: 10),
            errorMessage: nil
        )
        let receivedInitial = state.receive([previous], for: initial)
        #expect(receivedInitial)
        let truthfulWindow = state.windowInput

        let refresh = state.begin(days: 30, now: now, timeZone: timeZone)
        let recordedRefreshFailure = state.fail(TestUsageError.unavailable, for: refresh)
        #expect(recordedRefreshFailure)

        #expect(state.windowInput == truthfulWindow)
        #expect(state.environments == [previous])
        #expect(state.merged.costUsd == 10)
        #expect(state.errorMessage != nil)
    }

    @Test
    func staleOrCancelledLoadCannotOverwriteTheNewestLoad() throws {
        let timeZone = try #require(TimeZone(identifier: "Australia/Sydney"))
        let now = try #require(
            ISO8601DateFormatter().date(from: "2026-08-10T12:00:00Z")
        )
        var state = UsageLoadState(days: 30, now: now, timeZone: timeZone)
        let stale = state.begin(days: 30, now: now, timeZone: timeZone)
        let previous = FeatureEnvironmentUsage(
            environmentID: "previous",
            label: "Previous",
            summary: summary(provider: .codex, costUsd: 30),
            errorMessage: nil
        )
        let receivedPrevious = state.receive([previous], for: stale)
        #expect(receivedPrevious)
        state.selectWindow(days: 7, now: now, timeZone: timeZone)
        #expect(state.environments.isEmpty)
        #expect(state.merged == MergedUsage())
        #expect(state.errorMessage == nil)
        #expect(state.isLoading)
        #expect(UsageWindow.days(in: state.windowInput).count == 7)
        let staleResult = FeatureEnvironmentUsage(
            environmentID: "stale",
            label: "Stale",
            summary: summary(provider: .codex, costUsd: 99),
            errorMessage: nil
        )
        let currentResult = FeatureEnvironmentUsage(
            environmentID: "current",
            label: "Current",
            summary: summary(provider: .codex, costUsd: 7),
            errorMessage: nil
        )

        let receivedStale = state.receive([staleResult], for: stale)
        #expect(!receivedStale)
        let recordedStaleFailure = state.fail(TestUsageError.unavailable, for: stale)
        #expect(!recordedStaleFailure)
        #expect(state.errorMessage == nil)
        state.finish(stale)
        #expect(state.isLoading)

        let current = state.begin(days: 7, now: now, timeZone: timeZone)
        let receivedCurrent = state.receive([currentResult], for: current)
        #expect(receivedCurrent)
        state.finish(current)

        #expect(!state.isLoading)
        #expect(state.environments == [currentResult])
        #expect(state.merged.costUsd == 7)
        #expect(UsageWindow.days(in: state.windowInput).count == 7)
    }

    @Test
    func sameWindowOverlapOnlyLetsTheNewestLoadCommitOrFinish() throws {
        let timeZone = try #require(TimeZone(identifier: "Australia/Sydney"))
        let now = try #require(
            ISO8601DateFormatter().date(from: "2026-08-10T12:00:00Z")
        )
        var state = UsageLoadState(days: 30, now: now, timeZone: timeZone)
        let superseded = state.begin(days: 30, now: now, timeZone: timeZone)
        let current = state.begin(days: 30, now: now, timeZone: timeZone)
        let result = FeatureEnvironmentUsage(
            environmentID: "current",
            label: "Current",
            summary: summary(provider: .codex, costUsd: 30),
            errorMessage: nil
        )

        let receivedSuperseded = state.receive([result], for: superseded)
        #expect(!receivedSuperseded)
        let recordedSupersededFailure = state.fail(
            TestUsageError.unavailable,
            for: superseded
        )
        #expect(!recordedSupersededFailure)
        state.finish(superseded)
        #expect(state.isLoading)

        let receivedCurrent = state.receive([result], for: current)
        #expect(receivedCurrent)
        state.finish(current)
        #expect(!state.isLoading)
        #expect(state.environments == [result])
    }

    @Test
    func partialEnvironmentFailureRemainsVisibleBesideTruthfulTotals() throws {
        let timeZone = try #require(TimeZone(identifier: "Australia/Sydney"))
        let now = try #require(
            ISO8601DateFormatter().date(from: "2026-08-10T12:00:00Z")
        )
        var state = UsageLoadState(days: 30, now: now, timeZone: timeZone)
        let request = state.begin(days: 30, now: now, timeZone: timeZone)
        let available = FeatureEnvironmentUsage(
            environmentID: "available",
            label: "Available",
            summary: summary(provider: .codex, costUsd: 10),
            errorMessage: nil
        )
        let unavailable = FeatureEnvironmentUsage(
            environmentID: "unavailable",
            label: "Unavailable",
            summary: nil,
            errorMessage: "This environment could not report usage."
        )

        let receivedPartial = state.receive([available, unavailable], for: request)
        #expect(receivedPartial)

        #expect(state.merged.costUsd == 10)
        #expect(state.environments.filter { $0.errorMessage != nil } == [unavailable])
        #expect(state.errorMessage == nil)
    }

    @Test
    func rollingServerVersionsLoadWhenAnotherEnvironmentIsOffline() throws {
        let timeZone = try #require(TimeZone(identifier: "America/Los_Angeles"))
        let now = try #require(
            ISO8601DateFormatter().date(from: "2026-08-18T12:00:00Z")
        )
        var state = UsageLoadState(days: 30, now: now, timeZone: timeZone)
        let request = state.begin(days: 30, now: now, timeZone: timeZone)
        let currentServer = FeatureEnvironmentUsage(
            environmentID: "current-server",
            label: "Current server",
            summary: summary(
                contractVersion: usageContractVersion,
                provider: .codex,
                costUsd: 10
            ),
            errorMessage: nil
        )
        let previousServer = FeatureEnvironmentUsage(
            environmentID: "previous-server",
            label: "Previous server",
            summary: summary(
                contractVersion: minimumCompatibleUsageContractVersion,
                provider: .claude,
                costUsd: 20
            ),
            errorMessage: nil
        )
        let offlineServer = FeatureEnvironmentUsage(
            environmentID: "offline-server",
            label: "Offline server",
            summary: nil,
            errorMessage: "This environment could not report usage."
        )

        let received = state.receive(
            [currentServer, previousServer, offlineServer],
            for: request
        )
        #expect(received)

        #expect(state.merged.costUsd == 30)
        #expect(
            state.merged.contributingEnvironments == ["current-server", "previous-server"]
        )
        #expect(state.merged.contractMismatches.isEmpty)
        #expect(state.environments.filter { $0.errorMessage != nil } == [offlineServer])
    }

    @Test
    func reconnectReplacesVersionWarningWithCurrentTotals() throws {
        let timeZone = try #require(TimeZone(identifier: "Australia/Sydney"))
        let now = try #require(
            ISO8601DateFormatter().date(from: "2026-08-18T12:00:00Z")
        )
        var state = UsageLoadState(days: 30, now: now, timeZone: timeZone)
        let mismatchedRequest = state.begin(days: 30, now: now, timeZone: timeZone)
        let newer = FeatureEnvironmentUsage(
            environmentID: "environment",
            label: "Studio",
            summary: summary(contractVersion: 5, provider: .codex, costUsd: 50),
            errorMessage: nil
        )
        let receivedNewer = state.receive([newer], for: mismatchedRequest)
        #expect(receivedNewer)
        #expect(state.merged.costUsd == 0)
        #expect(state.merged.contractMismatches.map(\.direction) == [.clientBehind])

        let currentRequest = state.begin(days: 30, now: now, timeZone: timeZone)
        let current = FeatureEnvironmentUsage(
            environmentID: "environment",
            label: "Studio",
            summary: summary(provider: .codex, costUsd: 12),
            errorMessage: nil
        )
        let receivedCurrent = state.receive([current], for: currentRequest)
        #expect(receivedCurrent)
        #expect(state.merged.costUsd == 12)
        #expect(state.merged.contractMismatches.isEmpty)
    }

    @Test
    func changingRangeClearsVersionWarningAndZeroSummary() throws {
        let timeZone = try #require(TimeZone(identifier: "Australia/Sydney"))
        let now = try #require(
            ISO8601DateFormatter().date(from: "2026-08-18T12:00:00Z")
        )
        var state = UsageLoadState(days: 30, now: now, timeZone: timeZone)
        let request = state.begin(days: 30, now: now, timeZone: timeZone)
        let older = FeatureEnvironmentUsage(
            environmentID: "environment",
            label: "Studio",
            summary: summary(contractVersion: 2, provider: .codex, costUsd: 50),
            errorMessage: nil
        )
        let receivedOlder = state.receive([older], for: request)
        #expect(receivedOlder)
        #expect(state.merged.contractMismatches.map(\.direction) == [.serverBehind])

        state.selectWindow(days: 1, now: now, timeZone: timeZone)

        #expect(state.environments.isEmpty)
        #expect(state.merged == MergedUsage())
        #expect(state.windowInput.resolution == .hour)
    }

    @Test
    func timezoneRefreshRecomputesCompatibilityAndClearsWarning() throws {
        let utc = try #require(TimeZone(identifier: "UTC"))
        let sydney = try #require(TimeZone(identifier: "Australia/Sydney"))
        let now = try #require(
            ISO8601DateFormatter().date(from: "2026-08-18T15:00:00Z")
        )
        var state = UsageLoadState(days: 30, now: now, timeZone: utc)
        let oldZoneRequest = state.begin(days: 30, now: now, timeZone: utc)
        let newer = FeatureEnvironmentUsage(
            environmentID: "environment",
            label: "Studio",
            summary: summary(contractVersion: 5, provider: .codex, costUsd: 50),
            errorMessage: nil
        )
        let receivedNewer = state.receive([newer], for: oldZoneRequest)
        #expect(receivedNewer)
        #expect(state.merged.contractMismatches.map(\.direction) == [.clientBehind])

        let newZoneRequest = state.begin(days: 30, now: now, timeZone: sydney)
        let current = FeatureEnvironmentUsage(
            environmentID: "environment",
            label: "Studio",
            summary: summary(provider: .codex, costUsd: 12),
            errorMessage: nil
        )
        let receivedCurrent = state.receive([current], for: newZoneRequest)
        #expect(receivedCurrent)
        #expect(state.windowInput.timeZone == "Australia/Sydney")
        #expect(state.windowInput.untilDay == "2026-08-19")
        #expect(state.merged.costUsd == 12)
        #expect(state.merged.contractMismatches.isEmpty)
    }

    private func summary(
        contractVersion: Int = usageContractVersion,
        provider: UsageProviderKind,
        costUsd: Double,
        uncachedInput: Int = 100,
        cachedInput: Int = 0,
        cacheCreation: Int = 0,
        output: Int = 20,
        reasoning: Int = 0,
        sourceStatus: UsageSourceStatus = .ok,
        hourStart: String? = nil
    ) -> UsageSummary {
        let path = provider == .codex ? "/Users/theo/.codex" : "/Users/theo/.claude"
        return UsageSummary(
            contractVersion: contractVersion,
            readAt: "2026-08-09T12:00:00.000Z",
            timeZone: "America/Los_Angeles",
            sinceDay: "2026-08-03",
            untilDay: "2026-08-09",
            buckets: [
                UsageBucket(
                    day: "2026-08-09",
                    hourStart: hourStart,
                    provider: provider,
                    model: provider == .codex ? "gpt-5.6-sol" : "claude-opus-4-1",
                    totals: UsageTokenTotals(
                        uncachedInputTokens: uncachedInput,
                        cachedInputTokens: cachedInput,
                        cacheCreationTokens: cacheCreation,
                        outputTokens: output,
                        reasoningTokens: reasoning
                    ),
                    costUsd: costUsd,
                    cacheSavingsUsd: 0,
                    costSource: .modelPriced,
                    records: 1,
                    unpricedRecords: 0,
                    sessions: 1
                ),
            ],
            sources: [
                UsageSource(
                    fingerprint: UsageSourceFingerprint(
                        hostId: "host",
                        provider: provider,
                        resolvedHomePath: path,
                        volumeId: "1:2"
                    ),
                    status: sourceStatus,
                    scannedFiles: 1,
                    skippedFiles: 0,
                    malformedRecords: 0,
                    distinctSessions: 1,
                    message: nil
                ),
            ],
            pricing: UsagePricing(
                status: .fresh,
                source: "LiteLLM",
                fetchedAt: nil,
                knownModels: 1
            ),
            scanDurationMs: 1
        )
    }
}

private enum TestUsageError: Error {
    case unavailable
}
