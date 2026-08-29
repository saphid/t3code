import SwiftUI

struct HomeEnvironmentFilterOptionLabel: View {
    let title: String
    let status: HomeEnvironmentFilter.ConnectionStatus
    let isSelected: Bool

    var body: some View {
        HStack(spacing: 8) {
            statusIndicator
                .frame(width: 18, height: 18)

            Text(title)

            Spacer(minLength: 8)

            if isSelected {
                Image(systemName: "checkmark")
                    .accessibilityHidden(true)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
        .accessibilityValue(status.accessibilityValue(isSelected: isSelected))
    }

    @ViewBuilder
    private var statusIndicator: some View {
        switch status {
        case .checking:
            ProgressView()
                .controlSize(.small)
                .tint(T3Colors.textSecondary)
        case .connecting:
            ProgressView()
                .controlSize(.small)
                .tint(T3Colors.warning)
        case .connected:
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(T3Colors.success)
        case .unreachable:
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(T3Colors.warning)
        case .disconnected, .relinkRequired:
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(T3Colors.danger)
        }
    }
}
