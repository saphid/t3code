import Foundation

enum FeatureCheckpointRevertStatus: String, Codable, Sendable {
    case ready
    case missing
    case error
    case unknown

    init(wireValue: String) {
        self = Self(rawValue: wireValue) ?? .unknown
    }

    var hasRestoreRef: Bool {
        self == .ready || self == .error
    }
}

public struct FeatureCheckpointRevertTarget: Codable, Hashable, Sendable {
    let threadID: String
    let userMessageID: String
    let turnID: String
    let checkpointRef: String
    let checkpointTurnCount: Int
    let restoreTurnCount: Int
}

enum FeatureCheckpointRevertUnavailableReason: String, Codable, Sendable {
    case checkpointUnavailable
    case restorePointUnavailable

    var explanation: String {
        switch self {
        case .checkpointUnavailable:
            "Revert is unavailable because this failed turn has no saved checkpoint."
        case .restorePointUnavailable:
            "Revert is unavailable because the preceding restore point is not loaded."
        }
    }

    var controlLabel: String {
        switch self {
        case .checkpointUnavailable:
            "No checkpoint saved"
        case .restorePointUnavailable:
            "Load earlier turns to revert"
        }
    }
}

enum FeatureCheckpointRevertAction: Codable, Equatable, Sendable {
    case available(FeatureCheckpointRevertTarget)
    case unavailable(FeatureCheckpointRevertUnavailableReason)
}

extension FeatureThreadState {
    var preventsCheckpointRevert: Bool {
        switch self {
        case .queued, .working, .monitoring, .waitingForApproval, .waitingForInput:
            true
        case .idle, .failed, .completed:
            false
        }
    }
}

enum FeatureCheckpointRevertReceipt {
    static func matches(
        turnCount: Int?,
        sequence: Int?,
        targetTurnCount: Int,
        requestSequence: Int?
    ) -> Bool {
        guard turnCount == targetTurnCount,
              let sequence,
              let requestSequence else {
            return false
        }
        return sequence > requestSequence
    }
}

struct FeatureCheckpointRevertMessage: Equatable, Sendable {
    let id: String
    let isUser: Bool
    let turnID: String?
}

struct FeatureCheckpointRevertSummary: Equatable, Sendable {
    let turnID: String
    let checkpointTurnCount: Int
    let checkpointRef: String
    let status: FeatureCheckpointRevertStatus
    let assistantMessageID: String?
}

enum FeatureCheckpointRevertAssociation {
    static func actions(
        threadID: String,
        messages: [FeatureCheckpointRevertMessage],
        checkpoints: [FeatureCheckpointRevertSummary],
        failedTurnIDs: Set<String>,
        latestFailedTurnID: String? = nil
    ) -> [String: FeatureCheckpointRevertAction] {
        let orderedCheckpoints = checkpoints.sorted {
            $0.checkpointTurnCount < $1.checkpointTurnCount
        }
        let userMessages = messages.filter(\.isUser)
        let associatedUserMessages = associations(
            messages: messages,
            userMessages: userMessages,
            checkpoints: orderedCheckpoints
        )
        var actions: [String: FeatureCheckpointRevertAction] = [:]

        let terminalFailureTurnIDs = failedTurnIDs.union(
            orderedCheckpoints.lazy
                .filter { $0.status == .error }
                .map(\.turnID)
        )
        for turnID in terminalFailureTurnIDs {
            guard let userMessage = associatedUserMessages[turnID]
                ?? userMessages.last(where: { $0.turnID == turnID })
                ?? (turnID == latestFailedTurnID ? userMessages.last : nil) else {
                continue
            }
            guard let checkpoint = orderedCheckpoints.last(where: { $0.turnID == turnID }) else {
                actions[userMessage.id] = .unavailable(.checkpointUnavailable)
                continue
            }
            guard checkpoint.status.hasRestoreRef,
                  checkpoint.checkpointTurnCount > 0,
                  !checkpoint.checkpointRef.isEmpty else {
                actions[userMessage.id] = .unavailable(.checkpointUnavailable)
                continue
            }

            let restoreTurnCount = checkpoint.checkpointTurnCount - 1
            if restoreTurnCount > 0,
               !orderedCheckpoints.contains(where: {
                   $0.checkpointTurnCount == restoreTurnCount && $0.status.hasRestoreRef
               }) {
                actions[userMessage.id] = .unavailable(.restorePointUnavailable)
                continue
            }
            actions[userMessage.id] = .available(
                FeatureCheckpointRevertTarget(
                    threadID: threadID,
                    userMessageID: userMessage.id,
                    turnID: checkpoint.turnID,
                    checkpointRef: checkpoint.checkpointRef,
                    checkpointTurnCount: checkpoint.checkpointTurnCount,
                    restoreTurnCount: restoreTurnCount
                )
            )
        }

        return actions
    }

    private static func associations(
        messages: [FeatureCheckpointRevertMessage],
        userMessages: [FeatureCheckpointRevertMessage],
        checkpoints: [FeatureCheckpointRevertSummary]
    ) -> [String: FeatureCheckpointRevertMessage] {
        var result: [String: FeatureCheckpointRevertMessage] = [:]
        let usersByTurnID = Dictionary(
            userMessages.compactMap { message in
                message.turnID.map { ($0, message) }
            },
            uniquingKeysWith: { _, latest in latest }
        )

        for checkpoint in checkpoints {
            if let direct = usersByTurnID[checkpoint.turnID] {
                result[checkpoint.turnID] = direct
                continue
            }
            guard let assistantMessageID = checkpoint.assistantMessageID,
                  !assistantMessageID.hasPrefix("assistant:"),
                  let assistantIndex = messages.firstIndex(where: { $0.id == assistantMessageID }),
                  let precedingUser = messages[..<assistantIndex].last(where: \.isUser) else {
                continue
            }
            result[checkpoint.turnID] = precedingUser
        }

        let maximumTurnCount = checkpoints.map(\.checkpointTurnCount).max() ?? 0
        let suffixOffset = max(0, maximumTurnCount - userMessages.count)
        for (checkpointIndex, checkpoint) in checkpoints.enumerated()
            where result[checkpoint.turnID] == nil {
            let exactIndex = checkpoint.checkpointTurnCount - suffixOffset - 1
            let fallbackIndex = checkpoints.count == userMessages.count
                ? checkpointIndex
                : exactIndex
            guard userMessages.indices.contains(fallbackIndex) else { continue }
            result[checkpoint.turnID] = userMessages[fallbackIndex]
        }
        return result
    }
}
