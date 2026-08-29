enum ProjectAttentionState: Int, Sendable, Equatable, Comparable {
    case unseenCompletion = 1
    case pendingInput = 2
    case failure = 3

    static func < (lhs: Self, rhs: Self) -> Bool {
        lhs.rawValue < rhs.rawValue
    }

    var accessibilityLabel: String {
        switch self {
        case .failure:
            "Failed task needs attention"
        case .pendingInput:
            "Task is awaiting input"
        case .unseenCompletion:
            "Completed task has not been viewed"
        }
    }

    var systemImage: String {
        switch self {
        case .failure:
            "exclamationmark.circle.fill"
        case .pendingInput:
            "questionmark.circle.fill"
        case .unseenCompletion:
            "checkmark.circle.fill"
        }
    }
}
