import Foundation
import Testing
import UIKit
@testable import T3Code

@Suite("Chat Markdown math")
struct MarkdownMathTests {
    @Test
    func recognizesInlineAndDisplayMathInMessageOrder() {
        let source = "Before \\(x^2 + y^2\\) between \\[E = mc^2\\] after"

        #expect(
            MarkdownMathParser.segments(in: source) == [
                .text("Before "),
                .math(MarkdownMathExpression(
                    source: "\\(x^2 + y^2\\)",
                    latex: "x^2 + y^2",
                    style: .inline
                )),
                .text(" between "),
                .math(MarkdownMathExpression(
                    source: "\\[E = mc^2\\]",
                    latex: "E = mc^2",
                    style: .display
                )),
                .text(" after"),
            ]
        )
    }

    @Test
    func leavesCurrencyEscapesAndNonMathBackslashesLiteral() {
        let source = #"Costs $20 and USD$30; escaped \\(x\\); path C:\tmp; \*literal*."#

        #expect(MarkdownMathParser.segments(in: source) == [.text(source)])
    }

    @Test
    func shieldsCodeAndLinkDestinationsButRendersProse() {
        let source = #"`\(code\)` [file](file:///tmp/\(path\).txt) <https://example.com/\[path\]> then \(math\)"#

        #expect(
            MarkdownMathParser.segments(in: source) == [
                .text(#"`\(code\)` [file](file:///tmp/\(path\).txt) <https://example.com/\[path\]> then "#),
                .math(MarkdownMathExpression(
                    source: #"\(math\)"#,
                    latex: "math",
                    style: .inline
                )),
            ]
        )
    }

    @Test
    func doesNotPairAcrossCodeAndRecoversAfterUnmatchedMarkdown() {
        let source = #"\(open `code` close\) then ` unmatched \(math\)"#

        #expect(
            MarkdownMathParser.segments(in: source) == [
                .text(#"\(open `code` close\) then ` unmatched "#),
                .math(MarkdownMathExpression(
                    source: #"\(math\)"#,
                    latex: "math",
                    style: .inline
                )),
            ]
        )
    }

    @Test
    func unfinishedLinkDestinationDoesNotHideLaterMath() {
        let source = #"unfinished [link](destination then \(math\)"#

        #expect(
            MarkdownMathParser.segments(in: source) == [
                .text("unfinished [link](destination then "),
                .math(MarkdownMathExpression(
                    source: #"\(math\)"#,
                    latex: "math",
                    style: .inline
                )),
            ]
        )
    }

    @Test
    func angleInequalityDoesNotHideMath() {
        let source = #"Bounds: a < \(x\) > b, unlike <https://example.com/\(path\)>"#

        #expect(
            MarkdownMathParser.segments(in: source) == [
                .text("Bounds: a < "),
                .math(MarkdownMathExpression(
                    source: #"\(x\)"#,
                    latex: "x",
                    style: .inline
                )),
                .text(#" > b, unlike <https://example.com/\(path\)>"#),
            ]
        )
    }

    @Test
    func leavesFencedMathLiteral() {
        let source = """
        ```text
        \\(not math\\)
        ```
        """

        #expect(
            MarkdownDocument(parsing: source).blocks == [
                .codeBlock(language: "text", code: "\\(not math\\)"),
            ]
        )
    }

    @Test
    func malformedAndUnsupportedMathFallsBackWithoutDroppingText() {
        let source = #"Before \(x^\) middle \(unclosed after \(a+b\) end"#

        #expect(
            MarkdownMathParser.segments(in: source) == [
                .text(#"Before \(x^\) middle \(unclosed after "#),
                .math(MarkdownMathExpression(
                    source: #"\(a+b\)"#,
                    latex: "a+b",
                    style: .inline
                )),
                .text(" end"),
            ]
        )
    }

    @Test
    func displayMathBecomesAnOrderedScrollableBlock() {
        let longFormula = #"\[\sum_{i=1}^{100} w_i x_i + \frac{\partial L}{\partial \theta_i}\]"#
        let document = MarkdownDocument(parsing: "Before\n\(longFormula)\nAfter")

        #expect(
            document.blocks == [
                .paragraph("Before"),
                .math(MarkdownMathExpression(
                    source: longFormula,
                    latex: #"\sum_{i=1}^{100} w_i x_i + \frac{\partial L}{\partial \theta_i}"#,
                    style: .display
                )),
                .paragraph("After"),
            ]
        )
    }

    @Test
    func inlineMathKeepsSurroundingMarkdownFormatting() {
        let formatted = MarkdownInlineFormatter.render(
            "**Energy \\(E=mc^2\\)** and [value \\(x\\)](https://example.com)."
        )

        #expect(String(formatted.attributedText.characters) == "Energy \u{FFFC} and value \u{FFFC}.")
        #expect(formatted.mathExpressions.map(\.source) == ["\\(E=mc^2\\)", "\\(x\\)"])
        #expect(
            formatted.attributedText.runs.contains {
                $0.inlinePresentationIntent?.contains(.stronglyEmphasized) == true
                    && String(formatted.attributedText[$0.range].characters).contains("\u{FFFC}")
            }
        )
        #expect(
            formatted.attributedText.runs.contains {
                $0.link == URL(string: "https://example.com")
                    && String(formatted.attributedText[$0.range].characters).contains("\u{FFFC}")
            }
        )
    }

    @Test @MainActor
    func selectableAttachmentHasSourceCopyAndAccessibilityLabel() throws {
        let document = try #require(
            MarkdownRenderCache.shared.documentImmediately(
                for: MarkdownContentRevision("Euler: \\(e^{i\\pi}+1=0\\).")
            )
        )
        guard case let .paragraph(inline) = document.blocks.first else {
            Issue.record("Expected an inline-math paragraph")
            return
        }
        let attributed = MarkdownSelectableTextAttributes.make(
            from: inline,
            lineSpacing: 4
        )
        let attachmentRange = (attributed.string as NSString).range(of: "\u{FFFC}")
        let attachment = try #require(
            attributed.attribute(.attachment, at: attachmentRange.location, effectiveRange: nil)
                as? NSTextAttachment
        )

        #expect(attachment.accessibilityLabel == "Math expression: e^{i\\pi}+1=0")
        #expect(
            MarkdownMathCopySource.string(
                from: attributed,
                in: NSRange(location: 0, length: attributed.length)
            ) == "Euler: \\(e^{i\\pi}+1=0\\)."
        )
        #expect(
            MarkdownMathCopySource.string(from: attributed, in: attachmentRange)
                == "\\(e^{i\\pi}+1=0\\)"
        )
    }
}
