import Testing
@testable import T3Code

private enum ClientStorageTestError: Error {
    case unavailable
}

@MainActor
private final class ClientStorageStub: FeatureClientStorageManaging {
    var summaryResults: [Result<FeatureClientCache.Summary, Error>]

    init(summaryResults: [Result<FeatureClientCache.Summary, Error>]) {
        self.summaryResults = summaryResults
    }

    func clientCacheSummary() async throws -> FeatureClientCache.Summary {
        try summaryResults.removeFirst().get()
    }

    func clearClientCache(_ scope: FeatureClientCache.Scope) async throws {}
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
}
