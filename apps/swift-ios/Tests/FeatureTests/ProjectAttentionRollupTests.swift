import Foundation
import Testing
@testable import T3Code

@Suite("Project attention rollup")
struct ProjectAttentionRollupTests {
    private let now = Date(timeIntervalSince1970: 2_000_000)

    @Test(
        "Project state uses the documented priority",
        .bug("https://github.com/saphid/t3code-personal/issues/201")
    )
    func priorityIsStableAcrossThreadOrder() {
        let completion = thread(
            id: "completion",
            projectID: "project",
            state: .completed,
            completionOffset: -10
        )
        let input = thread(id: "input", projectID: "project", state: .waitingForInput)
        let failure = thread(id: "failure", projectID: "project", state: .failed)
        let visits = [completion.id: now.addingTimeInterval(-20)]

        let forward = ProjectAttentionRollup(
            threads: [completion, input, failure],
            lastVisitedAtByThreadID: visits,
            now: now
        )
        let reverse = ProjectAttentionRollup(
            threads: [failure, input, completion],
            lastVisitedAtByThreadID: visits,
            now: now
        )

        #expect(forward.state(for: "project") == .failure)
        #expect(reverse == forward)
    }

    @Test(
        "Projected failure outranks a simultaneous pending request",
        .bug("https://github.com/saphid/t3code-personal/issues/201")
    )
    func failureTimestampOutranksPendingState() {
        var thread = thread(
            id: "conflict",
            projectID: "project",
            state: .waitingForApproval
        )
        thread.attentionAt = now.addingTimeInterval(-10)

        #expect(rollup([thread]).state(for: thread.projectID) == .failure)
    }

    @Test(
        "Settled, archived, and applicable snoozed threads do not contribute",
        .bug("https://github.com/saphid/t3code-personal/issues/201")
    )
    func exclusionsRemoveAttention() {
        var settled = thread(id: "settled", projectID: "project", state: .failed)
        settled.isSettled = true
        var archived = thread(id: "archived", projectID: "project", state: .failed)
        archived.isArchived = true
        var snoozed = thread(id: "snoozed", projectID: "project", state: .failed)
        snoozed.snoozedUntil = now.addingTimeInterval(3_600)
        snoozed.snoozedAt = now.addingTimeInterval(-10)
        snoozed.attentionAt = now.addingTimeInterval(-20)

        let rollup = ProjectAttentionRollup(
            threads: [settled, archived, snoozed],
            lastVisitedAtByThreadID: [:],
            now: now
        )

        #expect(rollup.state(for: "project") == nil)
    }

    @Test(
        "New failure and completion activity wake a snoozed thread",
        .bug("https://github.com/saphid/t3code-personal/issues/201")
    )
    func newAttentionAfterSnoozeContributes() {
        var failure = thread(id: "failure", projectID: "failed-project", state: .failed)
        failure.snoozedUntil = now.addingTimeInterval(3_600)
        failure.snoozedAt = now.addingTimeInterval(-20)
        failure.attentionAt = now.addingTimeInterval(-10)
        var completion = thread(
            id: "completion",
            projectID: "completed-project",
            state: .completed,
            completionOffset: -10
        )
        completion.snoozedUntil = now.addingTimeInterval(3_600)
        completion.snoozedAt = now.addingTimeInterval(-20)

        let rollup = ProjectAttentionRollup(
            threads: [failure, completion],
            lastVisitedAtByThreadID: [completion.id: now.addingTimeInterval(-30)],
            now: now
        )

        #expect(rollup.state(for: failure.projectID) == .failure)
        #expect(rollup.state(for: completion.projectID) == .unseenCompletion)
    }

