import SwiftUI

struct FeatureToolErrorNotice: View {
    let message: String
    let isRetrying: Bool
    let retryTitle: String
    let accessibilityIdentifierPrefix: String
    let retry: @MainActor () async -> Void

    init(
        message: String,
        isRetrying: Bool,
        retryTitle: String = "Try again",
        accessibilityIdentifierPrefix: String = "feature-tool-error",
        retry: @escaping @MainActor () async -> Void
    ) {
        self.message = message
        self.isRetrying = isRetrying
        self.retryTitle = retryTitle
        self.accessibilityIdentifierPrefix = accessibilityIdentifierPrefix
        self.retry = retry
    }

    var body: some View {
        let label = HStack(alignment: .firstTextBaseline, spacing: 7) {
            Image(systemName: "exclamationmark.circle")
                .foregroundStyle(.orange)
                .accessibilityHidden(true)
            Text(message)
                .foregroundStyle(T3Colors.textPrimary)
        }
        .font(T3Typography.control)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("\(accessibilityIdentifierPrefix)-message")

        let retryControl = Button {
            Task { await retry() }
        } label: {
            HStack(spacing: 6) {
                ProgressView()
                    .controlSize(.small)
                    .opacity(isRetrying ? 1 : 0)
                    .accessibilityHidden(true)
                Text(retryTitle)
            }
        }
        .font(T3Typography.control.weight(.semibold))
        .disabled(isRetrying)
        .accessibilityLabel(retryTitle)
        .accessibilityValue(isRetrying ? "In progress" : "")
        .accessibilityIdentifier("\(accessibilityIdentifierPrefix)-retry")

        ViewThatFits(in: .horizontal) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                label
                retryControl
            }

            VStack(alignment: .leading, spacing: 8) {
                label
                retryControl
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(T3Colors.background)
        .overlay(alignment: .bottom) {
            Divider().overlay(T3Colors.separator)
        }
    }
}
