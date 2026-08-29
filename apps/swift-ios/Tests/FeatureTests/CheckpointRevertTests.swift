import Testing
@testable import T3Code

struct CheckpointRevertTests {
    @Test(
        "Checkpoint command uses the exact typed restore count",
        .bug("https://github.com/saphid/t3code-personal/issues/200")
    )
    func commandShape() {
        let command = OrchestrationCommands.revertCheckpoint(
            threadID: "thread-1",
            turnCount: 2,
            commandID: "command-revert",
            createdAt: "2026-08-29T04:00:00Z"
        )

        #expect(command["type"] == .string("thread.checkpoint.revert"))
        #expect(command["commandId"] == .string("command-revert"))
        #expect(command["threadId"] == .string("thread-1"))
        #expect(command["turnCount"] == .number(2))
        #expect(command["createdAt"] == .string("2026-08-29T04:00:00Z"))
    }

    @Test(
        "Network error checkpoint stays bound to its user turn without an assistant row",
        .bug("https://github.com/saphid/t3code-personal/issues/200")
    )
    func missingAssistantUsesTurnIdentity() throws {
        let actions = FeatureCheckpointRevertAssociation.actions(
            threadID: "thread-1",
            messages: [message("user-1", user: true)],
            checkpoints: [checkpoint("turn-1", count: 1, status: .error)],
            failedTurnIDs: ["turn-1"]
        )

        let target = try availableTarget(actions["user-1"])
        #expect(target.turnID == "turn-1")
        #expect(target.checkpointTurnCount == 1)
        #expect(target.restoreTurnCount == 0)
    }

    @Test(
        "Synthetic assistant IDs fall back to the matching user turn",
        .bug("https://github.com/saphid/t3code-personal/issues/200")
    )
    func syntheticAssistantUsesCheckpointOrder() throws {
        let actions = FeatureCheckpointRevertAssociation.actions(
            threadID: "thread-1",
            messages: [
                message("user-1", user: true),
                message("assistant-1", user: false),
                message("user-2", user: true),
            ],
            checkpoints: [
                checkpoint(
                    "turn-1",
                    count: 1,
                    status: .ready,
                    assistantMessageID: "assistant-1"
                ),
                checkpoint(
                    "turn-2",
                    count: 2,
                    status: .error,
                    assistantMessageID: "assistant:turn-2"
                ),
            ],
            failedTurnIDs: ["turn-2"]
        )

        let target = try availableTarget(actions["user-2"])
        #expect(target.turnID == "turn-2")
        #expect(target.restoreTurnCount == 1)
        #expect(actions["user-1"] == nil)
    }

    @Test("Successful checkpoints retain their existing action rules")
    func successfulTurnHasNoRevertAction() {
        let actions = FeatureCheckpointRevertAssociation.actions(
            threadID: "thread-1",
            messages: [message("user-1", user: true, turnID: "turn-1")],
            checkpoints: [checkpoint("turn-1", count: 1, status: .ready)],
            failedTurnIDs: []
        )

        #expect(actions.isEmpty)
    }

    @Test("Every active turn state blocks checkpoint revert")
    func activeTurnStateMatrix() {
        let activeStates: [FeatureThreadState] = [
            .queued,
            .working,
            .monitoring,
            .waitingForApproval,
            .waitingForInput,
        ]
        let terminalStates: [FeatureThreadState] = [.idle, .failed, .completed]

        for state in activeStates {
            #expect(state.preventsCheckpointRevert)
        }
        for state in terminalStates {
            #expect(!state.preventsCheckpointRevert)
        }
    }

    @Test("Hydrated terminal failure can use a ready checkpoint")
    func hydratedFailureUsesLatestTurnState() throws {
        let actions = FeatureCheckpointRevertAssociation.actions(
            threadID: "thread-1",
            messages: [message("user-1", user: true, turnID: "turn-1")],
            checkpoints: [checkpoint("turn-1", count: 1, status: .ready)],
            failedTurnIDs: ["turn-1"]
        )

        let target = try availableTarget(actions["user-1"])
        #expect(target.checkpointRef == "refs/t3/turn-1")
    }

