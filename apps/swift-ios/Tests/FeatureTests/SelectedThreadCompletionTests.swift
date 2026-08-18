import Foundation
import XCTest
@testable import T3Code

/// Completion metadata reaches Home rows and the thread header over the shell
/// stream, while the transcript is fed by a separate, completion-scoped thread
/// subscription. These tests hold that thread subscription open — exactly the
/// state the old refresh guard rejected — and prove the open timeline still
/// reconciles to the assistant's final response.
@MainActor
final class SelectedThreadCompletionTests: XCTestCase {
    func testDoneShellDeltaRendersTheFinalResponseInTheOpenTimeline() async throws {
        let fixture = try await makeFixture()
        defer { fixture.tearDown() }

        let selected = try await fixture.openThread()
        XCTAssertFalse(
            selected.messages.contains { $0.id == selectedFinalMessageID },
            "The open timeline must start before the final response."
        )
        let subscribed = await fixture.connection.waitUntilSubscribedToThread()
        XCTAssertTrue(subscribed, "The open thread must hold a live detail subscription.")

        let finalResponse = fixture.expectFinalResponseInTimeline()
        await fixture.transport.completeTurn()
        try await fixture.connection.emitCompletedThreadDelta(sequence: 2)

        await fulfillment(of: [finalResponse.rendered], timeout: 5)
        finalResponse.cancel()
        await fixture.client.disconnect()
    }

    /// Completion regularly lands while an earlier refresh is still in flight.
    /// The coalesced trailing refresh has to keep the reconciliation intent, or
    /// the transcript settles one HTTP round trip behind the Done projection.
    func testCompletionCoalescedBehindAnInFlightRefreshStillReconciles() async throws {
        let fixture = try await makeFixture()
        defer { fixture.tearDown() }

        _ = try await fixture.openThread()
        let subscribed = await fixture.connection.waitUntilSubscribedToThread()
        XCTAssertTrue(subscribed, "The open thread must hold a live detail subscription.")

        // Park the refresh that a whole-shell snapshot forces, so the later
        // completion delta can only arrive as a coalesced trailing refresh.
        await fixture.transport.holdNextDetailRead()
        try await fixture.connection.emitShellSnapshot(sequence: 2)
        let parked = await fixture.transport.waitForHeldDetailRead()
        guard parked else {
            return XCTFail(
                """
                A whole-shell snapshot must reconcile the selected transcript even \
                while its completion-scoped detail stream is still open.
                """
            )
        }

        let doneProjection = fixture.expectDoneProjection()
        try await fixture.connection.emitCompletedThreadDelta(sequence: 3)
        await fulfillment(of: [doneProjection.observed], timeout: 5)
        doneProjection.cancel()

        let finalResponse = fixture.expectFinalResponseInTimeline()
        await fixture.transport.completeTurn()
        // The held read answers with the pre-completion transcript, so only a
        // trailing refresh that survived coalescing can render the response.
        await fixture.transport.releaseHeldDetailRead()

        await fulfillment(of: [finalResponse.rendered], timeout: 5)
        finalResponse.cancel()
        await fixture.client.disconnect()
    }

    private func makeFixture() async throws -> SelectedThreadCompletionFixture {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(
                "t3-selected-completion-\(UUID().uuidString)",
                isDirectory: true
            )
        let environment = Environment(
            id: "environment-completion",
            label: "Completion",
            httpBaseURL: URL(string: "https://completion.example")!,
            webSocketBaseURL: URL(string: "wss://completion.example")!
        )
        let store = EnvironmentStore(
            fileURL: directory.appendingPathComponent("environments.json")
        )
        try await store.save([environment])
        try await store.setActiveEnvironment(id: environment.id)
        let transport = SelectedThreadCompletionHTTPTransport()
        let connection = SelectedThreadCompletionWebSocketConnection()
        let runtime = EnvironmentRuntime(
            environmentStore: store,
            credentialStore: InMemoryCredentialStore(
                credentials: [environment.id: EnvironmentCredential(accessToken: "token")]
            ),
            httpTransport: transport,
            webSocketConnector: SelectedThreadCompletionWebSocketConnector(
                connection: connection
            )
        )
        let client = NativeFeatureClient(
            runtime: runtime,
            settingsStore: UserDefaults(
                suiteName: "t3-selected-completion-\(UUID().uuidString)"
            )!,
            // Keep HTTP fallback polling out of the way: these tests must prove
            // the live shell path reconciles, not that a poll eventually does.
            fallbackPollingInitialDelay: .seconds(600),
            fallbackPollingInterval: .seconds(600),
            aggregateRefreshInterval: .seconds(600)
        )
        return SelectedThreadCompletionFixture(
            directory: directory,
            transport: transport,
            connection: connection,
            client: client
        )
    }
}

