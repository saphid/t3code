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
        #expect(SettingsAboutMetadata.appVersionLabel(info: [
            "CFBundleShortVersionString": "$(MARKETING_VERSION)",
            "CFBundleVersion": "$(CURRENT_PROJECT_VERSION)",
        ]) == "? (?)")
    }

    @Test
    func formatsConnectedEnvironmentVersion() {
        #expect(SettingsAboutMetadata.environmentVersionLabel(
            connectionState: .connected,
            serverVersion: "2.3.4"
        ) == "2.3.4")
    }

    @Test
    func formatsUnknownConnectedEnvironmentVersion() {
        #expect(SettingsAboutMetadata.environmentVersionLabel(
            connectionState: .connected,
            serverVersion: nil
        ) == "Unknown")
        #expect(SettingsAboutMetadata.environmentVersionLabel(
            connectionState: .connected,
            serverVersion: "  "
        ) == "Unknown")
    }

    @Test
    func hidesStaleEnvironmentVersionWhileDisconnected() {
        #expect(SettingsAboutMetadata.environmentVersionLabel(
            connectionState: .disconnected,
            serverVersion: "2.3.4"
        ) == "Not connected")
        #expect(SettingsAboutMetadata.environmentVersionLabel(
            connectionState: .reconnecting,
            serverVersion: "2.3.4"
        ) == "Not connected")
        #expect(SettingsAboutMetadata.environmentVersionLabel(
            connectionState: .connecting,
            serverVersion: "2.3.4"
        ) == "Not connected")
    }

    @Test
    func decodesEmbeddedBuildChangelog() throws {
        let json = #"{"revision":"abc123","baseRevision":"def456","repositoryURL":"https://github.com/pingdotgg/t3code","generatedBy":"Git history","marketingVersion":"1.2.3","buildNumber":"456","entries":[{"commit":"abc123","title":"Fix sync","summary":"Keeps messages in sync.","pullRequest":42,"pullRequestURL":"https://github.com/pingdotgg/t3code/pull/42","committedAt":"2026-08-10T01:02:03Z"}]}"#
        let info: [String: Any] = [
            "CFBundleShortVersionString": "1.2.3",
            "CFBundleVersion": "456",
            "T3BuildChangelog": Data(json.utf8).base64EncodedString(),
        ]
        let changelog = try #require(BuildChangelog.load(info: info))

        #expect(changelog.revision == "abc123")
        #expect(changelog.generatedBy == "Git history")
        #expect(changelog.entries.first?.pullRequest == 42)
        #expect(changelog.entries.first?.pullRequestURL?.absoluteString == "https://github.com/pingdotgg/t3code/pull/42")
        #expect(changelog.repositoryURL?.absoluteString == "https://github.com/pingdotgg/t3code")
        #expect(changelog.entries.first?.shortCommit == "abc123")
        #expect(changelog.entries.first?.displaySummary == "Keeps messages in sync.")
        #expect(BuildChangelog.load(info: nil) == nil)
        #expect(BuildChangelog.load(info: ["T3BuildChangelog": "not base64"]) == nil)
    }

    @Test
    func rejectsNotesForAnotherInstalledVersion() {
        let json = #"{"revision":"abc123","baseRevision":null,"repositoryURL":null,"generatedBy":"Git history","marketingVersion":"1.2.3","buildNumber":"456","entries":[]}"#
        let encoded = Data(json.utf8).base64EncodedString()

        #expect(BuildChangelog.load(info: [
            "CFBundleShortVersionString": "1.2.3",
            "CFBundleVersion": "455",
            "T3BuildChangelog": encoded,
        ]) == nil)
        #expect(BuildChangelog.load(info: [
            "CFBundleShortVersionString": "1.2.4",
            "CFBundleVersion": "456",
            "T3BuildChangelog": encoded,
        ]) == nil)
        #expect(BuildChangelog.load(info: [
            "CFBundleShortVersionString": "1.2.3",
            "CFBundleVersion": "456",
            "T3BuildChangelog": encoded,
        ])?.entries.isEmpty == true)
    }
}
