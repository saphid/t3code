import Foundation
import Observation

@MainActor
@Observable
final class PullRequestInboxModel {
    enum Capability: Equatable {
        case unknown
        case unavailable
        case available
    }

    enum DetailTab: String, CaseIterable, Identifiable {
        case summary = "Summary"
        case timeline = "Timeline"

        var id: Self { self }
    }

    struct Scope: Equatable {
        let environmentID: String
        let environmentName: String
        let capability: Capability

        init(environment: FeatureEnvironment) {
            environmentID = environment.id
            environmentName = environment.name
            if !environment.pullRequestCapabilityKnown {
                capability = .unknown
            } else if environment.pullRequestCapability == true {
                capability = .available
            } else {
                capability = .unavailable
            }
        }
    }

    struct Route: Hashable {
        let entry: PullRequestListEntry

        static func == (lhs: Self, rhs: Self) -> Bool {
            lhs.entry.id == rhs.entry.id
        }

        func hash(into hasher: inout Hasher) {
            hasher.combine(entry.id)
        }
    }

    struct Group: Identifiable {
        enum ID: String {
            case reviewRequested
            case authored
            case others
        }

        let id: ID
        let title: String
        let entries: [PullRequestListEntry]
    }

    struct TimelineItem: Identifiable {
        enum Kind {
            case lifecycle
            case commit
            case comment
            case reviewThread(resolved: Bool)
        }

        let id: String
        let kind: Kind
        let actor: PullRequestActor?
        let title: String
        let body: String?
        let at: String
        let url: String?
        let path: String?
        let additions: Int?
        let deletions: Int?
    }

    let scope: Scope
    var state: PullRequestListState = .open
    var involvement: PullRequestInvolvement = .all
    var selectedProjectID: String?
    var selectedHost: String?
    var query = ""
    var entries: [PullRequestListEntry] = []
    var viewers: [String: String] = [:]
    var providers: [PullRequestProviderSummary] = []
    var knownProjects: [String: String] = [:]
    var projectErrors: [PullRequestListProjectError] = []
    var statsByEntryID: [String: PullRequestDiffStat] = [:]
    var nextCursors: [String: String] = [:]
    var isTruncated = false
    var isLoading = false
    var isLoadingMore = false
    var listError: String?
    private(set) var loadedFilterKey: String?

    var selectedDetail: PullRequestDetail?
    var selectedActivity: PullRequestActivity?
    var detailError: String?
    var activityError: String?
    var isLoadingDetail = false
    var selectedTab = DetailTab.summary

    private let client: PullRequestInboxClient
    private var listLoadID: UUID?
    private var detailLoadID: UUID?
    private var selectedEntryID: String?
    private var scheduledListLoad: (filterKey: String, task: Task<Void, Never>)?
    private let pageSize = 30

    init(scope: Scope, client: PullRequestInboxClient) {
        self.scope = scope
        self.client = client
    }

    var filterKey: String {
        [
            state.rawValue,
            involvement.rawValue,
            selectedProjectID ?? "all-projects",
            selectedHost ?? "all-hosts",
            query.trimmingCharacters(in: .whitespacesAndNewlines),
        ].joined(separator: ":")
    }

    var projectOptions: [(id: String, title: String)] {
        knownProjects.map { (id: $0.key, title: $0.value) }
            .sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
    }

    var hostOptions: [String] {
        providers.map(\.host).sorted()
    }

    var canLoadMore: Bool {
        isTruncated && !nextCursors.isEmpty && !isLoading && !isLoadingMore
    }

    var groups: [Group] {
        let rows = rankedEntries
        guard involvement == .all else {
            return rows.isEmpty ? [] : [Group(id: .others, title: "Pull requests", entries: rows)]
        }

        var reviewing: [PullRequestListEntry] = []
        var authored: [PullRequestListEntry] = []
        var others: [PullRequestListEntry] = []
        for entry in rows {
            if isAuthoredByViewer(entry) {
                authored.append(entry)
            } else if entry.viewerReviewRequested {
                reviewing.append(entry)
            } else {
                others.append(entry)
            }
        }
        return [
            Group(id: .reviewRequested, title: "Review requested", entries: reviewing),
            Group(id: .authored, title: "Authored", entries: authored),
            Group(id: .others, title: "Others", entries: others),
        ]
        .filter { !$0.entries.isEmpty }
    }

