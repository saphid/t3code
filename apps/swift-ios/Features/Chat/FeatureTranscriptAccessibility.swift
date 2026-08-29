import Foundation

struct FeatureTranscriptAccessibilityHeading: Equatable, Hashable {
    let messageID: String
    let label: String

    var accessibilityIdentifier: String {
        "message-heading-\(messageID)"
    }
}

enum FeatureTranscriptAccessibilityMetadata {
    static func assistantLabel(modelName: String?, providerName: String?) -> String {
        normalizedLabel(modelName) ?? normalizedLabel(providerName) ?? "Assistant"
    }

    static func heading(
        for message: FeatureMessage,
        assistantLabel: String
    ) -> FeatureTranscriptAccessibilityHeading? {
        let label: String? = switch message.role {
        case .user:
            "You"
        case .assistant:
            assistantLabel
        case .tool, .system:
            nil
        }
        guard let label else { return nil }
        return FeatureTranscriptAccessibilityHeading(messageID: message.id, label: label)
    }

    static func headings(
        for messages: [FeatureMessage],
        assistantLabel: String
    ) -> [FeatureTranscriptAccessibilityHeading] {
        uniqueMessages(messages).compactMap {
            heading(for: $0, assistantLabel: assistantLabel)
        }
    }

    static func uniqueMessages(_ messages: [FeatureMessage]) -> [FeatureMessage] {
        var seenMessageIDs = Set<String>()
        return Array(messages.reversed().filter {
            seenMessageIDs.insert($0.id).inserted
        }.reversed())
    }

    private static func normalizedLabel(_ value: String?) -> String? {
        guard let label = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !label.isEmpty else {
            return nil
        }
        return label
    }
}
