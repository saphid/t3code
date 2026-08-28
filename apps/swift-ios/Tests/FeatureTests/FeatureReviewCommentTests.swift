import Testing
@testable import T3Code

@Suite("Review comment ranges")
struct FeatureReviewCommentTests {
    private let lines = [
        FeatureDiffLine(id: "hunk", kind: .hunk, text: "@@ -7,2 +7,3 @@"),
        FeatureDiffLine(id: "old", kind: .deletion, oldLine: 7, text: "let retries = 2"),
        FeatureDiffLine(id: "new", kind: .addition, newLine: 7, text: "let retries = 4"),
        FeatureDiffLine(id: "context", kind: .context, oldLine: 8, newLine: 8, text: "run()"),
        FeatureDiffLine(id: "next-hunk", kind: .hunk, text: "@@ -20,1 +21,1 @@"),
        FeatureDiffLine(id: "later", kind: .context, oldLine: 20, newLine: 21, text: "done()"),
    ]

    @Test
    func rangeNormalizesDirectionAndCannotCrossDiffSections() throws {
        let reversed = try #require(
            FeatureReviewLineRangeSelection(anchorIndex: 3, activeIndex: 1, in: lines)
        )

        #expect(reversed.startIndex == 1)
        #expect(reversed.endIndex == 3)
        #expect(reversed.lines.map(\.id) == ["old", "new", "context"])
        #expect(FeatureReviewLineRangeSelection(anchorIndex: 1, activeIndex: 5, in: lines) == nil)
        #expect(reversed.extending(to: 5, in: lines)?.lines.map(\.id) == ["later"])
    }

    @Test
    func rangeReportsOldAndNewLineLabels() throws {
        let range = try #require(
            FeatureReviewLineRangeSelection(anchorIndex: 1, activeIndex: 3, in: lines)
        )

        #expect(range.oldLineLabel == "old lines 7–8")
        #expect(range.newLineLabel == "new lines 7–8")
        #expect(range.locationLabel == "old lines 7–8 · new lines 7–8")
    }

    @Test
    func serializationIncludesOneContextAndEverySelectedLineInOrder() throws {
        let range = try #require(
            FeatureReviewLineRangeSelection(anchorIndex: 1, activeIndex: 3, in: lines)
        )
        let draft = FeatureReviewCommentDraft(
            sectionID: "working-tree",
            sectionTitle: "Working tree",
            filePath: "Sources/App.swift",
            range: range,
            body: "  Keep retries configurable.  "
        )
        let prompt = draft.prompt
        let threadDraft = draft.appending(to: "Check the surrounding behavior.")

        #expect(prompt.components(separatedBy: "<review_comment").count - 1 == 1)
        #expect(threadDraft.hasPrefix("Check the surrounding behavior.\n\n<review_comment"))
        #expect(threadDraft.components(separatedBy: "<review_comment").count - 1 == 1)
        #expect(prompt.contains("startIndex=\"1\" endIndex=\"3\""))
        #expect(prompt.contains("@@ -7,2 +7,2 @@"))
        #expect(prompt.contains("-let retries = 2\n+let retries = 4\n run()"))
        #expect(prompt.contains("Keep retries configurable."))
        #expect(prompt.contains("  Keep retries configurable.  ") == false)
    }

    @Test
    func cancellingClearsTransientStateWithoutProducingADraft() {
        var session = FeatureReviewCommentSession()
        session.startRange(at: 1, in: lines)
        session.selectLine(at: 3, in: lines)
        session.openSelectedComment()
        session.comment = "Change this."

        session.cancelComposer()

        #expect(session.selection == nil)
        #expect(session.comment.isEmpty)
        #expect(session.isCommenting == false)
        #expect(session.takeDraft(
            sectionID: "working-tree",
            sectionTitle: "Working tree",
            filePath: "Sources/App.swift"
        ) == nil)
    }

    @Test
    func singleLineTapStillOpensACompatibleComment() throws {
        var session = FeatureReviewCommentSession()
        session.selectLine(at: 2, in: lines)

        #expect(session.isCommenting)
        #expect(session.selection?.startIndex == 2)
        #expect(session.selection?.endIndex == 2)
        #expect(session.selection?.newLineLabel == "new line 7")

        session.comment = "Keep this named."
        let prompt = try #require(session.takeDraft(
            sectionID: "working-tree",
            sectionTitle: "Working tree",
            filePath: "Sources/App.swift"
        )?.prompt)

        #expect(prompt.contains("rangeLabel=\"new line 7\""))
        #expect(prompt.contains("@@ -0,0 +7,1 @@\n+let retries = 4"))
        #expect(session.selection == nil)
        #expect(session.takeDraft(
            sectionID: "working-tree",
            sectionTitle: "Working tree",
            filePath: "Sources/App.swift"
        ) == nil)
    }
}
