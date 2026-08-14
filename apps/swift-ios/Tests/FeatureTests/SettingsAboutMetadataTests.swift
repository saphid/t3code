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
    }

    @Test
    func decodesEmbeddedBuildChangelog() throws {
        let json = #"{"revision":"abc123","baseRevision":"def456","repositoryURL":"https://github.com/pingdotgg/t3code","generatedBy":"GPT-5.6 Luna","sourceThreadID":"thread-7","entries":[{"commit":"abc123","title":"Fix sync","summary":"Keeps messages in sync.","pullRequest":42,"pullRequestURL":"https://github.com/pingdotgg/t3code/pull/42","committedAt":"2026-08-10T01:02:03Z"}]}"#
        let info = ["T3BuildChangelog": Data(json.utf8).base64EncodedString()]
        let changelog = try #require(BuildChangelog.load(info: info))

        #expect(changelog.revision == "abc123")
        #expect(changelog.generatedBy == "GPT-5.6 Luna")
        #expect(changelog.entries.first?.pullRequest == 42)
        #expect(changelog.entries.first?.pullRequestURL?.absoluteString == "https://github.com/pingdotgg/t3code/pull/42")
        #expect(changelog.repositoryURL?.absoluteString == "https://github.com/pingdotgg/t3code")
        #expect(changelog.entries.first?.shortCommit == "abc123")
        #expect(
            changelog.sourceThreadURL?.absoluteString
                == "\(PlatformRoute.nativeScheme)://threads?thread=thread-7"
        )
        #expect(BuildChangelog.load(info: nil) == nil)
        #expect(BuildChangelog.load(info: ["T3BuildChangelog": "not base64"]) == nil)
        #expect(SettingsAboutMetadata.appVersionLabel(info: [
            "CFBundleShortVersionString": "$(MARKETING_VERSION)",
            "CFBundleVersion": "$(CURRENT_PROJECT_VERSION)",
        ]) == "? (?)")
    }

    @Test
    func whatsNewPromptRemainsUntilTheCurrentBuildIsOpened() {
        let info: [String: Any] = [
            "CFBundleShortVersionString": "1.2.3",
            "CFBundleVersion": "456",
        ]

        #expect(BuildChangelogPrompt.buildIdentifier(info: info) == "1.2.3-456")
        #expect(BuildChangelogPrompt.shouldShow(lastOpenedBuild: "", info: info))
        #expect(BuildChangelogPrompt.shouldShow(lastOpenedBuild: "1.2.3-455", info: info))
        #expect(!BuildChangelogPrompt.shouldShow(lastOpenedBuild: "1.2.3-456", info: info))
        #expect(!BuildChangelogPrompt.shouldShow(lastOpenedBuild: "", info: nil))
    }

    @Test
    func hidesInvalidOrMissingSourceThreadLinks() throws {
        for json in [
            #"{"revision":"abc123","baseRevision":null,"repositoryURL":null,"generatedBy":"Git history","entries":[]}"#,
            #"{"revision":"abc123","baseRevision":null,"repositoryURL":null,"generatedBy":"Git history","sourceThreadID":" thread-7 ","entries":[]}"#,
            #"{"revision":"abc123","baseRevision":null,"repositoryURL":null,"generatedBy":"Git history","sourceThreadID":"..","entries":[]}"#,
            #"{"revision":"abc123","baseRevision":null,"repositoryURL":null,"generatedBy":"Git history","sourceThreadID":"line\nbreak","entries":[]}"#,
        ] {
            let info = ["T3BuildChangelog": Data(json.utf8).base64EncodedString()]
            let changelog = try #require(BuildChangelog.load(info: info))

            #expect(changelog.sourceThreadURL == nil)
        }
    }
}
