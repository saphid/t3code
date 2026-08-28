import Foundation
import Testing
@testable import T3Code

@Suite("Pinned thread reorder")
@MainActor
struct PinnedThreadReorderTests {
    private let now = Date(timeIntervalSince1970: 2_000_000)

    @Test("Wire models decode reorder capability and order keys", .bug("https://github.com/saphid/t3code-personal/issues/146"))
    func wireModelsDecodePinnedReorderFields() throws {
        let descriptor = try JSONDecoder.t3.decode(
            EnvironmentDescriptor.self,
            from: Data(
                #"{"environmentId":"environment","label":"Proof","platform":{"os":"darwin","arch":"arm64"},"serverVersion":"1","capabilities":{"repositoryIdentity":true,"threadPinning":true,"threadPinReorder":true}}"#.utf8
            )
        )
        let shell = try JSONDecoder.t3.decode(
            OrchestrationThreadShell.self,
            from: Data(
                #"{"id":"thread","projectId":"project","title":"Pinned","modelSelection":{"instanceId":"codex","model":"gpt-5.6-sol"},"runtimeMode":"full-access","interactionMode":"default","branch":null,"worktreePath":null,"latestTurn":null,"createdAt":"2026-08-28T00:00:00Z","updatedAt":"2026-08-28T00:00:00Z","archivedAt":null,"settledOverride":"active","settledAt":null,"snoozedUntil":null,"snoozedAt":null,"pinnedAt":"2026-08-28T00:00:00Z","pinOrderKey":"m","session":null,"latestUserMessageAt":null,"hasPendingApprovals":false,"hasPendingUserInput":false,"hasActionableProposedPlan":false,"backgroundLiveness":null}"#.utf8
            )
        )

        #expect(descriptor.capabilities.threadPinReorder == true)
        #expect(shell.pinOrderKey == "m")
    }

    @Test(
        "Legacy saved environments refresh the reorder capability",
        .bug("https://github.com/saphid/t3code-personal/issues/146")
    )
    func legacyEnvironmentRefreshesCapability() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("t3-pinned-reorder-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let descriptor = try JSONDecoder.t3.decode(
            EnvironmentDescriptor.self,
            from: Data(
                #"{"environmentId":"environment","label":"Old label","platform":{"os":"darwin","arch":"arm64"},"serverVersion":"1","capabilities":{"repositoryIdentity":true,"threadPinning":true}}"#.utf8
            )
        )
        let environment = Environment(
            id: "environment",
            label: "Old label",
            httpBaseURL: URL(string: "https://environment.example")!,
            webSocketBaseURL: URL(string: "wss://environment.example")!,
            descriptor: descriptor
        )
        let store = EnvironmentStore(fileURL: directory.appendingPathComponent("environments.json"))
        try await store.save([environment])
        let runtime = EnvironmentRuntime(
            environmentStore: store,
            credentialStore: InMemoryCredentialStore(),
            httpTransport: PinReorderDescriptorTransport()
        )

        let refreshed = try await runtime.refreshDescriptor(id: environment.id)
        let persistedEnvironments = try await store.load()
        let persisted = try #require(persistedEnvironments.first)

