import Foundation
import Testing
@testable import T3Code

@Suite("Project grouping settings")
struct ProjectGroupingSettingsTests {
    @Test
    func emptyStateShowsTheInheritedRepositoryDefault() {
        #expect(
            ProjectGroupingSettingsPresentation.settingsSummary(in: FeatureSnapshot())
                == "Group by repository"
        )
    }

    @Test
    func presentationUsesEnabledEnvironmentsAndReportsDifferentDefaults() {
        let snapshot = FeatureSnapshot(
            environments: [
                FeatureEnvironment(
                    id: "beta",
                    name: "Beta",
                    endpoint: "https://beta.example",
                    isEnabled: true
                ),
                FeatureEnvironment(
                    id: "alpha",
                    name: "Alpha",
                    endpoint: "https://alpha.example",
                    isEnabled: true
                ),
                FeatureEnvironment(
                    id: "off",
                    name: "Off",
                    endpoint: "https://off.example",
                    isEnabled: false
                ),
            ],
            preferencesByEnvironment: [
                "alpha": FeatureEnvironmentPreferences(projectGroupingMode: .repository),
                "beta": FeatureEnvironmentPreferences(projectGroupingMode: .separate),
            ]
        )

        #expect(
            ProjectGroupingSettingsPresentation.environments(in: snapshot).map(\.id)
                == ["alpha", "beta"]
        )
        #expect(ProjectGroupingSettingsPresentation.settingsSummary(in: snapshot) == "Varies")
    }

    @Test
    func projectRowsUseTheSameNormalizedOverrideKeyAsHome() throws {
        let older = FeatureProject(
            id: "older",
            environmentID: "environment",
            name: "Old title",
            path: "/work/t3code/",
            updatedAt: "2026-08-20T00:00:00Z"
        )
        let newer = FeatureProject(
            id: "newer",
            environmentID: "environment",
            name: "T3 Code",
            path: "/work/t3code",
            updatedAt: "2026-08-21T00:00:00Z"
        )
        let snapshot = FeatureSnapshot(projects: [older, newer])

        let project = try #require(
            ProjectGroupingSettingsPresentation.projects(
                in: snapshot,
                environmentID: "environment"
            ).only
        )

        #expect(project.id == newer.id)
        #expect(
            DailyUXProjectGrouping.overrideKey(for: project)
                == "environment:/work/t3code"
        )
    }

    @Test
    func clearingOverrideRestoresTheGlobalHomeGrouping() {
        let project = FeatureProject(
            id: "project",
            environmentID: "environment",
            name: "T3 Code",
            path: "/work/t3code",
            repositoryIdentity: FeatureRepositoryIdentity(canonicalKey: "github.com/t3code")
        )
        let key = DailyUXProjectGrouping.overrideKey(for: project)

        #expect(
            DailyUXProjectGrouping.logicalProjectID(
                for: project,
                mode: .repository,
                overrides: [key: .separate]
            ) == key
        )
        #expect(
            DailyUXProjectGrouping.logicalProjectID(
                for: project,
                mode: .repository,
                overrides: [:]
            ) == "github.com/t3code"
        )
    }

    @Test
    func homeProjectFilterUsesTheEffectiveGroupingRules() {
        let identity = FeatureRepositoryIdentity(canonicalKey: "github.com/t3code")
        let main = FeatureProject(
            id: "main",
            environmentID: "environment",
            name: "T3 Code Main",
            path: "/work/t3code",
            repositoryIdentity: identity
        )
        let checkout = FeatureProject(
            id: "checkout",
            environmentID: "environment",
            name: "T3 Code Checkout",
            path: "/work/t3code-checkout",
            repositoryIdentity: identity
        )
        let grouped = FeatureSnapshot(
            projects: [main, checkout],
            preferencesByEnvironment: [
                "environment": FeatureEnvironmentPreferences(projectGroupingMode: .repository),
            ]
        )
        var overridden = grouped
        overridden.preferencesByEnvironment?["environment"]?.projectGroupingOverrides = [
            DailyUXProjectGrouping.overrideKey(for: checkout): .separate,
        ]
        var separate = grouped
        separate.preferencesByEnvironment?["environment"]?.projectGroupingMode = .separate

        #expect(
            DailyUXCreationContext.projectFilterProjects(
                in: grouped,
                environmentID: nil
            ).count == 1
        )
        #expect(
            DailyUXCreationContext.projectFilterProjects(
                in: overridden,
                environmentID: nil
            ).count == 2
        )
        #expect(DailyUXCreationContext.projectGroups(in: overridden).contains {
            $0.name == "T3 Code Checkout"
        })
        #expect(
            Set(DailyUXCreationContext.projectGroups(in: separate).map(\.name))
                == ["T3 Code Main", "T3 Code Checkout"]
        )

        overridden.preferencesByEnvironment?["environment"]?.projectGroupingOverrides = [:]
        #expect(
            DailyUXCreationContext.projectFilterProjects(
                in: overridden,
                environmentID: nil
            ).count == 1
        )
    }

    @Test
    func devicePreferencesPersistIndependentlyForEachEnvironment() throws {
        let suiteName = "ProjectGroupingSettingsTests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let store = NativeProjectGroupingPreferencesStore(defaults: defaults)

        try store.save(
            environmentID: "alpha",
            mode: .separate,
            overrides: ["alpha:/work/t3code": .repository]
        )
        try store.save(
            environmentID: "beta",
            mode: .repositoryPath,
            overrides: [:]
        )

        let reloaded = NativeProjectGroupingPreferencesStore(defaults: defaults).load()
        #expect(reloaded["alpha"]?.mode == .separate)
        #expect(reloaded["alpha"]?.overrides == ["alpha:/work/t3code": .repository])
        #expect(reloaded["beta"]?.mode == .repositoryPath)
        #expect(reloaded["beta"]?.overrides == [:])
    }

    @Test
    func invalidDevicePreferencesFallBackToNoSavedChoice() throws {
        let suiteName = "ProjectGroupingSettingsTests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        defaults.set(Data("not-json".utf8), forKey: "swift-ios.project-grouping-preferences.v1")

        #expect(NativeProjectGroupingPreferencesStore(defaults: defaults).load().isEmpty)
    }
}

private extension Collection {
    var only: Element? {
        count == 1 ? first : nil
    }
}
