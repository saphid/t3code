import Foundation

public struct FeatureThreadVisitStore {
    private static let key = "t3.swiftui.threadLastVisitedAt"
    private static let maximumEntryCount = 5_000

    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func load() -> [String: Date] {
        guard let data = defaults.data(forKey: Self.key),
              let stored = try? JSONDecoder().decode([String: Date].self, from: data) else {
            return [:]
        }
        return stored.filter { $0.key.isEmpty == false }
    }

    func save(_ visits: [String: Date]) {
        let retained = visits
            .sorted { lhs, rhs in
                if lhs.value != rhs.value { return lhs.value > rhs.value }
                return lhs.key < rhs.key
            }
            .prefix(Self.maximumEntryCount)
        let value = Dictionary(uniqueKeysWithValues: retained.map { ($0.key, $0.value) })
        guard let data = try? JSONEncoder().encode(value) else { return }
        defaults.set(data, forKey: Self.key)
    }
}
