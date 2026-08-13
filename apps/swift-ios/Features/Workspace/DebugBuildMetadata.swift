import Foundation

struct DebugBuildMetadata: Equatable {
    let build: String
    let baseRef: String?
    let ahead: Int?
    let behind: Int?

    init(info: [String: Any]?) {
        build = Self.nonemptyValue("CFBundleVersion", info: info) ?? "?"
        baseRef = Self.nonemptyValue("T3GitBaseRef", info: info)
        ahead = Self.nonnegativeCount("T3GitAheadCount", info: info)
        behind = Self.nonnegativeCount("T3GitBehindCount", info: info)
    }

    var distanceLabel: String? {
        guard let baseRef, let ahead, let behind else { return nil }
        let displayBaseRef = baseRef.split(separator: "/").last.map(String.init) ?? baseRef
        return "\(ahead)↑ \(behind)↓ \(displayBaseRef)"
    }

    var accessibilityLabel: String {
        guard let baseRef, let ahead, let behind else {
            return "Development build \(build)"
        }
        return "Development build \(build), compared with \(baseRef): \(ahead) commits ahead and \(behind) commits behind"
    }

    private static func nonemptyValue(_ key: String, info: [String: Any]?) -> String? {
        guard let value = info?[key] as? String,
              !value.isEmpty,
              !value.hasPrefix("$(")
        else { return nil }
        return value
    }

    private static func nonnegativeCount(_ key: String, info: [String: Any]?) -> Int? {
        guard let value = nonemptyValue(key, info: info),
              let count = Int(value),
              count >= 0
        else { return nil }
        return count
    }
}
