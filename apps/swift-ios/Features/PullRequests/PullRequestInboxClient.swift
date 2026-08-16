import Foundation

/// Read-only dependency surface for the inbox candidate. Diff and mutation APIs are
/// deliberately absent so this feature cannot cross into later #94 slices.
@MainActor
struct PullRequestInboxClient {
    var list: @MainActor @Sendable (String, PullRequestListInput) async throws -> PullRequestListResult
    var stats: @MainActor @Sendable (String, PullRequestListStatsInput) async throws -> PullRequestListStatsResult
    var detail: @MainActor @Sendable (String, PullRequestRef) async throws -> PullRequestDetail
    var activity: @MainActor @Sendable (String, PullRequestRef) async throws -> PullRequestActivity

    init(client: any FeatureClient) {
        list = { environmentID, input in
            try await client.pullRequestsList(environmentID: environmentID, input: input)
        }
        stats = { environmentID, input in
            try await client.pullRequestsListStats(environmentID: environmentID, input: input)
        }
        detail = { environmentID, reference in
            try await client.pullRequestDetail(environmentID: environmentID, reference: reference)
        }
        activity = { environmentID, reference in
            try await client.pullRequestActivity(environmentID: environmentID, reference: reference)
        }
    }

    init(
        list: @escaping @MainActor @Sendable (String, PullRequestListInput) async throws -> PullRequestListResult,
        stats: @escaping @MainActor @Sendable (String, PullRequestListStatsInput) async throws -> PullRequestListStatsResult,
        detail: @escaping @MainActor @Sendable (String, PullRequestRef) async throws -> PullRequestDetail,
        activity: @escaping @MainActor @Sendable (String, PullRequestRef) async throws -> PullRequestActivity
    ) {
        self.list = list
        self.stats = stats
        self.detail = detail
        self.activity = activity
    }
}
