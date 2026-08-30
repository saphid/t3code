import Foundation

/// Keeps only the small part of subagent state that mobile displays. The
/// server-provided `agentKind` is authoritative; legacy unmarked tasks remain
/// ordinary work-log entries.
struct FeatureActiveSubagentTracker {
    private enum Status: String {
        case pending
        case running
        case waiting
        case idle
        case completed
        case failed
        case cancelled
        case interrupted

        var isActive: Bool {
            self == .pending || self == .running || self == .waiting
        }

        var isTerminal: Bool {
            self == .completed || self == .failed || self == .cancelled || self == .interrupted
        }
    }

    private var statuses: [String: Status] = [:]
    private var attempts: [String: Int] = [:]
    private var workflowIDs: Set<String> = []
    private var parentWorkflowByTaskID: [String: String] = [:]

    var activeCount: Int {
        let workflowsWithLiveMembers = Set(parentWorkflowByTaskID.compactMap { memberID, parentID in
            statuses[memberID]?.isActive == true ? parentID : nil
        })
        statuses.count { taskID, status in
            guard status.isActive else { return false }
            guard workflowIDs.contains(taskID) else { return true }
            return !workflowsWithLiveMembers.contains(taskID)
        }
    }

    mutating func reset(with activities: [OrchestrationActivity]) {
        statuses.removeAll(keepingCapacity: true)
        attempts.removeAll(keepingCapacity: true)
        workflowIDs.removeAll(keepingCapacity: true)
        parentWorkflowByTaskID.removeAll(keepingCapacity: true)
        for activity in activities {
            apply(activity)
        }
    }

    mutating func apply(_ activity: OrchestrationActivity) {
        guard activity.kind == "task.started"
                || activity.kind == "task.progress"
                || activity.kind == "task.updated"
                || activity.kind == "task.completed",
              let taskID = activity.payload["taskId"]?.stringValue?
                .trimmingCharacters(in: .whitespacesAndNewlines),
              !taskID.isEmpty else {
            return
        }

        let isKnownAgent = statuses[taskID] != nil
        let isExplicitAgent = activity.payload["agentKind"]?.stringValue == "agent"
        guard isKnownAgent || isExplicitAgent else { return }

        let previousAttempt = attempts[taskID]
        let incomingAttempt = attempt(from: activity.payload["attempt"])
        let startsNewAttempt = incomingAttempt.map { $0 > (previousAttempt ?? -1) } == true
        if let incomingAttempt {
            if let previousAttempt {
                if incomingAttempt > previousAttempt {
                    attempts[taskID] = incomingAttempt
                }
            } else {
                attempts[taskID] = incomingAttempt
            }
        }

        if activity.payload["taskType"]?.stringValue == "local_workflow" {
            workflowIDs.insert(taskID)
        }
        if let parentWorkflowID = activity.payload["parentAgentId"]?.stringValue?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !parentWorkflowID.isEmpty {
            parentWorkflowByTaskID[taskID] = parentWorkflowID
        }

        switch activity.kind {
        case "task.started":
            if let current = statuses[taskID], current.isTerminal, !startsNewAttempt {
                return
            }
            statuses[taskID] = .running

        case "task.progress":
            if let status = status(from: activity.payload["status"]) {
                if !isStaleWorkflowMemberReactivation(
                    taskID: taskID,
                    status: status,
                    incomingAttempt: incomingAttempt,
                    previousAttempt: previousAttempt
                ) {
                    statuses[taskID] = status
                }
            } else if statuses[taskID] != .idle,
                      statuses[taskID]?.isTerminal != true {
                statuses[taskID] = .running
            }

        case "task.updated":
            let nextStatus = status(from: activity.payload["status"])
                ?? statuses[taskID]
                ?? .pending
            if !isStaleWorkflowMemberReactivation(
                taskID: taskID,
                status: nextStatus,
                incomingAttempt: incomingAttempt,
                previousAttempt: previousAttempt
            ) {
                statuses[taskID] = nextStatus
            }

        case "task.completed":
            guard statuses[taskID]?.isTerminal != true else { return }
            statuses[taskID] = switch activity.payload["status"]?.stringValue {
            case "failed": .failed
            case "stopped": .interrupted
            default: .completed
            }

        default:
            break
        }
    }

    private func status(from value: JSONValue?) -> Status? {
        guard let rawValue = value?.stringValue else { return nil }
        return Status(rawValue: rawValue)
    }

    private func attempt(from value: JSONValue?) -> Int? {
        switch value {
        case let .integer(value): Int(exactly: value)
        case let .unsignedInteger(value): Int(exactly: value)
        case let .number(value): Int(exactly: value)
        case nil, .null, .bool, .string, .array, .object: nil
        }
    }

    private func isStaleWorkflowMemberReactivation(
        taskID: String,
        status: Status,
        incomingAttempt: Int?,
        previousAttempt: Int?
    ) -> Bool {
        parentWorkflowByTaskID[taskID] != nil
            && statuses[taskID]?.isTerminal == true
            && status.isActive
            && incomingAttempt.map { attempt in
                previousAttempt.map { attempt <= $0 } ?? false
            } == true
    }
}
