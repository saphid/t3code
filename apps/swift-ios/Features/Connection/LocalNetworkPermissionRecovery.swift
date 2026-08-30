struct LocalNetworkPermissionRecovery<Action> {
    private var action: Action?
    private var activationCount = 0
    private var activationCountAtAttemptStart = 0
    private var observedInactive = false
    private var waitingForActivation = false

    mutating func begin(_ action: Action) {
        self.action = action
        activationCountAtAttemptStart = activationCount
        observedInactive = false
        waitingForActivation = false
    }

    mutating func applicationBecameInactive() {
        observedInactive = true
    }

    mutating func applicationBecameActive() -> Action? {
        guard observedInactive else { return nil }
        observedInactive = false
        activationCount += 1
        guard waitingForActivation else { return nil }
        return consumeAction()
    }

    mutating func permissionWasDenied() -> Action? {
        guard action != nil else { return nil }
        if activationCount > activationCountAtAttemptStart {
            return consumeAction()
        }
        waitingForActivation = true
        return nil
    }

    mutating func finish() {
        clearAttempt()
    }

    mutating func cancel() {
        clearAttempt()
    }

    private mutating func consumeAction() -> Action? {
        let action = action
        self.action = nil
        waitingForActivation = false
        return action
    }

    private mutating func clearAttempt() {
        action = nil
        observedInactive = false
        waitingForActivation = false
    }
}
