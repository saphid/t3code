import Foundation

struct DebugBuildMetadata: Equatable {
    let commit: String
    let repositoryURL: String?
    let baseRef: String?
    let ahead: Int?
    let behind: Int?

    init(info: [String: Any]?) {
        commit = Self.resolvedValue("T3GitCommit", info: info) ?? "Unknown"
        let repository = Self.resolvedValue("T3GitRepoURL", info: info)
        repositoryURL = repository?.hasPrefix("https://github.com/") == true ? repository : nil
        baseRef = Self.resolvedValue("T3GitBaseRef", info: info)
        ahead = Self.nonnegativeCount("T3GitAheadCount", info: info)
        behind = Self.nonnegativeCount("T3GitBehindCount", info: info)
    }

    var sourceLabel: String { commit }

    var distanceLabel: String {
        guard let baseRef else { return "Unknown" }
        guard let ahead, let behind else { return "Unknown · \(displayBaseRef(baseRef))" }
        return "\(ahead)↑ \(behind)↓ \(displayBaseRef(baseRef))"
    }

    var accessibilityLabel: String {
        guard let baseRef else {
            return "Development source \(commit). Upstream comparison unavailable."
        }
        guard let ahead, let behind else {
            return "Development source \(commit). Comparison with \(baseRef) unavailable."
        }
        let aheadUnit = ahead == 1 ? "commit" : "commits"
        let behindUnit = behind == 1 ? "commit" : "commits"
        return "Development source \(commit), compared with \(baseRef): \(ahead) \(aheadUnit) ahead and \(behind) \(behindUnit) behind."
    }

    var commitURL: URL? {
        guard let repositoryURL, commit != "Unknown" else { return nil }
        let cleanCommit = commit.hasSuffix("-dirty")
            ? String(commit.dropLast("-dirty".count))
            : commit
        return URL(string: "\(repositoryURL)/commit/\(cleanCommit)")
    }

    private func displayBaseRef(_ value: String) -> String {
        value.split(separator: "/").last.map(String.init) ?? value
    }

    private static func resolvedValue(_ key: String, info: [String: Any]?) -> String? {
        guard let rawValue = info?[key] as? String else { return nil }
        let value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, !value.hasPrefix("$(") else { return nil }
        return value
    }

    private static func nonnegativeCount(_ key: String, info: [String: Any]?) -> Int? {
        guard let value = resolvedValue(key, info: info),
              let count = Int(value),
              count >= 0
        else { return nil }
        return count
    }
}
