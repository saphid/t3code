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

    @State private var dictationDraft = FeatureVoiceDictationDraft()

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
            // Just the colour change; the composer-wide voice glow carries
            // the "listening" animation.
            Image(systemName: "mic.fill")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(T3Colors.danger)
        }
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
            dictationDraft = FeatureVoiceDictationDraft(text: text)
            let vocabulary = FeatureVoiceVocabulary.merge([
                vocabularyProvider?() ?? [],
                FeatureVoiceVocabulary.staticTerms,
            ])
            model.start(
                vocabulary: vocabulary,
                onVolatile: { hypothesis in
                    text = dictationDraft.renderVolatile(hypothesis, currentText: text)
                },
                onText: { segment in
                    text = dictationDraft.commitSegment(segment, currentText: text)
                }
            )
        }
    }
}
