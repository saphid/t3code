import Foundation

struct BuildTestingCurrentReviewStore {
    static func entryID(
        for manifest: BuildTestingManifest,
        defaults: UserDefaults = .standard
    ) -> String? {
        guard let entryID = defaults.string(forKey: key(for: manifest)),
              manifest.entries.contains(where: { $0.id == entryID })
        else { return nil }
        return entryID
    }

    static func select(
        entryID: String,
        manifest: BuildTestingManifest,
        defaults: UserDefaults = .standard
    ) {
        guard manifest.entries.contains(where: { $0.id == entryID }) else { return }
        defaults.set(entryID, forKey: key(for: manifest))
    }

    #if DEBUG
    static func clear(
        for manifest: BuildTestingManifest,
        defaults: UserDefaults = .standard
    ) {
        defaults.removeObject(forKey: key(for: manifest))
    }
    #endif

    private static func key(for manifest: BuildTestingManifest) -> String {
        "build-testing-current-review.v1.\(manifest.channel.rawValue).\(manifest.build).\(manifest.revision)"
    }
}
