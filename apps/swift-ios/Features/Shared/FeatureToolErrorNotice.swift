import SwiftUI

struct FeatureToolErrorNotice: View {
    let message: String
    let isRetrying: Bool
    let retry: @MainActor () async -> Void

    var body: some View {
        let label = Label(message, systemImage: "exclamationmark.circle")
            .font(T3Typography.control)
            .foregroundStyle(.orange)
            .frame(maxWidth: .infinity, alignment: .leading)

        let retryControl = Group {
            if isRetrying {
                ProgressView()
                    .controlSize(.small)
                    .accessibilityLabel("Trying again")
            } else {
                Button("Try again") {
                    Task { await retry() }
                }
                .font(T3Typography.control.weight(.semibold))
            }
        }

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
