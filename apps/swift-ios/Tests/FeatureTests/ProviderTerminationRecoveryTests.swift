import Foundation
import Testing
@testable import T3Code

@Suite("Provider termination recovery")
struct ProviderTerminationRecoveryTests {
    @Test
    func recoveryIsDeterministicAndInspectsBeforeContinuing() throws {
        let occurredAt = try #require(
            ISO8601DateFormatter().date(from: "2026-08-29T03:00:00Z")
        )

        let first = FeatureProviderTerminationRecovery.plan(
            eventID: "activity-termination-event",
            createdAt: occurredAt
        )
        let second = FeatureProviderTerminationRecovery.plan(
            eventID: "activity-termination-event",
            createdAt: occurredAt
        )

        #expect(first == second)
        #expect(first.commandID == "provider-termination-retry:activity-termination-event")
        #expect(first.messageID == "provider-termination-retry-message:activity-termination-event")
        #expect(first.createdAt > occurredAt)
        #expect(first.prompt.contains("Inspect the current state first"))
        #expect(first.prompt.contains("do not repeat commands or tool calls"))
    }

    @Test
    func differentTerminationEventsCannotShareARecoveryIdentity() {
        let first = FeatureProviderTerminationRecovery.plan(eventID: "event-1", createdAt: .now)
        let second = FeatureProviderTerminationRecovery.plan(eventID: "event-2", createdAt: .now)

        #expect(first.commandID != second.commandID)
        #expect(first.messageID != second.messageID)
    }

    @Test
    func recoveryEligibilityRequiresAFailedThreadWithoutALaterUserMessage() {
        let termination = FeatureMessage(
            id: "activity-event-1",
            role: .system,
            text: "Provider process ended unexpectedly",
            toolName: "runtime.process.terminated"
        )
        let assistant = FeatureMessage(
            id: "assistant-after",
            role: .assistant,
            text: "Partial output"
        )
        let user = FeatureMessage(id: "user-after", role: .user, text: "Changed direction")
        let failedThread = FeatureThread(
            id: "thread-1",
            projectID: "project-1",
            title: "Task",
            state: .failed
        )
        let workingThread = FeatureThread(
            id: "thread-1",
            projectID: "project-1",
            title: "Task",
            state: .working
        )

        #expect(
            FeatureProviderTerminationRecovery.recoverableMessage(
                in: FeatureThreadDetail(
                    thread: failedThread,
                    messages: [termination, assistant]
                )
            )?.id == termination.id
        )
        #expect(
            FeatureProviderTerminationRecovery.recoverableMessage(
                in: FeatureThreadDetail(thread: workingThread, messages: [termination])
            ) == nil
        )
        #expect(
            FeatureProviderTerminationRecovery.recoverableMessage(
                in: FeatureThreadDetail(
                    thread: failedThread,
                    messages: [termination, user]
                )
            ) == nil
        )
    }
}
