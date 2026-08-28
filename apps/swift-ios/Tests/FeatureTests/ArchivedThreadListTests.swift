import Foundation
import Testing
@testable import T3Code

@Suite("Archived thread list")
struct ArchivedThreadListTests {
    private let now = Date(timeIntervalSince1970: 2_000_000)

    @Test
    func groupsArchivedThreadsByProjectAndSkipsOrdinaryThreads() {
        let alpha = project(id: "alpha", name: "Alpha")
        let beta = project(id: "beta", name: "Beta")
        let snapshot = FeatureSnapshot(
            projects: [alpha, beta],
            threads: [
                thread(id: "alpha-new", project: alpha, archived: -10),
                thread(id: "ordinary", project: alpha, archived: nil),
                thread(id: "beta-old", project: beta, archived: -100),
                thread(id: "alpha-old", project: alpha, archived: -200),
            ]
        )

        let list = ArchivedThreadList(
            snapshot: snapshot,
            query: "",
            sortOrder: .newest
        )

        #expect(list.totalArchivedCount == 3)
        #expect(list.groups.map(\.project.id) == ["alpha", "beta"])
        #expect(list.groups[0].threads.map(\.id) == ["alpha-new", "alpha-old"])
        #expect(list.groups[1].threads.map(\.id) == ["beta-old"])
    }

    @Test
    func sortOrderUsesArchivedDateInBothDirectionsWithStableTies() {
        let project = project(id: "project", name: "Project")
        let snapshot = FeatureSnapshot(
            projects: [project],
            threads: [
                thread(id: "zeta", project: project, title: "Zeta", archived: -20),
                thread(id: "alpha-b", project: project, title: "Alpha", archived: -20),
                thread(id: "alpha-a", project: project, title: "Alpha", archived: -20),
                thread(id: "oldest", project: project, archived: -100),
                thread(id: "newest", project: project, archived: -1),
            ]
        )

        let newest = ArchivedThreadList(
            snapshot: snapshot,
            query: "",
            sortOrder: .newest
        )
        let oldest = ArchivedThreadList(
            snapshot: snapshot,
            query: "",
            sortOrder: .oldest
        )

        #expect(
            newest.groups[0].threads.map(\.id)
                == ["newest", "alpha-a", "alpha-b", "zeta", "oldest"]
        )
        #expect(
            oldest.groups[0].threads.map(\.id)
                == ["oldest", "alpha-a", "alpha-b", "zeta", "newest"]
        )
    }

    @Test
    func searchMatchesArchivedTitlesCaseInsensitivelyAndTrimsWhitespace() {
        let project = project(id: "project", name: "Release project")
        let snapshot = FeatureSnapshot(
            projects: [project],
            threads: [
                thread(
                    id: "release",
                    project: project,
                    title: "Release checklist",
                    archived: -10
                ),
                thread(
                    id: "notes",
                    project: project,
                    title: "Planning notes",
                    archived: -20
                ),
            ]
        )

        let matching = ArchivedThreadList(
            snapshot: snapshot,
            query: "  RELEASE  ",
            sortOrder: .newest
        )
        let noMatch = ArchivedThreadList(
            snapshot: snapshot,
            query: "missing",
            sortOrder: .newest
        )

        #expect(matching.groups.flatMap(\.threads).map(\.id) == ["release"])
        #expect(noMatch.totalArchivedCount == 2)
        #expect(noMatch.groups.isEmpty)
    }

    @Test
    func persistedSearchAndSortKeysRemainIndependent() throws {
        let suiteName = "ArchivedThreadListTests-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }

        defaults.set("release", forKey: ArchivedThreadPreferences.searchQueryKey)
        defaults.set(
            ArchivedThreadSortOrder.oldest.rawValue,
            forKey: ArchivedThreadPreferences.sortOrderKey
        )

        let restored = try #require(UserDefaults(suiteName: suiteName))
        #expect(restored.string(forKey: ArchivedThreadPreferences.searchQueryKey) == "release")
        #expect(
            ArchivedThreadPreferences.sortOrder(
                from: restored.string(forKey: ArchivedThreadPreferences.sortOrderKey)
            ) == .oldest
        )
        #expect(ArchivedThreadPreferences.sortOrder(from: "removed") == .newest)
        #expect(ArchivedThreadPreferences.sortOrder(from: nil) == .newest)
        #expect(
            ArchivedThreadPreferences.searchQueryKey
                != ArchivedThreadPreferences.sortOrderKey
        )
    }

    private func project(id: String, name: String) -> FeatureProject {
        FeatureProject(
            id: id,
            environmentID: "environment",
            name: name,
            path: "/\(id)"
        )
    }

    private func thread(
        id: String,
        project: FeatureProject,
        title: String? = nil,
        archived: TimeInterval?
    ) -> FeatureThread {
        FeatureThread(
            id: id,
            projectID: project.id,
            title: title ?? id,
            createdAt: now.addingTimeInterval(-1_000),
            updatedAt: now.addingTimeInterval(archived ?? -500),
            isArchived: archived != nil,
            archivedAt: archived.map(now.addingTimeInterval)
        )
    }
}
