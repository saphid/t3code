import Foundation
import Testing
@testable import T3Code

@Suite("Debug build metadata")
struct DebugBuildMetadataTests {
    @Test
    func presentsCompletePublicBuildDistance() {
        let metadata = DebugBuildMetadata(info: [
            "T3GitCommit": "abc123-dirty",
            "T3GitRepoURL": "https://github.com/pingdotgg/t3code",
            "T3GitBaseRef": "upstream/t3code/rebuild-mobile-app-swift",
            "T3GitAheadCount": "2",
            "T3GitBehindCount": "3",
        ])

        #expect(metadata.sourceLabel == "abc123-dirty")
        #expect(metadata.distanceLabel == "2↑ 3↓ rebuild-mobile-app-swift")
        #expect(
            metadata.accessibilityLabel
                == "Development source abc123-dirty, compared with upstream/t3code/rebuild-mobile-app-swift: 2 commits ahead and 3 commits behind."
        )
        #expect(
            metadata.commitURL?.absoluteString
                == "https://github.com/pingdotgg/t3code/commit/abc123"
        )
    }

    @Test
    func reportsUnavailableMetadataWithoutInventingDistance() {
        let metadata = DebugBuildMetadata(info: [
            "T3GitRepoURL": "https://private.example/repo",
            "T3GitAheadCount": "-1",
            "T3GitBehindCount": "not-a-number",
        ])

        #expect(metadata.sourceLabel == "Unknown")
        #expect(metadata.distanceLabel == "Unknown")
        #expect(metadata.commitURL == nil)
        #expect(
            metadata.accessibilityLabel
                == "Development source Unknown. Upstream comparison unavailable."
        )
    }

    @Test
    func distinguishesKnownBaseWithUnavailableHistory() {
        let metadata = DebugBuildMetadata(info: [
            "T3GitCommit": "abc123",
            "T3GitBaseRef": "upstream/main",
            "T3GitAheadCount": "$(T3_GIT_AHEAD_COUNT)",
        ])

        #expect(metadata.distanceLabel == "Unknown · main")
        #expect(
            metadata.accessibilityLabel
                == "Development source abc123. Comparison with upstream/main unavailable."
        )
    }

    @Test
    func describesSingularDistance() {
        let metadata = DebugBuildMetadata(info: [
            "T3GitBaseRef": "upstream/main",
            "T3GitAheadCount": "1",
            "T3GitBehindCount": "1",
        ])

        #expect(
            metadata.accessibilityLabel
                == "Development source Unknown, compared with upstream/main: 1 commit ahead and 1 commit behind."
        )
    }
}