@MainActor
private struct SelectedThreadCompletionFixture {
    let directory: URL
    let transport: SelectedThreadCompletionHTTPTransport
    let connection: SelectedThreadCompletionWebSocketConnection
    let client: NativeFeatureClient

    struct Observation {
        let rendered: XCTestExpectation
        private let task: Task<Void, Never>

        init(expectation: XCTestExpectation, task: Task<Void, Never>) {
            rendered = expectation
            self.task = task
        }

        var observed: XCTestExpectation { rendered }

        func cancel() {
            task.cancel()
        }
    }

    func openThread() async throws -> FeatureThreadDetail {
        let snapshot = try await client.initialSnapshot()
        let thread = try XCTUnwrap(
            snapshot.threads.first { $0.wireID == selectedThreadWireID }
        )
        await connection.waitUntilConnected()
        let subscribed = await connection.waitUntilSubscribedToShell()
        XCTAssertTrue(subscribed, "The environment must hold a live shell subscription.")
        return try await client.loadThread(id: thread.id)
    }

    func expectFinalResponseInTimeline() -> Observation {
        observeDetail(
            description: "the final assistant response is rendered in the open timeline"
        ) { $0.messages.contains { $0.id == selectedFinalMessageID } }
    }

    func expectDoneProjection() -> Observation {
        observeDetail(
            description: "the open thread projects Done"
        ) { $0.thread.state == .completed }
    }

    func tearDown() {
        try? FileManager.default.removeItem(at: directory)
    }

    private func observeDetail(
        description: String,
        matching predicate: @escaping @Sendable (FeatureThreadDetail) -> Bool
    ) -> Observation {
        let expectation = XCTestExpectation(description: description)
        let events = client.events()
        let task = Task {
            for await event in events {
                let detail: FeatureThreadDetail?
                switch event {
                case let .detail(value), let .detailDelta(value, _):
                    detail = value
                default:
                    detail = nil
                }
                if let detail, predicate(detail) {
                    expectation.fulfill()
                    return
                }
            }
        }
        return Observation(expectation: expectation, task: task)
    }
}

private let selectedProjectID = "project-completion"
private let selectedThreadWireID = "thread-completion"
private let selectedFinalMessageID = "final-assistant-message"
private let selectedTimestamp = "2026-08-18T09:00:00.000Z"
private let selectedCompletedAt = "2026-08-18T09:01:00.000Z"

private struct SelectedThreadCompletionWebSocketConnector: WebSocketConnecting {
    let connection: SelectedThreadCompletionWebSocketConnection

    func connect(to _: URL) async throws -> any WebSocketConnection {
        connection
    }
}

