import Testing
@testable import T3Code

@Suite("Transcript viewport and timestamp gestures")
struct TranscriptViewportGeometryTests {
    @Test
    func timestampRevealTracksLeftwardDragWithinBounds() {
        #expect(TranscriptTimestampRevealGeometry.width(translationX: -32) == 32)
    }

    @Test
    func timestampRevealClampsAtRestAndMaximumWidth() {
        #expect(TranscriptTimestampRevealGeometry.width(translationX: 24) == 0)
        #expect(
            TranscriptTimestampRevealGeometry.width(translationX: -200)
                == TranscriptTimestampRevealGeometry.maximumWidth
        )
    }

    @Test
    func timestampRevealClaimsOnlyDeliberateLeftwardHorizontalPans() {
        #expect(
            TranscriptTimestampRevealGeometry.shouldBegin(velocityX: -24, velocityY: 4)
        )
        #expect(
            !TranscriptTimestampRevealGeometry.shouldBegin(velocityX: -4, velocityY: 24)
        )
        #expect(
            !TranscriptTimestampRevealGeometry.shouldBegin(velocityX: 24, velocityY: 4)
        )
        #expect(
            !TranscriptTimestampRevealGeometry.shouldBegin(velocityX: -10, velocityY: 9)
        )
    }

    @Test
    func timestampRevealRequiresBeginAndResetsAfterCancellation() {
        var reveal = TranscriptTimestampRevealModel()

        reveal.update(translationX: -32)
        #expect(reveal == TranscriptTimestampRevealModel())

        reveal.begin()
        reveal.update(translationX: -32)
        #expect(reveal.phase == .tracking)
        #expect(reveal.width == 32)

        reveal.finish()
        #expect(reveal == TranscriptTimestampRevealModel())
    }

    @Test
    func timestampRevealReuseCannotLeakPriorThreadState() {
        var reveal = TranscriptTimestampRevealModel()
        reveal.begin()
        reveal.update(translationX: -200)
        #expect(reveal.width == TranscriptTimestampRevealGeometry.maximumWidth)

        reveal.finish()
        reveal.begin()
        #expect(reveal.phase == .tracking)
        #expect(reveal.width == 0)
    }

    @Test
    func timestampAccessibilityLabelsEveryMessageRole() {
        #expect(FeatureMessageTimestampAccessibility.label(for: .user) == "Sent")
        #expect(FeatureMessageTimestampAccessibility.label(for: .assistant) == "Received")
        #expect(FeatureMessageTimestampAccessibility.label(for: .tool) == "Timestamp")
        #expect(FeatureMessageTimestampAccessibility.label(for: .system) == "Timestamp")
    }

    @Test
    func firstLoadedTranscriptAnchorsToLatestMessage() {
        let empty = TranscriptViewportGeometry(
            contentHeight: 0,
            viewportHeight: 700,
            topInset: 0,
            bottomInset: 0
        )
        let loaded = TranscriptViewportGeometry(
            contentHeight: 1_200,
            viewportHeight: 700,
            topInset: 0,
            bottomInset: 0
        )

        #expect(
            loaded.restoredBottomOffset(
                after: empty,
                maintainsBottomAnchor: true,
                isInteracting: false
            ) == 500
        )
    }

    @Test
    func keyboardViewportChangeKeepsLatestMessageVisible() {
        let beforeKeyboard = TranscriptViewportGeometry(
            contentHeight: 1_200,
            viewportHeight: 700,
            topInset: 0,
            bottomInset: 0
        )
        let afterKeyboard = TranscriptViewportGeometry(
            contentHeight: 1_200,
            viewportHeight: 400,
            topInset: 0,
            bottomInset: 0
        )

        #expect(
            afterKeyboard.restoredBottomOffset(
                after: beforeKeyboard,
                maintainsBottomAnchor: true,
                isInteracting: false
            ) == 800
        )
    }

    @Test
    func readerPositionIsUntouchedAwayFromLatestMessage() {
        let beforeKeyboard = TranscriptViewportGeometry(
            contentHeight: 1_200,
            viewportHeight: 700,
            topInset: 0,
            bottomInset: 0
        )
        let afterKeyboard = TranscriptViewportGeometry(
            contentHeight: 1_200,
            viewportHeight: 400,
            topInset: 0,
            bottomInset: 0
        )

        #expect(
            afterKeyboard.restoredBottomOffset(
                after: beforeKeyboard,
                maintainsBottomAnchor: false,
                isInteracting: false
            ) == nil
        )
    }

    @Test
    func activeTranscriptGestureOwnsItsScrollPosition() {
        let before = TranscriptViewportGeometry(
            contentHeight: 1_200,
            viewportHeight: 700,
            topInset: 0,
            bottomInset: 0
        )
        let after = TranscriptViewportGeometry(
            contentHeight: 1_260,
            viewportHeight: 700,
            topInset: 0,
            bottomInset: 0
        )

        #expect(
            after.restoredBottomOffset(
                after: before,
                maintainsBottomAnchor: true,
                isInteracting: true
            ) == nil
        )
    }
}
