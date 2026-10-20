import Foundation
import Observation
import Testing
@testable import T3Code

@MainActor
@Suite("Voice dictation result failures")
struct FeatureVoiceDictationFailureTests {
    @Test("A failed results stream stops capture and retains the written transcript")
    func failureAfterStart() async {
        let engine = VoiceDictationEngineStub()
        var events = engine.events.stream.makeAsyncIterator()
        let model = FeatureVoiceDictationModel(requestPermission: { true }, makeEngine: { engine })
        var text = ""
        model.start(vocabulary: [], onVolatile: { _ in }, onText: { text = $0 })
        #expect(await events.next() == "started")
        await waitForDictationPhase(.recording, model: model)
        #expect(model.phase == .recording)

        engine.results.continuation.yield("keep this")
        engine.results.continuation.finish(throwing: VoiceResultsFailure.failed)
        await engine.resultsTask?.value
        #expect(await events.next() == "canceled")

        #expect(text == "keep this")
        #expect(!engine.captureActive)
        #expect(!engine.sessionActive)
        await waitForDictationPhase(.idle, model: model)
        #expect(model.phase == .idle)
        #expect(model.audioLevel == 0)
        #expect(model.errorMessage == "Dictation stopped unexpectedly. Try again.")
    }

    @Test("Failure while Stop awaits final results tears down and cannot overwrite a retry")
    func failureDuringFinalization() async {
        let engine = VoiceDictationEngineStub()
        var events = engine.events.stream.makeAsyncIterator()
        let model = FeatureVoiceDictationModel(requestPermission: { true }, makeEngine: { engine })
        model.start(vocabulary: [], onVolatile: { _ in }, onText: { _ in })
        #expect(await events.next() == "started")
        model.stop()
        #expect(await events.next() == "finishing")
        #expect(model.phase == .stopping)

        engine.results.continuation.finish(throwing: VoiceResultsFailure.failed)
        // finishAndFlush and the failure teardown may resume in either order.
        let completions = [await events.next(), await events.next()]
        #expect(completions.contains("finished"))
        #expect(completions.contains("canceled"))
        await waitForDictationPhase(.idle, model: model)
        #expect(model.phase == .idle)
        #expect(model.errorMessage != nil)
        #expect(!engine.sessionActive)

        model.start(vocabulary: [], onVolatile: { _ in }, onText: { _ in })
        #expect(await events.next() == "started")
        await waitForDictationPhase(.recording, model: model)
        #expect(model.phase == .recording)
        #expect(model.errorMessage == nil)
        model.cancel()
        #expect(await events.next() == "canceled")
    }

    @Test("Cancellation suppresses stream errors and stale callbacks even when an engine is reused")
    func cancellationAndGeneration() async {
        let engine = VoiceDictationEngineStub()
        var events = engine.events.stream.makeAsyncIterator()
        let model = FeatureVoiceDictationModel(requestPermission: { true }, makeEngine: { engine })
        var text = "original"
        model.start(vocabulary: [], onVolatile: { text = $0 }, onText: { text = $0 })
        #expect(await events.next() == "started")
        let oldFailure = engine.onFailure
        let oldFinal = engine.onFinal
        let oldResultsTask = engine.resultsTask
        let oldResults = engine.results

        model.cancel()
        #expect(await events.next() == "canceled")
        oldResults.continuation.finish(throwing: VoiceResultsFailure.failed)
        await oldResultsTask?.value
        #expect(model.errorMessage == nil)
        await waitForDictationPhase(.idle, model: model)
        #expect(model.phase == .idle)

        model.start(vocabulary: [], onVolatile: { text = $0 }, onText: { text = $0 })
        #expect(await events.next() == "started")
        oldFailure?(VoiceResultsFailure.failed)
        oldFinal?("late result")
        await waitForDictationPhase(.recording, model: model)
        #expect(model.phase == .recording)
        #expect(model.errorMessage == nil)
        #expect(text == "original")
        #expect(engine.captureActive)
        model.cancel()
        #expect(await events.next() == "canceled")
    }