/// A scripted RPC peer. The thread subscription is accepted and then held open
/// forever, which is the exact live state in which Done metadata can overtake
/// the transcript.
private actor SelectedThreadCompletionWebSocketConnection: WebSocketConnection {
    private var queued: [Data] = []
    private var receiver: CheckedContinuation<Data, Error>?
    private var shellRequestID: Int?
    private var threadRequestID: Int?
    private var didConnect = false
    private var connectionWaiters: [CheckedContinuation<Void, Never>] = []

    func send(_ data: Data) throws {
        let request = try JSONDecoder.t3.decode(JSONValue.self, from: data)
        if !didConnect {
            didConnect = true
            connectionWaiters.forEach { $0.resume() }
            connectionWaiters.removeAll()
        }
        guard let tag = request["tag"]?.stringValue,
              case let .number(rawRequestID)? = request["id"] else {
            return
        }
        let requestID = Int(rawRequestID)
        switch tag {
        case RPCMethod.serverGetConfig.rawValue:
            enqueue(
                try JSONEncoder.t3.encode(
                    JSONValue.object([
                        "_tag": .string("Exit"),
                        "requestId": .number(Double(requestID)),
                        "exit": .object([
                            "_tag": .string("Success"),
                            "value": .object(["providers": .array([])]),
                        ]),
                    ])
                )
            )
        case RPCMethod.subscribeShell.rawValue:
            shellRequestID = requestID
        case RPCMethod.subscribeThread.rawValue:
            threadRequestID = requestID
        default:
            return
        }
    }

    func receive() async throws -> Data {
        if !queued.isEmpty {
            return queued.removeFirst()
        }
        return try await withCheckedThrowingContinuation { continuation in
            receiver = continuation
        }
    }

    func close() {
        receiver?.resume(throwing: CancellationError())
        receiver = nil
    }

    func waitUntilConnected() async {
        guard !didConnect else { return }
        await withCheckedContinuation { continuation in
            connectionWaiters.append(continuation)
        }
    }

    /// Bounded so a missing subscription fails the test instead of hanging it.
    func waitUntilSubscribedToShell(withinSeconds seconds: Double = 5) async -> Bool {
        await poll(withinSeconds: seconds) { self.shellRequestID != nil }
    }

    func waitUntilSubscribedToThread(withinSeconds seconds: Double = 5) async -> Bool {
        await poll(withinSeconds: seconds) { self.threadRequestID != nil }
    }

    private func poll(
        withinSeconds seconds: Double,
        until condition: () -> Bool
    ) async -> Bool {
        for _ in 0..<Int(seconds * 20) {
            if condition() { return true }
            try? await Task.sleep(for: .milliseconds(50))
        }
        return condition()
    }

    func emitCompletedThreadDelta(sequence: Int) throws {
        guard let shellRequestID else { return }
        enqueue(
            try JSONEncoder.t3.encode(
                RPCChunk(
                    requestId: shellRequestID,
                    values: [
                        ShellThreadUpsertedDelta(
                            sequence: sequence,
                            thread: selectedThreadShell(completed: true)
                        ),
                    ]
                )
            )
        )
    }

    func emitShellSnapshot(sequence: Int) throws {
        guard let shellRequestID else { return }
        enqueue(
            try JSONEncoder.t3.encode(
                RPCChunk(
                    requestId: shellRequestID,
                    values: [
                        ShellSnapshotDelta(
                            snapshot: selectedShellSnapshot(
                                sequence: sequence,
                                completed: false
                            )
                        ),
                    ]
                )
            )
        )
    }

    private func enqueue(_ data: Data) {
        if let receiver {
            self.receiver = nil
            receiver.resume(returning: data)
        } else {
            queued.append(data)
        }
    }
}

private struct RPCChunk<Value: Encodable>: Encodable {
    let _tag = "Chunk"
    let requestId: Int
    let values: [Value]
}

private struct ShellThreadUpsertedDelta: Encodable {
    let kind = "thread-upserted"
    let sequence: Int
    let thread: OrchestrationThreadShell
}

private struct ShellSnapshotDelta: Encodable {
    let kind = "snapshot"
    let snapshot: OrchestrationShellSnapshot
}

private actor SelectedThreadCompletionHTTPTransport: HTTPTransport {
    private var turnIsComplete = false
    private var holdsNextDetailRead = false
    private var heldDetailRead: CheckedContinuation<Void, Never>?

    /// Flip the server-side truth: the turn is done and its final assistant
    /// message is now part of the thread snapshot.
    func completeTurn() {
        turnIsComplete = true
    }

    func holdNextDetailRead() {
        holdsNextDetailRead = true
    }

    /// Deliberately bounded. Without the fix no detail read is ever issued, and
    /// an unbounded wait here would hang the whole test run instead of failing.
    func waitForHeldDetailRead(withinSeconds seconds: Double = 5) async -> Bool {
        let steps = Int(seconds * 20)
        for _ in 0..<steps {
            if heldDetailRead != nil { return true }
            try? await Task.sleep(for: .milliseconds(50))
        }
        return heldDetailRead != nil
    }

    func releaseHeldDetailRead() {
        heldDetailRead?.resume()
        heldDetailRead = nil
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let path = request.url?.path ?? ""
        if path == "/api/auth/websocket-ticket" {
            return (
                Data(
                    """
                    {"ticket":"ticket","expiresAt":"2026-08-18T09:05:00.000Z"}
                    """.utf8
                ),
                selectedResponse(request)
            )
        }
        if path == "/api/orchestration/shell" {
            return (
                try JSONEncoder.t3.encode(
                    selectedShellSnapshot(sequence: 1, completed: turnIsComplete)
                ),
                selectedResponse(request)
            )
        }
        if path.hasPrefix("/api/orchestration/threads/") {
            // A held read answers with the transcript as it stood when the read
            // began, which is how a real refresh can land just before the final
            // events are durable.
            if holdsNextDetailRead {
                holdsNextDetailRead = false
                let staleDetail = selectedThreadDetail(includesFinalResponse: false)
                await withCheckedContinuation { continuation in
                    heldDetailRead = continuation
                }
                return (try JSONEncoder.t3.encode(staleDetail), selectedResponse(request))
            }
            return (
                try JSONEncoder.t3.encode(
                    selectedThreadDetail(includesFinalResponse: turnIsComplete)
                ),
                selectedResponse(request)
            )
        }
        throw URLError(.unsupportedURL)
    }
}

