import CoreGraphics
import Testing
@testable import T3Code

struct FeatureComposerAttachmentLayoutTests {
    @Test(
        "An attached banner covers one physical pixel beneath the composer shoulder",
        .bug("https://github.com/saphid/t3code-personal/issues/252"),
        arguments: [CGFloat(1), CGFloat(2), CGFloat(3)]
    )
    func attachedBannerCoversOnePhysicalPixel(displayScale: CGFloat) {
        let overlap = FeatureComposerAttachmentLayout.overlap(
            hasAttachedBanner: true,
            displayScale: displayScale
        )
        let coveredPixels = (
            overlap - FeatureComposerAttachmentLayout.shoulderDepth
        ) * displayScale

        #expect(abs(coveredPixels - 1) < 0.000_001)
    }

    @Test(
        "A composer without a banner keeps its ordinary layout",
        .bug("https://github.com/saphid/t3code-personal/issues/252")
    )
    func composerWithoutBannerAddsNoOverlap() {
        #expect(
            FeatureComposerAttachmentLayout.overlap(
                hasAttachedBanner: false,
                displayScale: 3
            ) == 0
        )
    }
}
