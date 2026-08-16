import Testing
@testable import T3Code

@Suite("Thread detail presentation")
struct ThreadDetailPresentationTests {
    @Test
    func cachedTranscriptRemainsVisibleWhileRefreshing() {
        #expect(
            !FeatureThreadPresentation.showsOpeningState(
                isLoading: true,
                hasDetail: true
            )
        )
    }

    @Test
    func openingStateOnlyAppearsBeforeFirstDetailLoads() {
        #expect(
            FeatureThreadPresentation.showsOpeningState(
                isLoading: true,
                hasDetail: false
            )
        )
        #expect(
            !FeatureThreadPresentation.showsOpeningState(
                isLoading: false,
                hasDetail: false
            )
        )
    }
}
