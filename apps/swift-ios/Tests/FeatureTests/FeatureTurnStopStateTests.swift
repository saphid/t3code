import Testing
@testable import T3Code

struct FeatureTurnStopStateTests {
    @Test(
        "Stop enters a single-flight state synchronously",
        .bug("https://github.com/saphid/t3code-personal/issues/223")
    )
    func stopIsSingleFlight() {
        var state = FeatureTurnStopState()

        #expect(state.begin(threadID: "thread-1"))
        #expect(state.isStopping(threadID: "thread-1"))
        #expect(state.begin(threadID: "thread-1") == false)
    }

    @Test(
        "A terminal thread releases the stopping state",
        .bug("https://github.com/saphid/t3code-personal/issues/223")
    )
    func terminalThreadReleasesStopping() {
        var state = FeatureTurnStopState()
        #expect(state.begin(threadID: "thread-1"))

        state.reconcile(threadID: "thread-1", isWorking: true)
        #expect(state.isStopping(threadID: "thread-1"))

        state.reconcile(threadID: "thread-1", isWorking: false)
        #expect(state.isStopping(threadID: "thread-1") == false)
    }

    @Test(
        "A surfaced dispatch failure makes Stop retryable",
        .bug("https://github.com/saphid/t3code-personal/issues/223")
    )
    func dispatchFailureReleasesStopping() {
        var state = FeatureTurnStopState()
        #expect(state.begin(threadID: "thread-1"))

        state.finish(threadID: "thread-1")

        #expect(state.isStopping(threadID: "thread-1") == false)
        #expect(state.begin(threadID: "thread-1"))
    }
}
