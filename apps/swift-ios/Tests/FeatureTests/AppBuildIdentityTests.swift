import Testing
@testable import T3Code

@Suite("App build identity")
struct AppBuildIdentityTests {
    @Test("Dev metadata is displayed with a short source revision")
    func devIdentity() {
        let identity = AppBuildIdentity(infoDictionary: [
            "T3BuildChannel": "dev",
            "CFBundleShortVersionString": "0.1.0",
            "CFBundleVersion": "37",
            "T3GitCommit": "704e46327223e92f68803cf9095fe000885141ea",
        ])

        #expect(identity.channel == "Dev")
        #expect(identity.marketingVersion == "0.1.0")
        #expect(identity.buildNumber == "37")
        #expect(identity.sourceRevision == "704e4632")
    }

    @Test("Test metadata is normalized without changing its values")
    func testIdentity() {
        let identity = AppBuildIdentity(infoDictionary: [
            "T3BuildChannel": " Test ",
            "CFBundleShortVersionString": "1.2.3",
            "CFBundleVersion": "42",
            "T3GitCommit": "abcdef12",
        ])

        #expect(identity.channel == "Test")
        #expect(identity.marketingVersion == "1.2.3")
        #expect(identity.buildNumber == "42")
        #expect(identity.sourceRevision == "abcdef12")
    }

    @Test("An ordinary release is identified as Live")
    func liveIdentity() {
        let identity = AppBuildIdentity(infoDictionary: [
            "T3BuildChannel": "",
            "CFBundleShortVersionString": "1.0",
            "CFBundleVersion": "100",
            "T3GitCommit": "1234567890abcdef",
        ])

        #expect(identity.channel == "Live")
        #expect(identity.sourceRevision == "12345678")
    }

    @Test("Missing metadata is explicit")
    func missingIdentity() {
        let identity = AppBuildIdentity(infoDictionary: [:])

        #expect(identity.channel == "Live")
        #expect(identity.marketingVersion == "Unknown")
        #expect(identity.buildNumber == "Unknown")
        #expect(identity.sourceRevision == "Unknown")
    }

    @Test("Unexpanded build settings are never shown as identity values")
    func unexpandedIdentity() {
        let identity = AppBuildIdentity(infoDictionary: [
            "T3BuildChannel": "$(T3_BUILD_CHANNEL)",
            "CFBundleShortVersionString": "$(MARKETING_VERSION)",
            "CFBundleVersion": "$(CURRENT_PROJECT_VERSION)",
            "T3GitCommit": "$(T3_GIT_COMMIT)",
        ])

        #expect(identity.channel == "Unknown")
        #expect(identity.marketingVersion == "Unknown")
        #expect(identity.buildNumber == "Unknown")
        #expect(identity.sourceRevision == "Unknown")
    }
}
