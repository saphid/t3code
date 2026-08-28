import Foundation
import Observation

@MainActor
@Observable
final class ClientStorageViewModel {
    enum State: Equatable {
        case loading
        case unavailable
        case loaded(FeatureClientCache.Summary)
    }

    private let storage: (any FeatureClientStorageManaging)?

    private(set) var state = State.loading
    private(set) var clearingScope: FeatureClientCache.Scope?
    private(set) var errorMessage: String?

    init(client: any FeatureClient) {
        storage = client as? any FeatureClientStorageManaging
    }

    var summary: FeatureClientCache.Summary? {
        guard case let .loaded(summary) = state else { return nil }
        return summary
    }

    func load() async {
        guard clearingScope == nil else { return }
        state = .loading
        errorMessage = nil
        guard let storage else {
            state = .unavailable
            return
        }
        do {
            state = .loaded(try await storage.clientCacheSummary())
        } catch {
            state = .unavailable
        }
    }

    func clear(_ scope: FeatureClientCache.Scope) async {
        guard clearingScope == nil, let storage else { return }
        clearingScope = scope
        errorMessage = nil
        do {
            try await storage.clearClientCache(scope)
            state = .loaded(try await storage.clientCacheSummary())
        } catch {
            errorMessage = "Client storage is temporarily unavailable. Try again after restarting the app."
        }
        clearingScope = nil
    }
}
