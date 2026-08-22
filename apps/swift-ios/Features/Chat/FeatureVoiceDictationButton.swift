import SwiftUI

/// Composer microphone button: tap to dictate, tap again to stop and keep
/// the transcript, with the recognizer's finalized segments appended to the
/// draft as they arrive.
struct FeatureVoiceDictationButton: View {
    let model: FeatureVoiceDictationModel
    @Binding var text: String
    let vocabularyProvider: (() -> [String])?
    var onBegin: (() -> Void)?

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
            Image(systemName: "stop.fill")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 28, height: 28)
                .background(T3Colors.danger, in: Circle())
                .symbolEffect(.pulse, isActive: true)
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
            let vocabulary = FeatureVoiceVocabulary.merge([
                vocabularyProvider?() ?? [],
                FeatureVoiceVocabulary.staticTerms,
            ])
            model.start(vocabulary: vocabulary) { segment in
                appendSegment(segment)
            }
        }
    }

    private func appendSegment(_ segment: String) {
        let trimmed = segment.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        if text.isEmpty {
            text = trimmed
        } else if let last = text.last, last.isWhitespace || last.isNewline {
            text += trimmed
        } else {
            text += " " + trimmed
        }
    }
}
