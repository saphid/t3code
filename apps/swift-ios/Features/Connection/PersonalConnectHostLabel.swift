import SwiftUI

struct PersonalConnectHostLabel: View {
    let host: PersonalFleetPairingHost
    let isConnecting: Bool

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "point.3.connected.trianglepath.dotted")
                .frame(width: 24)
                .accessibilityHidden(true)
            Text(host.label)
                .font(.body.weight(.semibold))
            Spacer()
            if isConnecting {
                ProgressView()
                    .controlSize(.small)
                    .accessibilityLabel("Pairing")
            } else {
                Image(systemName: "arrow.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
        }
        .foregroundStyle(.primary)
        .contentShape(Rectangle())
        .padding(.vertical, 12)
    }
}
