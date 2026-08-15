import Foundation
import Testing
@testable import T3Code

@MainActor
@Suite("Pull-request inbox")
struct PullRequestInboxModelTests {
    @Test
    func capabilityIsTriStateAndUnknownNeverProbes() async {
        var listCalls = 0
        let client = Self.client(list: { _, _ in
            listCalls += 1
            return Self.page()
        })
        let unknown = PullRequestInboxModel(
            scope: .init(environment: Self.environment(capability: nil, known: false)),
            client: client
        )
        let unavailable = PullRequestInboxModel.Scope(
            environment: Self.environment(capability: false, known: true)
        )
        let available = PullRequestInboxModel.Scope(
            environment: Self.environment(capability: true, known: true)
        )
        let unavailableModel = PullRequestInboxModel(
            scope: unavailable,
            client: client
        )

        await unknown.load()
        await unavailableModel.load()

        #expect(unknown.scope.capability == .unknown)
        #expect(unavailable.capability == .unavailable)
        #expect(available.capability == .available)
        #expect(listCalls == 0)
    }

    @Test
    func listStaysInOneEnvironmentAndCarriesFilters() async throws {
        var capturedEnvironment: String?
        var capturedInput: PullRequestListInput?
        var statsEnvironment: String?
        let entry = Self.entry(number: 42)
        let model = Self.model(
            client: Self.client(
                list: { environment, input in
                    capturedEnvironment = environment
                    capturedInput = input
                    return Self.page(entries: [entry])
                },
                stats: { environment, _ in
                    statsEnvironment = environment
                    return .init(stats: [Self.stat(number: 42)])
                }
            )
        )
        model.state = .merged
        model.involvement = .reviewing
        model.selectedProjectID = "project-a"
        model.selectedHost = "github.example.com"
        model.query = "release"

        await model.load()

        let input = try #require(capturedInput)
        #expect(capturedEnvironment == "environment-a")
        #expect(statsEnvironment == "environment-a")
        #expect(input.state == .merged)
        #expect(input.involvement == .reviewing)
        #expect(input.projectId == "project-a")
        #expect(input.host == "github.example.com")
        #expect(input.query == "release")
        #expect(model.entries.first?.id == "github.example.com org/repo#42")
        #expect(model.stat(for: entry)?.additions == 12)
    }

    @Test
    func initialAutomaticLoadFinishesAfterItsViewTaskIsCancelled() async {
        let gate = DetailGate()
        var listCalls = 0
        let model = Self.model(
            client: Self.client(list: { _, _ in
                listCalls += 1
                await gate.wait()
                try Task.checkCancellation()
                return Self.page(entries: [Self.entry(number: 42)])
            })
        )

        let automaticLoad = Task {
            await model.loadForCurrentFilterIfNeeded()
        }
        await gate.waitUntilEntered()
        #expect(model.isLoading)
        automaticLoad.cancel()
        gate.release()
        await automaticLoad.value

        #expect(listCalls == 1)
        #expect(model.entries.map(\.number) == [42])
        #expect(model.isLoading == false)
    }

    @Test
    func paginationUsesHostCursorsAndNeverDuplicatesRows() async throws {
        var inputs: [PullRequestListInput] = []
        let model = Self.model(
            client: Self.client(list: { _, input in
                inputs.append(input)
                if inputs.count == 1 {
                    return Self.page(
                        entries: [Self.entry(number: 1), Self.entry(number: 2)],
                        truncated: true,
                        nextCursors: ["github.example.com": "cursor-2"]
                    )
                }
                return Self.page(entries: [Self.entry(number: 2), Self.entry(number: 3)])
            })
        )

        await model.load()
        await model.load(reset: false)

        #expect(model.entries.map(\.number) == [1, 2, 3])
        #expect(inputs.count == 2)
        #expect(inputs[1].cursors == ["github.example.com": "cursor-2"])
    }

    @Test
    func successfulPaginationRetryClearsThePreviousError() async {
        var calls = 0
        let model = Self.model(
            client: Self.client(list: { _, _ in
                calls += 1
                switch calls {
                case 1:
                    return Self.page(
                        entries: [Self.entry(number: 1)],
                        truncated: true,
                        nextCursors: ["github.example.com": "cursor-2"]
                    )
                case 2:
                    throw TestFailure.list
                default:
                    return Self.page(entries: [Self.entry(number: 2)])
                }
            })
        )

        await model.load()
        await model.load(reset: false)
        #expect(model.listError != nil)

        await model.load(reset: false)

        #expect(model.listError == nil)
        #expect(model.entries.map(\.number) == [1, 2])
    }

