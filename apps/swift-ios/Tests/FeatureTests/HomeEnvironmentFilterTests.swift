import Foundation
import Testing
@testable import T3Code

@Suite("Home environment filter")
struct HomeEnvironmentFilterTests {
    private let now = Date(timeIntervalSince1970: 2_000_000)

    @Test
    func presentationFiltersActiveArchivedAndSearchResultsThenRestoresAll() {
        let localProject = project(id: "local-project", environmentID: "local")
        let remoteProject = project(id: "remote-project", environmentID: "remote")
        let snapshot = FeatureSnapshot(
            projects: [localProject, remoteProject],
            threads: [
                thread(id: "local-active", project: localProject, title: "Local active"),
                thread(id: "remote-active", project: remoteProject, title: "Remote active"),
                thread(
                    id: "local-archived",
                    project: localProject,
                    title: "Local archived",
                    archived: true
                ),
                thread(
                    id: "remote-archived",
                    project: remoteProject,
                    title: "Remote archived",
                    archived: true
                ),
            ]
        )

        let filtered = HomePresentation(
            snapshot: snapshot,
            query: "Remote",
            projectID: nil,
            environmentID: "remote",
            now: now
        )
        let restored = HomePresentation(
            snapshot: snapshot,
            query: "",
            projectID: nil,
            now: now
        )

        #expect(filtered.active.map(\.id) == ["remote-active"])
        #expect(filtered.archived.map(\.id) == ["remote-archived"])
        #expect(Set(filtered.searchResults.map(\.id)) == ["remote-active", "remote-archived"])
        #expect(Set(restored.active.map(\.id)) == ["local-active", "remote-active"])
        #expect(Set(restored.archived.map(\.id)) == ["local-archived", "remote-archived"])
    }

    @Test
    func projectAndEnvironmentFiltersComposeWithoutLeakingThreads() {
        let localProject = project(id: "local-project", environmentID: "local")
        let remoteProject = project(id: "remote-project", environmentID: "remote")
        let snapshot = FeatureSnapshot(
            projects: [localProject, remoteProject],
            threads: [
                thread(id: "local", project: localProject, title: "Local"),
                thread(id: "remote", project: remoteProject, title: "Remote"),
            ]
        )

        let incompatible = HomePresentation(
            snapshot: snapshot,
            query: "",
            projectID: localProject.id,
            environmentID: "remote",
            now: now
        )

        #expect(incompatible.active.isEmpty)
        #expect(incompatible.archived.isEmpty)
    }

    @Test
    func ownershipIsConsistentForAmbiguousLegacyProjectIDs() {
        let projects = [
            project(id: "shared", environmentID: "local"),
            project(id: "shared", environmentID: "remote"),
        ]
        let ownership = HomeEnvironmentFilter.Ownership(projects: projects)
        let legacy = FeatureThread(id: "legacy", projectID: "shared", title: "Legacy")
        let explicit = FeatureThread(
            id: "explicit",
            projectID: "shared",
            environmentID: "remote",
            title: "Explicit"
        )

        #expect(ownership.environmentID(for: legacy) == nil)
        #expect(ownership.includes(legacy, in: "local") == false)
        #expect(ownership.includes(legacy, in: "remote") == false)
        #expect(ownership.includes(explicit, in: "remote"))
    }

