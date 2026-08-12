import Testing
@testable import T3Code

@Suite("Feature error surfaces")
struct FeatureErrorSurfaceTests {
    @Test
    func hidesErrorPresentationWithoutAnError() {
        #expect(
            FeatureToolErrorPresentation.resolve(
                errorMessage: nil,
                retainsContent: true
            ) == .none
        )
    }

    @Test
    func usesUnavailablePresentationWithoutContent() {
        #expect(
            FeatureToolErrorPresentation.resolve(
                errorMessage: "Offline",
                retainsContent: false
            ) == .unavailable(message: "Offline")
        )
    }

    @Test
    func usesInlinePresentationWhenLastKnownContentRemains() {
        #expect(
            FeatureToolErrorPresentation.resolve(
                errorMessage: "Push failed",
                retainsContent: true
            ) == .inline(message: "Push failed")
        )
    }

    @Test
    func sourceControlRetryPreservesTheFailedActionAndCommitMessage() {
        let retry = FeatureSourceControlRetry(
            action: .commitAndPush,
            message: "Explain the change"
        )

        #expect(retry.action == .commitAndPush)
        #expect(retry.message == "Explain the change")
    }

    @Test
    func latestRequestRejectsEarlierCompletions() {
        var requests = FeatureLatestRequest()
        let earlier = requests.begin()
        let latest = requests.begin()

        #expect(requests.isCurrent(earlier) == false)
        #expect(requests.isCurrent(latest))
    }
}