    @Test
    func rejectedSecondPaginationRequestDoesNotOrphanTheFirst() async {
        let gate = DetailGate()
        var calls = 0
        let model = Self.model(
            client: Self.client(list: { _, _ in
                calls += 1
                if calls == 1 {
                    return Self.page(
                        entries: [Self.entry(number: 1)],
                        truncated: true,
                        nextCursors: ["github.example.com": "cursor-2"]
                    )
                }
                await gate.wait()
                return Self.page(entries: [Self.entry(number: 2)])
            })
        )

        await model.load()
        let firstPagination = Task { await model.load(reset: false) }
        await gate.waitUntilEntered()
        await model.load(reset: false)
        gate.release()
        await firstPagination.value

        #expect(calls == 2)
        #expect(model.entries.map(\.number) == [1, 2])
        #expect(model.isLoadingMore == false)
    }

    @Test
    func changingFiltersClearsRowsBeforeTheReplacementPageArrives() async {
        let gate = DetailGate()
        let model = Self.model(
            client: Self.client(list: { _, input in
                if input.host == "gitlab.example.com" {
                    await gate.wait()
                }
                return Self.page(entries: [Self.entry(number: input.host == nil ? 1 : 2)])
            })
        )
        await model.load()
        model.selectedHost = "gitlab.example.com"

        let replacement = Task { await model.load() }
        await gate.waitUntilEntered()

        #expect(model.entries.isEmpty)
        #expect(model.nextCursors.isEmpty)
        gate.release()
        await replacement.value
        #expect(model.entries.map(\.number) == [2])
    }

    @Test
    func revertingAFilterAfterCancellationStartsAReplacementLoad() async {
        let gate = DetailGate()
        var calls: [String] = []
        let model = Self.model(
            client: Self.client(list: { _, input in
                let query = input.query ?? ""
                calls.append(query)
                if query == "a" {
                    gate.enter()
                    try await Task.sleep(for: .seconds(60))
                }
                return Self.page(entries: [Self.entry(number: query.isEmpty ? 1 : 2)])
            })
        )
        await model.load()
        model.query = "a"
        let abandoned = Task { await model.load() }
        await gate.waitUntilEntered()

        abandoned.cancel()
        _ = await abandoned.result
        model.query = ""
        await model.load()

        #expect(calls == ["", "a", ""])
        #expect(model.entries.map(\.number) == [1])
        #expect(model.isLoading == false)
        #expect(model.loadedFilterKey == model.filterKey)
    }

    @Test
    func detailAndActivityFailIndependentlyWithoutCallingLaterSliceAPIs() async {
        var detailCalls = 0
        var activityCalls = 0
        let entry = Self.entry(number: 7)
        let model = Self.model(
            client: Self.client(
                detail: { environment, reference in
                    detailCalls += 1
                    #expect(environment == "environment-a")
                    #expect(reference.number == 7)
                    return Self.detail(number: 7)
                },
                activity: { environment, reference in
                    activityCalls += 1
                    #expect(environment == "environment-a")
                    #expect(reference.number == 7)
                    throw TestFailure.activity
                }
            )
        )

        await model.loadDetail(for: entry)

        #expect(detailCalls == 1)
        #expect(activityCalls == 1)
        #expect(model.selectedDetail?.number == 7)
        #expect(model.selectedActivity == nil)
        #expect(model.detailError == nil)
        #expect(model.activityError != nil)
    }

    @Test
    func lateDetailCannotReplaceTheCurrentSelection() async {
        let gate = DetailGate()
        let first = Self.entry(number: 1)
        let second = Self.entry(number: 2)
        let model = Self.model(
            client: Self.client(
                detail: { _, reference in
                    if reference.number == 1 { await gate.wait() }
                    return Self.detail(number: reference.number)
                },
                activity: { _, _ in Self.activity() }
            )
        )
        let firstLoad = Task { await model.loadDetail(for: first) }
        await gate.waitUntilEntered()

        await model.loadDetail(for: second)
        gate.release()
        await firstLoad.value

        #expect(model.selectedDetail?.number == 2)
    }