    @Test(
        "Reverse transitions lower and clear the rollup",
        .bug("https://github.com/saphid/t3code-personal/issues/201")
    )
    func reverseTransitions() {
        let completion = thread(
            id: "completion",
            projectID: "project",
            state: .completed,
            completionOffset: -10
        )
        let input = thread(id: "input", projectID: "project", state: .waitingForApproval)
        var failure = thread(id: "failure", projectID: "project", state: .failed)
        let unseenVisit = now.addingTimeInterval(-20)

        #expect(
            rollup([completion, input, failure], visits: [completion.id: unseenVisit])
                .state(for: "project") == .failure
        )
        failure.isSettled = true
        #expect(
            rollup([completion, input, failure], visits: [completion.id: unseenVisit])
                .state(for: "project") == .pendingInput
        )
        #expect(
            rollup([completion, failure], visits: [completion.id: unseenVisit])
                .state(for: "project") == .unseenCompletion
        )
        #expect(
            rollup([completion, failure], visits: [completion.id: now])
                .state(for: "project") == nil
        )
    }

    @Test(
        "Environment-scoped projects do not leak attention",
        .bug("https://github.com/saphid/t3code-personal/issues/201")
    )
    func environmentAndLogicalGroupScoping() {
        let local = FeatureProject(
            id: "local:project",
            environmentID: "local",
            name: "T3 Code",
            path: "/local/t3code"
        )
        let relay = FeatureProject(
            id: "relay:project",
            environmentID: "relay",
            name: "T3 Code",
            path: "/relay/t3code"
        )
        let group = DailyUXProjectGroup(
            id: "t3code",
            name: "T3 Code",
            projects: [local, relay],
            memberProjectIDs: [local.id, relay.id]
        )
        let failure = thread(id: "relay:thread", projectID: relay.id, state: .failed)
        let rollup = ProjectAttentionRollup(
            threads: [failure],
            lastVisitedAtByThreadID: [:],
            now: now
        )

        #expect(rollup.state(for: local.id) == nil)
        #expect(rollup.state(for: relay.id) == .failure)
        #expect(rollup.state(for: group) == .failure)
    }

    @Test(
        "Completion needs an earlier visit and viewing clears it",
        .bug("https://github.com/saphid/t3code-personal/issues/201")
    )
    func unseenCompletionRequiresVisitMarker() {
        let completion = thread(
            id: "completion",
            projectID: "project",
            state: .completed,
            completionOffset: -10
        )

        #expect(rollup([completion]).state(for: "project") == nil)
        #expect(
            rollup(
                [completion],
                visits: [completion.id: now.addingTimeInterval(-20)]
            ).state(for: "project") == .unseenCompletion
        )
        #expect(
            rollup([completion], visits: [completion.id: now])
                .state(for: "project") == nil
        )
    }

    @Test(
        "Every state has distinct non-color accessibility text and a symbol",
        .bug("https://github.com/saphid/t3code-personal/issues/201")
    )
    func accessibilityMetadata() {
        let states: [ProjectAttentionState] = [.failure, .pendingInput, .unseenCompletion]

        #expect(Set(states.map(\.accessibilityLabel)).count == states.count)
        #expect(states.allSatisfy { $0.accessibilityLabel.isEmpty == false })
        #expect(Set(states.map(\.systemImage)).count == states.count)
    }

    @Test(
        "Large project catalog resolves in one deterministic pass",
        .bug("https://github.com/saphid/t3code-personal/issues/201")
    )
    func largeProjectList() {
        let threads = (0..<10_000).map { index in
            thread(
                id: "thread-\(index)",
                projectID: "project-\(index)",
                state: index == 9_999 ? .failed : .idle
            )
        }

        let result = ProjectAttentionRollup(
            threads: threads,
            lastVisitedAtByThreadID: [:],
            now: now
        )

        #expect(result.state(for: "project-0") == nil)
        #expect(result.state(for: "project-9999") == .failure)
    }

    private func rollup(
        _ threads: [FeatureThread],
        visits: [String: Date] = [:]
    ) -> ProjectAttentionRollup {
        ProjectAttentionRollup(
            threads: threads,
            lastVisitedAtByThreadID: visits,
            now: now
        )
    }

    private func thread(
        id: String,
        projectID: String,
        state: FeatureThreadState,
        completionOffset: TimeInterval? = nil
    ) -> FeatureThread {
        FeatureThread(
            id: id,
            projectID: projectID,
            environmentID: projectID.components(separatedBy: ":").first,
            title: id,
            createdAt: now.addingTimeInterval(-100),
            updatedAt: now.addingTimeInterval(-10),
            state: state,
            lastActivityAt: now.addingTimeInterval(-10),
            attentionAt: state == .failed ? now.addingTimeInterval(-10) : nil,
            latestTurnCompletedAt: completionOffset.map { now.addingTimeInterval($0) }
        )
    }
}

@Suite("Thread visit persistence")
struct FeatureThreadVisitStoreTests {
    @Test(
        "Visits survive hydration and retain the newest bounded set",
        .bug("https://github.com/saphid/t3code-personal/issues/201")
    )
    func persistenceIsBounded() throws {
        let suiteName = "thread-visits-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let store = FeatureThreadVisitStore(defaults: defaults)
        let visits = Dictionary(uniqueKeysWithValues: (0...5_000).map { index in
            ("thread-\(index)", Date(timeIntervalSince1970: Double(index)))
        })

        store.save(visits)
        let restored = store.load()

        #expect(restored.count == 5_000)
        #expect(restored["thread-0"] == nil)
        #expect(restored["thread-5000"] == Date(timeIntervalSince1970: 5_000))
    }

    @Test(
        "Malformed persistence fails open",
        .bug("https://github.com/saphid/t3code-personal/issues/201")
    )
    func corruptDataDoesNotCreateVisits() throws {
        let suiteName = "thread-visits-corrupt-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        defaults.set(Data("not-json".utf8), forKey: "t3.swiftui.threadLastVisitedAt")

        #expect(FeatureThreadVisitStore(defaults: defaults).load().isEmpty)
    }
}
