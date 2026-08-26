import Foundation

enum HomeEnvironmentFilter {
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

        func includes(_ thread: FeatureThread, in environmentID: String?) -> Bool {
            guard let environmentID else { return true }
            return self.environmentID(for: thread) == environmentID
        }
    }

    struct Selection: Equatable {
        var environmentID: String?
        var projectID: String?

        func selectingEnvironment(
            _ environmentID: String?,
            projects: [FeatureProject]
        ) -> Self {
            guard let environmentID else {
                return Self(environmentID: nil, projectID: nil)
            }
            let project = HomeEnvironmentFilter.project(
                id: projectID,
                environmentID: self.environmentID,
                projects: projects
            )
            return Self(
                environmentID: environmentID,
                projectID: project?.environmentID == environmentID ? projectID : nil
            )
        }

        func selectingProject(
            _ projectID: String,
            targetEnvironmentID: String? = nil,
            projects: [FeatureProject]
        ) -> Self {
            let matches = projects.filter { $0.id == projectID }
            let lookupEnvironmentID = targetEnvironmentID ?? environmentID
            guard let project = HomeEnvironmentFilter.project(
                id: projectID,
                environmentID: lookupEnvironmentID,
                projects: projects
            ) else { return self }
            let needsEnvironmentDisambiguation = matches.count > 1
            return Self(
                environmentID: environmentID == nil && !needsEnvironmentDisambiguation
                    ? nil
                    : project.environmentID,
                projectID: projectID
            )
        }

        func reconciled(
            environments: [FeatureEnvironment],
            projects: [FeatureProject]
        ) -> Self {
            guard let environmentID else {
                let project = HomeEnvironmentFilter.project(
                    id: projectID,
                    environmentID: nil,
                    projects: projects
                )
                return Self(environmentID: nil, projectID: project?.id)
            }
            guard environments.contains(where: { $0.id == environmentID }) else {
                return Self(environmentID: nil, projectID: nil)
            }
            let project = HomeEnvironmentFilter.project(
                id: projectID,
                environmentID: environmentID,
                projects: projects
            )
            return Self(
                environmentID: environmentID,
                projectID: project?.environmentID == environmentID ? projectID : nil
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
