import Foundation
import Testing
@testable import T3Code

@MainActor
@Suite("Asset preview recovery")
struct FeatureAssetPreviewModelTests {
    @Test("Pending means an operation is in flight")
    func pendingTracksRealWork() async {
        let model = FeatureAssetPreviewModel<String>()
        let gate = AssetPreviewOperationGate<String>()
        let task = Task {
            await model.load(request: .init(scopeID: "environment-a", resourceID: "image.png")) {
                try await gate.run()
            }
        }

        await gate.waitForCallCount(1)
        #expect(model.state == .pending)

        await gate.succeed(call: 0, with: "preview")
        await task.value
    }

    @Test("Connection failures terminate preparation", .bug("https://github.com/saphid/t3code-personal/issues/182"))
    func connectionFailure() async {
        let state = await failedState(for: URLError(.networkConnectionLost))

        #expect(state.failure?.kind == .connection)
        #expect(state.isPending == false)
    }

    @Test("Authorization failures terminate preparation", .bug("https://github.com/saphid/t3code-personal/issues/182"))
    func authorizationFailure() async {
        let state = await failedState(
            for: AssetPreviewTestError("The request was forbidden (HTTP 403).")
        )

        #expect(state.failure?.kind == .authorization)
        #expect(state.isPending == false)
    }

    @Test("Missing files terminate preparation", .bug("https://github.com/saphid/t3code-personal/issues/182"))
    func missingFileFailure() async {
        let state = await failedState(
            for: AssetPreviewTestError("The requested file was not found (HTTP 404).")
        )

        #expect(state.failure?.kind == .missingFile)
        #expect(state.isPending == false)
    }

    @Test("Decoding failures terminate preparation", .bug("https://github.com/saphid/t3code-personal/issues/182"))
    func decodingFailure() async {
        let state = await failedState(
            for: FeatureAssetPreviewFailure(
                kind: .decoding,
                message: "The file is not a supported image."
            )
        )

        #expect(state.failure?.kind == .decoding)
        #expect(state.isPending == false)
    }

    @Test("Query failures terminate preparation", .bug("https://github.com/saphid/t3code-personal/issues/182"))
    func queryFailure() async {
        let state = await failedState(
            for: AssetPreviewTestError("assets.createUrl failed")
        )

        #expect(state.failure?.kind == .query)
        #expect(state.isPending == false)
    }

    @Test("Retry can recover a failed preview", .bug("https://github.com/saphid/t3code-personal/issues/182"))
    func retrySuccess() async {
        let model = FeatureAssetPreviewModel<String>()
        let request = FeatureAssetPreviewRequest(
            scopeID: "environment-a",
            resourceID: "image.png"
        )
        let attempts = AssetPreviewAttemptCounter()

        await model.load(request: request) {
            await attempts.increment()
            throw AssetPreviewTestError("assets.createUrl failed")
        }
        let retry = model.retry(request: request) {
            await attempts.increment()
            return "recovered-preview"
        }
        await retry?.value

        #expect(model.state == .success("recovered-preview"))
        let attemptCount = await attempts.value
        #expect(attemptCount == 2)
    }

    @Test("Repeated retry stays single-flight and each settled retry is fresh", .bug("https://github.com/saphid/t3code-personal/issues/182"))
    func repeatedRetry() async {
        let model = FeatureAssetPreviewModel<String>()
        let request = FeatureAssetPreviewRequest(
            scopeID: "environment-a",
            resourceID: "image.png"
        )
        let gate = AssetPreviewOperationGate<String>()

        let first = model.retry(request: request) { try await gate.run() }
        await gate.waitForCallCount(1)
        let duplicate = model.retry(request: request) { try await gate.run() }
        #expect(duplicate == nil)
        let duplicateCallCount = await gate.callCount
        #expect(duplicateCallCount == 1)
        await gate.fail(call: 0, with: AssetPreviewTestError("first failure"))
        await first?.value

        let second = model.retry(request: request) { try await gate.run() }
        await gate.waitForCallCount(2)
        await gate.fail(call: 1, with: AssetPreviewTestError("second failure"))
        await second?.value

        let third = model.retry(request: request) { try await gate.run() }
        await gate.waitForCallCount(3)
        await gate.succeed(call: 2, with: "recovered-preview")
        await third?.value

        let totalCallCount = await gate.callCount
        #expect(totalCallCount == 3)
        #expect(model.state == .success("recovered-preview"))
    }

