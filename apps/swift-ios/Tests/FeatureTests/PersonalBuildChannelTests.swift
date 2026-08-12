import Testing
@testable import T3Code

struct PersonalBuildChannelTests {
    @Test
    func mapsPersonalChannelsAndFallsBackToUpstream() {
        #expect(PersonalBuildChannel(info: ["T3BuildChannel": "dev"]) == .dev)
        #expect(PersonalBuildChannel(info: ["T3BuildChannel": "test"]) == .test)
        #expect(PersonalBuildChannel(info: ["T3BuildChannel": "debug"]) == .debug)
        #expect(PersonalBuildChannel(info: ["T3BuildChannel": "$(T3_BUILD_CHANNEL)"]) == .upstream)
        #expect(PersonalBuildChannel(info: nil) == .upstream)
    }

    @Test
    func exposesClearTitleSuffixes() {
        #expect(PersonalBuildChannel.dev.titleSuffix == "Dev")
        #expect(PersonalBuildChannel.test.titleSuffix == "Test")
        #expect(PersonalBuildChannel.debug.titleSuffix == "Debug")
        #expect(PersonalBuildChannel.upstream.titleSuffix == nil)
    }

    @Test(arguments: [
        PersonalBuildChannel.upstream,
        PersonalBuildChannel.debug,
        PersonalBuildChannel.dev,
    ])
    func hidesPersonalConnectOutsideTest(_ channel: PersonalBuildChannel) {
        #expect(
            PersonalConnectAvailability.isVisible(
                for: channel,
                hasConfiguredHosts: true
            ) == false
        )
    }

    @Test
    func showsPersonalConnectOnlyForConfiguredTestBuilds() {
        #expect(
            PersonalConnectAvailability.isVisible(
                for: .test,
                hasConfiguredHosts: true
            )
        )
        #expect(
            PersonalConnectAvailability.isVisible(
                for: .test,
                hasConfiguredHosts: false
            ) == false
        )
    }
}