private func selectedShellSnapshot(
    sequence: Int,
    completed: Bool
) -> OrchestrationShellSnapshot {
    OrchestrationShellSnapshot(
        snapshotSequence: sequence,
        projects: [
            OrchestrationProject(
                id: selectedProjectID,
                title: "Completion",
                workspaceRoot: "/work/completion",
                repositoryIdentity: nil,
                defaultModelSelection: selectedModel,
                scripts: [],
                createdAt: selectedTimestamp,
                updatedAt: selectedTimestamp,
                deletedAt: nil
            ),
        ],
        threads: [selectedThreadShell(completed: completed)],
        updatedAt: selectedTimestamp
    )
}

private let selectedModel = ModelSelection(instanceId: "codex", model: "gpt-5.6-sol")

private func selectedLatestTurn(completed: Bool) -> OrchestrationLatestTurn {
    OrchestrationLatestTurn(
        turnId: "turn-one",
        state: completed ? "completed" : "running",
        requestedAt: selectedTimestamp,
        startedAt: selectedTimestamp,
        completedAt: completed ? selectedCompletedAt : nil,
        assistantMessageId: completed ? selectedFinalMessageID : nil
    )
}

private func selectedThreadShell(completed: Bool) -> OrchestrationThreadShell {
    OrchestrationThreadShell(
        id: selectedThreadWireID,
        projectId: selectedProjectID,
        title: "Completion",
        modelSelection: selectedModel,
        runtimeMode: .fullAccess,
        interactionMode: .default,
        branch: "fix/issue101-completion-refresh",
        worktreePath: nil,
        latestTurn: selectedLatestTurn(completed: completed),
        createdAt: selectedTimestamp,
        updatedAt: completed ? selectedCompletedAt : selectedTimestamp,
        archivedAt: nil,
        settledOverride: nil,
        settledAt: nil,
        snoozedUntil: nil,
        snoozedAt: nil,
        pinnedAt: nil,
        session: nil,
        latestUserMessageAt: selectedTimestamp,
        hasPendingApprovals: false,
        hasPendingUserInput: false,
        hasActionableProposedPlan: false,
        backgroundLiveness: nil
    )
}

private func selectedThreadDetail(
    includesFinalResponse: Bool
) -> OrchestrationThreadDetailSnapshot {
    var messages = [
        OrchestrationMessage(
            id: "user-message",
            role: "user",
            text: "Summarize the change.",
            attachments: nil,
            turnId: "turn-one",
            streaming: false,
            createdAt: selectedTimestamp,
            updatedAt: selectedTimestamp
        ),
    ]
    if includesFinalResponse {
        messages.append(
            OrchestrationMessage(
                id: selectedFinalMessageID,
                role: "assistant",
                text: "Here is the completed response.",
                attachments: nil,
                turnId: "turn-one",
                streaming: false,
                createdAt: selectedCompletedAt,
                updatedAt: selectedCompletedAt
            )
        )
    }
    return OrchestrationThreadDetailSnapshot(
        // The reconciled snapshot must never regress the live sequence the
        // detail stream already published.
        snapshotSequence: includesFinalResponse ? 3 : 2,
        thread: OrchestrationThread(
            id: selectedThreadWireID,
            projectId: selectedProjectID,
            title: "Completion",
            modelSelection: selectedModel,
            runtimeMode: .fullAccess,
            interactionMode: .default,
            branch: "fix/issue101-completion-refresh",
            worktreePath: nil,
            latestTurn: selectedLatestTurn(completed: includesFinalResponse),
            createdAt: selectedTimestamp,
            updatedAt: includesFinalResponse ? selectedCompletedAt : selectedTimestamp,
            archivedAt: nil,
            settledOverride: nil,
            settledAt: nil,
            snoozedUntil: nil,
            snoozedAt: nil,
            pinnedAt: nil,
            deletedAt: nil,
            messages: messages,
            activities: [],
            checkpoints: [],
            session: nil
        )
    )
}

private func selectedResponse(_ request: URLRequest) -> HTTPURLResponse {
    HTTPURLResponse(
        url: request.url!,
        statusCode: 200,
        httpVersion: "HTTP/1.1",
        headerFields: ["Content-Type": "application/json"]
    )!
}