    @Test("Missing checkpoints explain why revert is unavailable")
    func missingCheckpointIsUnavailable() {
        let actions = FeatureCheckpointRevertAssociation.actions(
            threadID: "thread-1",
            messages: [message("user-1", user: true, turnID: "turn-1")],
            checkpoints: [checkpoint("turn-1", count: 1, status: .missing)],
            failedTurnIDs: ["turn-1"]
        )

        #expect(actions["user-1"] == .unavailable(.checkpointUnavailable))
        #expect(FeatureCheckpointRevertUnavailableReason.checkpointUnavailable.controlLabel
            == "No checkpoint saved")
    }

    @Test("A terminal failure without a checkpoint explains that revert is unavailable")
    func absentCheckpointIsUnavailable() {
        let actions = FeatureCheckpointRevertAssociation.actions(
            threadID: "thread-1",
            messages: [message("user-1", user: true)],
            checkpoints: [],
            failedTurnIDs: ["turn-1"],
            latestFailedTurnID: "turn-1"
        )

        #expect(actions["user-1"] == .unavailable(.checkpointUnavailable))
    }

    @Test("An unloaded preceding checkpoint cannot produce a stale restore target")
    func missingRestorePointIsUnavailable() {
        let actions = FeatureCheckpointRevertAssociation.actions(
            threadID: "thread-1",
            messages: [message("user-3", user: true, turnID: "turn-3")],
            checkpoints: [checkpoint("turn-3", count: 3, status: .error)],
            failedTurnIDs: ["turn-3"]
        )

        #expect(actions["user-3"] == .unavailable(.restorePointUnavailable))
        #expect(FeatureCheckpointRevertUnavailableReason.restorePointUnavailable.controlLabel
            == "Load earlier turns to revert")
    }

    @Test("A delayed completion cannot finish a newer same-count request")
    func delayedReceiptDoesNotMatch() {
        #expect(
            !FeatureCheckpointRevertReceipt.matches(
                turnCount: 1,
                sequence: 40,
                targetTurnCount: 1,
                requestSequence: 41
            )
        )
        #expect(
            FeatureCheckpointRevertReceipt.matches(
                turnCount: 1,
                sequence: 42,
                targetTurnCount: 1,
                requestSequence: 41
            )
        )
        #expect(
            !FeatureCheckpointRevertReceipt.matches(
                turnCount: 2,
                sequence: 42,
                targetTurnCount: 1,
                requestSequence: 41
            )
        )
        #expect(
            !FeatureCheckpointRevertReceipt.matches(
                turnCount: 1,
                sequence: 42,
                targetTurnCount: 1,
                requestSequence: nil
            )
        )
    }

    private func message(
        _ id: String,
        user: Bool,
        turnID: String? = nil
    ) -> FeatureCheckpointRevertMessage {
        FeatureCheckpointRevertMessage(id: id, isUser: user, turnID: turnID)
    }

    private func checkpoint(
        _ turnID: String,
        count: Int,
        status: FeatureCheckpointRevertStatus,
        assistantMessageID: String? = nil
    ) -> FeatureCheckpointRevertSummary {
        FeatureCheckpointRevertSummary(
            turnID: turnID,
            checkpointTurnCount: count,
            checkpointRef: "refs/t3/\(turnID)",
            status: status,
            assistantMessageID: assistantMessageID
        )
    }

    private func availableTarget(
        _ action: FeatureCheckpointRevertAction?
    ) throws -> FeatureCheckpointRevertTarget {
        guard case let .available(target)? = action else {
            Issue.record("Expected an available checkpoint revert target.")
            throw CheckpointRevertTestError.targetUnavailable
        }
        return target
    }
}

private enum CheckpointRevertTestError: Error {
    case targetUnavailable
}
