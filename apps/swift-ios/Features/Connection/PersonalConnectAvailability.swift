enum PersonalConnectAvailability {
    static func isVisible(
        for buildChannel: PersonalBuildChannel,
        hasConfiguredHosts: Bool = PersonalFleetPairingHost.all.isEmpty == false
    ) -> Bool {
        buildChannel == .test && hasConfiguredHosts
    }
}
