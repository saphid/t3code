import Testing
@testable import T3Code

@Suite("Context usage")
struct ContextUsageTests {
    @Test(
        "Uses the last valid context snapshot",
        .bug("https://github.com/saphid/t3code-personal/issues/194")
    )
    func usesLastValidSnapshot() {
        let activities = [
            activity(id: "first", usedTokens: 10_000, maxTokens: 200_000),
            OrchestrationActivity(
                id: "malformed",
                tone: "info",
                kind: "context-window.updated",
                summary: "Context window updated",
                payload: .object(["usedTokens": .number(30_000)]),
                turnId: nil,
                sequence: 2,
                createdAt: "2026-08-29T00:00:01.000Z"
            ),
            activity(id: "latest", usedTokens: 50_000, maxTokens: 200_000),
        ]

        #expect(FeatureContextUsage.latest(in: activities) == 0.25)
    }

    @Test("Keeps the last valid snapshot when a delayed update is malformed")
    func ignoresInvalidDelayedSnapshot() {
        let valid = activity(id: "valid", usedTokens: 40_000, maxTokens: 200_000)
        let invalid = OrchestrationActivity(
            id: "invalid",
            tone: "info",
            kind: "context-window.updated",
            summary: "Context window updated",
            payload: .object([
                "usedTokens": .number(20_000),
                "maxTokens": .number(0),
            ]),
            turnId: nil,
            sequence: 2,
            createdAt: "2026-08-29T00:00:01.000Z"
        )

        #expect(FeatureContextUsage.latest(in: [valid, invalid]) == 0.2)
    }

    private func activity(
        id: String,
        usedTokens: Double,
        maxTokens: Double
    ) -> OrchestrationActivity {
        OrchestrationActivity(
            id: id,
            tone: "info",
            kind: "context-window.updated",
            summary: "Context window updated",
            payload: .object([
                "usedTokens": .number(usedTokens),
                "maxTokens": .number(maxTokens),
            ]),
            turnId: nil,
            sequence: 1,
            createdAt: "2026-08-29T00:00:00.000Z"
        )
    }
}
