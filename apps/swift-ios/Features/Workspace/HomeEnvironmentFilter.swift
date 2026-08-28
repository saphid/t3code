import Foundation

enum HomeEnvironmentFilter {
    enum ConnectionStatus: Equatable {
        case checking
        case connecting
        case connected
        case unreachable
        case disconnected

        var accessibilityText: String {
            switch self {
            case .checking: "Checking connection"
            case .connecting: "Connecting"
            case .connected: "Connected"
            case .unreachable: "Unreachable, reconnecting"
            case .disconnected: "Disconnected"
            }
        }

        func accessibilityValue(isSelected: Bool) -> String {
            "\(accessibilityText), \(isSelected ? "Included" : "Excluded")"
        }
    }

    struct EnvironmentIdentity: Equatable {
        let id: String
        let isEnabled: Bool
    }

    struct ProjectIdentity: Equatable {
        let id: String
        let environmentID: String
    }

    struct Ownership {
        private let environmentByProjectID: [String: String]

        init(projects: [FeatureProject]) {
            let environmentsByProjectID = Dictionary(grouping: projects, by: \.id)
                .mapValues { Set($0.map(\.environmentID)) }
            environmentByProjectID = environmentsByProjectID.compactMapValues { environmentIDs in
                environmentIDs.count == 1 ? environmentIDs.first : nil
            }
        }

        func environmentID(for thread: FeatureThread) -> String? {
            thread.environmentID ?? environmentByProjectID[thread.projectID]
        }

        func includes(
            _ thread: FeatureThread,
            excluding disabledEnvironmentIDs: Set<String>
        ) -> Bool {
            guard let environmentID = environmentID(for: thread) else { return true }
            return !disabledEnvironmentIDs.contains(environmentID)
        }
    }

    struct Selection: Equatable {
        var disabledEnvironmentIDs: Set<String> = []
        var projectID: String? = nil
        var projectEnvironmentID: String? = nil

        func togglingEnvironment(
            _ environmentID: String,
            isIncluded: Bool,
            environments: [FeatureEnvironment],
            projects: [FeatureProject]
        ) -> Self {
            let optionIDs = Set(HomeEnvironmentFilter.options(from: environments).map(\.id))
            guard optionIDs.contains(environmentID) else { return self }

            var disabledEnvironmentIDs = disabledEnvironmentIDs
            if isIncluded {
                disabledEnvironmentIDs.remove(environmentID)
            } else {
                let includedCount = optionIDs.subtracting(disabledEnvironmentIDs).count
                guard includedCount > 1 else { return self }
                disabledEnvironmentIDs.insert(environmentID)
            }

            return Self(
                disabledEnvironmentIDs: disabledEnvironmentIDs,
                projectID: projectID,
                projectEnvironmentID: projectEnvironmentID
            ).reconciled(environments: environments, projects: projects)
        }

        func includingAll(projects: [FeatureProject]) -> Self {
            let project = HomeEnvironmentFilter.project(
                id: projectID,
                environmentID: projectEnvironmentID,
                projects: projects
            )
            return Self(
                disabledEnvironmentIDs: [],
                projectID: project?.id,
                projectEnvironmentID: project?.environmentID
            )
        }

        func selectingProject(
            _ projectID: String?,
            targetEnvironmentID: String? = nil,
            projects: [FeatureProject]
        ) -> Self {
            guard let projectID else {
                return Self(
                    disabledEnvironmentIDs: disabledEnvironmentIDs,
                    projectID: nil,
                    projectEnvironmentID: nil
                )
            }
            guard let project = HomeEnvironmentFilter.project(
                id: projectID,
                environmentID: targetEnvironmentID,
                projects: projects
            ) else { return self }
            var disabledEnvironmentIDs = disabledEnvironmentIDs
            disabledEnvironmentIDs.remove(project.environmentID)
            return Self(
                disabledEnvironmentIDs: disabledEnvironmentIDs,
                projectID: project.id,
                projectEnvironmentID: project.environmentID
            )
        }