    var timelineItems: [TimelineItem] {
        guard let detail = selectedDetail else { return [] }
        var items = [
            TimelineItem(
                id: "lifecycle-opened",
                kind: .lifecycle,
                actor: detail.author,
                title: "opened this pull request",
                body: nil,
                at: detail.createdAt,
                url: detail.url,
                path: nil,
                additions: nil,
                deletions: nil
            ),
        ]
        guard let activity = selectedActivity else { return items }

        items.append(contentsOf: activity.commits.map { commit in
            TimelineItem(
                id: "commit-\(commit.oid)",
                kind: .commit,
                actor: commit.authors?.first,
                title: commit.messageHeadline,
                body: nil,
                at: commit.committedDate,
                url: nil,
                path: nil,
                additions: commit.additions,
                deletions: commit.deletions
            )
        })

        let listedCommentIDs = Set(activity.comments.map(\.id))
        items.append(contentsOf: activity.comments.map(Self.timelineItem))
        for thread in activity.reviewThreads {
            for comment in thread.comments where !listedCommentIDs.contains(comment.id) {
                items.append(
                    TimelineItem(
                        id: "thread-\(thread.id)-\(comment.id)",
                        kind: .reviewThread(resolved: thread.isResolved),
                        actor: comment.author,
                        title: thread.isResolved ? "reviewed and resolved" : "left a review comment",
                        body: comment.body,
                        at: comment.createdAt,
                        url: comment.url,
                        path: thread.path,
                        additions: nil,
                        deletions: nil
                    )
                )
            }
        }

        if let mergedAt = detail.mergedAt {
            items.append(Self.lifecycleItem(id: "merged", title: "merged this pull request", at: mergedAt))
        } else if let closedAt = detail.closedAt {
            items.append(Self.lifecycleItem(id: "closed", title: "closed this pull request", at: closedAt))
        }
        return items.enumerated()
            .map { (offset: $0.offset, item: $0.element, date: Self.date($0.element.at)) }
            .sorted { lhs, rhs in
                let left = lhs.date ?? .distantFuture
                let right = rhs.date ?? .distantFuture
                return left == right ? lhs.offset < rhs.offset : left < right
            }
            .map(\.item)
    }

    func route(for entry: PullRequestListEntry) -> Route {
        Route(entry: entry)
    }

    func stat(for entry: PullRequestListEntry) -> PullRequestDiffStat? {
        statsByEntryID[entry.id]
    }

    func loadForCurrentFilterIfNeeded() async {
        let requestedFilterKey = filterKey
        guard loadedFilterKey != requestedFilterKey else { return }
        if let scheduledListLoad,
           scheduledListLoad.filterKey == requestedFilterKey {
            await scheduledListLoad.task.value
            return
        }

        scheduledListLoad?.task.cancel()
        let shouldDebounce = loadedFilterKey != nil
        let task = Task { @MainActor [weak self] in
            if shouldDebounce {
                do {
                    try await Task.sleep(for: .milliseconds(250))
                } catch {
                    return
                }
            }
            guard let self, self.filterKey == requestedFilterKey else { return }
            await self.load()
        }
        scheduledListLoad = (requestedFilterKey, task)
        await task.value
        if scheduledListLoad?.filterKey == requestedFilterKey {
            scheduledListLoad = nil
        }
    }

    func load(reset: Bool = true) async {
        guard scope.capability == .available else { return }
        if !reset {
            guard canLoadMore else { return }
        }
        let requestedFilterKey = filterKey
        let loadID = UUID()
        listLoadID = loadID
        listError = nil
        if reset {
            loadedFilterKey = nil
            isLoading = true
            entries = []
            statsByEntryID = [:]
            nextCursors = [:]
            isTruncated = false
        } else {
            isLoadingMore = true
        }

        let input = PullRequestListInput(
            state: state,
            involvement: involvement,
            projectId: selectedProjectID,
            host: selectedHost,
            limit: pageSize,
            cursors: reset ? nil : nextCursors,
            query: query.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
        )
        do {
            let result = try await client.list(scope.environmentID, input)
            guard listLoadID == loadID else { return }
            apply(result, reset: reset)
            if reset { loadedFilterKey = requestedFilterKey }
            isLoading = false
            isLoadingMore = false
            await loadStats(for: result.entries, loadID: loadID)
        } catch is CancellationError {
            if listLoadID == loadID {
                isLoading = false
                isLoadingMore = false
            }
            return
        } catch {
            guard listLoadID == loadID else { return }
            listError = PullRequestServiceError(error: error).localizedDescription
        }
        guard listLoadID == loadID else { return }
        isLoading = false
        isLoadingMore = false
    }

    func loadDetail(for entry: PullRequestListEntry, refresh: Bool = false) async {
        let entryChanged = selectedEntryID != entry.id
        selectedEntryID = entry.id
        let loadID = UUID()
        detailLoadID = loadID
        if !refresh {
            selectedDetail = nil
            selectedActivity = nil
        }
        detailError = nil
        activityError = nil
        isLoadingDetail = true
        if entryChanged { selectedTab = .summary }
        let reference = PullRequestRef(
            projectId: entry.projectId,
            repository: entry.repository,
            number: entry.number
        )

        async let detail = client.detail(scope.environmentID, reference)
        async let activity = client.activity(scope.environmentID, reference)
        do {
            let value = try await detail
            if detailLoadID == loadID { selectedDetail = value }
        } catch is CancellationError {
            if detailLoadID == loadID { isLoadingDetail = false }
            return
        } catch {
            if detailLoadID == loadID {
                detailError = PullRequestServiceError(error: error).localizedDescription
            }
        }
        do {
            let value = try await activity
            if detailLoadID == loadID { selectedActivity = value }
        } catch is CancellationError {
            if detailLoadID == loadID { isLoadingDetail = false }
            return
        } catch {
            if detailLoadID == loadID {
                activityError = PullRequestServiceError(error: error).localizedDescription
            }
        }
        if detailLoadID == loadID { isLoadingDetail = false }
    }

