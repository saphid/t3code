import Foundation
import Testing
@testable import T3Code

@Suite("Subagent status")
struct SubagentStatusTests {
    @Test
    func countsOnlyExplicitLiveSubagents() {
        var tracker = FeatureActiveSubagentTracker()

        tracker.apply(activity(
            id: "agent-start",
            kind: "task.started",
            payload: ["taskId": .string("agent-1"), "agentKind": .string("agent")]
        ))
        tracker.apply(activity(
            id: "background-start",
            kind: "task.started",
            payload: ["taskId": .string("monitor-1"), "agentKind": .string("background")]
        ))
        tracker.apply(activity(
            id: "legacy-start",
            kind: "task.started",
            payload: ["taskId": .string("legacy-1")]
        ))

        #expect(tracker.activeCount == 1)
    }

    @Test
    func terminalRowsInheritKnownAgentMembership() {
        var tracker = FeatureActiveSubagentTracker()
        tracker.apply(activity(
            id: "start",
            kind: "task.started",
            payload: ["taskId": .string("agent-1"), "agentKind": .string("agent")]
        ))
        tracker.apply(activity(
            id: "complete",
            kind: "task.completed",
            payload: ["taskId": .string("agent-1"), "status": .string("completed")]
        ))

        #expect(tracker.activeCount == 0)
    }

    @Test
    func workflowCountsMembersWhileTheyRunAndCoordinatorBetweenPhases() {
        var tracker = FeatureActiveSubagentTracker()
        tracker.apply(activity(
            id: "workflow-start",
            kind: "task.started",
            payload: [
                "taskId": .string("workflow-1"),
                "taskType": .string("local_workflow"),
                "agentKind": .string("agent"),
            ]
        ))
        tracker.apply(activity(
            id: "member-start",
            kind: "task.started",
            payload: [
                "taskId": .string("member-1"),
                "parentAgentId": .string("workflow-1"),
                "agentKind": .string("agent"),
            ]
        ))

        #expect(tracker.activeCount == 1)

        tracker.apply(activity(
            id: "member-complete",
            kind: "task.completed",
            payload: [
                "taskId": .string("member-1"),
                "parentAgentId": .string("workflow-1"),
                "status": .string("completed"),
            ]
        ))

        #expect(tracker.activeCount == 1)

        tracker.apply(activity(
            id: "workflow-complete",
            kind: "task.completed",
            payload: [
                "taskId": .string("workflow-1"),
                "taskType": .string("local_workflow"),
                "status": .string("completed"),
            ]
        ))

        #expect(tracker.activeCount == 0)
    }

    @Test
    func reconnectReplayAndLateTerminalEventsConvergeOnBetweenPhaseLiveness() {
        let activities = [
            activity(
                id: "workflow-start",
                kind: "task.started",
                payload: [
                    "taskId": .string("workflow-1"),
                    "taskType": .string("local_workflow"),
                    "agentKind": .string("agent"),
                ]
            ),
            activity(
                id: "member-start",
                kind: "task.started",
                payload: [
                    "taskId": .string("member-1"),
                    "parentAgentId": .string("workflow-1"),
                    "agentKind": .string("agent"),
                ]
            ),
            activity(
                id: "member-complete",
                kind: "task.completed",
                payload: [
                    "taskId": .string("member-1"),
                    "parentAgentId": .string("workflow-1"),
                    "status": .string("completed"),
                ]
            ),
        ]
        var tracker = FeatureActiveSubagentTracker()

        tracker.reset(with: activities)
        tracker.apply(activity(
            id: "late-member-complete",
            kind: "task.completed",
            payload: [
                "taskId": .string("member-1"),
                "parentAgentId": .string("workflow-1"),
                "status": .string("completed"),
            ]
        ))

        #expect(tracker.activeCount == 1)
    }

    @Test
    func nestedWorkflowCountsOnlyItsDeepestLiveUnit() {
        var tracker = FeatureActiveSubagentTracker()
        tracker.apply(activity(
            id: "root-start",
            kind: "task.started",
            payload: [
                "taskId": .string("workflow-root"),
                "taskType": .string("local_workflow"),
                "agentKind": .string("agent"),
            ]
        ))
        tracker.apply(activity(
            id: "nested-start",
            kind: "task.started",
            payload: [
                "taskId": .string("workflow-nested"),
                "taskType": .string("local_workflow"),
                "parentAgentId": .string("workflow-root"),
                "agentKind": .string("agent"),
            ]
        ))
        tracker.apply(activity(
            id: "member-start",
            kind: "task.started",
            payload: [
                "taskId": .string("member-nested"),
                "parentAgentId": .string("workflow-nested"),
                "agentKind": .string("agent"),
            ]
        ))

        #expect(tracker.activeCount == 1)
    }

