import SwiftUI

struct FeatureAssetPreviewFailureView: View {
    let failure: FeatureAssetPreviewFailure
    let onRetry: () -> Void
    var onClose: (() -> Void)?

    var body: some View {
        ContentUnavailableView {
            Label(failure.title, systemImage: "photo.badge.exclamationmark")
        } description: {
            Text(failure.message)
        } actions: {
            Button("Retry", systemImage: "arrow.clockwise", action: onRetry)
                .buttonStyle(.borderedProminent)
            if let onClose {
                Button("Close", action: onClose)
                    .buttonStyle(.bordered)
            }
        }
    }
}
