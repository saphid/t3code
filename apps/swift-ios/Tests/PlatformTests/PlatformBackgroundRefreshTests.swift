import Foundation
import Testing
@testable import T3Code

@Suite("Background refresh")
struct PlatformBackgroundRefreshTests {
    @Test
    @MainActor
    func usesThePermittedIdentifierAndAConservativeRetryWindow() {
        #expect(
            PlatformBackgroundRefreshCoordinator.identifier
                == "\(Bundle.main.bundleIdentifier ?? "com.alxs.t3code.typed-swiftui").refresh"
        )
        #expect(PlatformBackgroundRefreshPolicy.minimumDelay == 15 * 60)
    }
}