    @Test
    func staleWorkflowMemberAttemptDoesNotReopenAfterFailure() {
        var tracker = FeatureActiveSubagentTracker()
        tracker.apply(activity(
            id: "member-running",
            kind: "task.progress",
            payload: [
                "taskId": .string("member-1"),
                "parentAgentId": .string("workflow-1"),
                "agentKind": .string("agent"),
                "status": .string("running"),
                "attempt": .number(1),
            ]
        ))
        tracker.apply(activity(
            id: "member-failed",
            kind: "task.progress",
            payload: [
                "taskId": .string("member-1"),
                "parentAgentId": .string("workflow-1"),
                "status": .string("failed"),
                "attempt": .number(1),
            ]
        ))
        tracker.apply(activity(
            id: "stale-member-running",
            kind: "task.progress",
            payload: [
                "taskId": .string("member-1"),
                "parentAgentId": .string("workflow-1"),
                "status": .string("running"),
                "attempt": .number(1),
            ]
        ))

        #expect(tracker.activeCount == 0)

        tracker.apply(activity(
            id: "member-retry",
            kind: "task.progress",
            payload: [
                "taskId": .string("member-1"),
                "parentAgentId": .string("workflow-1"),
                "status": .string("running"),
                "attempt": .number(2),
            ]
        ))

        #expect(tracker.activeCount == 1)
    }

    @Test
    func idleAgentsCanStartAgainButTerminalAgentsDoNotReopenFromLateStarts() {
        var tracker = FeatureActiveSubagentTracker()
        tracker.apply(activity(
            id: "start",
            kind: "task.started",
            payload: ["taskId": .string("agent-1"), "agentKind": .string("agent")]
        ))
        tracker.apply(activity(
            id: "idle",
            kind: "task.updated",
            payload: ["taskId": .string("agent-1"), "status": .string("idle")]
        ))
        #expect(tracker.activeCount == 0)

        tracker.apply(activity(
            id: "restart",
            kind: "task.started",
            payload: ["taskId": .string("agent-1")]
        ))
        #expect(tracker.activeCount == 1)

        tracker.apply(activity(
            id: "failed",
            kind: "task.updated",
            payload: ["taskId": .string("agent-1"), "status": .string("failed")]
        ))
        tracker.apply(activity(
            id: "late-start",
            kind: "task.started",
            payload: ["taskId": .string("agent-1")]
        ))
        #expect(tracker.activeCount == 0)
    }

    @Test
    func monitoringRemainsDistinctFromActiveAgentWork() {
        let working = NativeFeatureClient.resolveThreadState(
            latestTurn: nil,
            session: nil,
            hasApprovals: false,
            hasUserInput: false,
            backgroundLiveness: .working
        )
        let monitoring = NativeFeatureClient.resolveThreadState(
            latestTurn: nil,
            session: nil,
            hasApprovals: false,
            hasUserInput: false,
            backgroundLiveness: .monitoring
        )

        #expect(working == .working)
        #expect(monitoring == .monitoring)
    }

    @Test(arguments: [
        OrchestrationBackgroundLiveness.working,
        OrchestrationBackgroundLiveness.monitoring,
    ])
    func threadShellDecodesBackgroundLiveness(
        _ backgroundLiveness: OrchestrationBackgroundLiveness
    ) throws {
        let shell = OrchestrationThreadShell(
            id: "thread-1",
            projectId: "project-1",
            title: "Subagents",
            modelSelection: ModelSelection(instanceId: "codex", model: "gpt-5.6-sol"),
            runtimeMode: .fullAccess,
            interactionMode: .default,
            branch: nil,
            worktreePath: nil,
            latestTurn: nil,
            createdAt: "2026-08-08T00:00:00Z",
            updatedAt: "2026-08-08T00:00:00Z",
            archivedAt: nil,
            settledOverride: nil,
            settledAt: nil,
            snoozedUntil: nil,
            snoozedAt: nil,
            pinnedAt: nil,
            session: nil,
            latestUserMessageAt: nil,
            hasPendingApprovals: false,
            hasPendingUserInput: false,
            hasActionableProposedPlan: false,
            backgroundLiveness: backgroundLiveness
        )

        let decoded = try JSONDecoder.t3.decode(
            OrchestrationThreadShell.self,
            from: JSONEncoder.t3.encode(shell)
        )

        #expect(decoded.backgroundLiveness == backgroundLiveness)
    }

    private func activity(
        id: String,
        kind: String,
        payload: [String: JSONValue]
    ) -> OrchestrationActivity {
        OrchestrationActivity(
            id: id,
            tone: "info",
            kind: kind,
            summary: kind,
            payload: .object(payload),
            turnId: "turn-1",
            sequence: nil,
            createdAt: "2026-08-08T00:00:00Z"
        )
    }
}
