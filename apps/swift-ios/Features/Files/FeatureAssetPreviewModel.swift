import Foundation
import Observation

struct FeatureAssetPreviewRequest: Hashable, Sendable {
    let scopeID: String
    let resourceID: String
}

enum FeatureAssetPreviewFailureKind: Sendable, Equatable {
    case connection
    case authorization
    case missingFile
    case decoding
    case query
}

struct FeatureAssetPreviewFailure: LocalizedError, Sendable, Equatable {
    let kind: FeatureAssetPreviewFailureKind
    let message: String

    var title: String {
        switch kind {
        case .connection: "Connection unavailable"
        case .authorization: "Authorization required"
        case .missingFile: "File not found"
        case .decoding: "Image unavailable"
        case .query: "Preview unavailable"
        }
    }

    var errorDescription: String? { message }

    static func classify(_ error: any Error) -> Self {
        if let failure = error as? Self {
            return failure
        }
        if let urlError = error as? URLError {
            switch urlError.code {
            case .userAuthenticationRequired, .userCancelledAuthentication:
                return Self(kind: .authorization, message: urlError.localizedDescription)
            case .fileDoesNotExist:
                return Self(kind: .missingFile, message: urlError.localizedDescription)
            case .badServerResponse, .cannotDecodeContentData, .cannotDecodeRawData:
                return Self(kind: .decoding, message: urlError.localizedDescription)
            case .cannotConnectToHost, .cannotFindHost, .dataNotAllowed,
                 .dnsLookupFailed, .internationalRoamingOff, .networkConnectionLost,
                 .notConnectedToInternet, .secureConnectionFailed, .timedOut:
                return Self(kind: .connection, message: urlError.localizedDescription)
            default:
                break
            }
        }

        let message = error.localizedDescription
        let normalized = message.lowercased()
        if containsAny(
            normalized,
            ["http 401", "http 403", "authenticate", "authorization", "credential", "forbidden", "permission", "scope", "unauthorized"]
        ) {
            return Self(kind: .authorization, message: message)
        }
        if containsAny(
            normalized,
            ["http 404", "does not exist", "file was not found", "no longer available", "not found"]
        ) {
            return Self(kind: .missingFile, message: message)
        }
        if containsAny(
            normalized,
            ["connection unavailable", "did not answer", "disconnected", "network connection", "not connected", "offline", "timed out", "unreachable"]
        ) {
            return Self(kind: .connection, message: message)
        }
        if containsAny(normalized, ["could not decode", "invalid image", "supported image"]) {
            return Self(kind: .decoding, message: message)
        }
        return Self(kind: .query, message: message)
    }

    private static func containsAny(_ value: String, _ candidates: [String]) -> Bool {
        candidates.contains { value.contains($0) }
    }
}

enum FeatureAssetPreviewState<Value> {
    case idle
    case pending
    case success(Value)
    case failure(FeatureAssetPreviewFailure)

    var isPending: Bool {
        if case .pending = self { true } else { false }
    }

    var failure: FeatureAssetPreviewFailure? {
        if case let .failure(failure) = self { failure } else { nil }
    }
}

extension FeatureAssetPreviewState: Equatable where Value: Equatable {}

@MainActor
@Observable
final class FeatureAssetPreviewModel<Value> {
    private(set) var state: FeatureAssetPreviewState<Value> = .idle

    @ObservationIgnored private var generation: UInt64 = 0
    @ObservationIgnored private var currentRequest: FeatureAssetPreviewRequest?
    @ObservationIgnored private var retryTask: Task<Void, Never>?

    func load(
        request: FeatureAssetPreviewRequest,
        operation: @MainActor () async throws -> Value
    ) async {
        if currentRequest == request, state.isPending {
            return
        }

        generation &+= 1
        let attempt = generation
        currentRequest = request
        state = .pending

        do {
            let value = try await operation()
            guard Task.isCancelled == false,
                  generation == attempt,
                  currentRequest == request else {
                return
            }
            state = .success(value)
        } catch is CancellationError {
            guard generation == attempt, currentRequest == request else { return }
            state = .idle
        } catch {
            guard Task.isCancelled == false,
                  generation == attempt,
                  currentRequest == request else {
                return
            }
            state = .failure(FeatureAssetPreviewFailure.classify(error))
        }
    }

    @discardableResult
    func retry(
        request: FeatureAssetPreviewRequest,
        operation: @escaping @MainActor () async throws -> Value
    ) -> Task<Void, Never>? {
        guard currentRequest != request || state.isPending == false else { return nil }
        retryTask?.cancel()
        let task = Task { [weak self] in
            guard let self else { return }
            await load(request: request, operation: operation)
        }
        retryTask = task
        return task
    }

    func cancel() {
        retryTask?.cancel()
        retryTask = nil
        generation &+= 1
        currentRequest = nil
        state = .idle
    }
}
