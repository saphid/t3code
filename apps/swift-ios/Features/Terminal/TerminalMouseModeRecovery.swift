enum TerminalMouseModeRecovery {
    static let resetSequence = [9, 1000, 1001, 1002, 1003, 1005, 1006, 1015, 1016]
        .map { "\u{1B}[?\($0)l" }
        .joined()

    static func sequenceAfterReplay(hasRunningSubprocess: Bool) -> String? {
        hasRunningSubprocess ? nil : resetSequence
    }

    static func sequenceAfterActivityChange(
        wasRunning: Bool,
        isRunning: Bool
    ) -> String? {
        wasRunning && !isRunning ? resetSequence : nil
    }
}
