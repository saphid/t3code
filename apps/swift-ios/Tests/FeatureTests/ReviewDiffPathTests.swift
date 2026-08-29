import Foundation
import Testing
@testable import T3Code

@Suite("Review diff paths")
struct ReviewDiffPathTests {
    struct HeaderCase: Sendable {
        let line: String
        let expectedPath: String
    }

    @Test(
        "Decodes ordinary, mnemonic, no-prefix, quoted, and Windows-style headers",
        .bug("https://github.com/saphid/t3code-personal/issues/180"),
        arguments: [
            HeaderCase(
                line: "diff --git a/Sources/App.swift b/Sources/App.swift",
                expectedPath: "Sources/App.swift"
            ),
            HeaderCase(
                line: "diff --git c/Sources/App.swift w/Sources/App.swift",
                expectedPath: "Sources/App.swift"
            ),
            HeaderCase(
                line: "diff --git Sources/App.swift Sources/App.swift",
                expectedPath: "Sources/App.swift"
            ),
            HeaderCase(
                line: #"diff --git "a/Sources/My File.swift" "b/Sources/My File.swift""#,
                expectedPath: "Sources/My File.swift"
            ),
            HeaderCase(
                line: #"diff --git "a/Sources/caf\303\251.swift" "b/Sources/caf\303\251.swift""#,
                expectedPath: "Sources/café.swift"
            ),
            HeaderCase(
                line: #"diff --git a\Sources\App.swift b\Sources\App.swift"#,
                expectedPath: "Sources/App.swift"
            ),
        ]
    )
    func decodesSupportedHeaders(testCase: HeaderCase) {
        let header = GitDiffPathParser.header(testCase.line)

        #expect(header.displayPath == testCase.expectedPath)
        #expect(header.newPath == testCase.expectedPath)
        #expect(header.oldPath == testCase.expectedPath)
    }

    @Test("Rename, copy, add, delete, and binary metadata keep safe workspace paths")
    func mapsFileChangePaths() {
        let review = NativeWorkspaceMapper.review(
            preview(
                """
                diff --git "a/Old Name.swift" "b/New Name.swift"
                similarity index 100%
                rename from Old Name.swift
                rename to New Name.swift
                diff --git a/Template.swift b/Copied.swift
                similarity index 100%
                copy from Template.swift
                copy to Copied.swift
                diff --git a/Added.swift b/Added.swift
                new file mode 100644
                --- /dev/null
                +++ b/Added.swift
                @@ -0,0 +1 @@
                +new
                diff --git a/Deleted.swift b/Deleted.swift
                deleted file mode 100644
                --- a/Deleted.swift
                +++ /dev/null
                @@ -1 +0,0 @@
                -old
                diff --git a/Assets/logo.png b/Assets/logo.png
                Binary files a/Assets/logo.png and b/Assets/logo.png differ
                """
            ))

        #expect(review.files.map(\.path) == [
            "New Name.swift", "Copied.swift", "Added.swift", "Deleted.swift", "Assets/logo.png",
        ])
        #expect(
            review.files.map(\.previousPath) == [
                "Old Name.swift", "Template.swift", nil, "Deleted.swift", "Assets/logo.png",
            ])
        #expect(review.files.map(\.change) == [.renamed, .renamed, .added, .deleted, .binary])
        #expect(review.files.allSatisfy(\.isPathResolved))
    }

    @Test("Malformed and unsafe headers remain visible but cannot open a file")
    func rejectsMalformedAndUnsafePaths() {
        let review = NativeWorkspaceMapper.review(
            preview(
                """
                diff --git only-one-path
                @@ -1 +1 @@
                -old
                +new
                diff --git a/ok.swift b/../../outside.swift
                @@ -1 +1 @@
                -old
                +new
                """
            ))

        #expect(review.files.map(\.path) == ["only-one-path", "../../outside.swift"])
        #expect(review.files.allSatisfy { $0.isPathResolved == false })
        #expect(GitDiffPathParser.marker("wrong/App.swift", expectedPrefix: "b/").workspacePath == nil)
    }

    @Test("Pull request rows use the same path rules")
    func pullRequestParserUsesSharedPathRules() {
        let files = PullRequestDiffParser.parse(
            """
            diff --git c/Sources/App.swift w/Sources/App.swift
            --- c/Sources/App.swift
            +++ w/Sources/App.swift
            @@ -1 +1 @@
            -old
            +new
            diff --git Before.swift After.swift
            similarity index 100%
            copy from Before.swift
            copy to After.swift
            diff --git Assets/logo.png Assets/logo.png
            Binary files Assets/logo.png and Assets/logo.png differ
            diff --git malformed
            """
        )

        #expect(
            files.map(\.path) == [
                "Sources/App.swift", "After.swift", "Assets/logo.png", "malformed",
            ])
        #expect(
            files.map(\.oldPath) == [
                "Sources/App.swift", "Before.swift", "Assets/logo.png", nil,
            ])
        #expect(files.map(\.isPathResolved) == [true, true, true, false])
    }

    @Test("File targets retain their environment-scoped thread identity")
    func fileTargetsStayEnvironmentScoped() throws {
        let file = FeatureReviewFile(
            path: "Sources/App.swift",
            previousPath: "Sources/App.swift",
            change: .modified,
            additions: 1,
            deletions: 1
        )
        let local = try #require(
            FeatureReviewFileLoader.target(
                threadID: "local:thread-42",
                file: file
            ))
        let relay = try #require(
            FeatureReviewFileLoader.target(
                threadID: "relay:thread-42",
                file: file
            ))

        #expect(local.path == relay.path)
        #expect(local.threadID == "local:thread-42")
        #expect(relay.threadID == "relay:thread-42")
        #expect(local != relay)
        #expect(
            FeatureReviewFileLoader.target(
                threadID: "tunnel:thread-42",
                file: FeatureReviewFile(
                    path: "../../outside.swift",
                    change: .modified,
                    additions: 1,
                    deletions: 1,
                    isPathResolved: false
                )
            ) == nil
        )
    }

    @Test("Saved review files without path state remain openable")
    func decodesLegacyReviewFiles() throws {
        let file = try JSONDecoder().decode(
            FeatureReviewFile.self,
            from: Data(
                #"{"path":"Sources/App.swift","previousPath":null,"change":"modified","additions":1,"deletions":1,"lines":[],"sourceKind":null,"sourceBaseReference":null,"sourceHeadReference":null}"#.utf8
            )
        )

        #expect(file.isPathResolved)
    }

    private func preview(_ diff: String) -> ReviewDiffPreview {
        ReviewDiffPreview(
            cwd: "/workspace",
            generatedAt: "2026-08-29T00:00:00Z",
            sources: [
                ReviewDiffSource(
                    id: "working-tree",
                    kind: "working-tree",
                    title: "Working tree",
                    baseRef: "main",
                    headRef: nil,
                    diff: diff,
                    diffHash: "hash",
                    truncated: false
                )
            ]
        )
    }
}
