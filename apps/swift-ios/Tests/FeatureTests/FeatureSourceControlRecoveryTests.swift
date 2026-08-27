import Foundation
import Testing
@testable import T3Code

@Suite("Source control failure recovery")
struct FeatureSourceControlRecoveryTests {
    private struct StubError: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    private func failedState(
        _ operation: FeatureSourceControlOperation = .action(.push, message: nil),
        message: String = "remote rejected: non-fast-forward"
    ) -> FeatureSourceControlRecoveryState {
        var state = FeatureSourceControlRecoveryState()
        _ = state.begin(operation)
        state.finishFailure(operation, error: StubError(message: message))
        return state
    }

    @Test
    func failureRetainsOutputAndTheExactOperation() {
        let operation = FeatureSourceControlOperation.action(
            .commit,
            message: "fix: keep this input"
        )
        let state = failedState(operation, message: "pre-commit hook failed")

        #expect(state.failure?.operation == operation)
        #expect(state.failure?.message == "pre-commit hook failed")
        #expect(state.failure?.operation.failureTitle == "Commit changes failed")
        #expect(state.failure?.operation.retryAccessibilityLabel == "Retry commit changes")
    }

    @Test
    func retryKeepsTheOriginalOutputVisibleWhileRunning() {
        var state = failedState()
        let originalFailureID = state.failure?.id

        let didBegin = state.begin(.action(.push, message: nil))
        #expect(didBegin)

        #expect(state.failure?.id == originalFailureID)
        #expect(state.failure?.message == "remote rejected: non-fast-forward")
        #expect(state.failure?.isRetrying == true)
        #expect(state.failure?.accessibilityLabel.hasSuffix("Retrying.") == true)
    }

    @Test
    func cancellationDoesNotCreateFalseFailureOutput() {
        var state = FeatureSourceControlRecoveryState()
        let didBegin = state.begin(.load)
        #expect(didBegin)

        state.finishFailure(.load, error: CancellationError())

        #expect(state.failure == nil)
        #expect(state.isBusy == false)
    }

    @Test
    func cancellingARetryPreservesTheOriginalFailure() {
        let operation = FeatureSourceControlOperation.action(.push, message: nil)
        var state = failedState(operation)
        let didBegin = state.begin(operation)
        #expect(didBegin)

        state.finishFailure(operation, error: URLError(.cancelled))

        #expect(state.failure?.operation == operation)
        #expect(state.failure?.message == "remote rejected: non-fast-forward")
        #expect(state.failure?.isRetrying == false)
    }

    @Test
    func matchingSuccessClearsFailureAndAnnouncesRecoveryOnce() {
        let operation = FeatureSourceControlOperation.action(.push, message: nil)
        var state = failedState(operation)
        let didBegin = state.begin(operation)
        #expect(didBegin)

        state.finishSuccess(operation, alsoSatisfying: .load)

        #expect(state.failure == nil)
        let firstAnnouncement = state.takeRecoveryAnnouncement()
        let secondAnnouncement = state.takeRecoveryAnnouncement()
        #expect(firstAnnouncement == "Push succeeded. Repository status updated.")
        #expect(secondAnnouncement == nil)
    }

    @Test(
        "An unrelated load success preserves a failed action",
        .bug("https://github.com/pingdotgg/t3code/pull/7371#discussion_r3801994163")
    )
    func unrelatedLoadSuccessPreservesAFailedAction() {
        let failedAction = FeatureSourceControlOperation.action(.push, message: nil)
        var state = failedState(failedAction)
        let didBegin = state.begin(.load)
        #expect(didBegin)

        state.finishSuccess(.load)

        #expect(state.failure?.operation == failedAction)
        #expect(state.recoveryAnnouncement == nil)
    }

    @Test
    func actionAndRefreshSuccessClearsAnEarlierLoadFailure() {
        let action = FeatureSourceControlOperation.action(.push, message: nil)
        var state = failedState(.load)
        let didBegin = state.begin(action)
        #expect(didBegin)

        state.finishSuccess(action, alsoSatisfying: .load)

        #expect(state.failure == nil)
        let announcement = state.takeRecoveryAnnouncement()
        #expect(announcement == "Repository status loaded.")
    }

    @Test(
        "A failed refresh after a completed action retries only the refresh",
        .bug("https://github.com/pingdotgg/t3code/pull/7371#discussion_r3801994206")
    )
    func failedRefreshAfterCompletedActionRetriesOnlyLoad() {
        let completedAction = FeatureSourceControlOperation.action(
            .commit,
            message: "fix: never repeat"
        )
        var state = FeatureSourceControlRecoveryState()
        let didBegin = state.begin(completedAction)
        #expect(didBegin)

        state.finishFollowUpFailure(
            after: completedAction,
            retrying: .load,
            error: StubError(message: "connection lost during refresh")
        )

        #expect(state.failure?.operation == .load)
        #expect(state.failure?.operation != completedAction)
        #expect(state.failure?.message == "connection lost during refresh")
    }

    @Test
    func cancelledRefreshCannotLeaveACompletedActionRetryable() {
        let completedAction = FeatureSourceControlOperation.action(.push, message: nil)
        var state = failedState(completedAction)
        let didBegin = state.begin(completedAction)
        #expect(didBegin)

        state.finishFollowUpFailure(
            after: completedAction,
            retrying: .load,
            error: CancellationError()
        )

        #expect(state.failure == nil)
        #expect(state.isBusy == false)
    }

    @Test
    func onlyOneOperationCanOwnRecoveryState() {
        let action = FeatureSourceControlOperation.action(.pull, message: nil)
        var state = FeatureSourceControlRecoveryState()

        let didBeginAction = state.begin(action)
        let didBeginLoad = state.begin(.load)
        #expect(didBeginAction)
        #expect(didBeginLoad == false)
        #expect(state.runningOperation == action)

        state.finishSuccess(action)
        #expect(state.isBusy == false)
    }

    @Test
    func repeatFailureGetsANewFocusIdentity() {
        let operation = FeatureSourceControlOperation.action(.push, message: nil)
        var state = failedState(operation)
        let firstID = state.failure?.id
        let didBegin = state.begin(operation)
        #expect(didBegin)

        state.finishFailure(operation, error: StubError(message: "still rejected"))

        #expect(state.failure?.id != firstID)
        #expect(state.failure?.message == "still rejected")
    }

    @Test
    func emptyErrorTextStillProducesReadableOutput() {
        var state = FeatureSourceControlRecoveryState()
        let didBegin = state.begin(.load)
        #expect(didBegin)

        state.finishFailure(.load, error: StubError(message: "   "))

        #expect(state.failure?.message == "The operation could not be completed.")
        #expect(state.failure?.accessibilityLabel.isEmpty == false)
    }
}