        #expect(refreshed.label == "Current label")
        #expect(refreshed.descriptor?.capabilities.threadPinReorder == true)
        #expect(persisted == refreshed)
    }

    @Test("Reorder command matches the shared contract", .bug("https://github.com/saphid/t3code-personal/issues/146"))
    func commandMatchesSharedContract() {
        let command = OrchestrationCommands.reorderPin(
            threadID: "thread",
            orderKey: "m",
            commandID: "command"
        )

        #expect(command["type"]?.stringValue == "thread.pin.reorder")
        #expect(command["threadId"]?.stringValue == "thread")
        #expect(command["orderKey"]?.stringValue == "m")
        #expect(command["commandId"]?.stringValue == "command")
    }

    @Test("Canonical ordering drives menu boundaries", .bug("https://github.com/saphid/t3code-personal/issues/146"))
    func canonicalOrderingAndBoundaries() {
        let first = thread(id: "first", key: "c", createdOffset: -300)
        let middle = thread(id: "middle", key: "m", createdOffset: -200)
        let last = thread(id: "last", key: nil, createdOffset: -100)
        var unsupported = thread(id: "unsupported", key: "a", createdOffset: 0)
        unsupported.supportsPinReorder = false
        var archived = thread(id: "archived", key: "b", createdOffset: 0)
        archived.isArchived = true

        let ordered = PinnedThreadReordering.eligibleThreads(
            in: [last, unsupported, middle, archived, first]
        )
        let positions = PinnedThreadReordering.positions(in: ordered)

        #expect(ordered.map(\.id) == ["first", "middle", "last"])
        #expect(positions["first"] == .init(canMoveUp: false, canMoveDown: true))
        #expect(positions["middle"] == .init(canMoveUp: true, canMoveDown: true))
        #expect(positions["last"] == .init(canMoveUp: true, canMoveDown: false))
        #expect(positions["unsupported"] == nil)
    }

    @Test(
        "Equal keys use wire identity before environment",
        .bug("https://github.com/saphid/t3code-personal/issues/146")
    )
    func equalKeysConvergeAcrossEnvironments() {
        var first = thread(id: "scoped-z", key: "m", createdOffset: 0)
        first.wireID = "a"
        first.environmentID = "environment-z"
        var second = thread(id: "scoped-a", key: "m", createdOffset: 0)
        second.wireID = "z"
        second.environmentID = "environment-a"

        #expect(PinnedThreadReordering.sorted([second, first]).map(\.id) == [first.id, second.id])
    }

    @Test("A keyed move writes one thread and reverses", .bug("https://github.com/saphid/t3code-personal/issues/146"))
    func keyedMoveAndReverse() throws {
        let original = [
            thread(id: "first", key: "c", createdOffset: -300),
            thread(id: "middle", key: "m", createdOffset: -200),
            thread(id: "last", key: "x", createdOffset: -100),
        ]

        let upward = try #require(
            PinnedThreadReordering.planMove(
                threads: original,
                movedID: "middle",
                direction: .up
            )
        )
        #expect(upward == [.init(id: "middle", orderKey: "b")])

        var moved = original
        let middleIndex = try #require(moved.firstIndex { $0.id == "middle" })
        moved[middleIndex].pinOrderKey = upward[0].orderKey
        let reverse = try #require(
            PinnedThreadReordering.planMove(
                threads: PinnedThreadReordering.eligibleThreads(in: moved),
                movedID: "middle",
                direction: .down
            )
        )

        #expect(reverse.count == 1)
        #expect(reverse[0].id == "middle")
        #expect(reverse[0].orderKey > "c")
        #expect(reverse[0].orderKey < "x")
    }

    @Test("A keyless neighbor receives a deterministic section rewrite", .bug("https://github.com/saphid/t3code-personal/issues/146"))
    func keylessNeighborFallback() throws {
        let threads = [
            thread(id: "keyed", key: "c", createdOffset: -300),
            thread(id: "legacy", key: nil, createdOffset: -100),
            thread(id: "legacy-last", key: nil, createdOffset: -200),
        ]

        let assignments = try #require(
            PinnedThreadReordering.planMove(
                threads: threads,
                movedID: "keyed",
                direction: .down
            )
        )

        #expect(assignments.map(\.id) == ["legacy", "keyed", "legacy-last"])
        #expect(assignments.map(\.orderKey) == assignments.map(\.orderKey).sorted())
        #expect(assignments.allSatisfy { !$0.orderKey.hasSuffix("a") })
    }

    @Test("Root model changes only pin order state", .bug("https://github.com/saphid/t3code-personal/issues/146"))
    func rootModelPreservesUnrelatedState() async throws {
        var first = thread(id: "first", key: "c", createdOffset: -300)
        first.state = .failed
        first.isSettled = false
        first.snoozedAt = now.addingTimeInterval(-60)
        first.snoozedUntil = nil
        first.preview = "Composer-adjacent state stays intact"
        let middle = thread(id: "middle", key: "m", createdOffset: -200)
        let client = PinnedReorderClient(snapshot: snapshot([first, middle]))
        let model = FeatureRootModel(client: client)
        await model.reload()
        let before = try #require(model.snapshot.threads.first { $0.id == "middle" })

        let moved = await model.movePinnedThread("middle", direction: .up)

        let after = try #require(model.snapshot.threads.first { $0.id == "middle" })
        #expect(moved)
        #expect(client.requests == [.init(id: "middle", orderKey: "b")])
        #expect(after.pinOrderKey == "b")
        #expect(after.pinnedAt == before.pinnedAt)
        #expect(after.isSettled == before.isSettled)
        #expect(after.snoozedAt == before.snoozedAt)
        #expect(after.snoozedUntil == before.snoozedUntil)
        #expect(after.isArchived == before.isArchived)
        #expect(after.state == before.state)
        #expect(after.preview == before.preview)
    }

    @Test(
        "A partial section rewrite stays retryable and reports its state",
        .bug("https://github.com/saphid/t3code-personal/issues/146")
    )
    func partialRewriteReportsContext() async throws {
        let threads = [
            thread(id: "keyed", key: "c", createdOffset: -300),
            thread(id: "legacy", key: nil, createdOffset: -100),
            thread(id: "legacy-last", key: nil, createdOffset: -200),
        ]
        let client = PinnedReorderClient(snapshot: snapshot(threads), failingRequest: 2)
        let model = FeatureRootModel(client: client)
        await model.reload()

        let moved = await model.movePinnedThread("keyed", direction: .down)

        #expect(!moved)
        #expect(client.requests.count == 2)
        #expect(model.errorMessage == "Pinned order was partially updated. Try the move again.")
        #expect(
            PinnedThreadReordering.planMove(
                threads: model.snapshot.threads,
                movedID: "keyed",
                direction: .down
            ) != nil
        )
    }

    private func thread(
        id: String,
        key: String?,
        createdOffset: TimeInterval
    ) -> FeatureThread {
        FeatureThread(
            id: id,
            wireID: id,
            projectID: "project",
            environmentID: "environment",
            title: id,
            createdAt: now.addingTimeInterval(createdOffset),
            updatedAt: now,
            pinnedAt: now,
            pinOrderKey: key,
            supportsPinning: true,
            supportsPinReorder: true
        )
    }

    private func snapshot(_ threads: [FeatureThread]) -> FeatureSnapshot {
        FeatureSnapshot(
            projects: [
                FeatureProject(
                    id: "project",
                    environmentID: "environment",
                    name: "Proof",
                    path: "/proof"
                ),
            ],
            threads: threads
        )
    }
}

