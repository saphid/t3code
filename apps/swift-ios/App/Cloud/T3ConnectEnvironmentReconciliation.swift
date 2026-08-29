import Foundation

struct T3ConnectEnvironmentReconciliationPlan: Equatable, Sendable {
    let connect: [T3ConnectRelayEnvironment]
    let removeEnvironmentIDs: [String]

    init(
        discovered: [T3ConnectRelayEnvironment],
        saved: [Environment]
    ) {
        let discovered = Self.unique(discovered)
        let discoveredIDs = Set(discovered.map(\.environmentId))
        let savedManaged = saved.filter { $0.kind == .managedDPoP }
        let savedManagedByID = Dictionary(
            uniqueKeysWithValues: savedManaged.map { ($0.id, $0) }
        )

        connect = discovered.filter { linked in
            guard let saved = savedManagedByID[linked.environmentId] else { return true }
            return saved.httpBaseURL != linked.endpoint.httpBaseURL
                || saved.webSocketBaseURL != linked.endpoint.webSocketBaseURL
        }
        removeEnvironmentIDs = savedManaged.compactMap {
            discoveredIDs.contains($0.id) ? nil : $0.id
        }
    }

    static func unique(
        _ environments: [T3ConnectRelayEnvironment]
    ) -> [T3ConnectRelayEnvironment] {
        var seen = Set<String>()
        return environments.filter { seen.insert($0.environmentId).inserted }
    }
}
