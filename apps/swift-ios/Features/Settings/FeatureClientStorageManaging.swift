import Foundation

@MainActor
public protocol FeatureClientStorageManaging: AnyObject {
    func clientCacheSummary() async throws -> FeatureClientCache.Summary
    func clearClientCache(_ scope: FeatureClientCache.Scope) async throws
}
