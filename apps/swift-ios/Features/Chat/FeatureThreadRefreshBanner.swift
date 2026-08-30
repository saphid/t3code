import SwiftUI

struct FeatureThreadRefreshBanner: View {
    let presentation: ThreadRefreshPresentation
    let onRetry: () -> Void

    var body: some View {
        FeatureComposerAttachedBanner {
            HStack(spacing: 8) {
                Label(presentation.title, systemImage: presentation.systemImage)
                    .font(T3Typography.supporting)
                    .foregroundStyle(T3Colors.textSecondary)

                Spacer(minLength: 4)

                if presentation.canRetry {
                    Button(action: onRetry) {
                        Label("Retry", systemImage: "arrow.clockwise")
                            .font(T3Typography.control)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(T3Colors.accent)
                    .frame(minHeight: T3Metrics.minimumTapTarget)
                    .accessibilityIdentifier("thread-refresh-retry")
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("thread-refresh-status")
    }
}
