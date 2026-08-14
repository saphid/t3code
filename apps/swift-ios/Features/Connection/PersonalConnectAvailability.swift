enum PersonalConnectAvailability {
    static func isVisible(
        for buildChannel: PersonalBuildChannel,
        hasConfiguredHosts: Bool
    ) -> Bool {
        buildChannel == .test && hasConfiguredHosts
    }
}
