import Foundation

struct EnvironmentBadgePresentation: Equatable {
    enum Channel: Equatable {
        case development
        case test
        case production

        init(bundleIdentifier: String?, displayName: String?) {
            let bundleParts = bundleIdentifier?
                .lowercased()
                .split(separator: ".")
                .map(String.init) ?? []
            let displayWords = displayName?
                .lowercased()
                .split(whereSeparator: { !$0.isLetter })
                .map(String.init) ?? []
            let identityParts = bundleParts + displayWords
            if identityParts.contains("test") {
                self = .test
            } else if identityParts.contains("dev") {
                self = .development
            } else {
                self = .production
            }
        }

        static var current: Self {
            Self(
                bundleIdentifier: Bundle.main.bundleIdentifier,
                displayName: Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String
            )
        }

        var badgeLabel: String? {
            switch self {
            case .development: "Dev"
            case .test: "Test"
            case .production: nil
            }
        }

        var accessibilityLabel: String? {
            badgeLabel.map { "\($0) build" }
        }
    }

    enum Status: Equatable {
        case connected
        case connecting
        case reconnecting
        case disconnected
        case disabled

        var defaultLabel: String? {
            switch self {
            case .connected: nil
            case .connecting: "connecting"
            case .reconnecting: "reconnecting"
            case .disconnected: "offline"
            case .disabled: "off"
            }
        }

        var systemImage: String {
            switch self {
            case .connected: "server.rack"
            case .connecting, .reconnecting: "wifi.exclamationmark"
            case .disconnected, .disabled: "network.slash"
            }
        }
    }

    enum Content: Equatable {
        case brand
        case environment(name: String, status: Status, statusLabel: String?)
    }

    let content: Content
    let channel: Channel

    static func brand(channel: Channel = .current) -> Self {
        Self(content: .brand, channel: channel)
    }

    static func environment(
        name: String,
        status: Status,
        statusLabel: String? = nil,
        channel: Channel = .current
    ) -> Self {
        Self(
            content: .environment(
                name: normalizedName(name),
                status: status,
                statusLabel: statusLabel
            ),
            channel: channel
        )
    }

    var fullLabel: String {
        switch content {
        case .brand:
            "T3 Code"
        case let .environment(name, status, statusLabel):
            [name, statusLabel ?? status.defaultLabel]
                .compactMap { $0 }
                .joined(separator: " ")
        }
    }

    var compactLabel: String {
        switch content {
        case .brand: "T3"
        case let .environment(name, _, _): name
        }
    }

    var accessibilityLabel: String {
        [fullLabel, channel.accessibilityLabel]
            .compactMap { $0 }
            .joined(separator: ", ")
    }

    var status: Status? {
        guard case let .environment(_, status, _) = content else { return nil }
        return status
    }

    private static func normalizedName(_ name: String) -> String {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "T3 environment" : trimmed
    }
}
