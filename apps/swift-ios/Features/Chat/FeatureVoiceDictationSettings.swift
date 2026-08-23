import Foundation

/// Device-local dictation preferences. These stay in UserDefaults rather
/// than the synced settings store because they describe this device's
/// capabilities: which on-device model to run and whether to show the
/// button at all.
enum FeatureVoiceEngine: String, CaseIterable, Identifiable {
    /// Apple's dictation model: the only on-device module that accepts
    /// contextual vocabulary, so learned terms bias recognition directly.
    case dictation
    /// Apple's general speech model: higher transcription quality, but no
    /// contextual vocabulary; learned terms only apply as post-corrections.
    case general

    var id: String { rawValue }

    var label: String {
        switch self {
        case .dictation: "Dictation (learns your terms)"
        case .general: "General speech (higher quality)"
        }
    }
}

enum FeatureVoiceDictationSettings {
    static let enabledKey = "voiceDictationEnabled"
    static let engineKey = "voiceDictationEngine"
    /// Whether the keyboard stays up while dictating. Off by default: the
    /// transcript types itself, so the keyboard mostly covers the thread.
    static let keyboardKey = "voiceDictationKeyboardEnabled"

    static var isEnabled: Bool {
        UserDefaults.standard.object(forKey: enabledKey) as? Bool ?? true
    }

    static var engine: FeatureVoiceEngine {
        FeatureVoiceEngine(rawValue: UserDefaults.standard.string(forKey: engineKey) ?? "")
            ?? .dictation
    }
}
