import Foundation
import Testing
@testable import T3Code

@Suite("Visualization links")
struct CodexVisualizationTests {
    private let marker = "\u{E200}visualize\u{E202}{\"path\":\"/work/study.html\"}\u{E201}"

    @Test func exactMarkerBecomesActionableLinkInDocument() throws {
        let link = try #require(CodexVisualizationLink(path: "/work/study.html")?.url)
        #expect(MarkdownDocument(parsing: "Before \(marker) after.").blocks == [
            .paragraph("Before [Open visualization file](<\(link.absoluteString)>) after."),
        ])
    }

    @Test func streamingPartialAndMalformedMarkersStayLiteral() {
        for source in [String(marker.dropLast()), "\u{E200}visualize\u{E202}{broken}\u{E201}",
                       "\u{E200}visualize\u{E202}{\"path\":4}\u{E201}",
                       "\u{E200}visualize\u{E202}{\"path\":\"https://host/study.html\"}\u{E201}"] {
            #expect(MarkdownDocument(parsing: source).blocks == [.paragraph(source)])
        }
    }

    @Test func fencedIndentedAndInlineCodeRemainLiteral() {
        #expect(MarkdownDocument(parsing: "```text\n\(marker)\n```").blocks == [
            .codeBlock(language: "text", code: marker),
        ])
        #expect(MarkdownDocument(parsing: "    \(marker)").blocks == [
            .paragraph("    \(marker)"),
        ])
        #expect(MarkdownDocument(parsing: "`\(marker)`").blocks == [.paragraph("`\(marker)`")])
        #expect(MarkdownDocument(parsing: "> ```\n> \(marker)\n> ```").blocks == [
            .blockquote(MarkdownDocument(parsing: "```\n\(marker)\n```")),
        ])
    }

    @Test func citationAndMultipleVisualizationsCoexist() {
        let citation = #":codex-file-citation{path="src/main.swift" line_range_start="12"}"#
        let document = MarkdownDocument(parsing: "\(marker)\n\(citation)\n\(marker)")
        guard case let .paragraph(text) = document.blocks.first else {
            Issue.record("Expected a paragraph"); return
        }
        #expect(text.components(separatedBy: "Open visualization file").count == 3)
        #expect(text.contains("[main.swift](<src/main.swift#L12>)"))
        #expect(!text.contains("\u{E200}"))
    }

    @Test func optionalHostMetadataAndJSONWhitespaceAreAccepted() throws {
        let source = "\u{E200}visualize\u{E202}{\n\"path\":\"/work/study.html\",\"mode\":\"wide\",\"title\":\"Study\"}\u{E201}"
        let document = MarkdownDocument(parsing: source)
        guard case let .paragraph(text) = document.blocks.first else {
            Issue.record("Expected a paragraph"); return
        }
        #expect(text.contains("Open visualization file"))
        #expect(!text.contains("\u{E200}"))
    }

    @Test func hostPathsRoundTripWithoutBecomingClientFileURLs() throws {
        for path in ["/work/study #1?.html", "artifacts/日本語.html", "C:\\work\\study.html", "\\\\host\\share\\study.htm"] {
            let link = try #require(CodexVisualizationLink(path: path))
            let url = try #require(link.url)
            #expect(url.scheme == "t3code")
            #expect(CodexVisualizationLink.parse(url)?.path == path)
        }
    }

    @Test func unsupportedRoutesAndSchemesAreRejected() {
        for path in ["", "/work/readme.md", "javascript:study.html", "data:text/html,study.html", "file:///study.html", "/work/a\nstudy.html"] {
            #expect(CodexVisualizationLink(path: path) == nil)
        }
        for raw in ["t3code://visualization/open?path=/a.html&path=/b.html", "t3code://user@visualization/open?path=/a.html", "t3code://visualization/open?path=/a.html#fragment"] {
            #expect(CodexVisualizationLink.parse(URL(string: raw)!) == nil)
        }
        #expect(CodexVisualizationLink.isBrowserURL(URL(string: "https://host/api/assets/signed")!))
        #expect(!CodexVisualizationLink.isBrowserURL(URL(string: "file:///private/study.html")!))
        #expect(!CodexVisualizationLink.isBrowserURL(URL(string: "javascript:alert(1)")!))
    }

    @Test func resolutionPreservesOwningThreadPathAndSignedURL() async throws {
        let link = try #require(CodexVisualizationLink(path: "artifacts/study.html"))
        let signed = URL(string: "https://environment.example/api/assets/file?signature=fixture")!
        let result = try await link.resolveBrowserURL(threadID: "environment:thread") { id, path in
            #expect(id == "environment:thread")
            #expect(path == "artifacts/study.html")
            return signed
        }
        #expect(result == signed)
        await #expect(throws: URLError.self) {
            try await link.resolveBrowserURL(threadID: "environment:thread") { _, _ in
                URL(string: "file:///private/study.html")!
            }
        }
    }

    @Test @MainActor func cancelledResolutionCannotProduceDelayedBrowserURL() async throws {
        let link = try #require(CodexVisualizationLink(path: "/work/study.html"))
        let entered = AsyncStream<Void>.makeStream()
        var release: CheckedContinuation<URL, Never>?
        let task = Task {
            try await link.resolveBrowserURL(threadID: "environment:thread") { _, _ in
                await withCheckedContinuation {
                    release = $0
                    entered.continuation.yield(())
                }
            }
        }
        var starts = entered.stream.makeAsyncIterator()
        await starts.next()
        task.cancel()
        release?.resume(returning: URL(string: "https://environment.example/signed")!)
        await #expect(throws: CancellationError.self) { try await task.value }
    }
}
