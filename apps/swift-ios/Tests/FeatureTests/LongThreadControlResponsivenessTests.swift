import Testing
@testable import T3Code

@Suite("Long thread control responsiveness")
struct LongThreadControlResponsivenessTests {
    @Test(.bug("https://github.com/saphid/t3code-personal/issues/187"))
    @MainActor
    func repeatedStopTapsDispatchOneInterrupt() async {
        let client = LongThreadFeatureClient()
        let thread = FeatureThread(
            id: "thread-1",
            projectID: "project-1",
            environmentID: "environment-1",
            title: "Long task",
            state: .working
        )
        client.snapshot = FeatureSnapshot(threads: [thread])
        client.finishEvents()
        let model = FeatureRootModel(client: client)
        await model.start()

        let first = Task { await model.cancelTurn(threadID: thread.id) }
        await client.waitUntilCancelStarts()
        let second = Task { await model.cancelTurn(threadID: thread.id) }
        await Task.yield()

        #expect(client.cancelTurnCallCount == 1)

        client.finishCancel()
        await first.value
        await second.value
        #expect(client.cancelTurnCallCount == 1)
    }

    @Test(.bug("https://github.com/saphid/t3code-personal/issues/187"))
    @MainActor
    func longReductionSequenceYieldsToAControlAction() async {
        var thread = longRunningOrchestrationThread()
        let worker = NativeThreadDetailReductionWorker()
        var controlAccepted = false
        let control = Task { @MainActor in controlAccepted = true }

        for sequence in 1 ... 400 {
            let reduction = await worker.apply(
                longRunningMessageEvent(sequence: sequence),
                to: thread
            )
            guard case let .updated(next) = reduction.result else {
                Issue.record("Expected a streaming message update")
                return
            }
            thread = next
        }

        #expect(controlAccepted)
        await control.value
        #expect(thread.messages.first?.text.count == 400)
    }

    @Test(.bug("https://github.com/saphid/t3code-personal/issues/187"))
    func staleControlCompletionsCannotReleaseANewerCommand() {
        var state = FeatureThreadControlState()
        let stale = state.begin(.send)
        #expect(stale != nil)
        #expect(state.begin(.send) == nil)

        state.reset()
        let current = state.begin(.send)
        #expect(current != nil)
        #expect(state.finish(stale) == false)
        #expect(state.isInFlight(.send))
        #expect(state.finish(current))
        #expect(state.isInFlight(.send) == false)
    }

    @Test(.bug("https://github.com/saphid/t3code-personal/issues/187"))
    func staleReductionContextIsRejectedAfterNavigationOrReconnect() {
        let isCurrent: (
            Bool,
            Int,
            Int,
            String,
            String?,
            Bool
        ) -> Bool = NativeThreadDetailReductionApplicability.isCurrent

        #expect(isCurrent(false, 4, 4, "thread-1", "thread-1", true))
        #expect(isCurrent(false, 3, 4, "thread-1", "thread-1", true) == false)
        #expect(isCurrent(false, 4, 4, "thread-1", "thread-2", true) == false)
        #expect(isCurrent(false, 4, 4, "thread-1", "thread-1", false) == false)
        #expect(isCurrent(true, 4, 4, "thread-1", "thread-1", true) == false)
    }
}

private func longRunningOrchestrationThread() -> OrchestrationThread {
    OrchestrationThread(
        id: "thread-1",
        projectId: "project-1",
        title: "Long stream",
        modelSelection: ModelSelection(instanceId: "codex", model: "gpt-5.6-sol"),
        runtimeMode: .fullAccess,
        interactionMode: .default,
        branch: nil,
        worktreePath: nil,
        latestTurn: nil,
        createdAt: "2026-08-29T01:00:00Z",
        updatedAt: "2026-08-29T01:00:00Z",
        archivedAt: nil,
        settledOverride: nil,
        settledAt: nil,
        snoozedUntil: nil,
        snoozedAt: nil,
        pinnedAt: nil,
        deletedAt: nil,
        messages: [],
        activities: [],
        checkpoints: [],
        session: nil
    )
}

private func longRunningMessageEvent(sequence: Int) -> JSONValue {
    .object([
        "type": .string("thread.message-sent"),
        "sequence": .number(Double(sequence)),
        "occurredAt": .string("2026-08-29T01:00:01Z"),
        "payload": .object([
            "threadId": .string("thread-1"),
            "messageId": .string("assistant-1"),
            "role": .string("assistant"),
            "text": .string("x"),
            "turnId": .string("turn-1"),
            "streaming": .bool(true),
            "createdAt": .string("2026-08-29T01:00:00Z"),
            "updatedAt": .string("2026-08-29T01:00:01Z"),
        ]),
    ])
}

@MainActor
private final class LongThreadFeatureClient: FeatureClient {
    private let eventStream: AsyncStream<FeatureEvent>
    private let eventContinuation: AsyncStream<FeatureEvent>.Continuation
    private let cancelStartedStream: AsyncStream<Void>
    private let cancelStartedContinuation: AsyncStream<Void>.Continuation
    private let cancelReleaseStream: AsyncStream<Void>
    private let cancelReleaseContinuation: AsyncStream<Void>.Continuation

    var snapshot = FeatureSnapshot()
    var cancelTurnCallCount = 0

    init() {
        let events = AsyncStream<FeatureEvent>.makeStream()
        eventStream = events.stream
        eventContinuation = events.continuation
        let started = AsyncStream<Void>.makeStream()
        cancelStartedStream = started.stream
        cancelStartedContinuation = started.continuation
        let release = AsyncStream<Void>.makeStream()
        cancelReleaseStream = release.stream
        cancelReleaseContinuation = release.continuation
    }

    func initialSnapshot() async throws -> FeatureSnapshot { snapshot }
    func events() -> AsyncStream<FeatureEvent> { eventStream }

    func cancelTurn(threadID: String) async throws {
        cancelTurnCallCount += 1
        cancelStartedContinuation.yield()
        for await _ in cancelReleaseStream { break }
    }

    func finishEvents() {
        eventContinuation.finish()
    }

    func waitUntilCancelStarts() async {
        for await _ in cancelStartedStream { break }
    }

    func finishCancel() {
        cancelReleaseContinuation.yield()
        cancelReleaseContinuation.finish()
    }
}
