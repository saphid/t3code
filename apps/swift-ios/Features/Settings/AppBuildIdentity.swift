import Foundation

public struct AppBuildIdentity: Equatable, Sendable {
    public let channel: String
    public let marketingVersion: String
    public let buildNumber: String
    public let sourceRevision: String

    public init(infoDictionary: [String: Any]) {
        channel = Self.channelName(infoDictionary["T3BuildChannel"] as? String)
        marketingVersion = Self.value(
            infoDictionary["CFBundleShortVersionString"] as? String
        )
        buildNumber = Self.value(infoDictionary["CFBundleVersion"] as? String)

        let revision = Self.value(infoDictionary["T3GitCommit"] as? String)
        sourceRevision = revision == "Unknown"
            ? revision
            : String(revision.prefix(8))
    }

    public static var current: AppBuildIdentity {
        AppBuildIdentity(infoDictionary: Bundle.main.infoDictionary ?? [:])
    }

    private static func channelName(_ value: String?) -> String {
        let channel = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !isUnexpandedBuildSetting(channel) else { return "Unknown" }
        switch channel.lowercased() {
        case "": return "Live"
        case "dev": return "Dev"
        case "test": return "Test"
        case "live": return "Live"
        default: return channel
        }
    }

    private static func value(_ value: String?) -> String {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty || isUnexpandedBuildSetting(trimmed) ? "Unknown" : trimmed
    }

    private static func isUnexpandedBuildSetting(_ value: String) -> Bool {
        value.hasPrefix("$(") && value.hasSuffix(")")
    }
}
