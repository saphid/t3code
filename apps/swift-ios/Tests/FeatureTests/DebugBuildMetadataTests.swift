import Foundation
import Testing
@testable import T3Code

@Suite("Debug build metadata")
struct DebugBuildMetadataTests {
    @Test
    func presentsCompleteBuildDistance() {
        let metadata = DebugBuildMetadata(info: [
            "CFBundleVersion": "456",
            "T3GitBaseRef": "upstream/t3code/rebuild-mobile-app-swift",
            "T3GitAheadCount": "2",
            "T3GitBehindCount": "3",
        ])

        #expect(metadata.build == "456")
        #expect(metadata.distanceLabel == "2↑ 3↓ rebuild-mobile-app-swift")
        #expect(
            metadata.accessibilityLabel
                == "Development build 456, compared with upstream/t3code/rebuild-mobile-app-swift: 2 commits ahead and 3 commits behind"
        )
    }

    @Test
    func omitsInvalidOrIncompleteMetadata() {
        let metadata = DebugBuildMetadata(info: [
            "T3GitAheadCount": "-1",
            "T3GitBehindCount": "not-a-number",
        ])

        #expect(metadata.build == "?")
        #expect(metadata.distanceLabel == nil)
        #expect(metadata.accessibilityLabel == "Development build ?")
    }

    @Test
    func ignoresUnexpandedBuildSettingsAndIncompleteDistance() {
        let metadata = DebugBuildMetadata(info: [
            "CFBundleVersion": "$(CURRENT_PROJECT_VERSION)",
            "T3GitBaseRef": "upstream/main",
            "T3GitAheadCount": "1",
        ])

        #expect(metadata.build == "?")
        #expect(metadata.distanceLabel == nil)
    }
}
