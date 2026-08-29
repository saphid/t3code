import Testing
@testable import T3Code

@Suite("Workspace recovery")
struct WorkspaceRecoveryTests {
    @Test
    func requiredActivityDecodesUnicodeCandidates() {
        let recovery = FeatureWorkspaceRecovery.latest(in: [
            activity(
                id: "required-1",
                kind: "thread.workspace.recovery.required",
                payload: [
                    "recoveryId": .string("recovery-1"),
                    "messageId": .string("message-1"),
                    "branch": .string("feature/日本語"),
                    "missingWorktreePath": .string("/work/削除済み"),
                    "reason": .string("ambiguous-match"),
                    "candidates": .array([
                        .object([
                            "path": .string("/work/café/候補"),
                            "isProjectRoot": .bool(false),
                            "dirty": .bool(true),
                        ]),
                        .object([
                            "path": .string(#"C:\work\feature"#),
                            "isProjectRoot": .bool(false),
                            "dirty": .bool(false),
                        ]),
                    ]),
                    "canRecreate": .bool(false),
                    "detail": .string("Choose the checkout to use."),
                ]
            ),
        ])

        #expect(recovery?.id == "recovery-1")
        #expect(recovery?.branch == "feature/日本語")
        #expect(recovery?.candidates.first?.path == "/work/café/候補")
        #expect(recovery?.candidates.first?.displayName == "候補")
        #expect(recovery?.candidates.first?.dirty == true)
        #expect(recovery?.candidates.last?.displayName == "feature")
    }

    @Test
    func completedActivityClearsOnlyItsRecovery() {
        let required = activity(
            id: "required-1",
            kind: "thread.workspace.recovery.required",
            payload: requiredPayload(messageID: "message-1")
        )

        #expect(FeatureWorkspaceRecovery.latest(in: [required]) != nil)
        #expect(
            FeatureWorkspaceRecovery.latest(in: [
                required,
                activity(
                    id: "completed-other",
                    kind: "thread.workspace.recovery.completed",
                    payload: ["messageId": .string("message-2")]
                ),
            ]) != nil
        )
        #expect(
            FeatureWorkspaceRecovery.latest(in: [
                required,
                activity(
                    id: "completed-1",
                    kind: "thread.workspace.recovery.completed",
                    payload: ["messageId": .string("message-1")]
                ),
            ]) == nil
        )
    }

    @Test
    func malformedRequiredActivityIsIgnored() {
        #expect(
            FeatureWorkspaceRecovery.latest(in: [
                activity(
                    id: "malformed",
                    kind: "thread.workspace.recovery.required",
                    payload: ["messageId": .string("message-1")]
                ),
            ]) == nil
        )
    }

    private func requiredPayload(messageID: String) -> [String: JSONValue] {
        [
            "recoveryId": .string("recovery-1"),
            "messageId": .string(messageID),
            "branch": .string("feature/recover"),
            "missingWorktreePath": .string("/work/removed"),
            "reason": .string("no-match"),
            "candidates": .array([]),
            "canRecreate": .bool(true),
            "detail": .string("The recorded worktree was removed."),
        ]
    }

    private func activity(
        id: String,
        kind: String,
        payload: [String: JSONValue]
    ) -> OrchestrationActivity {
        OrchestrationActivity(
            id: id,
            tone: "warning",
            kind: kind,
            summary: kind,
            payload: .object(payload),
            turnId: nil,
            sequence: nil,
            createdAt: "2026-08-29T00:00:00Z"
        )
    }
}
