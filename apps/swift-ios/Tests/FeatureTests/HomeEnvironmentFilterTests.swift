import Foundation
import Testing
@testable import T3Code

@Suite("Home environment filter")
struct HomeEnvironmentFilterTests {
    private let now = Date(timeIntervalSince1970: 2_000_000)

    @Test
    func presentationFiltersMultipleShelvesAndRestoresAll() {
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
            disabledEnvironmentIDs: ["local"],
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
    func optionsAreMultiSelectableButKeepOneEnvironmentIncluded() {
        let environments = [
            environment(id: "local", state: .connected),
            environment(id: "remote", state: .connected),
            environment(id: "studio", state: .connected),
        ]
        let projects = environments.map { project(id: "\($0.id)-project", environmentID: $0.id) }

        let withoutLocal = HomeEnvironmentFilter.Selection().togglingEnvironment(
            "local",
            isIncluded: false,
            environments: environments,
            projects: projects
        )
        let onlyStudio = withoutLocal.togglingEnvironment(
            "remote",
            isIncluded: false,
            environments: environments,
            projects: projects
        )
        let refusingEmpty = onlyStudio.togglingEnvironment(
            "studio",
            isIncluded: false,
            environments: environments,
            projects: projects
        )
        let localRestored = onlyStudio.togglingEnvironment(
            "local",
            isIncluded: true,
            environments: environments,
            projects: projects
        )

        #expect(withoutLocal.disabledEnvironmentIDs == ["local"])
        #expect(onlyStudio.disabledEnvironmentIDs == ["local", "remote"])
        #expect(refusingEmpty == onlyStudio)
        #expect(localRestored.disabledEnvironmentIDs == ["remote"])
    }

    @Test
    func selectionSurvivesConnectionStateChangesAndIncludesNewEnvironments() {
        let selected = HomeEnvironmentFilter.Selection(disabledEnvironmentIDs: ["local"])
        let connecting = [
            environment(id: "local", state: .connecting),
            environment(id: "remote", state: .connected),
        ]
        let disconnected = [
            environment(id: "local", state: .disconnected),
            environment(id: "remote", state: .connected),
        ]
        let withNewEnvironment = disconnected + [environment(id: "studio", state: .connected)]

        #expect(selected.reconciled(environments: connecting, projects: []) == selected)
        #expect(selected.reconciled(environments: disconnected, projects: []) == selected)
        #expect(
            selected.reconciled(environments: withNewEnvironment, projects: [])
                .disabledEnvironmentIDs == ["local"]
        )
    }

