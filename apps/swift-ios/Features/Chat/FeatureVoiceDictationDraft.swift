import Foundation

/// Keeps a replaceable hypothesis separate from finalized dictation and
/// adopts edits made before the next recognition result arrives.
struct FeatureVoiceDictationDraft {
    private var committedText: String
    private var lastWrittenText: String

    init(text: String = "") {
        committedText = text
        lastWrittenText = text
    }

    mutating func renderVolatile(_ hypothesis: String, currentText: String) -> String {
        rebaseIfUserEdited(currentText)
        let trimmed = hypothesis.trimmingCharacters(in: .whitespacesAndNewlines)
        lastWrittenText = trimmed.isEmpty ? committedText : joined(committedText, trimmed)
        return lastWrittenText
    }

    mutating func commitSegment(_ segment: String, currentText: String) -> String {
        rebaseIfUserEdited(currentText)
        let trimmed = segment.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
            committedText = joined(committedText, trimmed)
        }
        lastWrittenText = committedText
        return lastWrittenText
    }

    private mutating func rebaseIfUserEdited(_ currentText: String) {
        if currentText != lastWrittenText {
            committedText = currentText
        }
    }

    private func joined(_ base: String, _ addition: String) -> String {
        if base.isEmpty { return addition }
        if let last = base.last, last.isWhitespace || last.isNewline {
            return base + addition
        }
        return base + " " + addition
    }
}
