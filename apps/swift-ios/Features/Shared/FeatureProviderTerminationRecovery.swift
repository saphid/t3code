import Foundation

struct FeatureProviderTerminationRecoveryPlan: Equatable, Sendable {
    let prompt: String
    let commandID: String
    let messageID: String
    let createdAt: Date
}

enum FeatureProviderTerminationRecovery {
    static let prompt = """
        Continue from the last completed step. The provider process ended unexpectedly. \
        Inspect the current state first, preserve completed work, and do not repeat commands or \
        tool calls whose effects may already have occurred.
        """

    static func plan(
        eventID: String,
        createdAt: Date
    ) -> FeatureProviderTerminationRecoveryPlan {
        FeatureProviderTerminationRecoveryPlan(
            prompt: prompt,
            commandID: "provider-termination-retry:\(eventID)",
            messageID: "provider-termination-retry-message:\(eventID)",
            createdAt: createdAt.addingTimeInterval(0.001)
        )
    }

    static func recoverableMessage(in detail: FeatureThreadDetail) -> FeatureMessage? {
        guard detail.thread.state == .failed,
              let terminationIndex = detail.messages.lastIndex(where: {
                  $0.toolName == "runtime.process.terminated"
              }) else { return nil }
        let laterMessages = detail.messages.index(after: terminationIndex)..<detail.messages.endIndex
        guard !detail.messages[laterMessages].contains(where: { $0.role == .user }) else {
            return nil
        }
        return detail.messages[terminationIndex]
    }
}