@MainActor
private final class PinnedReorderClient: FeatureClient {
    struct Request: Equatable {
        let id: String
        let orderKey: String
    }

    let snapshot: FeatureSnapshot
    var requests: [Request] = []
    let failingRequest: Int?

    init(snapshot: FeatureSnapshot, failingRequest: Int? = nil) {
        self.snapshot = snapshot
        self.failingRequest = failingRequest
    }

    func initialSnapshot() async throws -> FeatureSnapshot {
        snapshot
    }

    func reorderPinnedThread(id: String, orderKey: String) async throws {
        requests.append(.init(id: id, orderKey: orderKey))
        if requests.count == failingRequest {
            throw PinnedReorderFailure()
        }
    }

    func pair(endpoint: String, token: String?) async throws {}

    func createThread(
        projectID: String,
        title: String?,
        selection: FeatureSelection?
    ) async throws -> FeatureThread {
        FeatureThread(id: "created", projectID: projectID, title: title ?? "Created")
    }

    func renameThread(id: String, title: String) async throws {}
    func setThreadArchived(id: String, archived: Bool) async throws {}
    func deleteThread(id: String) async throws {}

    func loadThread(id: String) async throws -> FeatureThreadDetail {
        FeatureThreadDetail(
            thread: snapshot.threads.first { $0.id == id }
                ?? FeatureThread(id: id, projectID: "project", title: "Task")
        )
    }

    func sendMessage(
        threadID: String,
        text: String,
        selection: FeatureSelection?
    ) async throws {}
    func cancelTurn(threadID: String) async throws {}
    func resolveApproval(id: String, decision: FeatureApprovalDecision) async throws {}
    func saveSettings(_ settings: FeatureSettings) async throws {}
}

private struct PinnedReorderFailure: Error {}

private struct PinReorderDescriptorTransport: HTTPTransport {
    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let body = #"{"environmentId":"environment","label":"Current label","platform":{"os":"darwin","arch":"arm64"},"serverVersion":"2","capabilities":{"repositoryIdentity":true,"threadPinning":true,"threadPinReorder":true}}"#
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        return (Data(body.utf8), response)
    }
}
