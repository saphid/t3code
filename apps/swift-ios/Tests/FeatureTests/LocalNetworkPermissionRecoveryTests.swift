import Testing
@testable import T3Code

@Suite("Local Network permission recovery")
struct LocalNetworkPermissionRecoveryTests {
    private let action = "pair http://192.168.1.42:3773"

    @Test
    func retriesWhenPermissionResultArrivesAfterTheAppReactivates() {
        var recovery = LocalNetworkPermissionRecovery<String>()

        recovery.begin(action)
        recovery.applicationBecameInactive()
        #expect(recovery.applicationBecameActive() == nil)

        #expect(recovery.permissionWasDenied() == action)
    }

    @Test
    func retriesWhenTheAppReactivatesAfterPermissionDenial() {
        var recovery = LocalNetworkPermissionRecovery<String>()

        recovery.begin(action)
        recovery.applicationBecameInactive()
        #expect(recovery.permissionWasDenied() == nil)

        #expect(recovery.applicationBecameActive() == action)
    }

    @Test
    func aRetryThatIsStillDeniedWaitsForANewInactiveCycle() {
        var recovery = LocalNetworkPermissionRecovery<String>()

        recovery.begin(action)
        recovery.applicationBecameInactive()
        _ = recovery.applicationBecameActive()
        #expect(recovery.permissionWasDenied() == action)

        recovery.begin(action)
        #expect(recovery.permissionWasDenied() == nil)
        #expect(recovery.applicationBecameActive() == nil)

        recovery.applicationBecameInactive()
        #expect(recovery.applicationBecameActive() == action)
    }

    @Test
    func duplicateActiveEventsDoNotRetryTwice() {
        var recovery = LocalNetworkPermissionRecovery<String>()

        recovery.begin(action)
        recovery.applicationBecameInactive()
        #expect(recovery.permissionWasDenied() == nil)
        #expect(recovery.applicationBecameActive() == action)

        #expect(recovery.applicationBecameActive() == nil)
    }

    @Test
    func ordinaryFailureDoesNotArmPermissionRecovery() {
        var recovery = LocalNetworkPermissionRecovery<String>()

        recovery.begin(action)
        recovery.applicationBecameInactive()
        recovery.finish()

        #expect(recovery.applicationBecameActive() == nil)
    }

    @Test
    func cancellationClearsPermissionRecovery() {
        var recovery = LocalNetworkPermissionRecovery<String>()

        recovery.begin(action)
        recovery.applicationBecameInactive()
        #expect(recovery.permissionWasDenied() == nil)
        recovery.cancel()

        #expect(recovery.applicationBecameActive() == nil)
    }
}
