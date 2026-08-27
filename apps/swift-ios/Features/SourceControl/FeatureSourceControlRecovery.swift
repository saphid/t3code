import Foundation

extension FeatureSourceControlAction {
    var title: String {
        switch self {
        case .commit: "Commit changes"
        case .push: "Push"
        case .pull: "Pull latest"
        case .createPullRequest: "Create pull request"
        case .commitAndPush: "Commit and push"
        case .commitPushAndCreatePullRequest: "Commit, push, and create PR"
        }
    }
}

enum FeatureSourceControlOperation: Equatable, Sendable {
    case load
    case action(FeatureSourceControlAction, message: String?)

    var isLoad: Bool {
        if case .load = self { return true }
        return false
    }

    var failureTitle: String {
        switch self {
        case .load: "Repository status failed to load"
        case let .action(action, _): "\(action.title) failed"
        }
    }

    var retryAccessibilityLabel: String {
        switch self {
        case .load: "Retry loading repository status"
        case let .action(action, _): "Retry \(action.title.lowercased())"
        }
    }

    var recoveryAnnouncement: String {
        switch self {
        case .load: "Repository status loaded."
        case let .action(action, _): "\(action.title) succeeded. Repository status updated."
        }
    }
}

struct FeatureSourceControlFailure: Identifiable, Equatable, Sendable {
    let id: Int
    let operation: FeatureSourceControlOperation
    let message: String
    var isRetrying: Bool

    var accessibilityLabel: String {
        let suffix = isRetrying ? " Retrying." : ""
        return "\(operation.failureTitle). \(message).\(suffix)"
    }
}

enum FeatureSourceControlRecoveryFocus: Hashable, Sendable {
    case failure
    case recoveredContent
}

struct FeatureSourceControlRecoveryState: Equatable, Sendable {
    private(set) var failure: FeatureSourceControlFailure?
    private(set) var runningOperation: FeatureSourceControlOperation?
    private(set) var recoveryAnnouncement: String?
    private var failureCount = 0

    var isBusy: Bool { runningOperation != nil }
    var isRunningAction: Bool { runningOperation?.isLoad == false }

    mutating func begin(_ operation: FeatureSourceControlOperation) -> Bool {
        guard runningOperation == nil else { return false }
        runningOperation = operation
        recoveryAnnouncement = nil
        let isRetrying = failure?.operation == operation
        failure?.isRetrying = isRetrying
        return true
    }

    mutating func finishSuccess(
        _ operation: FeatureSourceControlOperation,
        alsoSatisfying relatedOperation: FeatureSourceControlOperation? = nil
    ) {
        guard runningOperation == operation else { return }
        runningOperation = nil
        guard let failedOperation = failure?.operation,
              failedOperation == operation || failedOperation == relatedOperation else {
            return
        }
        failure = nil
        recoveryAnnouncement = failedOperation.recoveryAnnouncement
    }

    mutating func finishFailure(_ operation: FeatureSourceControlOperation, error: Error) {
        guard runningOperation == operation else { return }
        runningOperation = nil
        guard !Self.isCancellation(error) else {
            failure?.isRetrying = false
            return
        }
        presentFailure(operation, error: error)
    }

    mutating func finishFollowUpFailure(
        after completedOperation: FeatureSourceControlOperation,
        retrying followUpOperation: FeatureSourceControlOperation,
        error: Error
    ) {
        guard runningOperation == completedOperation else { return }
        runningOperation = nil
        guard !Self.isCancellation(error) else {
            if failure?.operation == completedOperation {
                failure = nil
            } else {
                failure?.isRetrying = false
            }
            return
        }
        presentFailure(followUpOperation, error: error)
    }

    mutating func takeRecoveryAnnouncement() -> String? {
        defer { recoveryAnnouncement = nil }
        return recoveryAnnouncement
    }

    static func isCancellation(_ error: Error) -> Bool {
        if error is CancellationError { return true }
        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain, nsError.code == NSURLErrorCancelled { return true }
        return nsError.domain == NSCocoaErrorDomain && nsError.code == NSUserCancelledError
    }

    private mutating func presentFailure(
        _ operation: FeatureSourceControlOperation,
        error: Error
    ) {
        failureCount += 1
        let message = error.localizedDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        failure = FeatureSourceControlFailure(
            id: failureCount,
            operation: operation,
            message: message.isEmpty ? "The operation could not be completed." : message,
            isRetrying: false
        )
    }
}