    @Test
    func selectionSurvivesConnectionChangesAndClearsRemovedEnvironments() {
        let localProject = project(id: "local-project", environmentID: "local")
        let remoteProject = project(id: "remote-project", environmentID: "remote")
        let selected = HomeEnvironmentFilter.Selection(
            environmentID: "local",
            projectID: localProject.id
        )
        let connecting = environment(id: "local", state: .connecting)
        let disconnected = environment(id: "local", state: .disconnected)

        #expect(
            selected.reconciled(
                environments: [connecting],
                projects: [localProject]
            ) == selected
        )
        #expect(
            selected.reconciled(
                environments: [disconnected],
                projects: [localProject]
            ) == selected
        )
        #expect(
            selected.reconciled(
                environments: [environment(id: "remote", state: .connected)],
                projects: [remoteProject]
            ) == .init(environmentID: nil, projectID: nil)
        )
    }

    @Test
    func selectingAcrossEnvironmentsKeepsProjectRoutesCoherent() {
        let localProject = project(id: "local-project", environmentID: "local")
        let remoteProject = project(id: "remote-project", environmentID: "remote")
        let selected = HomeEnvironmentFilter.Selection(
            environmentID: "local",
            projectID: localProject.id
        )

        #expect(
            selected.selectingProject(
                remoteProject.id,
                projects: [localProject, remoteProject]
            ) == .init(environmentID: "remote", projectID: remoteProject.id)
        )
        #expect(
            selected.selectingEnvironment(
                nil,
                projects: [localProject, remoteProject]
            ) == .init(environmentID: nil, projectID: nil)
        )
    }

    @Test
    func duplicateProjectIDsResolveWithinTheTargetEnvironment() {
        let localProject = project(id: "shared", environmentID: "local")
        let remoteProject = project(id: "shared", environmentID: "remote")
        let projects = [localProject, remoteProject]
        let remoteSelection = HomeEnvironmentFilter.Selection(
            environmentID: "remote",
            projectID: "shared"
        )

        #expect(
            remoteSelection.reconciled(
                environments: [
                    environment(id: "local", state: .connected),
                    environment(id: "remote", state: .connected),
                ],
                projects: projects
            ) == remoteSelection
        )
        #expect(
            HomeEnvironmentFilter.Selection(environmentID: "local", projectID: nil)
                .selectingProject(
                    "shared",
                    targetEnvironmentID: "remote",
                    projects: projects
                ) == remoteSelection
        )
        #expect(
            HomeEnvironmentFilter.project(
                id: "shared",
                environmentID: "remote",
                projects: projects
            ) == remoteProject
        )
        #expect(
            HomeEnvironmentFilter.project(
                id: "shared",
                environmentID: nil,
                projects: projects
            ) == nil
        )
    }

    @Test
    func projectArrivalReconcilesAUniqueRawIDThatBecomesAmbiguous() {
        let localProject = project(id: "shared", environmentID: "local")
        let remoteProject = project(id: "shared", environmentID: "remote")
        let allEnvironmentsSelection = HomeEnvironmentFilter.Selection(
            environmentID: nil,
            projectID: "shared"
        )

        #expect(
            allEnvironmentsSelection.reconciled(
                environments: [],
                projects: [localProject]
            ) == allEnvironmentsSelection
        )
        #expect(
            allEnvironmentsSelection.reconciled(
                environments: [],
                projects: [localProject, remoteProject]
            ) == .init(environmentID: nil, projectID: nil)
        )
        #expect(
            HomeEnvironmentFilter.projectIdentities([localProject])
                != HomeEnvironmentFilter.projectIdentities([localProject, remoteProject])
        )
    }

    @Test
    func duplicateNamesReceiveUniqueTokenFreeLabels() throws {
        let environments = [
            FeatureEnvironment(
                id: "local-one",
                name: "Studio",
                endpoint: "https://user:secret@127.0.0.1:17345/path?token=private"
            ),
            FeatureEnvironment(
                id: "local-two",
                name: "Studio",
                endpoint: "http://127.0.0.1:17345/"
            ),
            FeatureEnvironment(
                id: "remote",
                name: "Studio",
                endpoint: "https://relay.example:443/environment"
            ),
        ]

        let labels = HomeEnvironmentFilter.labels(for: environments)
        let localOne = try #require(labels["local-one"])
        let localTwo = try #require(labels["local-two"])
        let remote = try #require(labels["remote"])

        #expect(Set(labels.values).count == environments.count)
        #expect(localOne.contains("127.0.0.1:17345"))
        #expect(localTwo.contains("127.0.0.1:17345"))
        #expect(remote.contains("relay.example:443"))
        #expect(labels.values.allSatisfy { $0.contains("secret") == false })
        #expect(labels.values.allSatisfy { $0.contains("private") == false })
    }

    private func environment(
        id: String,
        state: FeatureConnection.State
    ) -> FeatureEnvironment {
        FeatureEnvironment(
            id: id,
            name: id.capitalized,
            endpoint: "http://\(id)",
            connectionState: state
        )
    }

    private func project(id: String, environmentID: String) -> FeatureProject {
        FeatureProject(
            id: id,
            environmentID: environmentID,
            name: id,
            path: "/\(id)"
        )
    }

    private func thread(
        id: String,
        project: FeatureProject,
        title: String,
        archived: Bool = false
    ) -> FeatureThread {
        FeatureThread(
            id: id,
            projectID: project.id,
            environmentID: project.environmentID,
            title: title,
            createdAt: now,
            updatedAt: now,
            isArchived: archived
        )
    }
}
