import Foundation

public protocol PersonalFleetPairingRequesting: Sendable {
    func pairingURL(for host: PersonalFleetPairingHost) async throws -> String
}
