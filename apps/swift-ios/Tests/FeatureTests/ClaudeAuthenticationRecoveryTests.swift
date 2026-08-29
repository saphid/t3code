import Foundation
import Testing

@testable import T3Code

@Suite("Claude authentication recovery")
struct ClaudeAuthenticationRecoveryTests {
  @Test
  func projectsTypedFailureWithPreservedUserMessage() throws {
    let thread = try decodeThread(latestTurn: nil)

    let failure = NativeFeatureClient.providerAuthenticationFailure(in: thread)

    #expect(failure?.providerID == "claude_work")
    #expect(failure?.failedMessageText == "Continue the existing task")
    #expect(failure?.message.contains("claude auth login") == true)
  }

  @Test
  func successfulLaterTurnClearsStaleFailure() throws {
    let thread = try decodeThread(latestTurn: [
      "turnId": "turn-retry",
      "state": "completed",
      "requestedAt": "2026-08-30T01:00:00.000Z",
      "startedAt": "2026-08-30T01:00:01.000Z",
      "completedAt": "2026-08-30T01:00:02.000Z",
      "assistantMessageId": "assistant-retry",
    ])

    #expect(NativeFeatureClient.providerAuthenticationFailure(in: thread) == nil)
  }

  @Test
  func providerAuthFieldsRemainBackwardCompatible() throws {
    let provider = FeatureProvider(id: "claudeAgent", name: "Claude")
    let roundTrip = try JSONDecoder().decode(
      FeatureProvider.self,
      from: JSONEncoder().encode(provider)
    )

    #expect(roundTrip.authStatus == nil)
    #expect(roundTrip.statusMessage == nil)
  }

  private func decodeThread(latestTurn: [String: Any]?) throws -> OrchestrationThread {
    var object: [String: Any] = [
      "id": "thread-1",
      "projectId": "project-1",
      "title": "Authentication recovery",
      "modelSelection": [
        "instanceId": "claude_work",
        "model": "claude-opus-5",
      ],
      "runtimeMode": "full-access",
      "interactionMode": "default",
      "createdAt": "2026-08-30T00:00:00.000Z",
      "updatedAt": "2026-08-30T00:00:04.000Z",
      "messages": [
        [
          "id": "message-user",
          "role": "user",
          "text": "Continue the existing task",
          "turnId": "turn-auth",
          "streaming": false,
          "createdAt": "2026-08-30T00:00:01.000Z",
          "updatedAt": "2026-08-30T00:00:01.000Z",
        ]
      ],
      "activities": [
        [
          "id": "activity-auth",
          "tone": "error",
          "kind": "provider.authentication.required",
          "summary": "Claude is signed out",
          "payload": [
            "providerInstanceId": "claude_work",
            "errorClass": "authentication_error",
            "detail":
              "Claude is signed out. Run `claude auth login` on this environment, then refresh provider status and retry.",
          ],
          "turnId": "turn-auth",
          "createdAt": "2026-08-30T00:00:03.000Z",
        ]
      ],
      "checkpoints": [],
    ]
    if let latestTurn {
      object["latestTurn"] = latestTurn
    }
    let data = try JSONSerialization.data(withJSONObject: object)
    return try JSONDecoder.t3.decode(OrchestrationThread.self, from: data)
  }
}
