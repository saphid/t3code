import Testing
@testable import T3Code

private enum ClientStorageTestError: Error {
    case unavailable
}

@MainActor
private final class ClientStorageStub: FeatureClientStorageManaging {
    var summaryResults: [Result<FeatureClientCache.Summary, Error>]
    var clearResults: [Result<Void, Error>]
    var onClear: (() async -> Void)?
    private(set) var clearedScopes: [FeatureClientCache.Scope] = []

    init(
        summaryResults: [Result<FeatureClientCache.Summary, Error>],
        clearResults: [Result<Void, Error>] = [.success(())]
    ) {
        self.summaryResults = summaryResults
        self.clearResults = clearResults
    }

    func clientCacheSummary() async throws -> FeatureClientCache.Summary {
        try summaryResults.removeFirst().get()
    }

    func clearClientCache(_ scope: FeatureClientCache.Scope) async throws {
        clearedScopes.append(scope)
        await onClear?()
        try clearResults.removeFirst().get()
    }
}

@Suite("Client storage")
@MainActor
struct ClientStorageTests {
    @Test
    func summaryAggregatesCountsAndPayloadSizesByEnvironment() throws {
        let summary = FeatureClientCache.Summary(records: [
            .init(
                environmentID: "beta",
                kind: .branches,
                payloadBytes: 25
            ),
            .init(
                environmentID: "alpha",
                kind: .threads,
                recordCount: 2,
                payloadBytes: 100
            ),
            .init(
                environmentID: "alpha",
                kind: .serverMetadata,
                payloadBytes: 50
            ),
        ])

        #expect(summary.recordCount == 4)
        #expect(summary.payloadBytes == 175)
        #expect(summary.environments.map(\.environmentID) == ["alpha", "beta"])

        let alpha = try #require(summary.environments.first)
        #expect(alpha.recordCount == 3)
        #expect(alpha.payloadBytes == 150)
        #expect(alpha.countsByKind == [.threads: 2, .serverMetadata: 1])
    }

    @Test
    func byteSizesStayReadableAtUnitBoundaries() {
        #expect(ClientStorageView.formatBytes(512) == "512 B")
        #expect(ClientStorageView.formatBytes(1_536) == "1.5 KB")
        #expect(ClientStorageView.formatBytes(20_480) == "20 KB")
        #expect(ClientStorageView.formatBytes(1_572_864) == "1.5 MB")
    }

    @Test
    func scopedAndAllDeletionResolveOnlyTheirIntendedEnvironments() {
        let cached: Set<String> = ["alpha", "beta"]

        #expect(
            FeatureClientCache.environmentIDs(
                for: .environment("beta"),
                among: cached
            ) == ["beta"]
        )
        #expect(
            FeatureClientCache.environmentIDs(for: .all, among: cached)
                == ["alpha", "beta"]
        )
    }

    @Test
    func refreshFailureKeepsTheLastValidSummaryVisible() async {
        let summary = FeatureClientCache.Summary(records: [
            .init(environmentID: "alpha", kind: .threads, payloadBytes: 42),
        ])
        let storage = ClientStorageStub(summaryResults: [
            .success(summary),
            .failure(ClientStorageTestError.unavailable),
        ])
        let model = ClientStorageViewModel(storage: storage)

        await model.load()
        #expect(model.summary == summary)

        await model.load()
        #expect(model.summary == summary)
        #expect(model.errorMessage == "Cached data could not be refreshed. Try again.")
    }

    @Test
    func clearReportsProgressAndPublishesTheReloadedSummary() async {
        let populated = FeatureClientCache.Summary(records: [
            .init(environmentID: "alpha", kind: .threads, payloadBytes: 42),
        ])
        let empty = FeatureClientCache.Summary(records: [])
        let started = AsyncStream<Void>.makeStream()
        let resumed = AsyncStream<Void>.makeStream()
        let storage = ClientStorageStub(summaryResults: [
            .success(populated),
            .success(empty),
        ])
        storage.onClear = {
            started.continuation.yield()
            var iterator = resumed.stream.makeAsyncIterator()
            _ = await iterator.next()
        }
        let model = ClientStorageViewModel(storage: storage)
        await model.load()

        let clearTask = Task { await model.clear(.all) }
        var startedIterator = started.stream.makeAsyncIterator()
        _ = await startedIterator.next()
        #expect(model.clearingScope == .all)
        #expect(model.summary == populated)

        resumed.continuation.yield()
        await clearTask.value
        #expect(model.clearingScope == nil)
        #expect(model.summary == empty)
        #expect(storage.clearedScopes == [.all])
    }

    @Test
    func clearFailureRetainsTheLastValidSummaryAndReportsTheFailure() async {
        let summary = FeatureClientCache.Summary(records: [
            .init(environmentID: "alpha", kind: .threads, payloadBytes: 42),
        ])
        let storage = ClientStorageStub(
            summaryResults: [.success(summary)],
            clearResults: [.failure(ClientStorageTestError.unavailable)]
        )
        let model = ClientStorageViewModel(storage: storage)
        await model.load()

        await model.clear(.environment("alpha"))

        #expect(model.summary == summary)
        #expect(model.clearingScope == nil)
        #expect(model.errorMessage == "Client cache could not be cleared. Try again.")
    }

    @Test
    func successfulClearWithFailedReloadDoesNotShowTheOldSummary() async {
        let summary = FeatureClientCache.Summary(records: [
            .init(environmentID: "alpha", kind: .threads, payloadBytes: 42),
        ])
        let storage = ClientStorageStub(summaryResults: [
            .success(summary),
            .failure(ClientStorageTestError.unavailable),
        ])
        let model = ClientStorageViewModel(storage: storage)
        await model.load()

        await model.clear(.all)

        #expect(model.state == .unavailable)
        #expect(model.summary == nil)
        #expect(
            model.errorMessage
                == "The cache was cleared, but remaining cached data could not be refreshed. Try again."
        )
    }
}
