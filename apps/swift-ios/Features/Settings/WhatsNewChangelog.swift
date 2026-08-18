import Foundation

/// The "What's New" entries embedded in a build.
///
/// The payload rides in the app bundle as base64-encoded JSON under the
/// `T3BuildChangelog` Info.plist key, expanded from the `T3_BUILD_CHANGELOG`
/// build setting at build time — the same injection-only shape used to record
/// build identity. A build that injects nothing simply has no changelog, and
/// the Settings entry point hides rather than showing a placeholder.
struct WhatsNewChangelog: Codable, Equatable, Sendable {
    struct Entry: Codable, Equatable, Sendable {
        let title: String
        let summary: String?
    }

    let entries: [Entry]

    static let infoDictionaryKey = "T3BuildChangelog"

    static func load(info: [String: Any]?) -> WhatsNewChangelog? {
        guard let encoded = info?[infoDictionaryKey] as? String else { return nil }
        return decode(encoded)
    }

    /// Decodes an embedded payload, returning `nil` for anything a build can
    /// plausibly leave behind: an absent value, an unexpanded `$(…)` setting,
    /// something that is not base64 JSON, or a changelog with nothing to say.
    static func decode(_ encoded: String) -> WhatsNewChangelog? {
        let trimmed = encoded.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              !trimmed.hasPrefix("$("),
              let data = Data(base64Encoded: trimmed),
              let decoded = try? JSONDecoder().decode(WhatsNewChangelog.self, from: data)
        else { return nil }

        let entries = decoded.entries.compactMap(\.normalized)
        guard !entries.isEmpty else { return nil }
        return WhatsNewChangelog(entries: entries)
    }

    /// `0.1.0 (29)` for the running bundle, or `nil` when either value is
    /// missing or unexpanded.
    static func buildLabel(info: [String: Any]?) -> String? {
        guard let version = metadataValue("CFBundleShortVersionString", info: info),
              let build = metadataValue("CFBundleVersion", info: info)
        else { return nil }
        return "\(version) (\(build))"
    }

    private static func metadataValue(_ key: String, info: [String: Any]?) -> String? {
        guard let value = info?[key] as? String else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !trimmed.hasPrefix("$(") else { return nil }
        return trimmed
    }
}

extension WhatsNewChangelog.Entry {
    /// Drops entries with no title and treats a blank summary as absent, so a
    /// sloppy payload degrades to fewer rows instead of empty ones.
    var normalized: WhatsNewChangelog.Entry? {
        let title = self.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else { return nil }
        let summary = self.summary?.trimmingCharacters(in: .whitespacesAndNewlines)
        return WhatsNewChangelog.Entry(
            title: title,
            summary: (summary?.isEmpty ?? true) ? nil : summary
        )
    }
}
