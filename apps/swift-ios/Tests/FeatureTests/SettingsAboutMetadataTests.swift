import Foundation
import Testing
@testable import T3Code

@Suite("Settings about metadata")
struct SettingsAboutMetadataTests {
    @Test
    func formatsAppVersionAndBuild() {
        let info: [String: Any] = [
            "CFBundleShortVersionString": "1.2.3",
            "CFBundleVersion": "456",
        ]

        #expect(SettingsAboutMetadata.appVersionLabel(info: info) == "1.2.3 (456)")
        #expect(SettingsAboutMetadata.appVersionLabel(info: nil) == "? (?)")
        #expect(SettingsAboutMetadata.environmentVersionLabel(
            connectionState: .connected,
            serverVersion: "2.3.4"
        ) == "2.3.4")
        #expect(SettingsAboutMetadata.environmentVersionLabel(
            connectionState: .connected,
            serverVersion: nil
        ) == "Unknown")
        #expect(SettingsAboutMetadata.environmentVersionLabel(
            connectionState: .disconnected,
            serverVersion: "2.3.4"
        ) == "Not connected")
    }

    @Test
    func buildsPublicChangelogURLAndRejectsInvalidMetadata() {
        let info: [String: Any] = [
            "T3GitRepoURL": "https://github.com/pingdotgg/t3code",
            "T3GitCommit": "abc123-dirty",
        ]

        #expect(
            SettingsAboutMetadata.buildChangelogURL(info: info)?.absoluteString
                == "https://github.com/pingdotgg/t3code/commits/abc123"
        )
        #expect(
            SettingsAboutMetadata.buildChangelogURL(info: [
                "T3GitRepoURL": "https://private.example/repo",
                "T3GitCommit": "abc123",
            ]) == nil
        )
        #expect(SettingsAboutMetadata.buildChangelogURL(info: nil) == nil)
        #expect(SettingsAboutMetadata.buildChangelogURL(info: [
            "T3GitRepoURL": "",
            "T3GitCommit": "unknown",
        ]) == nil)
        #expect(SettingsAboutMetadata.appVersionLabel(info: [
            "CFBundleShortVersionString": "$(MARKETING_VERSION)",
            "CFBundleVersion": "$(CURRENT_PROJECT_VERSION)",
        ]) == "? (?)")
    }
}
