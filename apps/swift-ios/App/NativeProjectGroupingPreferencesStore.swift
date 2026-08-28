import Foundation

struct NativeProjectGroupingPreferencesStore {
    struct Entry: Codable, Equatable {
        var mode: FeatureEnvironmentPreferences.ProjectGroupingMode
        var overrides: [String: FeatureEnvironmentPreferences.ProjectGroupingMode]
    }

    private let defaults: UserDefaults

    init(defaults: UserDefaults) {
        self.defaults = defaults
    }

    func load() -> [String: Entry] {
        guard let data = defaults.data(forKey: Self.key),
              let preferences = try? JSONDecoder().decode([String: Entry].self, from: data) else {
            return [:]
        }
        return preferences
    }

    func save(
        environmentID: String,
        mode: FeatureEnvironmentPreferences.ProjectGroupingMode,
        overrides: [String: FeatureEnvironmentPreferences.ProjectGroupingMode]
    ) throws {
        var preferences = load()
        preferences[environmentID] = Entry(mode: mode, overrides: overrides)
        defaults.set(try JSONEncoder().encode(preferences), forKey: Self.key)
    }

    private static let key = "swift-ios.project-grouping-preferences.v1"
}
