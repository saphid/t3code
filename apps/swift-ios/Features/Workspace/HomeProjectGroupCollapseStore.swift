import Foundation

struct HomeProjectGroupCollapseStore {
    private static let key = "t3.swiftui.home.collapsedProjectGroups"

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func load() -> Set<String> {
        guard let data = defaults.data(forKey: Self.key),
              let values = try? JSONDecoder().decode([String].self, from: data) else {
            return []
        }
        return Set(values)
    }

    func save(_ groupIDs: Set<String>) {
        let values = groupIDs.sorted()
        guard let data = try? JSONEncoder().encode(values) else { return }
        defaults.set(data, forKey: Self.key)
    }

    @discardableResult
    func toggle(_ groupID: String) -> Set<String> {
        var values = load()
        if values.remove(groupID) == nil {
            values.insert(groupID)
        }
        save(values)
        return values
    }

    @discardableResult
    func reconcile(
        validGroupIDs: Set<String>,
        catalogIsComplete: Bool
    ) -> Set<String> {
        let current = load()
        guard catalogIsComplete else { return current }
        let reconciled = current.intersection(validGroupIDs)
        if reconciled != current {
            save(reconciled)
        }
        return reconciled
    }
}