    @Test("Dismissal ignores a late result", .bug("https://github.com/saphid/t3code-personal/issues/182"))
    func dismissalIgnoresLateResult() async {
        let model = FeatureAssetPreviewModel<String>()
        let gate = AssetPreviewOperationGate<String>()
        let task = model.retry(
            request: .init(scopeID: "environment-a", resourceID: "image.png")
        ) {
            try await gate.run()
        }
        await gate.waitForCallCount(1)

        model.cancel()
        await gate.succeed(call: 0, with: "late-preview")
        await task?.value

        #expect(model.state == .idle)
    }

    @Test("A late retry result cannot replace the newer result", .bug("https://github.com/saphid/t3code-personal/issues/182"))
    func lateResultIsIgnored() async {
        let model = FeatureAssetPreviewModel<String>()
        let gate = AssetPreviewOperationGate<String>()
        let firstRequest = FeatureAssetPreviewRequest(
            scopeID: "environment-a",
            resourceID: "image.png"
        )
        let secondRequest = FeatureAssetPreviewRequest(
            scopeID: "environment-a",
            resourceID: "other.png"
        )

        let first = Task {
            await model.load(request: firstRequest) { try await gate.run() }
        }
        await gate.waitForCallCount(1)
        let second = Task {
            await model.load(request: secondRequest) { try await gate.run() }
        }
        await gate.waitForCallCount(2)
        await gate.succeed(call: 1, with: "new-preview")
        await second.value
        await gate.succeed(call: 0, with: "late-preview")
        await first.value

        #expect(model.state == .success("new-preview"))
    }

    @Test("Switching environments rejects the previous environment result", .bug("https://github.com/saphid/t3code-personal/issues/182"))
    func environmentSwitchRejectsOldResult() async {
        let model = FeatureAssetPreviewModel<String>()
        let gate = AssetPreviewOperationGate<String>()

        let first = Task {
            await model.load(
                request: .init(scopeID: "environment-a", resourceID: "image.png")
            ) {
                try await gate.run()
            }
        }
        await gate.waitForCallCount(1)
        let second = Task {
            await model.load(
                request: .init(scopeID: "environment-b", resourceID: "image.png")
            ) {
                try await gate.run()
            }
        }
        await gate.waitForCallCount(2)
        await gate.succeed(call: 1, with: "environment-b-preview")
        await second.value
        await gate.succeed(call: 0, with: "environment-a-preview")
        await first.value

        #expect(model.state == .success("environment-b-preview"))
    }

    @Test("A successful preview leaves preparation", .bug("https://github.com/saphid/t3code-personal/issues/182"))
    func successfulPreview() async {
        let model = FeatureAssetPreviewModel<String>()

        await model.load(
            request: .init(scopeID: "environment-a", resourceID: "image.png")
        ) {
            "preview"
        }

        #expect(model.state == .success("preview"))
        #expect(model.state.isPending == false)
    }

    private func failedState(
        for error: any Error & Sendable
    ) async -> FeatureAssetPreviewState<String> {
        let model = FeatureAssetPreviewModel<String>()
        await model.load(
            request: .init(scopeID: "environment-a", resourceID: "image.png")
        ) {
            throw error
        }
        return model.state
    }
}

private struct AssetPreviewTestError: LocalizedError, Sendable {
    let message: String

    init(_ message: String) {
        self.message = message
    }

    var errorDescription: String? { message }
}

private actor AssetPreviewAttemptCounter {
    private(set) var value = 0

    func increment() {
        value += 1
    }
}

private actor AssetPreviewOperationGate<Value: Sendable> {
    private var continuations: [Int: CheckedContinuation<Value, any Error>] = [:]
    private var waiters: [(count: Int, continuation: CheckedContinuation<Void, Never>)] = []
    private(set) var callCount = 0

    func run() async throws -> Value {
        let call = callCount
        callCount += 1
        let ready = waiters.filter { callCount >= $0.count }
        waiters.removeAll { callCount >= $0.count }
        ready.forEach { $0.continuation.resume() }
        return try await withCheckedThrowingContinuation { continuation in
            continuations[call] = continuation
        }
    }

    func waitForCallCount(_ count: Int) async {
        guard callCount < count else { return }
        await withCheckedContinuation { continuation in
            waiters.append((count, continuation))
        }
    }

    func succeed(call: Int, with value: Value) {
        continuations.removeValue(forKey: call)?.resume(returning: value)
    }

    func fail(call: Int, with error: any Error) {
        continuations.removeValue(forKey: call)?.resume(throwing: error)
    }
}
