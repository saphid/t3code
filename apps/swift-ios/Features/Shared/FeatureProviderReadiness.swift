import Foundation

public enum FeatureProviderReadiness: String, Codable, Sendable, Hashable {
    case checking
    case ready
    case timeout
    case missingBinary
    case incompatibleVersion
    case failed
}
