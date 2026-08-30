import Foundation
import Testing
@testable import T3Code

@MainActor
struct PullRequestDetailRefreshTests {
    @Test
    func publishesChangedDetailAndActivityOnAutomaticRefresh() async throws {
        let client = PullRequestDetailRefreshClient(
            details: [
                try detail(title: "Waiting for checks", check: .pending),
                try detail(title: "Checks passed", check: .success),
            ],
            activities: [try activity(commit: "first"), try activity(commit: "second")],
        )
        let model = PullRequestDetailModel(client: client, target: target)
        let refreshes = AsyncStream<Void>.makeStream()
        var refreshIterator = client.completedRefreshes.makeAsyncIterator()
        let observation = Task { await model.observe(refreshes: refreshes.stream) }

        #expect(await refreshIterator.next() == 1)
        #expect(model.detail?.title == "Waiting for checks")
        #expect(model.activity?.commits.first?.oid == "first")

        refreshes.continuation.yield()
        #expect(await refreshIterator.next() == 2)
        #expect(model.detail?.title == "Checks passed")
        #expect(model.detail?.checks.first?.status == .success)
        #expect(model.activity?.commits.first?.oid == "second")

        observation.cancel()
        await observation.value
    }

    @Test
    func cancellationStopsObservationAfterDismissal() async throws {
        let client = PullRequestDetailRefreshClient(
            details: [try detail(title: "Visible", check: .pending)],
            activities: [try activity(commit: "visible")],
        )
        let model = PullRequestDetailModel(client: client, target: target)
        let refreshes = AsyncStream<Void>.makeStream()
        var refreshIterator = client.completedRefreshes.makeAsyncIterator()
        let observation = Task { await model.observe(refreshes: refreshes.stream) }

        #expect(await refreshIterator.next() == 1)
        observation.cancel()
        await observation.value
        refreshes.continuation.yield()

        #expect(client.detailCallCount == 1)
    }

    @Test
    func manualRefreshInvalidatesThenUsesTheTypedProjection() async throws {
        let client = PullRequestDetailRefreshClient(
            details: [try detail(title: "Fresh", check: .success)],
            activities: [try activity(commit: "fresh")],
        )
        let model = PullRequestDetailModel(client: client, target: target)

        await model.load(invalidate: true)

        #expect(client.invalidatedTargets == [target])
        #expect(model.detail?.title == "Fresh")
        #expect(model.activity?.commits.first?.oid == "fresh")
    }

    private var target: FeaturePullRequestTarget {
        FeaturePullRequestTarget(
            environmentID: "environment",
            environmentName: "Test",
            reference: PullRequestRef(projectId: "project", repository: "acme/web", number: 85)
        )
    }

    private func detail(title: String, check: PullRequestCheckStatus) throws -> PullRequestDetail {
        try JSONDecoder.t3.decode(
            PullRequestDetail.self,
            from: Data(
                #"{"provider":"github","capabilities":{"diff":true,"comment":true,"actions":[],"mergeMethods":[],"search":true,"reactions":true,"review":{"inlineComment":true,"reply":true,"resolve":true,"verdicts":[]},"reviewers":{"request":true,"listCandidates":true},"edit":{"changeRequest":true,"comment":true}},"viewerPermissions":{"actions":[],"comment":true,"resolve":true,"verdicts":[],"requestReviewers":true},"projectId":"project","projectTitle":"Web","workspaceRoot":"/tmp/web","repository":"acme/web","number":85,"title":"\#(title)","body":"","url":"https://github.com/acme/web/pull/85","author":null,"state":"open","isDraft":false,"mergeability":"mergeable","additions":2,"deletions":1,"changedFiles":1,"headBranch":"feature","baseBranch":"main","createdAt":"2026-08-30T00:00:00Z","updatedAt":"2026-08-30T00:00:01Z","mergedAt":null,"closedAt":null,"reviewers":[],"labels":[],"checks":[{"name":"test","status":"\#(check.rawValue)","description":null,"url":null}],"mergeCapabilities":{"merge":true,"squash":true,"rebase":true}}"#.utf8
            )
        )
    }

    private func activity(commit: String) throws -> PullRequestActivity {
        try JSONDecoder.t3.decode(
            PullRequestActivity.self,
            from: Data(
                #"{"comments":[],"commentCount":0,"commentsTruncated":false,"reviewThreads":[],"commits":[{"oid":"\#(commit)","messageHeadline":"\#(commit)","committedDate":"2026-08-30T00:00:00Z","additions":1,"deletions":0,"authors":[]}]}"#.utf8
            )
        )
    }
}

@MainActor
private final class PullRequestDetailRefreshClient: FeatureClient {
    private var details: [PullRequestDetail]
    private var activities: [PullRequestActivity]
    private let completedRefreshContinuation: AsyncStream<Int>.Continuation
    let completedRefreshes: AsyncStream<Int>
    var detailCallCount = 0
    var invalidatedTargets: [FeaturePullRequestTarget] = []

    init(details: [PullRequestDetail], activities: [PullRequestActivity]) {
        self.details = details
        self.activities = activities
        let refreshes = AsyncStream<Int>.makeStream()
        completedRefreshes = refreshes.stream
        completedRefreshContinuation = refreshes.continuation
    }

    func pullRequestDetail(_ target: FeaturePullRequestTarget) async throws -> PullRequestDetail {
        detailCallCount += 1
        return details.removeFirst()
    }

    func pullRequestActivity(_ target: FeaturePullRequestTarget) async throws -> PullRequestActivity {
        let activity = activities.removeFirst()
        completedRefreshContinuation.yield(detailCallCount)
        return activity
    }

    func invalidatePullRequests(_ target: FeaturePullRequestTarget?) async throws {
        if let target { invalidatedTargets.append(target) }
    }

    func initialSnapshot() async throws -> FeatureSnapshot { FeatureSnapshot() }
    func pair(endpoint: String, token: String?) async throws {}
    func createThread(
        projectID: String,
        title: String?,
        selection: FeatureSelection?
    ) async throws -> FeatureThread {
        FeatureThread(id: "created", projectID: projectID, title: title ?? "Created")
    }
    func renameThread(id: String, title: String) async throws {}
    func setThreadArchived(id: String, archived: Bool) async throws {}
    func deleteThread(id: String) async throws {}
    func loadThread(id: String) async throws -> FeatureThreadDetail {
        FeatureThreadDetail(thread: FeatureThread(id: id, projectID: "project", title: "Task"))
    }
    func sendMessage(threadID: String, text: String, selection: FeatureSelection?) async throws {}
    func cancelTurn(threadID: String) async throws {}
    func resolveApproval(id: String, decision: FeatureApprovalDecision) async throws {}
    func saveSettings(_ settings: FeatureSettings) async throws {}
}