    @Test("Repeated cancellation waits for teardown before allowing a new recording")
    func repeatedCancellationWaitsForTeardown() async {
        let engine = VoiceDictationEngineStub()
        var events = engine.events.stream.makeAsyncIterator()
        let release = AsyncStream<Void>.makeStream()
        engine.cancelRelease = release.stream
        let model = FeatureVoiceDictationModel(requestPermission: { true }, makeEngine: { engine })
        model.start(vocabulary: [], onVolatile: { _ in }, onText: { _ in })
        #expect(await events.next() == "started")
        await waitForDictationPhase(.recording, model: model)
        model.cancel()
        #expect(await events.next() == "canceled")
        model.cancel()
        model.start(vocabulary: [], onVolatile: { _ in }, onText: { _ in })
        #expect(model.phase == .stopping)
        release.continuation.finish()
        await waitForDictationPhase(.idle, model: model)
    }

    @Test("CancellationError from a recognizer is expected teardown")
    func cancellationErrorIsIgnored() async {
        let results = AsyncThrowingStream<String, Error>.makeStream()
        results.continuation.finish(throwing: CancellationError())
        var failed = false
        await featureConsumeVoiceResults(results.stream, onResult: { _ in }, onFailure: { _ in
            failed = true
        })
        #expect(!failed)
    }

    @Test("A canceled consumer suppresses a non-cancellation error from teardown")
    func canceledConsumerIgnoresTeardownFailure() async {
        var failed = false
        let consumer = Task { @MainActor in
            await featureConsumeVoiceResults(FailingVoiceResults(), onResult: { _ in }, onFailure: { _ in
                failed = true
            })
        }
        consumer.cancel()
        await consumer.value
        #expect(!failed)
    }
}

private enum VoiceResultsFailure: Error {
    case failed
}

/// Ignores task cancellation deliberately, like an Apple sequence that throws
/// its own framework error while teardown is unwinding.
private struct FailingVoiceResults: AsyncSequence {
    typealias Element = String

    struct AsyncIterator: AsyncIteratorProtocol {
        mutating func next() async throws -> String? {
            throw VoiceResultsFailure.failed
        }
    }

    func makeAsyncIterator() -> AsyncIterator { AsyncIterator() }
}

/// Uses the production results collector with an injected failing sequence;
/// the resource flags make the model's teardown observable without a mic.
@MainActor
private final class VoiceDictationEngineStub: FeatureVoiceDictationEngineProtocol {
    let events = AsyncStream<String>.makeStream()
    var results = AsyncThrowingStream<String, Error>.makeStream()
    var resultsTask: Task<Void, Never>?
    var onFailure: (@MainActor (Error) -> Void)?
    var onFinal: (@MainActor (String) -> Void)?
    var cancelRelease: AsyncStream<Void>?
    var captureActive = false
    var sessionActive = false

    func start(
        vocabulary: [String],
        onVolatile: @escaping @MainActor (String) -> Void,
        onFinal: @escaping @MainActor (String) -> Void,
        onLevel: @escaping @MainActor (Double) -> Void,
        onDownloading: @escaping @MainActor () -> Void,
        onFailure: @escaping @MainActor (Error) -> Void
    ) async throws {
        self.onFailure = onFailure
        self.onFinal = onFinal
        results = AsyncThrowingStream<String, Error>.makeStream()
        let stream = results.stream
        resultsTask = Task { @MainActor in
            await featureConsumeVoiceResults(stream, onResult: onFinal, onFailure: onFailure)
        }
        captureActive = true
        sessionActive = true
        onLevel(0.8)
        events.continuation.yield("started")
    }

    func finishAndFlush() async {
        captureActive = false
        sessionActive = false
        events.continuation.yield("finishing")
        await resultsTask?.value
        events.continuation.yield("finished")
    }

    func cancel() async {
        resultsTask?.cancel()
        captureActive = false
        sessionActive = false
        events.continuation.yield("canceled")
        if let cancelRelease {
            for await _ in cancelRelease { break }
        }
    }
}

/// Observe transitions rather than relying on task scheduling or sleeps.
@MainActor
private func waitForDictationPhase(
    _ phase: FeatureVoiceDictationModel.Phase,
    model: FeatureVoiceDictationModel
) async {
    while model.phase != phase {
        let changes = AsyncStream<Bool>.makeStream()
        withObservationTracking {
            _ = model.phase
        } onChange: {
            changes.continuation.yield(true)
            changes.continuation.finish()
        }
        for await _ in changes.stream { break }
    }
}