    @Test
    func catalogChangesPruneInvalidChoicesAndRecoverFromAnEmptySelection() {
        let local = environment(id: "local", state: .connected)
        let remote = environment(id: "remote", state: .connected)
        let selected = HomeEnvironmentFilter.Selection(
            disabledEnvironmentIDs: ["local"],
            projectID: "remote-project",
            projectEnvironmentID: "remote"
        )
        let remoteProject = project(id: "remote-project", environmentID: "remote")

        #expect(
            selected.reconciled(environments: [remote], projects: [remoteProject])
                == .init(projectID: remoteProject.id, projectEnvironmentID: "remote")
        )
        #expect(
            HomeEnvironmentFilter.Selection(disabledEnvironmentIDs: ["local"])
                .reconciled(environments: [local], projects: []) == .init()
        )
    }

    @Test
    func disabledOwningEnvironmentClearsAProjectThatRemainsCached() {
        let localProject = project(id: "local-project", environmentID: "local")
        let local = environment(id: "local", state: .connected)
        let remote = environment(id: "remote", state: .connected)
        let disabledLocal = FeatureEnvironment(
            id: local.id,
            name: local.name,
            endpoint: local.endpoint,
            isEnabled: false,
            connectionState: .disconnected
        )
        let selected = HomeEnvironmentFilter.Selection(
            disabledEnvironmentIDs: ["remote"],
            projectID: localProject.id,
            projectEnvironmentID: local.id
        )

        let reconciled = selected.reconciled(
            environments: [disabledLocal, remote],
            projects: [localProject]
        )

        #expect(reconciled == .init())
    }

    @Test
    func disablingTheSelectedProjectsEnvironmentClearsOnlyProjectScope() {
        let localProject = project(id: "local-project", environmentID: "local")
        let remoteProject = project(id: "remote-project", environmentID: "remote")
        let environments = [
            environment(id: "local", state: .connected),
            environment(id: "remote", state: .connected),
        ]
        let selected = HomeEnvironmentFilter.Selection(
            projectID: localProject.id,
            projectEnvironmentID: "local"
        )

        let result = selected.togglingEnvironment(
            "local",
            isIncluded: false,
            environments: environments,
            projects: [localProject, remoteProject]
        )

        #expect(result.disabledEnvironmentIDs == ["local"])
        #expect(result.projectID == nil)
        #expect(result.projectEnvironmentID == nil)
    }

    @Test
    func projectAndEnvironmentFiltersComposeWithoutLeakingDuplicateIDs() {
        let localProject = project(id: "shared", environmentID: "local")
        let remoteProject = project(id: "shared", environmentID: "remote")
        let snapshot = FeatureSnapshot(
            projects: [localProject, remoteProject],
            threads: [
                thread(id: "local", project: localProject, title: "Local"),
                thread(id: "remote", project: remoteProject, title: "Remote"),
            ]
        )

        let presentation = HomePresentation(
            snapshot: snapshot,
            query: "",
            projectID: "shared",
            projectEnvironmentID: "remote",
            now: now
        )
        let selection = HomeEnvironmentFilter.Selection().selectingProject(
            "shared",
            targetEnvironmentID: "remote",
            projects: [localProject, remoteProject]
        )

        #expect(presentation.active.map(\.id) == ["remote"])
        #expect(
            selection == .init(
                projectID: "shared",
                projectEnvironmentID: "remote"
            )
        )
    }

    @Test
    func routingToAnExcludedProjectReincludesItsEnvironment() {
        let localProject = project(id: "local-project", environmentID: "local")
        let selection = HomeEnvironmentFilter.Selection(
            disabledEnvironmentIDs: ["local"],
            projectID: "remote-project",
            projectEnvironmentID: "remote"
        )

        let routed = selection.selectingProject(
            localProject.id,
            projects: [localProject]
        )

        #expect(
            routed == .init(
                projectID: localProject.id,
                projectEnvironmentID: localProject.environmentID
            )
        )
        #expect(
            routed.selectingProject(nil, projects: [localProject]) == .init()
        )
    }

    @Test
    func visibilityRequiresMoreThanOneEnabledEnvironment() {
        let local = environment(id: "local", state: .connected)
        let remote = environment(id: "remote", state: .connected)
        let disabledRemote = FeatureEnvironment(
            id: remote.id,
            name: remote.name,
            endpoint: remote.endpoint,
            isEnabled: false,
            connectionState: .disconnected
        )

        #expect(HomeEnvironmentFilter.shouldShow(environments: [local, remote]))
        #expect(HomeEnvironmentFilter.shouldShow(environments: [local, disabledRemote]) == false)
        #expect(HomeEnvironmentFilter.shouldShow(environments: [local]) == false)
    }

    @Test
    func optionsIncludeOnlyEnabledEnvironments() {
        let enabled = environment(id: "enabled", state: .connected)
        let disabled = FeatureEnvironment(
            id: "disabled",
            name: "Disabled",
            endpoint: "http://disabled",
            isEnabled: false,
            connectionState: .disconnected
        )

        #expect(HomeEnvironmentFilter.options(from: [enabled, disabled]) == [enabled])
    }

    @Test(
        arguments: [
            (FeatureConnection.State?.none, HomeEnvironmentFilter.ConnectionStatus.checking),
            (.some(.connecting), .connecting),
            (.some(.connected), .connected),
            (.some(.reconnecting), .unreachable),
            (.some(.disconnected), .disconnected),
            (.some(.relinkRequired), .relinkRequired),
        ]
    )
    func connectionStatusMapsLiveState(
        state: FeatureConnection.State?,
        expected: HomeEnvironmentFilter.ConnectionStatus
    ) {
        let environment = FeatureEnvironment(
            id: "environment",
            name: "Environment",
            endpoint: "http://environment",
            connectionState: state
        )

        #expect(HomeEnvironmentFilter.connectionStatus(for: environment) == expected)
        #expect(expected.accessibilityText.isEmpty == false)
        #expect(expected.accessibilityValue(isSelected: true).hasSuffix(", Included"))
        #expect(expected.accessibilityValue(isSelected: false).hasSuffix(", Excluded"))
    }

    @Test
    func ambiguousLegacyOwnershipStaysVisibleWhileExplicitOwnershipFilters() {
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
        #expect(ownership.includes(legacy, excluding: ["remote"]))
        #expect(ownership.includes(explicit, excluding: ["remote"]) == false)
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
