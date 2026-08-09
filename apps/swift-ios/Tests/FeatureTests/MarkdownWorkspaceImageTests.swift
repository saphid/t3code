import Foundation
import Testing
@testable import T3Code

@Suite("Markdown workspace images")
struct MarkdownWorkspaceImageTests {
    @Test
    func resolvesImageSourcesThroughWorkspaceFileLinks() throws {
        let relative = try #require(MarkdownWorkspaceImage(
            source: "./artifacts/demo%20image.png?download=1",
            workspaceRoot: "/repo"
        ))
        #expect(relative.link.path == "artifacts/demo image.png")

        let absolute = try #require(MarkdownWorkspaceImage(
            source: "/repo/artifacts/demo.png",
            workspaceRoot: "/repo"
        ))
        #expect(absolute.link.path == "artifacts/demo.png")
    }

    @Test
    func rejectsExternalEscapingAndNonImageSources() {
        #expect(MarkdownWorkspaceImage(
            source: "https://example.com/demo.png",
            workspaceRoot: "/repo"
        ) == nil)
        #expect(MarkdownWorkspaceImage(
            source: "../outside.png",
            workspaceRoot: "/repo"
        ) == nil)
        #expect(MarkdownWorkspaceImage(
            source: "recordings/demo.mp4",
            workspaceRoot: "/repo"
        ) == nil)
    }
}
