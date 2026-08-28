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
    private var loadGeneration = 0

    private(set) var state = State.loading
    private(set) var clearingScope: FeatureClientCache.Scope?
    private(set) var errorMessage: String?

    init(client: any FeatureClient) {
        storage = client as? any FeatureClientStorageManaging
    }

    init(storage: (any FeatureClientStorageManaging)?) {
        self.storage = storage
    }

    var summary: FeatureClientCache.Summary? {
        guard case let .loaded(summary) = state else { return nil }
        return summary
    }

    func load() async {
        guard clearingScope == nil else { return }
        loadGeneration &+= 1
        let generation = loadGeneration
        let previousSummary = summary
        if previousSummary == nil {
            state = .loading
        }
        errorMessage = nil
        guard let storage else {
            if previousSummary == nil {
                state = .unavailable
            }
            return
        }
        do {
            let summary = try await storage.clientCacheSummary()
            guard generation == loadGeneration, clearingScope == nil else { return }
            state = .loaded(summary)
        } catch {
            guard generation == loadGeneration, clearingScope == nil else { return }
            if previousSummary == nil {
                state = .unavailable
            } else {
                errorMessage = "Cached data could not be refreshed. Try again."
            }
        }
    }

    func clear(_ scope: FeatureClientCache.Scope) async {
        guard clearingScope == nil, let storage else { return }
        loadGeneration &+= 1
        clearingScope = scope
        errorMessage = nil
        do {
            try await storage.clearClientCache(scope)
        } catch {
            errorMessage = "Client cache could not be cleared. Try again."
            clearingScope = nil
            return
        }
        do {
            state = .loaded(try await storage.clientCacheSummary())
        } catch {
            state = .unavailable
            errorMessage = "The cache was cleared, but remaining cached data could not be refreshed. Try again."
        }
        clearingScope = nil
    }
}
