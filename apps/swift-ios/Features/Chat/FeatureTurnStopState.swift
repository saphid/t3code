struct FeatureTurnStopState: Equatable {
    private(set) var stoppingThreadID: String?

    mutating func begin(threadID: String) -> Bool {
        guard stoppingThreadID == nil else { return false }
        stoppingThreadID = threadID
        return true
    }

    mutating func finish(threadID: String) {
        guard stoppingThreadID == threadID else { return }
        stoppingThreadID = nil
    }

    mutating func reconcile(threadID: String, isWorking: Bool) {
        guard !isWorking else { return }
        finish(threadID: threadID)
    }

    func isStopping(threadID: String) -> Bool {
        stoppingThreadID == threadID
    }
}
