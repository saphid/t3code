import CoreGraphics
import Testing
import UIKit
@testable import T3Code

@Suite("Transcript viewport and timestamp gestures")
struct TranscriptViewportGeometryTests {
    @Test
    func timestampRevealTracksOnlyTheTouchedMessageAndResetsOnRelease() {
        var reveal = TranscriptTimestampRevealModel()

        reveal.update(translationX: -32)
        #expect(reveal == TranscriptTimestampRevealModel())

        reveal.begin(messageID: "assistant-1")
        reveal.update(translationX: -32)
        #expect(reveal.width(for: "assistant-1") == 32)
        #expect(reveal.width(for: "assistant-2") == 0)

        reveal.finish()
        #expect(reveal == TranscriptTimestampRevealModel())
    }

    @Test
    func timestampRevealClampsAndClaimsOnlyDeliberateLeftwardHorizontalPans() {
        #expect(TranscriptTimestampRevealGeometry.width(translationX: 24) == 0)
        #expect(
            TranscriptTimestampRevealGeometry.width(translationX: -200)
                == TranscriptTimestampRevealGeometry.maximumWidth
        )
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
    func timestampEligibilityRequiresCompletedUserOrAssistantWithRealDate() {
        let timestamp = Date(timeIntervalSince1970: 1_780_000_000)

        #expect(
            FeatureMessageTimestampMetadata.isEligible(
                role: .user,
                state: .complete,
                createdAt: timestamp
            )
        )
        #expect(
            FeatureMessageTimestampMetadata.isEligible(
                role: .assistant,
                state: .complete,
                createdAt: timestamp
            )
        )
        for state in [FeatureMessageState.queued, .streaming, .failed] {
            #expect(
                !FeatureMessageTimestampMetadata.isEligible(
                    role: .assistant,
                    state: state,
                    createdAt: timestamp
                )
            )
        }
        for role in [FeatureMessageRole.tool, .system] {
            #expect(
                !FeatureMessageTimestampMetadata.isEligible(
                    role: role,
                    state: .complete,
                    createdAt: timestamp
                )
            )
        }
        #expect(
            !FeatureMessageTimestampMetadata.isEligible(
                role: .user,
                state: .complete,
                createdAt: .distantPast
            )
        )
    }

    @Test
    func timestampAccessibilityLabelsOnlyEligibleConversationRoles() {
        #expect(FeatureMessageTimestampMetadata.accessibilityLabel(for: .user) == "Sent")
        #expect(FeatureMessageTimestampMetadata.accessibilityLabel(for: .assistant) == "Received")
        #expect(FeatureMessageTimestampMetadata.accessibilityLabel(for: .tool) == nil)
        #expect(FeatureMessageTimestampMetadata.accessibilityLabel(for: .system) == nil)
    }

    @Test
    @MainActor
    func selectableMarkdownDoesNotStealTimestampSwipeButHorizontalContentDoes() {
        let host = UIView(frame: CGRect(x: 0, y: 0, width: 240, height: 240))
        let textView = UITextView(frame: CGRect(x: 0, y: 0, width: 120, height: 120))
        textView.contentSize = CGSize(width: 480, height: 120)
        host.addSubview(textView)

        #expect(
            !TranscriptTimestampGestureOwnership.descendantOwnsHorizontalInteraction(
                from: textView,
                host: host
            )
        )

        let codeScroller = UIScrollView(frame: CGRect(x: 0, y: 120, width: 120, height: 120))
        codeScroller.contentSize = CGSize(width: 480, height: 120)
        host.addSubview(codeScroller)
        #expect(
            TranscriptTimestampGestureOwnership.descendantOwnsHorizontalInteraction(
                from: codeScroller,
                host: host
            )
        )
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

    @Test
    func verticalPanFailsBeforeItCanCompeteWithTranscriptScrolling() {
        #expect(!ThreadBackSwipeGesture.shouldBegin(with: CGPoint(x: 40, y: 120)))
        #expect(!ThreadBackSwipeGesture.shouldBegin(with: CGPoint(x: -120, y: 0)))
    }

    @Test
    func horizontalPanCanLeaveTheThreadFromAnywhereOnTheSurface() {
        #expect(ThreadBackSwipeGesture.shouldBegin(with: CGPoint(x: 120, y: 20)))
        #expect(
            ThreadBackSwipeGesture.shouldNavigateBack(
                with: CGPoint(x: 96, y: 16)
            )
        )
    }

    @Test
    func slowHorizontalPanUsesTranslationWhenVelocityIsUnavailable() {
        #expect(
            ThreadBackSwipeGesture.shouldBegin(
                with: .zero,
                translation: CGPoint(x: 16, y: 2)
            )
        )
        #expect(
            !ThreadBackSwipeGesture.shouldBegin(
                with: .zero,
                translation: CGPoint(x: 4, y: 16)
            )
        )
    }

    @Test
    func shortOrDiagonalPanDoesNotLeaveTheThread() {
        #expect(
            !ThreadBackSwipeGesture.shouldNavigateBack(
                with: CGPoint(x: 71, y: 0)
            )
        )
        #expect(
            !ThreadBackSwipeGesture.shouldNavigateBack(
                with: CGPoint(x: 96, y: 80)
            )
        )
    }

    @Test
    @MainActor
    func horizontalScrollContentSharesOnlyAtItsLeadingEdge() {
        let transcript = UIScrollView(frame: CGRect(x: 0, y: 0, width: 120, height: 120))
        transcript.contentSize = CGSize(width: 120, height: 480)
        #expect(ThreadBackSwipeGesture.shouldAllowSimultaneousRecognition(with: transcript))

        let codeBlock = UIScrollView(frame: CGRect(x: 0, y: 0, width: 120, height: 120))
        codeBlock.contentSize = CGSize(width: 480, height: 120)
        codeBlock.alwaysBounceVertical = true
        #expect(ThreadBackSwipeGesture.shouldAllowSimultaneousRecognition(with: codeBlock))
        codeBlock.contentOffset = CGPoint(x: 100, y: 0)
        #expect(!ThreadBackSwipeGesture.shouldAllowSimultaneousRecognition(with: codeBlock))
    }

    @Test
    @MainActor
    func horizontalScrollAncestorsCanReceiveBackPanAtLeadingEdge() {
        let host = UIView(frame: CGRect(x: 0, y: 0, width: 240, height: 240))
        let codeBlock = UIScrollView(frame: host.bounds)
        codeBlock.contentSize = CGSize(width: 480, height: 240)
        let label = UILabel(frame: .zero)
        codeBlock.addSubview(label)
        host.addSubview(codeBlock)

        #expect(ThreadBackSwipeGesture.shouldReceiveTouch(in: label, host: host))
        codeBlock.contentOffset = CGPoint(x: 100, y: 0)
        #expect(!ThreadBackSwipeGesture.shouldReceiveTouch(in: label, host: host))
        #expect(ThreadBackSwipeGesture.shouldReceiveTouch(in: host, host: host))

        let detachedHost = UIView(frame: host.bounds)
        let detachedCodeBlock = UIScrollView(frame: detachedHost.bounds)
        detachedCodeBlock.contentSize = CGSize(width: 480, height: 240)
        let detachedLabel = UILabel(frame: .zero)
        detachedCodeBlock.addSubview(detachedLabel)
        detachedHost.addSubview(detachedCodeBlock)
        #expect(!ThreadBackSwipeGesture.shouldReceiveTouch(in: detachedLabel, host: host))
    }

    @Test
    @MainActor
    func activeTextInteractionsKeepHorizontalDrags() {
        let host = UIView(frame: CGRect(x: 0, y: 0, width: 240, height: 240))
        let textField = UITextField(frame: .zero)
        let textView = UITextView(frame: .zero)
        textView.text = "Selectable transcript text"
        let textViewContent = UIView(frame: .zero)
        textView.addSubview(textViewContent)
        host.addSubview(textField)
        host.addSubview(textView)

        #expect(!ThreadBackSwipeGesture.shouldReceiveTouch(in: textField, host: host))
        textView.isEditable = false
        #expect(ThreadBackSwipeGesture.shouldReceiveTouch(in: textView, host: host))
        #expect(ThreadBackSwipeGesture.shouldReceiveTouch(in: textViewContent, host: host))

        textView.selectedRange = NSRange(location: 0, length: 1)
        #expect(ThreadBackSwipeGesture.shouldReceiveTouch(in: textView, host: host))
        #expect(ThreadBackSwipeGesture.shouldReceiveTouch(in: textViewContent, host: host))

        textView.selectedRange = NSRange(location: 0, length: 0)
        textView.isEditable = true
        #expect(!ThreadBackSwipeGesture.shouldReceiveTouch(in: textView, host: host))

        let window = UIWindow(frame: host.bounds)
        let rootViewController = UIViewController()
        window.rootViewController = rootViewController
        rootViewController.view.addSubview(host)
        window.makeKeyAndVisible()
        textView.isEditable = false
        #expect(textView.becomeFirstResponder())
        #expect(!ThreadBackSwipeGesture.shouldReceiveTouch(in: textViewContent, host: host))
        textView.resignFirstResponder()
        window.isHidden = true

        #expect(ThreadBackSwipeGesture.shouldReceiveTouch(in: host, host: host))
    }
}
