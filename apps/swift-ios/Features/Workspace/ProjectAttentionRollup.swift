import Foundation

struct ProjectAttentionRollup: Equatable {
    private let stateByProjectID: [String: ProjectAttentionState]

    init(
        threads: [FeatureThread],
        lastVisitedAtByThreadID: [String: Date],
        now: Date = .now
    ) {
        var result: [String: ProjectAttentionState] = [:]
        result.reserveCapacity(min(threads.count, 512))

        for thread in threads {
            guard let state = Self.state(
                for: thread,
                lastVisitedAt: lastVisitedAtByThreadID[thread.id],
                now: now
            ) else {
                continue
            }
            if let current = result[thread.projectID], current >= state {
                continue
            }
            result[thread.projectID] = state
        }

        stateByProjectID = result
    }

    func state(for projectID: String) -> ProjectAttentionState? {
        stateByProjectID[projectID]
    }

    func state(for group: DailyUXProjectGroup) -> ProjectAttentionState? {
        var result: ProjectAttentionState?
        for projectID in group.memberProjectIDs {
            guard let state = state(for: projectID) else { continue }
            if let result, result >= state { continue }
            result = state
        }
        return result
    }

    private static func state(
        for thread: FeatureThread,
        lastVisitedAt: Date?,
        now: Date
    ) -> ProjectAttentionState? {
        guard thread.isArchived == false,
              thread.isEffectivelySettled(at: now) == false,
              thread.isEffectivelySnoozed(at: now) == false else {
            return nil
        }

        if thread.state == .failed || thread.attentionAt != nil {
            return .failure
        }

        switch thread.state {
        case .waitingForApproval, .waitingForInput:
            return .pendingInput
        case .completed:
            guard let completedAt = thread.latestTurnCompletedAt,
                  let lastVisitedAt,
                  completedAt > lastVisitedAt else {
                return nil
            }
            return .unseenCompletion
        case .idle, .queued, .working, .monitoring, .failed:
            return nil
        }
    }
}
