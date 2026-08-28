import Foundation
import Testing
@testable import T3Code

@Suite("Home ordering")
struct HomeOrderingTests {
    private let now = Date(timeIntervalSince1970: 2_000_000)

    @Test
    func threadOrdersUseLatestUserMessageOrCreationTime() {
        let olderRecentMessage = thread(
            id: "older-recent-message",
            projectID: "project",
            created: -300,
            updated: -20,
            latestUserMessage: -10
        )
        let newerOlderMessage = thread(
            id: "newer-older-message",
            projectID: "project",
            created: -100,
            updated: -30,
            latestUserMessage: -200
        )
        let canonical = [olderRecentMessage, newerOlderMessage]

        #expect(
            HomeOrdering.threads(
                canonical,
                snapshot: snapshot(threads: canonical),
                projectOrder: .default,
                threadOrder: .lastUserMessage
            ).map(\.id) == ["older-recent-message", "newer-older-message"]
        )
        #expect(
            HomeOrdering.threads(
                canonical,
                snapshot: snapshot(threads: canonical),
                projectOrder: .default,
                threadOrder: .createdAt
            ).map(\.id) == ["newer-older-message", "older-recent-message"]
        )
    }

    @Test
    func projectAndThreadOrdersRemainIndependent() {
        let projectARecentMessage = thread(
            id: "a-recent-message",
            projectID: "project-a",
            created: -400,
            updated: -10,
            latestUserMessage: -5
        )
        let projectANewerCreation = thread(
            id: "a-newer-creation",
            projectID: "project-a",
            created: -100,
            updated: -200,
            latestUserMessage: -300
        )
        let projectBNewestCreation = thread(
            id: "b-newest-creation",
            projectID: "project-b",
            created: -20,
            updated: -50,
            latestUserMessage: -40
        )
        let canonical = [projectARecentMessage, projectBNewestCreation, projectANewerCreation]
        let snapshot = snapshot(threads: canonical)

        #expect(
            HomeOrdering.threads(
                canonical,
                snapshot: snapshot,
                projectOrder: .createdAt,
                threadOrder: .lastUserMessage
            ).map(\.id) == [
                "b-newest-creation",
                "a-recent-message",
                "a-newer-creation",
            ]
        )
        #expect(
            HomeOrdering.threads(
                canonical,
                snapshot: snapshot,
                projectOrder: .lastUserMessage,
                threadOrder: .createdAt
            ).map(\.id) == [
                "a-newer-creation",
                "a-recent-message",
                "b-newest-creation",
            ]
        )
    }

    @Test
    func defaultRestoresCanonicalShelvesWithoutChangingThreadState() {
        var pinned = thread(
            id: "pinned",
            projectID: "project-a",
            created: -400,
            updated: -10,
            latestUserMessage: -5
        )
        pinned.pinnedAt = now.addingTimeInterval(-100)
        pinned.supportsPinning = true

        var active = thread(
            id: "active",
            projectID: "project-b",
            created: -100,
            updated: -300,
            latestUserMessage: -350
        )
        active.state = .waitingForInput

        var snoozed = thread(
            id: "snoozed",
            projectID: "project-a",
            created: -200,
            updated: -200,
            latestUserMessage: -200
        )
        snoozed.snoozedUntil = now.addingTimeInterval(3_600)
        snoozed.supportsSnooze = true

        var settled = thread(
            id: "settled",
            projectID: "project-b",
            created: -300,
            updated: -100,
            latestUserMessage: -100
        )
        settled.isSettled = true
        settled.settledAt = now.addingTimeInterval(-50)
        settled.supportsSettlement = true

        var archived = thread(
            id: "archived",
            projectID: "project-a",
            created: -50,
            updated: -20,
            latestUserMessage: -20
        )
        archived.isArchived = true

        let originalThreads = [pinned, active, snoozed, settled, archived]
        let snapshot = snapshot(threads: originalThreads)
        let canonical = HomePresentation(
            snapshot: snapshot,
            query: "",
            projectID: nil,
            now: now
        )
        let reset = HomePresentation(
            snapshot: snapshot,
            query: "",
            projectID: nil,
            now: now,
            projectOrder: .default,
            threadOrder: .default
        )

        #expect(reset.pinned == canonical.pinned)
        #expect(reset.active == canonical.active)
        #expect(reset.snoozed == canonical.snoozed)
        #expect(reset.settled == canonical.settled)
        #expect(reset.archived == canonical.archived)
        #expect(snapshot.threads == originalThreads)
    }

    @Test
    func customOrdersOnlyPermuteCanonicalShelvesAndResetRestoresThem() {
        var pinned = thread(
            id: "pinned",
            projectID: "project-a",
            created: -400,
            updated: -10,
            latestUserMessage: -5
        )
        pinned.pinnedAt = now.addingTimeInterval(-100)
        pinned.supportsPinning = true

        var activeA = thread(
            id: "active-a",
            projectID: "project-a",
            created: -500,
            updated: -5,
            latestUserMessage: -5
        )
        activeA.state = .waitingForInput
        var activeB = thread(
            id: "active-b",
            projectID: "project-b",
            created: -100,
            updated: -300,
            latestUserMessage: -300
        )
        activeB.state = .failed

        var snoozed = thread(
            id: "snoozed",
            projectID: "project-a",
            created: -200,
            updated: -200,
            latestUserMessage: -200
        )
        snoozed.snoozedUntil = now.addingTimeInterval(3_600)
        snoozed.supportsSnooze = true

        var settled = thread(
            id: "settled",
            projectID: "project-b",
            created: -300,
            updated: -100,
            latestUserMessage: -100
        )
        settled.isSettled = true
        settled.settledAt = now.addingTimeInterval(-50)
        settled.supportsSettlement = true

        var archived = thread(
            id: "archived",
            projectID: "project-a",
            created: -50,
            updated: -20,
            latestUserMessage: -20
        )
        archived.isArchived = true

        let originalThreads = [pinned, activeA, activeB, snoozed, settled, archived]
        let snapshot = snapshot(threads: originalThreads)
        let canonical = HomePresentation(
            snapshot: snapshot,
            query: "",
            projectID: nil,
            now: now
        )
        let custom = HomePresentation(
            snapshot: snapshot,
            query: "",
            projectID: nil,
            now: now,
            projectOrder: .lastUserMessage,
            threadOrder: .createdAt
        )
        let reset = HomePresentation(
            snapshot: snapshot,
            query: "",
            projectID: nil,
            now: now,
            projectOrder: .default,
            threadOrder: .default
        )

        #expect(Set(custom.pinned.map(\.id)) == Set(canonical.pinned.map(\.id)))
        #expect(Set(custom.active.map(\.id)) == Set(canonical.active.map(\.id)))
        #expect(Set(custom.snoozed.map(\.id)) == Set(canonical.snoozed.map(\.id)))
        #expect(Set(custom.settled.map(\.id)) == Set(canonical.settled.map(\.id)))
        #expect(Set(custom.archived.map(\.id)) == Set(canonical.archived.map(\.id)))
        #expect(custom.active.map(\.id) != canonical.active.map(\.id))
        #expect(reset.pinned == canonical.pinned)
        #expect(reset.active == canonical.active)
        #expect(reset.snoozed == canonical.snoozed)
        #expect(reset.settled == canonical.settled)
        #expect(reset.archived == canonical.archived)
        #expect(snapshot.threads == originalThreads)
    }

    @Test
    func projectOrdersUseTheNewestRelevantThreadLikeReactNativeHome() {
        let projectA = thread(
            id: "a",
            projectID: "project-a",
            created: -300,
            updated: -10,
            latestUserMessage: -5
        )
        let projectB = thread(
            id: "b",
            projectID: "project-b",
            created: -20,
            updated: -100,
            latestUserMessage: -200
        )
        let snapshot = snapshot(threads: [projectA, projectB])

        #expect(
            HomeOrdering.projects(in: snapshot, order: .lastUserMessage).map(\.id)
                == ["project-a", "project-b"]
        )
        #expect(
            HomeOrdering.projects(in: snapshot, order: .createdAt).map(\.id)
                == ["project-b", "project-a"]
        )
    }

    @Test
    func missingUserMessageFallsBackToUpdatedTimeLikeReactNativeHome() {
        var automated = thread(
            id: "automated",
            projectID: "project-a",
            created: -500,
            updated: -5,
            latestUserMessage: -500
        )
        automated.latestUserMessageAt = nil
        let userMessage = thread(
            id: "user-message",
            projectID: "project-a",
            created: -400,
            updated: -10,
            latestUserMessage: -100
        )
        let snapshot = snapshot(threads: [userMessage, automated])

        #expect(
            HomeOrdering.threads(
                [userMessage, automated],
                snapshot: snapshot,
                projectOrder: .default,
                threadOrder: .lastUserMessage
            ).map(\.id) == ["automated", "user-message"]
        )
    }

    @Test
    func persistedRawValuesRoundTripAndInvalidValuesResetToDefault() throws {
        let suiteName = "HomeOrderingTests-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }

        defaults.set(HomeSortOrder.createdAt.rawValue, forKey: HomeSortPreferences.projectKey)
        defaults.set(
            HomeSortOrder.lastUserMessage.rawValue,
            forKey: HomeSortPreferences.threadKey
        )

        let relaunchedDefaults = try #require(UserDefaults(suiteName: suiteName))
        #expect(
            HomeSortPreferences.order(
                from: relaunchedDefaults.string(forKey: HomeSortPreferences.projectKey)
            ) == .createdAt
        )
        #expect(
            HomeSortPreferences.order(
                from: relaunchedDefaults.string(forKey: HomeSortPreferences.threadKey)
            ) == .lastUserMessage
        )
        #expect(HomeSortPreferences.order(from: "removed-value") == .default)
        #expect(HomeSortPreferences.order(from: nil) == .default)
        #expect(HomeSortPreferences.projectKey == "t3.swiftui.home.projectSortOrder")
        #expect(HomeSortPreferences.threadKey == "t3.swiftui.home.threadSortOrder")
        #expect(HomeSortPreferences.projectKey != HomeSortPreferences.threadKey)
    }

    private func snapshot(threads: [FeatureThread]) -> FeatureSnapshot {
        FeatureSnapshot(
            projects: [
                FeatureProject(
                    id: "project-a",
                    environmentID: "local",
                    name: "Alpha",
                    path: "/alpha",
                    createdAt: "2026-01-01T00:00:00Z",
                    updatedAt: "2026-01-02T00:00:00Z"
                ),
                FeatureProject(
                    id: "project-b",
                    environmentID: "remote",
                    name: "Beta",
                    path: "/beta",
                    createdAt: "2026-01-03T00:00:00Z",
                    updatedAt: "2026-01-04T00:00:00Z"
                ),
            ],
            threads: threads
        )
    }

    private func thread(
        id: String,
        projectID: String,
        created: TimeInterval,
        updated: TimeInterval,
        latestUserMessage: TimeInterval
    ) -> FeatureThread {
        FeatureThread(
            id: id,
            projectID: projectID,
            title: id,
            createdAt: now.addingTimeInterval(created),
            updatedAt: now.addingTimeInterval(updated),
            lastActivityAt: now.addingTimeInterval(updated),
            latestUserMessageAt: now.addingTimeInterval(latestUserMessage)
        )
    }
}
