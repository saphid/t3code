import Foundation
import UIKit

enum PlatformBetaFeedbackT3Handoff {
    enum HandoffError: LocalizedError {
        case emptyReport
        case invalidScreenshot
        case screenshotTooLarge

        var errorDescription: String? {
            switch self {
            case .emptyReport:
                "Review the report before sending it to T3 Code."
            case .invalidScreenshot:
                "The annotated screenshot could not be read."
            case .screenshotTooLarge:
                "The annotated screenshot is too large to attach."
            }
        }
    }

    static func newTask(
        projectID: String,
        report: String,
        screenshotJPEG: Data
    ) throws -> NewTaskRequest {
        NewTaskRequest(
            projectID: projectID,
            prompt: try prompt(
                instruction: "Fix this reviewed beta feedback report.",
                report: report
            ),
            selection: nil,
            runtimeMode: .fullAccess,
            interactionMode: .standard,
            attachments: [try attachment(screenshotJPEG)]
        )
    }

    static func followUp(
        threadID: String,
        report: String,
        screenshotJPEG: Data
    ) throws -> FeatureMessageSubmission {
        FeatureMessageSubmission(
            threadID: threadID,
            text: try prompt(
                instruction: "Follow up on this reviewed beta feedback report.",
                report: report
            ),
            selection: nil,
            attachments: [try attachment(screenshotJPEG)]
        )
    }

    private static func prompt(instruction: String, report: String) throws -> String {
        let trimmed = report.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.isEmpty == false else { throw HandoffError.emptyReport }
        return """
        \(instruction)

        \(trimmed)

        Use the attached annotated screenshot as the visual source of truth. Diagnose the cause, make the smallest coherent fix, and verify it with focused tests.
        """
    }

    private static func attachment(_ screenshotJPEG: Data) throws -> FeatureDraftAttachment {
        guard UIImage(data: screenshotJPEG) != nil else { throw HandoffError.invalidScreenshot }
        guard screenshotJPEG.count <= 10 * 1_024 * 1_024 else {
            throw HandoffError.screenshotTooLarge
        }
        return FeatureDraftAttachment(
            data: screenshotJPEG,
            filename: "Beta feedback annotated screenshot.jpg",
            mimeType: "image/jpeg"
        )
    }
}