    @Test
    func timelineIncludesReadOnlyReviewThreadsAndTruncationMetadata() async {
        let entry = Self.entry(number: 9)
        let activity = Self.activity(commentsTruncated: true, includeThread: true)
        let model = Self.model(
            client: Self.client(
                detail: { _, _ in Self.detail(number: 9) },
                activity: { _, _ in activity }
            )
        )

        await model.loadDetail(for: entry)

        #expect(model.selectedActivity?.commentsTruncated == true)
        #expect(model.timelineItems.contains {
            if case .reviewThread(resolved: false) = $0.kind { return true }
            return false
        })
        #expect(model.timelineItems.contains { $0.id == "commit-abc123" })
    }

    @Test
    func groupsSeparateReviewRequestsAuthorsAndOtherPullRequests() async {
        let model = Self.model(
            client: Self.client(list: { _, _ in
                Self.page(entries: [
                    Self.entry(number: 1),
                    Self.entry(number: 2, viewerReviewRequested: true, authorLogin: "reviewer"),
                    Self.entry(number: 3, authorLogin: "someone-else"),
                ])
            })
        )

        await model.load()

        #expect(model.groups.first(where: { $0.id == .authored })?.entries.map(\.number) == [1])
        #expect(model.groups.first(where: { $0.id == .reviewRequested })?.entries.map(\.number) == [2])
        #expect(model.groups.first(where: { $0.id == .others })?.entries.map(\.number) == [3])
    }

    @Test
    func failedActivityCanBeRetriedIndependently() async {
        var activityCalls = 0
        let entry = Self.entry(number: 8)
        let model = Self.model(
            client: Self.client(
                detail: { _, _ in Self.detail(number: 8) },
                activity: { _, _ in
                    activityCalls += 1
                    if activityCalls == 1 { throw TestFailure.activity }
                    return Self.activity()
                }
            )
        )

        await model.loadDetail(for: entry)
        await model.retryActivity(for: entry)

        #expect(activityCalls == 2)
        #expect(model.activityError == nil)
        #expect(model.selectedActivity != nil)
    }

    @Test(arguments: [
        "javascript:alert(1)",
        "file:///etc/passwd",
        "t3code://pull-request/1",
        "https://alex:secret@example.com/path",
        "https:///path",
    ])
    func unsafeExternalLinksAreRejected(_ value: String) {
        #expect(PullRequestInboxModel.safeURL(value) == nil)
    }

    @Test
    func fractionalTimelineDatesRemainParseable() {
        #expect(PullRequestInboxModel.date("2026-08-12T02:00:00.123Z") != nil)
    }

    @Test
    func oneSidedChangeCountsRemainVisible() throws {
        var entry = Self.entry(number: 12)
        entry = PullRequestListEntry(
            provider: entry.provider,
            host: entry.host,
            projectId: entry.projectId,
            projectTitle: entry.projectTitle,
            repository: entry.repository,
            number: entry.number,
            title: entry.title,
            url: entry.url,
            author: entry.author,
            headBranch: entry.headBranch,
            baseBranch: entry.baseBranch,
            state: entry.state,
            isDraft: entry.isDraft,
            mergeability: entry.mergeability,
            additions: 12,
            deletions: 0,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
            viewerReviewRequested: entry.viewerReviewRequested,
            labels: entry.labels
        )

        let counts = try #require(PullRequestRowView.resolvedChangeCounts(entry: entry, stat: nil))
        #expect(counts.additions == 12)
        #expect(counts.deletions == 0)
    }

    private static func model(client: PullRequestInboxClient) -> PullRequestInboxModel {
        PullRequestInboxModel(
            scope: .init(environment: environment(capability: true, known: true)),
            client: client
        )
    }

    private static func client(
        list: @escaping @MainActor @Sendable (String, PullRequestListInput) async throws -> PullRequestListResult = { _, _ in page() },
        stats: @escaping @MainActor @Sendable (String, PullRequestListStatsInput) async throws -> PullRequestListStatsResult = { _, _ in .init(stats: []) },
        detail: @escaping @MainActor @Sendable (String, PullRequestRef) async throws -> PullRequestDetail = { _, reference in Self.detail(number: reference.number) },
        activity: @escaping @MainActor @Sendable (String, PullRequestRef) async throws -> PullRequestActivity = { _, _ in Self.activity() }
    ) -> PullRequestInboxClient {
        .init(list: list, stats: stats, detail: detail, activity: activity)
    }

    private static func environment(capability: Bool?, known: Bool) -> FeatureEnvironment {
        FeatureEnvironment(
            id: "environment-a",
            name: "Studio",
            endpoint: "http://studio.local",
            serverVersion: known ? "0.1.0" : nil,
            supportsPullRequests: capability == true,
            pullRequestCapability: capability,
            pullRequestCapabilityKnown: known,
            isActive: true,
            connectionState: known ? .connected : .connecting
        )
    }

    private static func page(
        entries: [PullRequestListEntry] = [],
        truncated: Bool = false,
        nextCursors: [String: String] = [:]
    ) -> PullRequestListResult {
        .init(
            viewers: ["github.example.com": "alex"],
            providers: [],
            entries: entries,
            errors: [],
            truncated: truncated,
            nextCursors: nextCursors
        )
    }

    private static func entry(
        number: Int,
        viewerReviewRequested: Bool = false,
        authorLogin: String = "alex"
    ) -> PullRequestListEntry {
        .init(
            provider: .github,
            host: "github.example.com",
            projectId: "project-a",
            projectTitle: "T3 Code",
            repository: "org/repo",
            number: number,
            title: "Pull request \(number)",
            url: "https://github.example.com/org/repo/pull/\(number)",
            author: .init(login: authorLogin, name: "Alex", avatarUrl: nil),
            headBranch: "feature-\(number)",
            baseBranch: "main",
            state: .open,
            isDraft: false,
            mergeability: .mergeable,
            additions: 0,
            deletions: 0,
            createdAt: "2026-08-12T00:00:00Z",
            updatedAt: "2026-08-12T01:00:00Z",
            viewerReviewRequested: viewerReviewRequested,
            labels: []
        )
    }

    private static func stat(number: Int) -> PullRequestDiffStat {
        .init(
            projectId: "project-a",
            repository: "org/repo",
            number: number,
            additions: 12,
            deletions: 3
        )
    }

    private static func detail(number: Int) -> PullRequestDetail {
        .init(
            provider: .github,
            capabilities: .init(
                diff: true,
                comment: true,
                actions: [.merge],
                mergeMethods: [.squash],
                search: true,
                review: .init(inlineComment: true, reply: true, resolve: true, verdicts: [.approve]),
                reviewers: .init(request: true, listCandidates: true)
            ),
            viewerPermissions: .init(
                actions: [.merge],
                comment: true,
                resolve: true,
                verdicts: [.approve],
                requestReviewers: true
            ),
            projectId: "project-a",
            projectTitle: "T3 Code",
            workspaceRoot: "/repo",
            repository: "org/repo",
            number: number,
            title: "Pull request \(number)",
            body: "Summary",
            url: "https://github.example.com/org/repo/pull/\(number)",
            author: .init(login: "alex", name: "Alex", avatarUrl: nil),
            state: .open,
            isDraft: false,
            mergeability: .mergeable,
            additions: 12,
            deletions: 3,
            changedFiles: 2,
            headBranch: "feature-\(number)",
            baseBranch: "main",
            createdAt: "2026-08-12T00:00:00Z",
            updatedAt: "2026-08-12T01:00:00Z",
            mergedAt: nil,
            closedAt: nil,
            reviewers: [],
            labels: [],
            checks: [],
            mergeCapabilities: .init(merge: true, squash: true, rebase: true)
        )
    }

    private static func activity(
        commentsTruncated: Bool = false,
        includeThread: Bool = false
    ) -> PullRequestActivity {
        .init(
            author: .init(login: "alex", name: nil, avatarUrl: nil),
            reviewers: [],
            comments: [],
            commentCount: commentsTruncated ? 100 : 0,
            commentsTruncated: commentsTruncated,
            reviewThreads: includeThread ? [
                .init(
                    id: "thread-1",
                    path: "Sources/App.swift",
                    line: 20,
                    side: .right,
                    isResolved: false,
                    isOutdated: false,
                    comments: [
                        .init(
                            id: "thread-comment-1",
                            author: .init(login: "reviewer", name: nil, avatarUrl: nil),
                            body: "Please handle this case.",
                            createdAt: "2026-08-12T02:00:00Z",
                            url: "https://github.example.com/comment/1"
                        ),
                    ]
                ),
            ] : [],
            commits: [
                .init(
                    oid: "abc123",
                    messageHeadline: "Implement inbox",
                    committedDate: "2026-08-12T01:30:00Z",
                    additions: 10,
                    deletions: 2,
                    authors: [.init(login: "alex", name: nil, avatarUrl: nil)]
                ),
            ]
        )
    }
}

private enum TestFailure: Error {
    case activity
    case list
}

@MainActor
private final class DetailGate {
    private var enteredContinuation: CheckedContinuation<Void, Never>?
    private var releaseContinuation: CheckedContinuation<Void, Never>?
    private var didEnter = false

    func wait() async {
        didEnter = true
        enteredContinuation?.resume()
        enteredContinuation = nil
        await withCheckedContinuation { continuation in
            releaseContinuation = continuation
        }
    }

    func waitUntilEntered() async {
        guard !didEnter else { return }
        await withCheckedContinuation { continuation in
            enteredContinuation = continuation
        }
    }

    func release() {
        releaseContinuation?.resume()
        releaseContinuation = nil
    }

    func enter() {
        didEnter = true
        enteredContinuation?.resume()
        enteredContinuation = nil
    }
}
