import SwiftUI
import Testing
import UIKit
@testable import T3Code

@Suite("Transcript accessibility headings")
struct TranscriptAccessibilityHeadingTests {
    @Test(.bug("https://github.com/saphid/t3code-personal/issues/202"))
    func roleLabelsIdentifyConversationAuthorsAndExcludeSupportingRows() {
        let user = message("user", role: .user)
        let assistant = message("assistant", role: .assistant)

        #expect(
            FeatureTranscriptAccessibilityMetadata.heading(
                for: user,
                assistantLabel: "Sol"
            ) == FeatureTranscriptAccessibilityHeading(messageID: "user", label: "You")
        )
        #expect(
            FeatureTranscriptAccessibilityMetadata.heading(
                for: assistant,
                assistantLabel: "Sol"
            ) == FeatureTranscriptAccessibilityHeading(messageID: "assistant", label: "Sol")
        )
        #expect(
            FeatureTranscriptAccessibilityMetadata.heading(
                for: message("tool", role: .tool),
                assistantLabel: "Sol"
            ) == nil
        )
        #expect(
            FeatureTranscriptAccessibilityMetadata.heading(
                for: message("system", role: .system),
                assistantLabel: "Sol"
            ) == nil
        )
        #expect(
            FeatureTranscriptAccessibilityMetadata.heading(
                for: assistant,
                assistantLabel: "Sol"
            )?.accessibilityIdentifier == "message-heading-assistant"
        )
    }

    @Test
    func assistantLabelPrefersModelThenProviderThenGenericIdentity() {
        #expect(
            FeatureTranscriptAccessibilityMetadata.assistantLabel(
                modelName: "  GPT-5.6 Sol  ",
                providerName: "Codex"
            ) == "GPT-5.6 Sol"
        )
        #expect(
            FeatureTranscriptAccessibilityMetadata.assistantLabel(
                modelName: "  ",
                providerName: " Claude Code "
            ) == "Claude Code"
        )
        #expect(
            FeatureTranscriptAccessibilityMetadata.assistantLabel(
                modelName: nil,
                providerName: nil
            ) == "Assistant"
        )
    }

    @Test
    func headingsFollowRenderedConversationOrderAroundMarkdownAndWorkLogRows() {
        let headings = FeatureTranscriptAccessibilityMetadata.headings(
            for: [
                message("system", role: .system),
                message("user-1", role: .user, text: "# Request"),
                message("tool", role: .tool, text: "command output"),
                message("assistant-1", role: .assistant, text: "## Answer\n```swift\nlet x = 1\n```"),
                message("user-2", role: .user),
            ],
            assistantLabel: "Opus 5"
        )

        #expect(headings.map(\.messageID) == ["user-1", "assistant-1", "user-2"])
        #expect(headings.map(\.label) == ["You", "Opus 5", "You"])
    }

    @Test
    func markdownHeadingsRemainHeadingsWhilePlainTextAndCodeDoNot() {
        let heading = MarkdownInlineAccessibilityTraits.resolve(isHeading: true)
        let nonHeading = MarkdownInlineAccessibilityTraits.resolve(isHeading: false)

        #expect(heading.contains(.header))
        #expect(heading.contains(.staticText))
        #expect(nonHeading.contains(.header) == false)
        #expect(nonHeading == .staticText)
    }

    @Test(.bug("https://github.com/saphid/t3code-personal/issues/202"))
    @MainActor
    func renderedMarkdownKeepsHeadingSelectionWithoutPromotingPlainTextOrCode() throws {
        let host = UIHostingController(
            rootView: MarkdownMessageView(
                "# Plan\n\nBody text\n\n```swift\nlet value = 1\n```"
            )
        )
        host.loadViewIfNeeded()
        host.view.frame = CGRect(x: 0, y: 0, width: 390, height: 800)
        host.view.layoutIfNeeded()

        let textViews = descendantTextViews(in: host.view)
        let heading = try #require(textViews.first { $0.text == "Plan" })
        let body = try #require(textViews.first { $0.text == "Body text" })
        let code = try #require(textViews.first { $0.text.contains("let value = 1") })

        #expect(heading.accessibilityTraits.contains(.header))
        #expect(heading.isSelectable)
        #expect(body.accessibilityTraits.contains(.header) == false)
        #expect(code.accessibilityTraits.contains(.header) == false)
    }

    @Test
    func prependingEarlierMessagesKeepsExistingHeadingSuffixStable() {
        let visible = [
            message("user-2", role: .user),
            message("assistant-2", role: .assistant),
        ]
        let existing = headings(for: visible)
        let paginated = headings(
            for: [
                message("user-1", role: .user),
                message("assistant-1", role: .assistant),
            ] + visible
        )

        #expect(
            paginated.map(\.messageID)
                == ["user-1", "assistant-1", "user-2", "assistant-2"]
        )
        #expect(Array(paginated.suffix(existing.count)) == existing)
    }

    @Test
    func streamedCompletionInterruptionAndRetryKeepStableHeadingIdentity() {
        let streaming = message("assistant-1", role: .assistant, text: "Hel", state: .streaming)
        let interrupted = message("assistant-1", role: .assistant, text: "Hello", state: .failed)
        let retried = message("assistant-1", role: .assistant, text: "Hello again", state: .streaming)
        let complete = message("assistant-1", role: .assistant, text: "Hello again", state: .complete)

        let states = [streaming, interrupted, retried, complete].map {
            headings(for: [$0])
        }

        #expect(states.allSatisfy { $0.count == 1 })
        #expect(Set(states.compactMap(\.first)).count == 1)
        #expect(states.last?.first?.accessibilityIdentifier == "message-heading-assistant-1")
    }

    @Test
    func deletionRemovesOnlyTheMatchingHeading() {
        let before = headings(
            for: [
                message("user-1", role: .user),
                message("assistant-1", role: .assistant),
                message("user-2", role: .user),
                message("assistant-2", role: .assistant),
            ]
        )
        let after = headings(
            for: [
                message("user-1", role: .user),
                message("assistant-1", role: .assistant),
                message("assistant-2", role: .assistant),
            ]
        )

        #expect(before.map(\.messageID) == ["user-1", "assistant-1", "user-2", "assistant-2"])
        #expect(after.map(\.messageID) == ["user-1", "assistant-1", "assistant-2"])
        #expect(after.contains { $0.messageID == "user-2" } == false)
    }

    @Test
    func reconnectDuplicateUsesLatestMessageWithoutAddingAHeading() {
        let original = message(
            "assistant-1",
            role: .assistant,
            text: "Old response",
            state: .streaming
        )
        let replacement = message(
            "assistant-1",
            role: .assistant,
            text: "Final response",
            state: .complete
        )
        let messages = [
            message("user-1", role: .user),
            original,
            replacement,
        ]

        let unique = FeatureTranscriptAccessibilityMetadata.uniqueMessages(messages)
        let result = headings(for: messages)

        #expect(unique.map(\.id) == ["user-1", "assistant-1"])
        #expect(unique.last == replacement)
        #expect(result.map(\.messageID) == ["user-1", "assistant-1"])
    }

    private func headings(
        for messages: [FeatureMessage]
    ) -> [FeatureTranscriptAccessibilityHeading] {
        FeatureTranscriptAccessibilityMetadata.headings(
            for: messages,
            assistantLabel: "Sol"
        )
    }

    private func message(
        _ id: String,
        role: FeatureMessageRole,
        text: String? = nil,
        state: FeatureMessageState = .complete
    ) -> FeatureMessage {
        FeatureMessage(
            id: id,
            role: role,
            text: text ?? id,
            state: state
        )
    }

    @MainActor
    private func descendantTextViews(in view: UIView) -> [UITextView] {
        let current = (view as? UITextView).map { [$0] } ?? []
        return current + view.subviews.flatMap(descendantTextViews)
    }
}
