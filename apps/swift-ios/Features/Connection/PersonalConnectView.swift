import SwiftUI

struct PersonalConnectView: View {
    let hosts: [PersonalFleetPairingHost]
    let connectingHostID: String?
    let errorMessage: String?
    let onSelect: (PersonalFleetPairingHost) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("PERSONAL CONNECT")
                .font(T3Typography.eyebrow)
                .foregroundStyle(T3Colors.textSecondary)

            Text("Pair directly through your private Tailnet. No code entry required.")
                .font(T3Typography.supporting)
                .foregroundStyle(T3Colors.textSecondary)

            VStack(spacing: 0) {
                ForEach(hosts) { host in
                    Button {
                        onSelect(host)
                    } label: {
                        PersonalConnectHostLabel(
                            host: host,
                            isConnecting: connectingHostID == host.id
                        )
                    }
                    .buttonStyle(.plain)
                    .disabled(connectingHostID != nil)
                    .accessibilityHint(
                        "Requests a private one-time pairing link and connects automatically"
                    )

                    if host.id != hosts.last?.id {
                        Divider().overlay(T3Colors.border)
                    }
                }
            }

            if let errorMessage, connectingHostID == nil {
                Label(errorMessage, systemImage: "exclamationmark.circle")
                    .font(T3Typography.control)
                    .foregroundStyle(Color(red: 1, green: 0.58, blue: 0.2))
                    .accessibilityElement(children: .combine)
            }
        }
        .padding(.top, 28)
    }
}
