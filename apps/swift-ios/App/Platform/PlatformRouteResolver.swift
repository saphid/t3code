import Foundation

enum PlatformRouteResolver {
    static func thread(
        in snapshot: FeatureSnapshot,
        environmentID: String?,
        id: String
    ) -> FeatureThread? {
        let matches = snapshot.threads.filter { thread in
            (environmentID == nil || thread.environmentID == environmentID)
                && (thread.id.caseInsensitiveCompare(id) == .orderedSame
                    || thread.wireID?.caseInsensitiveCompare(id) == .orderedSame)
        }
        guard environmentID != nil || matches.count == 1 else { return nil }
        return matches.max { $0.updatedAt < $1.updatedAt }
    }

    static func project(
        in snapshot: FeatureSnapshot,
        environmentID: String?,
        id: String
    ) -> FeatureProject? {
        let matches = snapshot.projects.filter { project in
            (environmentID == nil || project.environmentID == environmentID)
                && (project.id.caseInsensitiveCompare(id) == .orderedSame
                    || project.wireID?.caseInsensitiveCompare(id) == .orderedSame)
        }
        guard environmentID != nil || matches.count == 1 else { return nil }
        return matches.first
    }
}
