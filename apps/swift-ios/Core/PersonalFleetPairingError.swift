import Foundation

public enum PersonalFleetPairingError: LocalizedError, Equatable, Sendable {
    case unavailable(host: String, status: Int)
    case invalidResponse(host: String)

    public var errorDescription: String? {
        switch self {
        case let .unavailable(host, status):
            "\(host) pairing is unavailable (HTTP \(status))."
        case let .invalidResponse(host):
            "\(host) returned an invalid pairing response."
        }
    }
}
