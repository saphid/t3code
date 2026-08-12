import Foundation

public struct HostStorageSnapshot: Codable, Equatable, Sendable {
    public enum Status: String, Codable, Sendable {
        case ok
        case warning
        case critical
    }

    public let totalBytes: Double
    public let availableBytes: Double
    public let warningThresholdBytes: Double
    public let criticalThresholdBytes: Double
    public let status: Status
}
