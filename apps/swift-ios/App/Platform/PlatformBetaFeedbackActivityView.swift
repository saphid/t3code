import SwiftUI

struct PlatformBetaFeedbackActivityView: UIViewControllerRepresentable {
    let payload: PlatformBetaFeedbackSharePayload
    let onDismiss: () -> Void
    let onComplete: () -> Void

    func makeUIViewController(context: Context) -> UIActivityViewController {
        let controller = UIActivityViewController(
            activityItems: payload.activityItems,
            applicationActivities: nil
        )
        controller.completionWithItemsHandler = { _, completed, _, _ in
            onDismiss()
            if completed { onComplete() }
        }
        return controller
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
