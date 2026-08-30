import Foundation
import Testing
import XCTest
@testable import T3Code

@Suite("Task widget snapshot")
struct TaskWidgetSnapshotTests {
    @Test
    func preservesTaskAndEmptyStates() throws {
        let directory = FileManager.default.temporaryDirectory
            .appending(path: "T3TaskWidgetSnapshotStoreTests-\(UUID().uuidString)")
        let url = directory.appending(path: "snapshot.json")
        defer { try? FileManager.default.removeItem(at: directory) }

        let task = T3RelayAgentActivityAggregateRow(
            environmentId: "environment",
            threadId: "thread",
            projectTitle: "t3code",
            threadTitle: "Fix the widget",
            modelTitle: "GPT-5.6 Sol",
            phase: .running,
            status: "Working",
            updatedAt: "2026-08-30T04:00:00.000Z",
            deepLink: "/environment/thread"
        )
        let taskSnapshot = T3TaskWidgetSnapshot(
            updatedAt: "2026-08-30T04:00:00.000Z",
            tasks: [task]
        )

        try T3TaskWidgetSnapshotStore.save(taskSnapshot, to: url)
        #expect(T3TaskWidgetSnapshotStore.load(from: url) == .tasks(taskSnapshot))

        let emptySnapshot = T3TaskWidgetSnapshot(
            updatedAt: "2026-08-30T04:01:00.000Z",
            tasks: []
        )
        try T3TaskWidgetSnapshotStore.save(emptySnapshot, to: url)
        #expect(T3TaskWidgetSnapshotStore.load(from: url) == .empty(updatedAt: emptySnapshot.updatedAt))
    }

    @Test
    func reportsMissingCorruptIncompatibleAndUnreadableData() throws {
        let directory = FileManager.default.temporaryDirectory
            .appending(path: "T3TaskWidgetSnapshotRecoveryTests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appending(path: "snapshot.json")

        #expect(T3TaskWidgetSnapshotStore.load(from: nil) == .recovery(.unavailable))
        #expect(T3TaskWidgetSnapshotStore.load(from: url) == .recovery(.missing))

        try Data("not-json".utf8).write(to: url)
        #expect(T3TaskWidgetSnapshotStore.load(from: url) == .recovery(.corrupt))

        let incompatible = Data(
            #"{"schemaVersion":999,"updatedAt":"2026-08-30T04:00:00.000Z","tasks":[]}"#.utf8
        )
        try incompatible.write(to: url)
        #expect(T3TaskWidgetSnapshotStore.load(from: url) == .recovery(.incompatible))

        #expect(T3TaskWidgetSnapshotStore.load(from: directory) == .recovery(.unreadable))
    }

    @Test
    func readsLegacySnapshotsAndWritesTheCurrentSchema() throws {
        let directory = FileManager.default.temporaryDirectory
            .appending(path: "T3TaskWidgetSnapshotSchemaTests-\(UUID().uuidString)")
        let url = directory.appending(path: "snapshot.json")
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

        try Data(#"{"updatedAt":"legacy","tasks":[]}"#.utf8).write(to: url)
        #expect(T3TaskWidgetSnapshotStore.load(from: url) == .empty(updatedAt: "legacy"))

        try T3TaskWidgetSnapshotStore.save(.empty, to: url)
        let object = try #require(
            JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any]
        )
        #expect(object["schemaVersion"] as? Int == T3TaskWidgetSnapshot.currentSchemaVersion)
    }

    @Test
    func everyFamilyHasNonblankEmptyAndRecoveryCopyWithAnIdentityCorrectLink() {
        let states: [T3TaskWidgetState] = [
            .empty(updatedAt: "2026-08-30T04:00:00.000Z"),
            .recovery(.missing),
            .recovery(.unavailable),
            .recovery(.unreadable),
            .recovery(.corrupt),
            .recovery(.incompatible),
        ]

        for state in states {
            for family in T3TaskWidgetFamily.allCases {
                let fallback = state.fallback(for: family)
                #expect(!fallback.title.isEmpty, "Missing title for \(state) in \(family)")
                #expect(!fallback.systemImage.isEmpty, "Missing icon for \(state) in \(family)")
                #expect(
                    fallback.destination.absoluteString
                        == "\(T3SharedContainer.urlScheme)://new-task"
                )
            }
        }
    }
}

final class ExtensionContractTests: XCTestCase {
    func testLiveActivityDecodesTheRelayAPNSEnvelope() throws {
        let props = #"{"title":"T3 Code","subtitle":"2 active agents, 1 needs attention","activeCount":2,"updatedAt":"2026-08-01T12:00:00.000Z","activities":[{"environmentId":"env-1","threadId":"thread-working","projectTitle":"t3code","threadTitle":"Build the native app","modelTitle":"GPT-5.6 Sol","phase":"running","status":"Working","updatedAt":"2026-08-01T12:00:00.000Z","deepLink":"/env-1/thread-working"},{"environmentId":"env-2","threadId":"thread-approval","projectTitle":"uploadthing","threadTitle":"Ship upload recovery","modelTitle":"Claude Opus 5","phase":"waiting_for_approval","status":"Approval","updatedAt":"2026-08-01T11:59:00.000Z","deepLink":"/env-2/thread-approval"}]}"#
        let state = LiveActivityAttributes.ContentState(
            name: "AgentActivity",
            props: props
        )

        let aggregate = try XCTUnwrap(state.aggregate)
        XCTAssertEqual(aggregate.activeCount, 2)
        XCTAssertEqual(aggregate.activities.count, 2)
        XCTAssertEqual(aggregate.attentionFirstActivities.first?.threadId, "thread-approval")
        XCTAssertEqual(
            aggregate.attentionFirstActivities.first?.nativeDeepLinkURL?.absoluteString,
            "\(T3SharedContainer.urlScheme)://threads?environment=env-2&thread=thread-approval"
        )
    }

    func testLocalLiveActivityStatePreservesTheExactNameAndPropsKeys() throws {
        let aggregate = T3RelayAgentActivityAggregateState(
            title: "T3 Code",
            subtitle: "1 active agent",
            activeCount: 1,
            updatedAt: "2026-08-01T12:00:00.000Z",
            activities: []
        )
        let state = try LiveActivityAttributes.ContentState(aggregate: aggregate)
        let encoded = try XCTUnwrap(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(state)) as? [String: Any]
        )

        XCTAssertEqual(Set(encoded.keys), Set(["name", "props"]))
        XCTAssertEqual(encoded["name"] as? String, "AgentActivity")
        XCTAssertEqual(state.aggregate, aggregate)
    }

    func testUnexpectedActivityNamesNeverDecodeAsAgentState() {
        let state = LiveActivityAttributes.ContentState(name: "Other", props: "{}")
        XCTAssertNil(state.aggregate)
    }
}
