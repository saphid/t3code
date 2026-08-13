import Foundation

struct BuildTestingVerdictStore {
    static func verdicts(
        for manifest: BuildTestingManifest,
        defaults: UserDefaults = .standard
    ) -> [String: BuildTestingDecision.Verdict] {
        guard let data = defaults.data(forKey: key(for: manifest)),
            let values = try? JSONDecoder().decode([String: String].self, from: data)
        else { return [:] }
        return values.reduce(into: [:]) { result, item in
            result[item.key] = BuildTestingDecision.Verdict(rawValue: item.value)
        }
    }

    static func record(
        _ verdict: BuildTestingDecision.Verdict,
        entryID: String,
        manifest: BuildTestingManifest,
        defaults: UserDefaults = .standard
    ) {
        var values = verdicts(for: manifest, defaults: defaults)
        values[entryID] = verdict
        let encoded = values.mapValues(\.rawValue)
        defaults.set(try? JSONEncoder().encode(encoded), forKey: key(for: manifest))
    }

    private static func key(for manifest: BuildTestingManifest) -> String {
        "build-testing-verdicts.v1.\(manifest.channel.rawValue).\(manifest.build).\(manifest.revision)"
    }
}