    func retryActivity(for entry: PullRequestListEntry) async {
        let loadID = detailLoadID
        let reference = PullRequestRef(
            projectId: entry.projectId,
            repository: entry.repository,
            number: entry.number
        )
        activityError = nil
        do {
            let activity = try await client.activity(scope.environmentID, reference)
            if detailLoadID == loadID { selectedActivity = activity }
        } catch is CancellationError {
            return
        } catch {
            if detailLoadID == loadID {
                activityError = PullRequestServiceError(error: error).localizedDescription
            }
        }
    }

    private var rankedEntries: [PullRequestListEntry] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !needle.isEmpty else { return entries }
        return entries.sorted {
            let left = Self.matchScore($0, query: needle)
            let right = Self.matchScore($1, query: needle)
            return left == right ? $0.updatedAt > $1.updatedAt : left > right
        }
    }

    private func apply(_ result: PullRequestListResult, reset: Bool) {
        for entry in result.entries {
            knownProjects[entry.projectId] = entry.projectTitle
        }
        viewers = result.viewers
        providers = result.providers
        projectErrors = result.errors
        isTruncated = result.truncated
        nextCursors = result.nextCursors
        if reset {
            entries = Self.deduplicated(result.entries)
        } else {
            entries = Self.deduplicated(entries + result.entries)
        }
    }

    private func loadStats(for entries: [PullRequestListEntry], loadID: UUID) async {
        let refs = entries.filter { $0.additions == 0 && $0.deletions == 0 }.map {
            PullRequestRef(projectId: $0.projectId, repository: $0.repository, number: $0.number)
        }
        guard !refs.isEmpty else { return }
        do {
            let result = try await client.stats(scope.environmentID, .init(refs: refs))
            guard listLoadID == loadID else { return }
            for stat in result.stats {
                let id = entries.first {
                    $0.projectId == stat.projectId
                        && $0.repository == stat.repository
                        && $0.number == stat.number
                }?.id
                if let id { statsByEntryID[id] = stat }
            }
        } catch is CancellationError {
            return
        } catch {
            // Deferred stats are optional decoration. The list remains useful without them.
        }
    }

    private func isAuthoredByViewer(_ entry: PullRequestListEntry) -> Bool {
        guard let viewer = viewers[entry.host]?.trimmingCharacters(in: .whitespacesAndNewlines),
              !viewer.isEmpty,
              let author = entry.author?.login else { return false }
        return viewer.caseInsensitiveCompare(author) == .orderedSame
    }

    private static func deduplicated(_ entries: [PullRequestListEntry]) -> [PullRequestListEntry] {
        var seen: Set<String> = []
        return entries.filter { seen.insert($0.id).inserted }
    }

    private static func matchScore(_ entry: PullRequestListEntry, query: String) -> Int {
        let needle = query.localizedLowercase
        if String(entry.number) == needle.trimmingCharacters(in: CharacterSet(charactersIn: "#")) {
            return 100
        }
        if entry.title.localizedLowercase == needle { return 90 }
        if entry.title.localizedStandardContains(query) { return 80 }
        if entry.headBranch.localizedStandardContains(query) { return 60 }
        if entry.author?.login.localizedStandardContains(query) == true { return 50 }
        if entry.repository.localizedStandardContains(query) { return 40 }
        return 10
    }

    private static func timelineItem(_ comment: PullRequestComment) -> TimelineItem {
        TimelineItem(
            id: "comment-\(comment.id)",
            kind: .comment,
            actor: comment.author,
            title: comment.reviewState?.friendlyWords ?? "commented",
            body: comment.body,
            at: comment.createdAt,
            url: comment.url,
            path: comment.path,
            additions: nil,
            deletions: nil
        )
    }

    private static func lifecycleItem(id: String, title: String, at: String) -> TimelineItem {
        TimelineItem(
            id: "lifecycle-\(id)",
            kind: .lifecycle,
            actor: nil,
            title: title,
            body: nil,
            at: at,
            url: nil,
            path: nil,
            additions: nil,
            deletions: nil
        )
    }

    static func date(_ value: String) -> Date? {
        if let date = try? Date(value, strategy: .iso8601) {
            return date
        }
        return try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(value)
    }

    static func safeURL(_ value: String?) -> URL? {
        guard let value, let url = URL(string: value) else { return nil }
        return MarkdownExternalLink.safeURL(url)
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }

    var friendlyWords: String {
        replacing("_", with: " ")
            .replacing("-", with: " ")
            .localizedCapitalized
    }
}
