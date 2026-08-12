import Foundation
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
    func suppressesCancellationErrors() {
        #expect(
            FeatureToolErrorPresentation.message(
                for: CancellationError(),
                taskIsCancelled: false
            ) == nil
        )
    }

    @Test
    func presentsNonCancellationErrors() {
        let error = NSError(domain: "FeatureErrorSurfaceTests", code: 1)

        #expect(
            FeatureToolErrorPresentation.message(
                for: error,
                taskIsCancelled: false
            ) == error.localizedDescription
        )
    }

    @Test
    func loadedPathDetectsOnlyResourceChanges() {
        var loadedPath = FeatureLoadedPath()
        let initialRoot = loadedPath.begin(nil)
        let repeatedRoot = loadedPath.begin(nil)
        let changedPath = loadedPath.begin("Sources")
        let repeatedPath = loadedPath.begin("Sources")

        #expect(initialRoot)
        #expect(repeatedRoot == false)
        #expect(changedPath)
        #expect(repeatedPath == false)
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
