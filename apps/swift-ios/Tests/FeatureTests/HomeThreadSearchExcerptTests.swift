import Foundation
import Testing
import UIKit
@testable import T3Code

@Suite("Home thread search excerpts")
struct HomeThreadSearchExcerptTests {
    private let now = Date(timeIntervalSince1970: 2_000_000)

    // MARK: - Excerpt resolution

    @Test
    func snippetWithoutTheQueryProducesNoExcerpt() {
        let match = match(snippet: "Linked the runbook from the relay README.")

        #expect(HomeThreadSearchExcerpt.resolve(match: match, query: "backoff") == nil)
    }

    @Test
    func emptyQueryProducesNoExcerpt() {
        let match = match(snippet: "Retries now wait with exponential backoff.")

        #expect(HomeThreadSearchExcerpt.resolve(match: match, query: "   ") == nil)
    }

    @Test
    func matchingRunsAreSeparatedFromSurroundingText() throws {
        let match = match(snippet: "Retries wait with exponential Backoff now.")
        let excerpt = try #require(
            HomeThreadSearchExcerpt.resolve(match: match, query: "backoff")
        )

        #expect(excerpt.segments.filter(\.isMatch).map(\.text) == ["Backoff"])
        #expect(excerpt.text == "Retries wait with exponential Backoff now.")
    }

    @Test
    func everyOccurrenceOfTheQueryIsMarked() throws {
        let match = match(snippet: "backoff, then more backoff.")
        let excerpt = try #require(
            HomeThreadSearchExcerpt.resolve(match: match, query: "backoff")
        )

        #expect(excerpt.segments.filter(\.isMatch).count == 2)
        #expect(excerpt.text == "backoff, then more backoff.")
    }

    @Test
    func newlinesAndRepeatedSpacesCollapseIntoOneLine() throws {
        let match = match(snippet: "Traced the stall.\n\n  Added a short backoff  between sweeps.")
        let excerpt = try #require(
            HomeThreadSearchExcerpt.resolve(match: match, query: "backoff")
        )

        #expect(!excerpt.text.contains("\n"))
        #expect(!excerpt.text.contains("  "))
    }

    @Test
    func aLateMatchIsWindowedSoTheQueryStaysNearTheStart() throws {
        // The server bounds a snippet at 240 characters, far more than one row
        // shows, so a match past the visible line has to bring its own window.
        let prefix = String(repeating: "context ", count: 20)
        let match = match(snippet: prefix + "adds a short backoff between dispatch sweeps.")
        let excerpt = try #require(
            HomeThreadSearchExcerpt.resolve(match: match, query: "backoff")
        )

        #expect(excerpt.text.hasPrefix(HomeThreadSearchExcerpt.ellipsis))
        #expect(excerpt.text.contains("backoff"))
        let queryOffset = try #require(excerpt.text.range(of: "backoff")).lowerBound
        #expect(excerpt.text.distance(from: excerpt.text.startIndex, to: queryOffset) <= 16)
    }

    @Test
    func aLongSnippetIsBoundedInsteadOfRenderedWhole() throws {
        let tail = String(repeating: "trailing ", count: 40)
        let match = match(snippet: "found a backoff bug " + tail)
        let excerpt = try #require(
            HomeThreadSearchExcerpt.resolve(match: match, query: "backoff")
        )

        #expect(excerpt.text.count < match.snippet.count)
        #expect(excerpt.text.count <= 130)
        #expect(excerpt.text.hasSuffix(HomeThreadSearchExcerpt.ellipsis))
    }

    @Test
    func aQueryLongerThanTheExcerptBudgetStaysBoundedAndHighlighted() throws {
        let query = String(repeating: "x", count: 200)
        let match = match(snippet: "prefix \(query) suffix")
        let excerpt = try #require(
            HomeThreadSearchExcerpt.resolve(match: match, query: query)
        )

        #expect(excerpt.text.count <= 122)
        #expect(excerpt.text.hasSuffix(HomeThreadSearchExcerpt.ellipsis))
        #expect(excerpt.segments.filter(\.isMatch).map(\.text).joined().count > 0)
    }

    @Test
    func highlightingUsesAsciiCaseFoldingWithoutMatchingDiacritics() throws {
        let match = match(snippet: "éclair; EXIT")
        let excerpt = try #require(
            HomeThreadSearchExcerpt.resolve(match: match, query: "e")
        )

        #expect(excerpt.segments.filter(\.isMatch).map(\.text) == ["E"])
    }

    @Test
    func repeatedQueryWhitespaceMatchesTheServerNormalizedSnippet() throws {
        let match = match(snippet: "Trace foo  \n bar before retrying.")
        let excerpt = try #require(
            HomeThreadSearchExcerpt.resolve(match: match, query: "foo  \n bar")
        )

        #expect(excerpt.segments.filter(\.isMatch).map(\.text) == ["foo bar"])
        #expect(excerpt.accessibilityDescription(query: "foo  \n bar").contains("matching \"foo bar\""))
    }

    @Test
    func theMatchedTextAndSpeakerAreNamedForVoiceOver() throws {
        let userExcerpt = try #require(
            HomeThreadSearchExcerpt.resolve(
                match: match(snippet: "use a jittered backoff instead", source: .user),
                query: "backoff"
            )
        )
        let agentExcerpt = try #require(
            HomeThreadSearchExcerpt.resolve(
                match: match(snippet: "waits with exponential backoff", source: .agent),
                query: "backoff"
            )
        )

        #expect(userExcerpt.accessibilityDescription(query: "backoff").contains("from you"))
        #expect(userExcerpt.accessibilityDescription(query: "backoff").contains("matching \"backoff\""))
        #expect(agentExcerpt.accessibilityDescription(query: "backoff").contains("from the agent"))
    }

    // MARK: - Home presentation

    @Test
    func messageMatchesJoinResultsAndCarryAnExcerptWhileMetadataMatchesDoNot() throws {
        let project = project()
        let snapshot = snapshot(project: project)
        let presentation = HomePresentation(
            snapshot: snapshot,
            query: "backoff",
            projectID: nil,
            searchMatches: [
                "content": FeatureThreadSearchMatch(
                    threadID: "content",
                    source: .agent,
                    snippet: "Retries now wait with exponential backoff before the fourth attempt."
                )
            ],
            now: now
        )

        #expect(Set(presentation.searchResults.map(\.id)) == ["metadata", "content"])
        let contentContext = try #require(presentation.rowContexts["content"])
        let metadataContext = try #require(presentation.rowContexts["metadata"])
        #expect(contentContext.searchExcerpt?.text.contains("backoff") == true)
        #expect(contentContext.searchQuery == "backoff")
        #expect(metadataContext.searchExcerpt == nil)
    }

    @Test
    func aThreadMatchingBothMetadataAndMessageStillExplainsTheMessage() throws {
        let project = project()
        let snapshot = snapshot(project: project)
        let presentation = HomePresentation(
            snapshot: snapshot,
            query: "backoff",
            projectID: nil,
            searchMatches: [
                "metadata": FeatureThreadSearchMatch(
                    threadID: "metadata",
                    source: .user,
                    snippet: "Where is the backoff ladder documented?"
                )
            ],
            now: now
        )

        let context = try #require(presentation.rowContexts["metadata"])
        #expect(context.searchExcerpt?.source == .user)
    }

    @Test
    func clearingTheQueryRestoresOrdinaryRowsWithoutExcerpts() throws {
        let project = project()
        let snapshot = snapshot(project: project)
        let cleared = HomePresentation(
            snapshot: snapshot,
            query: "",
            projectID: nil,
            searchMatches: [
                "content": FeatureThreadSearchMatch(
                    threadID: "content",
                    source: .agent,
                    snippet: "Retries now wait with exponential backoff."
                )
            ],
            now: now
        )

        #expect(cleared.searchResults.isEmpty)
        #expect(Set(cleared.active.map(\.id)) == ["metadata", "content", "unrelated"])
        #expect(cleared.rowContexts.values.allSatisfy { $0.searchExcerpt == nil })
    }

    @Test
    func aMatchWhoseSnippetNoLongerContainsTheQueryKeepsTheOrdinaryRow() throws {
        let project = project()
        let snapshot = snapshot(project: project)
        // A match can outlive the keystroke that produced it; the row must not
        // claim an excerpt it cannot show.
        let presentation = HomePresentation(
            snapshot: snapshot,
            query: "jitter",
            projectID: nil,
            searchMatches: [
                "content": FeatureThreadSearchMatch(
                    threadID: "content",
                    source: .agent,
                    snippet: "Retries now wait with exponential backoff."
                )
            ],
            now: now
        )

        let context = try #require(presentation.rowContexts["content"])
        #expect(context.searchExcerpt == nil)
    }

    @Test
    func searchRequestChangesWithEnvironmentConnectivityButNotOrdering() {
        let studio = FeatureEnvironment(
            id: "studio",
            name: "Studio",
            endpoint: "https://studio.test",
            connectionState: .connected
        )
        var laptop = FeatureEnvironment(
            id: "laptop",
            name: "Laptop",
            endpoint: "https://laptop.test",
            connectionState: .reconnecting
        )
        let original = HomeThreadSearchRequest(
            query: "  backoff  ",
            environments: [studio, laptop]
        )
        let reordered = HomeThreadSearchRequest(
            query: "backoff",
            environments: [laptop, studio]
        )

        #expect(original == reordered)
        #expect(original.query == "backoff")

        laptop.connectionState = .connected
        let reconnected = HomeThreadSearchRequest(
            query: "backoff",
            environments: [studio, laptop]
        )
        #expect(reconnected != original)
    }

    @MainActor
    @Test
    func excerptBearingUIKitCellAnnouncesTheMatchAndOpensItsThread() throws {
        let client = SearchExcerptClientStub()
        let project = project()
        let content = thread(
            id: "content",
            project: project,
            title: "Fix flaky upload cancellation"
        )
        let snapshot = FeatureSnapshot(projects: [project], threads: [content])
        let presentation = HomePresentation(
            snapshot: snapshot,
            query: "backoff",
            projectID: nil,
            searchMatches: [
                content.id: FeatureThreadSearchMatch(
                    threadID: content.id,
                    source: .agent,
                    snippet: "Retries use exponential backoff."
                ),
            ],
            now: now
        )
        var openedThreadID: String?
        let list = threadList(
            presentation: presentation,
            client: client,
            query: "backoff",
            onOpen: { openedThreadID = $0 }
        )
        let coordinator = list.makeCoordinator()
        let collectionView = UICollectionView(
            frame: CGRect(x: 0, y: 0, width: 390, height: 844),
            collectionViewLayout: UICollectionViewCompositionalLayout.list(
                using: UICollectionLayoutListConfiguration(appearance: .plain)
            )
        )
        coordinator.configure(collectionView)
        collectionView.layoutIfNeeded()
        defer {
            coordinator.invalidateTimer()
            coordinator.cancelPendingSwipeActions()
        }

        let indexPath = IndexPath(item: 0, section: 0)
        let cell = try #require(collectionView.cellForItem(at: indexPath))
        #expect(cell.accessibilityValue?.contains("Matched message from the agent") == true)
        #expect(cell.accessibilityValue?.contains("matching \"backoff\"") == true)

        coordinator.collectionView(collectionView, didSelectItemAt: indexPath)
        #expect(openedThreadID == content.id)
    }

    // MARK: - Fixtures

    private func match(
        snippet: String,
        source: FeatureThreadSearchMatch.Source = .agent
    ) -> FeatureThreadSearchMatch {
        FeatureThreadSearchMatch(threadID: "thread", source: source, snippet: snippet)
    }

    private func project() -> FeatureProject {
        FeatureProject(
            id: "relay",
            environmentID: "local",
            name: "Relay Service",
            path: "/relay"
        )
    }

    private func snapshot(project: FeatureProject) -> FeatureSnapshot {
        FeatureSnapshot(
            projects: [project],
            threads: [
                thread(id: "metadata", project: project, title: "Backoff policy notes"),
                thread(id: "content", project: project, title: "Fix flaky upload cancellation"),
                thread(id: "unrelated", project: project, title: "Update onboarding copy"),
            ]
        )
    }

    @MainActor
    private func threadList(
        presentation: HomePresentation,
        client: SearchExcerptClientStub,
        query: String,
        onOpen: @escaping (String) -> Void
    ) -> HomeThreadCollectionView {
        HomeThreadCollectionView(
            presentation: presentation,
            projectFaviconClient: client,
            query: query,
            selectedThreadID: nil,
            forceRichRows: false,
            hapticsEnabled: false,
            isSnoozedExpanded: false,
            isSettledExpanded: false,
            settledLimit: 12,
            onOpen: onOpen,
            onOpenSummaryTimeline: { _ in },
            onToggleSnoozed: {},
            onToggleSettled: {},
            onOpenArchive: {},
            onShowMoreSettled: {},
            onRename: { _ in },
            regeneratingTitleThreadIDs: [],
            onRegenerateTitle: { _ in },
            onArchive: { _, _ in },
            onSettle: { _, _, completion in completion(true) },
            onSnooze: { _, _ in },
            onPin: { _, _ in },
            pinnedMovePositions: [:],
            onMovePinned: { _, _ in },
            onDelete: { _ in }
        )
    }

    private func thread(
        id: String,
        project: FeatureProject,
        title: String
    ) -> FeatureThread {
        FeatureThread(
            id: id,
            projectID: project.id,
            environmentID: project.environmentID,
            title: title,
            createdAt: now,
            updatedAt: now
        )
    }
}

@MainActor
private final class SearchExcerptClientStub: FeatureClient {
    func initialSnapshot() async throws -> FeatureSnapshot { FeatureSnapshot() }
    func pair(endpoint: String, token: String?) async throws {}
    func addProject(path: String) async throws {}
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
