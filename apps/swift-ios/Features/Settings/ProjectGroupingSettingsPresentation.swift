import Foundation

struct ProjectGroupingSettingsPresentation {
    static func environments(in snapshot: FeatureSnapshot) -> [FeatureEnvironment] {
        snapshot.environments
            .filter(\.isEnabled)
            .sorted {
                let comparison = $0.name.localizedCaseInsensitiveCompare($1.name)
                return comparison == .orderedSame
                    ? $0.id < $1.id
                    : comparison == .orderedAscending
            }
    }

    static func projects(
        in snapshot: FeatureSnapshot,
        environmentID: String
    ) -> [FeatureProject] {
        var projectsByKey: [String: FeatureProject] = [:]
        for project in snapshot.projects where project.environmentID == environmentID {
            let key = DailyUXProjectGrouping.overrideKey(for: project)
            if let current = projectsByKey[key], freshness(current) >= freshness(project) {
                continue
            }
            projectsByKey[key] = project
        }
        return projectsByKey.values.sorted {
            let comparison = $0.name.localizedCaseInsensitiveCompare($1.name)
            return comparison == .orderedSame
                ? DailyUXProjectGrouping.overrideKey(for: $0)
                    < DailyUXProjectGrouping.overrideKey(for: $1)
                : comparison == .orderedAscending
        }
    }

    static func preferences(
        in snapshot: FeatureSnapshot,
        environmentID: String
    ) -> FeatureEnvironmentPreferences {
        snapshot.preferencesByEnvironment?[environmentID]
            ?? FeatureEnvironmentPreferences()
    }

    static func modeLabel(
        _ mode: FeatureEnvironmentPreferences.ProjectGroupingMode
    ) -> String {
        switch mode {
        case .repository: "Group by repository"
        case .repositoryPath: "Group by repository path"
        case .separate: "Keep separate"
        }
    }

    static func settingsSummary(in snapshot: FeatureSnapshot) -> String {
        let environments = environments(in: snapshot)
        guard !environments.isEmpty else { return modeLabel(.repository) }
        let modes = Set(environments.map {
            preferences(in: snapshot, environmentID: $0.id).projectGroupingMode
        })
        guard modes.count == 1, let mode = modes.first else { return "Varies" }
        return modeLabel(mode)
    }

    private static func freshness(_ project: FeatureProject) -> String {
        project.updatedAt ?? project.createdAt ?? ""
    }
}
