import Foundation
import Testing
@testable import T3Code

@Suite("Claude Stop-hook transcript")
struct ClaudeStopHookTranscriptTests {
    @Test
    func mapsClaudeStopHookToDistinctAccessibleTranscriptBoundary() throws {
        let activity = stopHookActivity(id: "hook-1")
        let boundary = try #require(ClaudeStopHookTranscriptBoundary.resolve(activity))
        let message = boundary.message(createdAt: Date(timeIntervalSince1970: 101))

        #expect(message.id == "hook-boundary-hook-1")
        #expect(message.role == .system)
        #expect(message.text == "Claude Stop hook")
        #expect(message.toolName == ClaudeStopHookTranscriptBoundary.marker)
        #expect(
            ClaudeStopHookTranscriptBoundary.accessibilityLabel
                == "Claude Stop hook. Claude may continue this turn."
        )
    }

    @Test
    func keepsPreHookAndContinuationCopySourcesIndependent() throws {
        let preHook = FeatureMessage(
            id: "assistant-before",
            role: .assistant,
            text: "Original result with its own warning.",
            createdAt: Date(timeIntervalSince1970: 100)
        )
        let boundary = try #require(
            ClaudeStopHookTranscriptBoundary.resolve(stopHookActivity(id: "hook-1"))
        ).message(createdAt: Date(timeIntervalSince1970: 101))
        let continuation = FeatureMessage(
            id: "assistant-after",
            role: .assistant,
            text: "Continuation result only.",
            createdAt: Date(timeIntervalSince1970: 102)
        )

        let transcript = [continuation, boundary, preHook].sorted { $0.createdAt < $1.createdAt }
        #expect(transcript.map(\.id) == ["assistant-before", "hook-boundary-hook-1", "assistant-after"])
        #expect(preHook.copySource == "Original result with its own warning.")
        #expect(continuation.copySource == "Continuation result only.")
        #expect(!preHook.copySource.contains(continuation.copySource))
        #expect(!continuation.copySource.contains(preHook.copySource))
    }

    @Test
    func usesStableBoundaryIdentityForReplayAndDistinctIdentityForMultipleHooks() throws {
        let first = stopHookActivity(id: "hook-1")
        let replay = stopHookActivity(id: "hook-1")
        let second = stopHookActivity(id: "hook-2")
        let firstBoundary = try #require(ClaudeStopHookTranscriptBoundary.resolve(first))
        let replayBoundary = try #require(ClaudeStopHookTranscriptBoundary.resolve(replay))
        let secondBoundary = try #require(ClaudeStopHookTranscriptBoundary.resolve(second))

        #expect(firstBoundary.id == replayBoundary.id)
        #expect(firstBoundary.id != secondBoundary.id)

        var mutations = NativeDetailRenderMutations()
        mutations.formUnion(.activity(first))
        mutations.formUnion(.activity(replay))
        mutations.formUnion(.activity(second))
        #expect(mutations.activities.map(\.id) == ["hook-1", "hook-2"])
    }

    @Test
    func ignoresOrdinaryHooksAndOtherProviders() {
        #expect(
            ClaudeStopHookTranscriptBoundary.resolve(
                stopHookActivity(id: "session-start", hookEvent: "SessionStart")
            ) == nil
        )
        #expect(
            ClaudeStopHookTranscriptBoundary.resolve(
                stopHookActivity(id: "codex-stop", provider: "codex")
            ) == nil
        )
    }

    private func stopHookActivity(
        id: String,
        provider: String = "claudeAgent",
        hookEvent: String = "Stop"
    ) -> OrchestrationActivity {
        OrchestrationActivity(
            id: id,
            tone: "info",
            kind: "hook.started",
            summary: "\(hookEvent) hook started",
            payload: .object([
                "provider": .string(provider),
                "hookId": .string(id),
                "hookName": .string("Stop:continuation"),
                "hookEvent": .string(hookEvent),
            ]),
            turnId: "turn-1",
            sequence: 12,
            createdAt: "2026-08-29T01:00:01.000Z"
        )
    }
}
