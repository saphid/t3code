import Testing
@testable import T3Code

@Suite("Review diff syntax highlighting")
struct FeatureDiffSyntaxHighlighterTests {
    @Test(
        "Changed file paths infer supported source languages",
        .bug("https://github.com/saphid/t3code-personal/issues/163"),
        arguments: [
            ("Sources/App.swift", "swift"),
            ("web/component.tsx", "typescript"),
            (#"C:\workspace\Sources\App.swift"#, "swift"),
            ("scripts/release.zsh", "shell"),
            ("notes/README", nil),
        ] as [(String, String?)]
    )
    func infersLanguageFromPath(path: String, expected: String?) {
        #expect(FeatureDiffSyntaxHighlighter.language(for: path) == expected)
    }

    @Test(
        "Syntax and word-change emphasis compose without replacing either",
        .bug("https://github.com/saphid/t3code-personal/issues/163")
    )
    func composesSyntaxWithWordChangeEmphasis() throws {
        let text = "let enabled = true // changed"
        let lines = [
            FeatureDiffLine(
                id: "context",
                kind: .context,
                oldLine: 1,
                newLine: 1,
                text: "import SwiftUI"
            ),
            FeatureDiffLine(
                id: "deletion",
                kind: .deletion,
                oldLine: 2,
                text: "let enabled = false",
                spans: [
                    .init(text: "let enabled = ", kind: .unchanged),
                    .init(text: "false", kind: .changed),
                ]
            ),
            FeatureDiffLine(
                id: "addition",
                kind: .addition,
                newLine: 2,
                text: text,
                spans: [
                    .init(text: "let enabled = ", kind: .unchanged),
                    .init(text: "true", kind: .changed),
                    .init(text: " // changed", kind: .unchanged),
                ]
            ),
        ]

        let output = FeatureDiffSyntaxHighlighter.lines(
            for: FeatureReviewFile(
                path: "Sources/App.swift",
                change: .modified,
                additions: 1,
                deletions: 1,
                lines: lines
            )
        )

        let context = try #require(output.first { $0.id == "context" })
        let deletion = try #require(output.first { $0.id == "deletion" })
        let addition = try #require(output.first { $0.id == "addition" })
        #expect(context.spans.contains { $0.text == "import" && $0.syntax == .keyword })
        #expect(deletion.spans.contains {
            $0.text == "false" && $0.syntax == .literal && $0.emphasis == .changed
        })
        #expect(addition.spans.contains {
            $0.text == "let" && $0.syntax == .keyword && $0.emphasis == .unchanged
        })
        #expect(addition.spans.contains {
            $0.text == "true" && $0.syntax == .literal && $0.emphasis == .changed
        })
        #expect(addition.spans.contains {
            $0.text == "// changed" && $0.syntax == .comment
        })
        #expect(addition.text == text)
    }

    @Test(
        "Unknown and binary diffs keep plain text and word emphasis",
        .bug("https://github.com/saphid/t3code-personal/issues/163")
    )
    func unsupportedContentFallsBackToPlainText() {
        let changed = FeatureDiffLine(
            id: "changed",
            kind: .addition,
            newLine: 1,
            text: "before after",
            spans: [
                .init(text: "before ", kind: .unchanged),
                .init(text: "after", kind: .changed),
            ]
        )

        for file in [
            FeatureReviewFile(
                path: "notes/README",
                change: .modified,
                additions: 1,
                deletions: 0,
                lines: [changed]
            ),
            FeatureReviewFile(
                path: "Sources/App.swift",
                change: .binary,
                additions: 0,
                deletions: 0,
                lines: [changed]
            ),
        ] {
            let line = FeatureDiffSyntaxHighlighter.lines(for: file)[0]
            #expect(line.text == "before after")
            #expect(line.spans.allSatisfy { $0.syntax == .plain })
            #expect(line.spans.last?.emphasis == .changed)
        }
    }

    @Test(
        "Highlighter safety limits fall back without changing text",
        .bug("https://github.com/saphid/t3code-personal/issues/163")
    )
    func safetyLimitsPreservePlainText() {
        let longText = String(repeating: "let value = 42; ", count: 2_100)
        let longLine = FeatureDiffLine(
            id: "long",
            kind: .addition,
            newLine: 1,
            text: longText
        )
        let longOutput = FeatureDiffSyntaxHighlighter.lines(
            for: FeatureReviewFile(
                path: "App.swift",
                change: .added,
                additions: 1,
                deletions: 0,
                lines: [longLine]
            )
        )[0]

        #expect(longText.utf8.count > 32 * 1_024)
        #expect(longOutput.text == longText)
        #expect(longOutput.spans == [
            FeatureDiffSyntaxSpan(text: longText, syntax: .plain, emphasis: .unchanged),
        ])

        let chunk = String(repeating: "let value = 42; ", count: 1_000)
        let manyLines = (0 ..< 36).map { index in
            FeatureDiffLine(
                id: "line-\(index)",
                kind: .context,
                oldLine: index + 1,
                newLine: index + 1,
                text: chunk
            )
        }
        let largeOutput = FeatureDiffSyntaxHighlighter.lines(
            for: FeatureReviewFile(
                path: "App.swift",
                change: .modified,
                additions: 0,
                deletions: 0,
                lines: manyLines
            )
        )

        #expect(manyLines.map(\.text).joined(separator: "\n").utf8.count > 512 * 1_024)
        #expect(largeOutput.map(\.text) == manyLines.map(\.text))
        #expect(largeOutput.flatMap(\.spans).allSatisfy { $0.syntax == .plain })
    }

    @Test(
        "Mixed Unicode diff content is preserved exactly",
        .bug("https://github.com/saphid/t3code-personal/issues/163")
    )
    func preservesExactText() {
        let source = #"let café = "👩🏽‍💻" // naïve 🌱"#
        let line = FeatureDiffLine(
            id: "unicode",
            kind: .addition,
            newLine: 1,
            text: source,
            spans: [
                .init(text: #"let café = ""#, kind: .unchanged),
                .init(text: #"👩🏽‍💻"#, kind: .changed),
                .init(text: " // naïve 🌱", kind: .unchanged),
            ]
        )

        let output = FeatureDiffSyntaxHighlighter.lines(
            for: FeatureReviewFile(
                path: "Unicode.swift",
                change: .added,
                additions: 1,
                deletions: 0,
                lines: [line]
            )
        )[0]

        #expect(output.text == source)
        #expect(output.spans.map(\.text).joined() == source)
    }
}
