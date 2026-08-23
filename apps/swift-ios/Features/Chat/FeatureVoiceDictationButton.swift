import SwiftUI

/// Composer microphone button: tap to dictate, tap again to stop and keep
/// the transcript. While recording, the icon turns red and a soft ring
/// breathes with the live microphone level; the recognizer's hypothesis
/// types directly into the draft and refines in place until finalized.
struct FeatureVoiceDictationButton: View {
    let model: FeatureVoiceDictationModel
    @Binding var text: String
    let vocabularyProvider: (() -> [String])?
    var onBegin: (() -> Void)?

    /// Draft content at recording start plus finalized segments; the
    /// volatile hypothesis renders after it and is replaced continually.
    @State private var committedText = ""
    /// What dictation last wrote into the draft; a mismatch means the user
    /// edited mid-recording and the committed base must rebase onto it.
    @State private var lastWrittenText: String?

    var body: some View {
        Button(action: toggle) {
            label
                .frame(width: 34, height: 34)
        }
        .buttonStyle(.plain)
        .frame(width: T3Metrics.minimumTapTarget, height: T3Metrics.minimumTapTarget)
        .contentShape(Rectangle())
        .accessibilityLabel(accessibilityLabel)
        .accessibilityValue(model.isRecording ? "Recording" : "")
        .accessibilityIdentifier("composer-dictation")
    }

    @ViewBuilder
    private var label: some View {
        switch model.phase {
        case .idle:
            Image(systemName: "mic")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(T3Colors.textSecondary)
        case .preparing, .downloadingModel, .stopping:
            ProgressView()
                .controlSize(.small)
                .tint(T3Colors.textSecondary)
        case .recording:
            // Red mic plus equalizer bars that bounce with the live
            // microphone level. Springy on purpose so speech visibly makes
            // them jump; they only repaint while audio buffers arrive.
            HStack(spacing: 3) {
                Image(systemName: "mic.fill")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(T3Colors.danger)
                HStack(spacing: 2) {
                    ForEach(0..<3, id: \.self) { index in
                        Capsule()
                            .fill(T3Colors.danger)
                            .frame(width: 2.5, height: barHeight(index))
                    }
                }
                .frame(height: 26)
            }
            .animation(.spring(duration: 0.2, bounce: 0.6), value: model.audioLevel)
        }
    }

    private func barHeight(_ index: Int) -> CGFloat {
        let multipliers: [CGFloat] = [16, 22, 12]
        return 4 + multipliers[index] * CGFloat(model.audioLevel)
    }

    private var accessibilityLabel: String {
        switch model.phase {
        case .idle: "Dictate"
        case .preparing: "Starting dictation"
        case .downloadingModel: "Downloading dictation model"
        case .recording: "Stop dictation"
        case .stopping: "Finishing dictation"
        }
    }

    private func toggle() {
        switch model.phase {
        case .recording:
            model.stop()
        case .preparing, .downloadingModel, .stopping:
            model.cancel()
        case .idle:
            onBegin?()
            committedText = text
            lastWrittenText = nil
            let vocabulary = FeatureVoiceVocabulary.merge([
                vocabularyProvider?() ?? [],
                FeatureVoiceVocabulary.staticTerms,
            ])
            model.start(
                vocabulary: vocabulary,
                onVolatile: { hypothesis in
                    renderVolatile(hypothesis)
                },
                onText: { segment in
                    commitSegment(segment)
                }
            )
        }
    }

    private func renderVolatile(_ hypothesis: String) {
        rebaseIfUserEdited()
        let trimmed = hypothesis.trimmingCharacters(in: .whitespacesAndNewlines)
        text = trimmed.isEmpty ? committedText : joined(committedText, trimmed)
        lastWrittenText = text
    }

    private func commitSegment(_ segment: String) {
        rebaseIfUserEdited()
        let trimmed = segment.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
            committedText = joined(committedText, trimmed)
        }
        text = committedText
        lastWrittenText = text
    }

    /// The user can still type while recording; adopt their edit as the new
    /// base instead of overwriting it.
    private func rebaseIfUserEdited() {
        if let lastWrittenText, text != lastWrittenText {
            committedText = text
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