        func reconciled(
            environments: [FeatureEnvironment],
            projects: [FeatureProject]
        ) -> Self {
            let options = HomeEnvironmentFilter.options(from: environments)
            let optionIDs = Set(options.map(\.id))
            var validDisabledIDs = disabledEnvironmentIDs.intersection(optionIDs)
            if !optionIDs.isEmpty, optionIDs.isSubset(of: validDisabledIDs) {
                validDisabledIDs.removeAll()
            }

            let project = HomeEnvironmentFilter.project(
                id: projectID,
                environmentID: projectEnvironmentID,
                projects: projects
            )
            guard let project,
                  optionIDs.contains(project.environmentID),
                  !validDisabledIDs.contains(project.environmentID) else {
                return Self(
                    disabledEnvironmentIDs: validDisabledIDs,
                    projectID: nil,
                    projectEnvironmentID: nil
                )
            }
            return Self(
                disabledEnvironmentIDs: validDisabledIDs,
                projectID: project.id,
                projectEnvironmentID: project.environmentID
            )
        }
    }

    static func project(
        id: String?,
        environmentID: String?,
        projects: [FeatureProject]
    ) -> FeatureProject? {
        guard let id else { return nil }
        let matches = projects.filter { $0.id == id }
        if let environmentID,
           let environmentMatch = matches.first(where: { $0.environmentID == environmentID }) {
            return environmentMatch
        }
        return matches.count == 1 ? matches[0] : nil
    }

    static func projectIdentities(_ projects: [FeatureProject]) -> [ProjectIdentity] {
        projects.map { ProjectIdentity(id: $0.id, environmentID: $0.environmentID) }
    }

    static func environmentIdentities(
        _ environments: [FeatureEnvironment]
    ) -> [EnvironmentIdentity] {
        environments.map { EnvironmentIdentity(id: $0.id, isEnabled: $0.isEnabled) }
    }

    static func options(from environments: [FeatureEnvironment]) -> [FeatureEnvironment] {
        environments.filter(\.isEnabled)
    }

    static func shouldShow(environments: [FeatureEnvironment]) -> Bool {
        options(from: environments).count > 1
    }

    static func connectionStatus(
        for environment: FeatureEnvironment
    ) -> ConnectionStatus {
        switch environment.connectionState {
        case .connected: .connected
        case .connecting: .connecting
        case .reconnecting: .unreachable
        case .disconnected: .disconnected
        case nil: .checking
        }
    }

    static func labels(for environments: [FeatureEnvironment]) -> [String: String] {
        let nameCounts = Dictionary(grouping: environments, by: \.name).mapValues(\.count)
        let baseLabels = environments.map { environment in
            let name = environment.name
            guard nameCounts[name, default: 0] > 1 else { return (environment, name) }
            return (environment, "\(name) · \(endpointLabel(environment.endpoint))")
        }
        let duplicateRanks = Dictionary(grouping: baseLabels, by: \.1).flatMap { label, entries in
            entries.sorted { $0.0.id < $1.0.id }.enumerated().map { offset, entry in
                (entry.0.id, (label: label, rank: offset + 1, count: entries.count))
            }
        }
        let rankByEnvironmentID = Dictionary(uniqueKeysWithValues: duplicateRanks)
        return Dictionary(uniqueKeysWithValues: baseLabels.map { environment, baseLabel in
            let duplicate = rankByEnvironmentID[environment.id]
            let label = (duplicate?.count ?? 0) > 1
                ? "\(baseLabel) · \(duplicate?.rank ?? 1)"
                : baseLabel
            return (environment.id, label)
        })
    }

    private static func endpointLabel(_ endpoint: String) -> String {
        guard let components = URLComponents(string: endpoint),
              let host = components.host else {
            return "Saved server"
        }
        guard let port = components.port else { return host }
        return "\(host):\(port)"
    }
}
