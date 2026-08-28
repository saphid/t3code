import Foundation
import Observation

@MainActor
@Observable
final class PlatformBetaFeedbackSheetModel {
    private(set) var draft: PlatformBetaFeedbackDraft
    private let structurer: PlatformBetaFeedbackStructurer
    var descriptionText: String
    var reportText: String
    var fallbackMessage: String?
    var usedOnDeviceModel: Bool
    var isStructuring = false
    var isAnnotating = false
    var markup = PlatformBetaFeedbackMarkup()
    var errorMessage: String?

    private var hasStartedInlineResponse = false

    init(
        draft: PlatformBetaFeedbackDraft,
        structurer: PlatformBetaFeedbackStructurer = .live
    ) {
        self.draft = draft
        self.structurer = structurer
        descriptionText = draft.originalDescription
        reportText = draft.reportText
        markup = draft.markup
        usedOnDeviceModel = draft.usedOnDeviceModel
        if draft.reportText.isEmpty == false {
            fallbackMessage = "This saved report is ready to review or route."
        }
    }

    var reviewedDraft: PlatformBetaFeedbackDraft {
        var value = draft
        value.originalDescription = descriptionText
        value.reportText = reportText
        value.usedOnDeviceModel = usedOnDeviceModel
        return value
    }

    var canReview: Bool {
        descriptionText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
            && isStructuring == false
    }

    var canRoute: Bool {
        reportText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
    }

    func applyMarkup(_ markup: PlatformBetaFeedbackMarkup, renderedJPEG: Data) {
        self.markup = markup
        draft.annotatedScreenshotJPEG = markup.isEmpty ? nil : renderedJPEG
        draft.markup = markup
        isAnnotating = false
    }

    func returnToDescription() {
        reportText = ""
        fallbackMessage = nil
        usedOnDeviceModel = false
    }

    func structureReport() async {
        guard isStructuring == false else { return }
        let sourceDescription = descriptionText
        let text = sourceDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        guard text.isEmpty == false else { return }
        isStructuring = true
        defer { isStructuring = false }
        let report: PlatformBetaFeedbackReport
        do {
            report = try await structurer.report(
                for: text,
                diagnostics: draft.diagnostics
            )
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
            return
        }
        guard Task.isCancelled == false else { return }
        guard descriptionText == sourceDescription else { return }
        reportText = report.text
        fallbackMessage = report.fallbackMessage
        usedOnDeviceModel = report.usedOnDeviceModel
    }

    func structureInlineResponseIfNeeded() async {
        guard hasStartedInlineResponse == false,
              draft.reportText.isEmpty,
              draft.originalDescription.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false else {
            return
        }
        hasStartedInlineResponse = true
        await structureReport()
    }
}
