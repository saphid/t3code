import Testing
@testable import T3Code

@Suite("Transcript accessibility headings")
struct TranscriptAccessibilityHeadingTests {
    @Test
    func roleLabelsIdentifyPeopleAndExcludeSupportingRows() {
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
    func headingsFollowRenderedConversationOrder() {
        let headings = FeatureTranscriptAccessibilityMetadata.headings(
            for: [
                message("system", role: .system),
                message("user-1", role: .user),
                message("tool", role: .tool),
                message("assistant-1", role: .assistant),
                message("user-2", role: .user),
            ],
            assistantLabel: "Opus 5"
        )

        #expect(headings.map(\.messageID) == ["user-1", "assistant-1", "user-2"])
        #expect(headings.map(\.label) == ["You", "Opus 5", "You"])
    }

    @Test
    func prependingEarlierMessagesKeepsExistingHeadingSuffixStable() {
        let visible = [
            message("user-2", role: .user),
            message("assistant-2", role: .assistant),
        ]
        let existing = FeatureTranscriptAccessibilityMetadata.headings(
            for: visible,
            assistantLabel: "Sol"
        )
        let paginated = FeatureTranscriptAccessibilityMetadata.headings(
            for: [
                message("user-1", role: .user),
                message("assistant-1", role: .assistant),
            ] + visible,
            assistantLabel: "Sol"
        )

        #expect(
            paginated.map(\.messageID)
                == ["user-1", "assistant-1", "user-2", "assistant-2"]
        )
        #expect(Array(paginated.suffix(existing.count)) == existing)
    }

    @Test
    func streamingReplacementKeepsOneStableHeading() {
        let streaming = FeatureMessage(
            id: "assistant-1",
            role: .assistant,
            text: "Hel",
            state: .streaming
        )
        let complete = FeatureMessage(
            id: "assistant-1",
            role: .assistant,
            text: "Hello",
            state: .complete
        )

        let before = FeatureTranscriptAccessibilityMetadata.headings(
            for: [streaming],
            assistantLabel: "Sol"
        )
        let after = FeatureTranscriptAccessibilityMetadata.headings(
            for: [complete],
            assistantLabel: "Sol"
        )

        #expect(before == after)
        #expect(after.count == 1)
        #expect(after.first?.accessibilityIdentifier == "message-heading-assistant-1")
    }

    @Test
    func duplicateMessageIDsProduceOnlyTheLatestHeading() {
        let original = FeatureMessage(
            id: "assistant-1",
            role: .assistant,
            text: "Old response",
            state: .streaming
        )
        let replacement = FeatureMessage(
            id: "assistant-1",
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
        let headings = FeatureTranscriptAccessibilityMetadata.headings(
            for: messages,
            assistantLabel: "Sol"
        )

        #expect(unique.map(\.id) == ["user-1", "assistant-1"])
        #expect(unique.last == replacement)
        #expect(headings.map(\.messageID) == ["user-1", "assistant-1"])
    }

    private func message(_ id: String, role: FeatureMessageRole) -> FeatureMessage {
        FeatureMessage(id: id, role: role, text: id)
    }
}
