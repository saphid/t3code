import Foundation

enum ProviderMaintenanceTone: Equatable {
    case neutral
    case progress
    case success
    case warning
    case failure
}

struct ProviderMaintenanceRow: Identifiable, Equatable {
    let environmentID: String
    let environmentName: String
    let isEnvironmentOnline: Bool
    let provider: FeatureProvider
    let status: String
    let detail: String?
    let output: String?
    let actionTitle: String?
    let tone: ProviderMaintenanceTone

    var id: String { "\(environmentID):\(provider.id)" }
    var canAct: Bool { actionTitle != nil && isEnvironmentOnline }
}

struct ProviderMaintenanceSection: Identifiable, Equatable {
    let environmentID: String
    let environmentName: String
    let rows: [ProviderMaintenanceRow]

    var id: String { environmentID }
}

enum ProviderSettingsPresentation {
    static func sections(in snapshot: FeatureSnapshot) -> [ProviderMaintenanceSection] {
        let catalogues = snapshot.providersByEnvironment ?? [:]
        var sections: [ProviderMaintenanceSection] = snapshot.environments.compactMap { environment in
            guard let providers = catalogues[environment.id], !providers.isEmpty else { return nil }
            return ProviderMaintenanceSection(
                environmentID: environment.id,
                environmentName: environment.name,
                rows: providers.map { row(provider: $0, environment: environment) }
            )
        }

        if snapshot.providersByEnvironment == nil, sections.isEmpty, !snapshot.providers.isEmpty {
            let environment = snapshot.environments.first(where: \.isActive)
                ?? snapshot.environments.first
                ?? FeatureEnvironment(
                    id: "active",
                    name: snapshot.connection.environmentName ?? "Current environment",
                    endpoint: snapshot.connection.endpoint ?? "",
                    isActive: true,
                    connectionState: snapshot.connection.state
                )
            sections = [
                ProviderMaintenanceSection(
                    environmentID: environment.id,
                    environmentName: environment.name,
                    rows: snapshot.providers.map { row(provider: $0, environment: environment) }
                ),
            ]
        }

        return sections
    }

    static func settingsSummary(in snapshot: FeatureSnapshot) -> String? {
        let rows = sections(in: snapshot).flatMap(\.rows)
        guard !rows.isEmpty else { return nil }
        let updates = rows.count { $0.actionTitle != nil }
        return updates == 0 ? "\(rows.count)" : "\(updates) update\(updates == 1 ? "" : "s")"
    }

    private static func row(
        provider: FeatureProvider,
        environment: FeatureEnvironment
    ) -> ProviderMaintenanceRow {
        let online = environment.isEnabled && environment.connectionState == .connected
        let update = provider.updateState
        let advisory = provider.versionAdvisory
        let terminalDetail = update?.message ?? reasonMessage(update?.reason)

        let presentation: (
            status: String,
            detail: String?,
            actionTitle: String?,
            tone: ProviderMaintenanceTone
        )
        if !environment.isEnabled {
            presentation = ("Environment off", "Enable this environment to manage providers.", nil, .neutral)
        } else if !online {
            presentation = ("Offline", "Reconnect this environment to manage providers.", nil, .warning)
        } else {
            presentation = switch update?.status {
            case "queued", "running":
                ("Updating", terminalDetail ?? "Waiting for the provider command to finish.", nil, .progress)
            case "succeeded":
                ("Up to date", terminalDetail ?? "Provider is current.", nil, .success)
            case "failed", "unchanged":
                (
                    "Update failed",
                    terminalDetail ?? "The update did not complete. Retry after checking the command output.",
                    advisory?.canUpdate == true ? "Retry" : nil,
                    .failure
                )
            default:
                switch advisory?.status {
                case "behind_latest":
                    ("Update available", advisory?.message, advisory?.canUpdate == true ? "Update" : nil, .warning)
                case "current":
                    ("Up to date", advisory?.message ?? "Provider is current.", nil, .success)
                case "unknown":
                    ("Version unavailable", advisory?.message, nil, .neutral)
                default:
                    (provider.isAvailable ? "Available" : "Unavailable", advisory?.message, nil, .neutral)
                }
            }
        }

        return ProviderMaintenanceRow(
            environmentID: environment.id,
            environmentName: environment.name,
            isEnvironmentOnline: online,
            provider: provider,
            status: presentation.status,
            detail: presentation.detail,
            output: update?.output?.trimmingCharacters(in: .whitespacesAndNewlines),
            actionTitle: presentation.actionTitle,
            tone: presentation.tone
        )
    }

    private static func reasonMessage(_ reason: String?) -> String? {
        switch reason {
        case "timed_out": "The update timed out. Check the package manager, then retry."
        case "command_not_found": "The required package manager was not found. Install it, then retry."
        case "permission_denied": "The update was denied. Fix the command permissions, then retry."
        case "nonzero_exit": "The update command failed. Check its output, then retry."
        case "cancelled": "The update was cancelled. Retry when the connection is stable."
        case "verification_failed": "The update finished, but the installed version could not be verified."
        case "version_mismatch": "The update finished, but the installed version did not match the expected version."
        default: nil
        }
    }
}
