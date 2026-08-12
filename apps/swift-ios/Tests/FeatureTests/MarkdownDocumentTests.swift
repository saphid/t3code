import Foundation
import Testing
import UIKit
@testable import T3Code

@Suite("Chat Markdown")
struct MarkdownDocumentTests {
    @Test
    func parsesStandaloneImagesWithoutChangingMixedProse() {
        let document = MarkdownDocument(
            parsing: """
            Before

            ![Simulator preview](./artifacts/demo.png "Latest run")

            See ![small preview](inline.png) above.
            """
        )

        #expect(document.blocks == [
            .paragraph("Before"),
            .image(MarkdownImageReference(
                source: "./artifacts/demo.png",
                alt: "Simulator preview"
            )),
            .paragraph("See ![small preview](inline.png) above."),
        ])
    }

    @Test
    func keepsMultilineAndMalformedImageParagraphsAsText() {
        #expect(
            MarkdownDocument(parsing: "![Preview](demo.png)\ncontinues here").blocks == [
                .paragraph("![Preview](demo.png)\ncontinues here"),
            ]
        )
        #expect(
            MarkdownDocument(parsing: "![Preview](demo.png invalid-title)").blocks == [
                .paragraph("![Preview](demo.png invalid-title)"),
            ]
        )
    }

    @Test
    func preservesStandaloneImagesInsideListsAndQuotes() {
        let document = MarkdownDocument(
            parsing: """
            - ![List preview](images/list.png)

            > ![Quoted preview](images/quote.png)
            """
        )

        guard case let .unorderedList(items) = document.blocks.first else {
            Issue.record("Expected image in a list")
            return
        }
        #expect(items.first?.blocks == [
            .image(MarkdownImageReference(source: "images/list.png", alt: "List preview")),
        ])

        guard case let .blockquote(quote) = document.blocks.last else {
            Issue.record("Expected image in a quote")
            return
        }
        #expect(quote.blocks == [
            .image(MarkdownImageReference(source: "images/quote.png", alt: "Quoted preview")),
        ])
    }

    @Test
    func separatesHeadingsParagraphsAndListKinds() {
        let document = MarkdownDocument(
            parsing: """
            # Release notes

            Includes **important** details.

            - First
            - [x] Shipped
            - [ ] Follow up

            3. Third
            4. Fourth
            """
        )

        #expect(
            document.blocks == [
                .heading(level: 1, text: "Release notes"),
                .paragraph("Includes **important** details."),
                .unorderedList([
                    MarkdownListItem(task: nil, blocks: [.paragraph("First")]),
                    MarkdownListItem(task: .complete, blocks: [.paragraph("Shipped")]),
                    MarkdownListItem(task: .incomplete, blocks: [.paragraph("Follow up")]),
                ]),
                .orderedList(
                    start: 3,
                    items: [
                        MarkdownListItem(task: nil, blocks: [.paragraph("Third")]),
                        MarkdownListItem(task: nil, blocks: [.paragraph("Fourth")]),
                    ]
                ),
            ]
        )
    }

    @Test
    func preservesNestedStructureInsideQuotesAndLists() {
        let document = MarkdownDocument(
            parsing: """
            > ## Heads up
            > Read this first.
            >
            > - Quoted item

            - Parent
              - Nested child
            """
        )

        guard case let .blockquote(quote) = document.blocks.first else {
            Issue.record("Expected a block quote")
            return
        }
        #expect(
            quote.blocks == [
                .heading(level: 2, text: "Heads up"),
                .paragraph("Read this first."),
                .unorderedList([
                    MarkdownListItem(task: nil, blocks: [.paragraph("Quoted item")]),
                ]),
            ]
        )

        guard case let .unorderedList(items) = document.blocks.last else {
            Issue.record("Expected an unordered list")
            return
        }
        #expect(
            items == [
                MarkdownListItem(
                    task: nil,
                    blocks: [
                        .paragraph("Parent"),
                        .unorderedList([
                            MarkdownListItem(task: nil, blocks: [.paragraph("Nested child")]),
                        ]),
                    ]
                ),
            ]
        )
    }

    @Test
    func parsesTablesWithAlignmentEscapesAndNormalizedRows() {
        let document = MarkdownDocument(
            parsing: """
            | Name | Status | Notes |
            | :--- | :---: | ---: |
            | Parser | Ready | **Fast** |
            | Escaped \\| pipe | ``a|b`` | [Docs](https://example.com) |
            | Short | Row |
            | Extra | cells | stay | ignored |
            """
        )

        #expect(
            document.blocks == [
                .table(
                    MarkdownTable(
                        header: ["Name", "Status", "Notes"],
                        alignments: [.leading, .center, .trailing],
                        rows: [
                            ["Parser", "Ready", "**Fast**"],
                            ["Escaped \\| pipe", "``a|b``", "[Docs](https://example.com)"],
                            ["Short", "Row", ""],
                            ["Extra", "cells", "stay"],
                        ]
                    )
                ),
            ]
        )
    }

    @Test
    func unmatchedBacktickDoesNotHideLaterTableSeparators() {
        let document = MarkdownDocument(
            parsing: """
            Left | Middle | Right
            --- | --- | ---
            x | `y | z
            """
        )

        #expect(
            document.blocks == [
                .table(
                    MarkdownTable(
                        header: ["Left", "Middle", "Right"],
                        alignments: [.natural, .natural, .natural],
                        rows: [["x", "`y", "z"]]
                    )
                ),
            ]
        )
    }

    @Test
    func rejectsTableDelimiterCellsWithFewerThanThreeDashes() {
        let document = MarkdownDocument(
            parsing: """
            Name | Status
            -- | ---
            Parser | Ready
            """
        )

        #expect(
            document.blocks == [
                .paragraph("Name | Status\n-- | ---\nParser | Ready"),
            ]
        )
    }

    @Test
    func rendersTableCellsThroughTheInlineMarkdownCache() throws {
        let source = """
        Label | Value
        --- | ---
        **Build** | `green`
        """
        let revision = MarkdownContentRevision(source)
        let rendered = try #require(
            MarkdownRenderCache.shared.documentImmediately(for: revision)
        )
        guard case let .table(table) = rendered.blocks.first else {
            Issue.record("Expected a rendered table")
            return
        }

        #expect(String(table.header[0].attributedText.characters) == "Label")
        #expect(String(table.rows[0][0].attributedText.characters) == "Build")
        #expect(
            table.rows[0][0].attributedText.runs.contains {
                $0.inlinePresentationIntent?.contains(.stronglyEmphasized) == true
            }
        )
        #expect(
            table.rows[0][1].attributedText.runs.contains {
                $0.inlinePresentationIntent?.contains(.code) == true
            }
        )
    }

    @Test
    func fencedCodeKeepsLanguageAndContentsLiteral() {
        let document = MarkdownDocument(
            parsing: """
            ```swift
            let value = "**not emphasis**"
              print(value)
            ```
            """
        )

        #expect(
            document.blocks == [
                .codeBlock(
                    language: "swift",
                    code: "let value = \"**not emphasis**\"\n  print(value)"
                ),
            ]
        )
    }

    @Test
    func unclosedFenceConsumesTheRemainingMessage() {
        let document = MarkdownDocument(
            parsing: """
            ~~~console
            pnpm test
            no closing fence
            """
        )

        #expect(
            document.blocks == [
                .codeBlock(language: "console", code: "pnpm test\nno closing fence"),
            ]
        )
    }

    @Test
    func plaintextCodeBlocksWrapByDefault() {
        for language in ["text", "TEXT", "txt", "plaintext", "plain", "md", "markdown"] {
            #expect(MarkdownCodeBlockWrapping.wrapsByDefault(language: language))
        }

        for language in [nil, "swift", "typescript", "console"] {
            #expect(!MarkdownCodeBlockWrapping.wrapsByDefault(language: language))
        }
    }

    @Test
    func parsesSetextHeadingsAndNormalizesWindowsNewlines() {
        let document = MarkdownDocument(parsing: "Heading\r\n=======\r\n\r\nBody")

        #expect(
            document.blocks == [
                .heading(level: 1, text: "Heading"),
                .paragraph("Body"),
            ]
        )
    }

    @Test
    func inlineFormatterRetainsEmphasisCodeAndLinks() {
        let formatted = MarkdownInlineFormatter.format(
            "Use **bold**, *emphasis*, `code`, and [docs](https://example.com)."
        )
        let runs = Array(formatted.runs)

        #expect(String(formatted.characters) == "Use bold, emphasis, code, and docs.")
        #expect(runs.contains { $0.inlinePresentationIntent?.contains(.stronglyEmphasized) == true })
        #expect(runs.contains { $0.inlinePresentationIntent?.contains(.emphasized) == true })
        #expect(runs.contains { $0.inlinePresentationIntent?.contains(.code) == true })
        #expect(runs.contains { $0.link == URL(string: "https://example.com") })
    }

    @Test
    func externalMarkdownLinksAllowOnlyCredentialFreeWebURLs() throws {
        let web = try #require(URL(string: "https://example.com/docs"))
        let localHTTP = try #require(URL(string: "HTTP://127.0.0.1:45678/docs"))
        let shortcut = try #require(URL(string: "shortcuts://run-shortcut?name=Unsafe"))
        let credentialed = try #require(URL(string: "https://token@example.com/docs"))

        #expect(MarkdownExternalLink.safeURL(web) == web)
        #expect(MarkdownExternalLink.safeURL(localHTTP) == localHTTP)
        #expect(MarkdownExternalLink.safeURL(shortcut) == nil)
        #expect(MarkdownExternalLink.safeURL(credentialed) == nil)
    }

    @Test @MainActor
    func selectableTextAttributesPreserveInlineFormatting() throws {
        let revision = MarkdownContentRevision(
            "Use **bold**, *emphasis*, `code`, ~~removed~~, and [docs](https://example.com)."
        )
        let document = try #require(
            MarkdownRenderCache.shared.documentImmediately(for: revision)
        )
        guard case let .paragraph(inline) = document.blocks.first else {
            Issue.record("Expected a rendered paragraph")
            return
        }

        let attributed = MarkdownSelectableTextAttributes.make(
            from: inline,
            lineSpacing: 4,
            foregroundColor: T3Colors.uiTextSecondary
        )
        let text = attributed.string as NSString
        let boldIndex = try #require(index(of: "bold", in: text))
        let emphasisIndex = try #require(index(of: "emphasis", in: text))
        let codeIndex = try #require(index(of: "code", in: text))
        let removedIndex = try #require(index(of: "removed", in: text))
        let linkIndex = try #require(index(of: "docs", in: text))

        let boldFont = try #require(
            attributed.attribute(.font, at: boldIndex, effectiveRange: nil) as? UIFont
        )
        let emphasisFont = try #require(
            attributed.attribute(.font, at: emphasisIndex, effectiveRange: nil) as? UIFont
        )
        let codeFont = try #require(
            attributed.attribute(.font, at: codeIndex, effectiveRange: nil) as? UIFont
        )
        let paragraphStyle = try #require(
            attributed.attribute(.paragraphStyle, at: 0, effectiveRange: nil)
                as? NSParagraphStyle
        )

        #expect(boldFont.fontDescriptor.symbolicTraits.contains(.traitBold))
        #expect(emphasisFont.fontDescriptor.symbolicTraits.contains(.traitItalic))
        #expect(codeFont.fontDescriptor.symbolicTraits.contains(.traitMonoSpace))
        #expect(attributed.attribute(.backgroundColor, at: codeIndex, effectiveRange: nil) != nil)
        #expect(
            attributed.attribute(.strikethroughStyle, at: removedIndex, effectiveRange: nil)
                as? Int == NSUnderlineStyle.single.rawValue
        )
        #expect(
            attributed.attribute(.foregroundColor, at: boldIndex, effectiveRange: nil)
                as? UIColor == T3Colors.uiTextSecondary
        )
        #expect(
            attributed.attribute(.link, at: linkIndex, effectiveRange: nil) as? URL
                == URL(string: "https://example.com")
        )
        #expect(
            attributed.string
                == "Use bold, emphasis, code, removed, and docs."
        )
        #expect(paragraphStyle.lineSpacing == 4)
    }

    @Test @MainActor
    func selectableDocumentJoinsParagraphsAndListsIntoOneTextRange() throws {
        let document = try #require(
            MarkdownRenderCache.shared.documentImmediately(
                for: MarkdownContentRevision(
                    "Text above the list.\n\n- First point\n- Second point\n\nText below."
                )
            )
        )

        let attributed = MarkdownSelectableDocumentAttributes.make(from: document.blocks)

        #expect(
            attributed.string
                == "Text above the list.\n•\tFirst point\n•\tSecond point\nText below."
        )
        #expect((attributed.string as NSString).range(of: "Text above").location == 0)
        #expect((attributed.string as NSString).range(of: "Second point").location > 0)
        let firstMarker = (attributed.string as NSString).range(of: "•").location
        let listStyle = try #require(
            attributed.attribute(.paragraphStyle, at: firstMarker, effectiveRange: nil)
                as? NSParagraphStyle
        )
        #expect(listStyle.headIndent >= 32)
        #expect(listStyle.lineSpacing == 4)
        #expect(listStyle.tabStops.first?.location == listStyle.headIndent)
    }

    @Test @MainActor
    func selectableDocumentPreservesNestedListIndentation() throws {
        let document = try #require(
            MarkdownRenderCache.shared.documentImmediately(
                for: MarkdownContentRevision(
                    "- A long first item that can wrap onto another visual line\n  - Nested point"
                )
            )
        )
        let attributed = MarkdownSelectableDocumentAttributes.make(from: document.blocks)
        let markers = (attributed.string as NSString).ranges(of: "•")
        #expect(markers.count == 2)
        let outer = try #require(
            attributed.attribute(.paragraphStyle, at: markers[0].location, effectiveRange: nil)
                as? NSParagraphStyle
        )
        let nested = try #require(
            attributed.attribute(.paragraphStyle, at: markers[1].location, effectiveRange: nil)
                as? NSParagraphStyle
        )
        #expect(outer.headIndent >= 32)
        #expect(nested.headIndent == outer.headIndent * 2)
        #expect(nested.firstLineHeadIndent == outer.headIndent)
        #expect(
            nested.headIndent.truncatingRemainder(dividingBy: nested.defaultTabInterval) == 0
        )
    }

    @Test @MainActor
    func selectableDocumentIndentsEveryParagraphInAListItem() throws {
        let document = try #require(
            MarkdownRenderCache.shared.documentImmediately(
                for: MarkdownContentRevision(
                    "- First point\n\n  Continued detail.\n- Second point"
                )
            )
        )
        let attributed = MarkdownSelectableDocumentAttributes.make(from: document.blocks)
        let continued = (attributed.string as NSString).range(of: "Continued detail").location
        let style = try #require(
            attributed.attribute(.paragraphStyle, at: continued, effectiveRange: nil)
                as? NSParagraphStyle
        )

        #expect(style.headIndent >= 32)
        #expect(style.firstLineHeadIndent == style.headIndent)
        #expect(style.lineSpacing == 4)
    }

    @Test @MainActor
    func selectableDocumentLeavesRoomForTwoDigitOrderedMarkers() throws {
        let document = try #require(
            MarkdownRenderCache.shared.documentImmediately(
                for: MarkdownContentRevision("10. Tenth point\n11. Eleventh point")
            )
        )
        let attributed = MarkdownSelectableDocumentAttributes.make(from: document.blocks)
        let markerRange = (attributed.string as NSString).range(of: "10.")
        let font = try #require(
            attributed.attribute(.font, at: markerRange.location, effectiveRange: nil) as? UIFont
        )
        let style = try #require(
            attributed.attribute(.paragraphStyle, at: markerRange.location, effectiveRange: nil)
                as? NSParagraphStyle
        )
        let markerWidth = ("10." as NSString).size(withAttributes: [.font: font]).width

        #expect(style.headIndent > markerWidth)
        #expect(style.defaultTabInterval == style.headIndent)
    }

    @Test @MainActor
    func selectableDocumentScalesOrderedListIndentForAccessibilityText() throws {
        let document = try #require(
            MarkdownRenderCache.shared.documentImmediately(
                for: MarkdownContentRevision("10. Tenth point")
            )
        )
        let attributed = MarkdownSelectableDocumentAttributes.make(
            from: document.blocks,
            dynamicTypeSize: .accessibility3
        )
        let markerRange = (attributed.string as NSString).range(of: "10.")
        let font = try #require(
            attributed.attribute(.font, at: markerRange.location, effectiveRange: nil) as? UIFont
        )
        let style = try #require(
            attributed.attribute(.paragraphStyle, at: markerRange.location, effectiveRange: nil)
                as? NSParagraphStyle
        )
        let markerWidth = ("10." as NSString).size(withAttributes: [.font: font]).width

        #expect(font.pointSize > 17)
        #expect(style.headIndent > 32)
        #expect(style.headIndent > markerWidth)
    }

    @Test @MainActor
    func selectableDocumentCacheKeysEveryRenderingInput() throws {
        let document = try #require(
            MarkdownRenderCache.shared.documentImmediately(
                for: MarkdownContentRevision("Cached paragraph")
            )
        )
        let cache = MarkdownSelectableDocumentCache()
        let first = MarkdownSelectableDocumentAttributes.make(
            from: document.blocks,
            cache: cache
        )
        let repeated = MarkdownSelectableDocumentAttributes.make(
            from: document.blocks,
            cache: cache
        )
        let larger = MarkdownSelectableDocumentAttributes.make(
            from: document.blocks,
            dynamicTypeSize: .accessibility3,
            cache: cache
        )
        let widerSpacing = MarkdownSelectableDocumentAttributes.make(
            from: document.blocks,
            blockSpacing: 20,
            cache: cache
        )

        #expect(first === repeated)
        #expect(first !== larger)
        #expect(first !== widerSpacing)
        cache.retain(
            blockSets: [document.blocks],
            textColor: T3Colors.uiTextPrimary,
            dynamicTypeSize: .large,
            blockSpacing: 12
        )
        let retained = MarkdownSelectableDocumentAttributes.make(
            from: document.blocks,
            cache: cache
        )
        #expect(first === retained)
        let largerAfterPrune = MarkdownSelectableDocumentAttributes.make(
            from: document.blocks,
            dynamicTypeSize: .accessibility3,
            cache: cache
        )
        #expect(larger !== largerAfterPrune)
        cache.retain(
            blockSets: [],
            textColor: T3Colors.uiTextPrimary,
            dynamicTypeSize: .large,
            blockSpacing: 12
        )
        let afterRecycle = MarkdownSelectableDocumentAttributes.make(
            from: document.blocks,
            cache: cache
        )
        #expect(first !== afterRecycle)
    }

    @Test @MainActor
    func taskListsStayOnTheRichRenderingPath() throws {
        let document = try #require(
            MarkdownRenderCache.shared.documentImmediately(
                for: MarkdownContentRevision("- [x] Completed\n- [ ] Pending")
            )
        )
        let segments = MarkdownSelectableDocumentAttributes.segments(in: document.blocks)

        #expect(segments.count == 1)
        guard case .rich = segments[0] else {
            Issue.record("Task lists must preserve native checkbox rendering")
            return
        }
    }

    @Test @MainActor
    func selectableDocumentSegmentsAroundRichBlockSurfaces() throws {
        let document = try #require(
            MarkdownRenderCache.shared.documentImmediately(
                for: MarkdownContentRevision(
                    "Before\n\n- First\n- Second\n\n```swift\nlet value = 1\n```\n\nAfter"
                )
            )
        )
        let segments = MarkdownSelectableDocumentAttributes.segments(in: document.blocks)

        #expect(segments.count == 3)
        guard case let .selectable(leading) = segments[0],
            case .rich = segments[1],
            case let .selectable(trailing) = segments[2]
        else {
            Issue.record("Expected selectable text on each side of the code block")
            return
        }
        #expect(MarkdownSelectableDocumentAttributes.make(from: leading).string.contains("Second"))
        #expect(MarkdownSelectableDocumentAttributes.make(from: trailing).string == "After")
    }

    @Test @MainActor
    func codeBlocksReuseSelectableInlineRendering() throws {
        let literalCode = "x = arr[i](fn)\na **b** c\nprintf(\\\"a\\\\tb\\\");"
        let cache = MarkdownRenderCache()
        let first = try #require(
            cache.documentImmediately(
                for: MarkdownContentRevision("```swift\n\(literalCode)\n```")
            )
        )
        let second = try #require(
            cache.documentImmediately(
                for: MarkdownContentRevision("Before\n\n```swift\n\(literalCode)\n```")
            )
        )

        guard case let .codeBlock(_, firstCode, firstInline) = first.blocks.first,
            case let .codeBlock(_, secondCode, secondInline) = second.blocks.last
        else {
            Issue.record("Expected rendered code blocks")
            return
        }

        #expect(firstCode == literalCode)
        #expect(secondCode == firstCode)
        #expect(firstInline === secondInline)
        #expect(firstInline.style == .code)

        let attributed = MarkdownSelectableTextAttributes.make(
            from: firstInline,
            lineSpacing: 3
        )
        let font = try #require(
            attributed.attribute(.font, at: 0, effectiveRange: nil) as? UIFont
        )
        #expect(attributed.string == firstCode)
        #expect(font.fontDescriptor.symbolicTraits.contains(.traitMonoSpace))
    }

    @Test
    func restoresSelectionOnlyWhenTextIsExtended() {
        let selection = NSRange(location: 7, length: 5)

        #expect(
            MarkdownSelectionRestoration.range(
                previousText: "Hello, world",
                previousRange: selection,
                newText: "Hello, world!"
            ) == selection
        )
        #expect(
            MarkdownSelectionRestoration.range(
                previousText: "Hello, world",
                previousRange: selection,
                newText: "Different text"
            ) == NSRange(location: 0, length: 0)
        )
        #expect(
            MarkdownSelectionRestoration.range(
                previousText: "Hello, world",
                previousRange: NSRange(location: 7, length: 20),
                newText: "Hello, world!"
            ) == NSRange(location: 0, length: 0)
        )
    }

    private func index(of substring: String, in text: NSString) -> Int? {
        let range = text.range(of: substring)
        return range.location == NSNotFound ? nil : range.location
    }
}

private extension NSString {
    func ranges(of substring: String) -> [NSRange] {
        var result: [NSRange] = []
        var search = NSRange(location: 0, length: length)
        while search.length > 0 {
            let found = range(of: substring, options: [], range: search)
            guard found.location != NSNotFound else { break }
            result.append(found)
            let next = NSMaxRange(found)
            search = NSRange(location: next, length: length - next)
        }
        return result
    }
}
