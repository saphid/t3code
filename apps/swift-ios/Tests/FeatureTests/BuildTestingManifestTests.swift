import Foundation
import Testing

@testable import T3Code

@Suite("Build testing metadata")
struct BuildTestingManifestTests {
    @Test("Loads exact embedded stream metadata", .bug("https://github.com/saphid/t3code-personal/issues/56"))
    func loadsEmbeddedManifest() throws {
        let json =
            #"{"schemaVersion":1,"channel":"test","build":42,"revision":"abcdef123456","repositoryURL":"https://github.com/saphid/t3code-personal","entries":[{"id":"feature-one","name":"Feature one","summary":"Explains the change.","whatToCheck":"Exercise the changed flow.","successLooksLike":"The flow works without regression.","state":"needs-you","commits":[{"sha":"1234567890abcdef","title":"Add feature one","role":"integrated"}],"threads":[{"id":"THREAD-ONE","title":"Feature one thread"}],"issueURL":"https://github.com/saphid/t3code-personal/issues/56"}]}"#
        let info = ["T3BuildTesting": Data(json.utf8).base64EncodedString()]
        let manifest = try #require(BuildTestingManifest.load(info: info))

        #expect(manifest.channel == .test)
        #expect(manifest.build == 42)
        #expect(manifest.entries.first?.commits.first?.shortSHA == "1234567")
        #expect(manifest.entries.first?.threads.first?.id == "THREAD-ONE")
        #expect(manifest.entries.first?.stateLabel == "Needs You")
        #expect(manifest.entries.first?.whatToCheck == "Exercise the changed flow.")
        #expect(BuildTestingManifest.load(info: nil) == nil)
        #expect(BuildTestingManifest.load(info: ["T3BuildTesting": "not base64"]) == nil)
        #expect(BuildTestingManifest.load(info: ["T3BuildTesting": "$(T3_BUILD_TESTING)"]) == nil)

        let invalidSchema = json.replacingOccurrences(of: #""schemaVersion":1"#, with: #""schemaVersion":2"#)
        #expect(BuildTestingManifest.load(info: ["T3BuildTesting": Data(invalidSchema.utf8).base64EncodedString()]) == nil)
        let invalidBuild = json.replacingOccurrences(of: #""build":42"#, with: #""build":0"#)
        #expect(BuildTestingManifest.load(info: ["T3BuildTesting": Data(invalidBuild.utf8).base64EncodedString()]) == nil)
    }

    @Test("Only personal Dev and Test builds expose the section")
    func limitsPresentationToPersonalChannels() {
        #expect(BuildTestingPresentation(channel: .dev)?.sectionTitle == "What’s ready for testing")
        #expect(BuildTestingPresentation(channel: .test)?.sectionTitle == "What’s testing")
        #expect(BuildTestingPresentation(channel: .test)?.readyLabel == "Ready for Dev")
        #expect(BuildTestingPresentation(channel: .test)?.pipelinePosition.contains("Development → Test → Dev → Upstream") == true)
        #expect(BuildTestingPresentation(channel: .debug) == nil)
        #expect(BuildTestingPresentation(channel: .upstream) == nil)
    }

    @Test("Builds exact auditable verdict prompts")
    func buildsVerdictPrompts() throws {
        let entry = BuildTestingManifest.Entry(
            id: "feature-one",
            name: "Feature one",
            summary: "Explains feature one.",
            whatToCheck: "Exercise feature one.",
            successLooksLike: "Feature one works.",
            state: "needs-you",
            commits: [
                .init(sha: "1234567890abcdef", title: "Integrate feature one", role: .integrated),
                .init(sha: "fedcba0987654321", title: "Source feature one", role: .source),
            ],
            threads: [.init(id: "THREAD-ONE", title: "Feature one thread")],
            issueURL: nil
        )
        let manifest = BuildTestingManifest(
            schemaVersion: 1,
            channel: .test,
            build: 42,
            revision: "abcdef123456",
            repositoryURL: nil,
            entries: [entry]
        )
        let ready = BuildTestingDecision(manifest: manifest, entry: entry, verdict: .ready)
        let rejected = BuildTestingDecision(manifest: manifest, entry: entry, verdict: .notReady)

        #expect(ready.prompt.contains("$approve-swiftui-feature feature-one"))
        #expect(ready.prompt.contains("Exact test build: 42"))
        #expect(ready.prompt.contains("Stream state: needs-you"))
        #expect(ready.prompt.contains("ask for the workflow’s required final human confirmation"))
        #expect(ready.prompt.contains("1234567890abcdef"))
        #expect(ready.prompt.contains("Source attribution commits (not build provenance): fedcba0987654321"))
        #expect(ready.prompt.contains("THREAD-ONE"))
        #expect(ready.confirmationTitle == "Promote to Dev?")
        #expect(ready.prompt.contains("approve this exact installed Test feature into SwiftUI Dev"))
        #expect(ready.prompt.contains("followed by upstream validation"))
        #expect(rejected.prompt.contains("not ready to enter Dev"))
    }

    @Test("Builds Dev promotion and rejection prompts")
    func buildsDevVerdictPrompts() throws {
        let entry = BuildTestingManifest.Entry(
            id: "feature-one",
            name: "Feature one",
            summary: "Explains feature one.",
            whatToCheck: "Exercise feature one.",
            successLooksLike: "Feature one works.",
            state: "proved",
            commits: [.init(sha: "1234567890abcdef", title: "Feature one", role: .candidate)],
            threads: [.init(id: "THREAD-ONE", title: "Feature one thread")],
            issueURL: nil
        )
        let manifest = BuildTestingManifest(
            schemaVersion: 1,
            channel: .dev,
            build: 43,
            revision: "abcdef123456",
            repositoryURL: nil,
            entries: [entry]
        )
        let ready = BuildTestingDecision(manifest: manifest, entry: entry, verdict: .ready)
        let notReady = BuildTestingDecision(manifest: manifest, entry: entry, verdict: .notReady)

        #expect(ready.confirmationTitle == "Send to Test?")
        #expect(ready.prompt.contains("$swiftui-feature-fix"))
        #expect(ready.prompt.contains("ready to enter SwiftUI Test"))
        #expect(notReady.confirmationTitle == "Mark as not ready?")
        #expect(notReady.prompt.contains("keep it out of Test"))
    }

    @Test("Persists verdicts for an exact build only")
    func persistsExactBuildVerdicts() throws {
        let suite = "build-testing-verdicts-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let manifest = BuildTestingManifest(
            schemaVersion: 1,
            channel: .test,
            build: 47,
            revision: "abcdef123456",
            repositoryURL: nil,
            entries: []
        )

        BuildTestingVerdictStore.record(
            .ready,
            entryID: "feature-one",
            manifest: manifest,
            defaults: defaults
        )
        #expect(BuildTestingVerdictStore.verdicts(for: manifest, defaults: defaults)["feature-one"] == .ready)
        let laterBuild = BuildTestingManifest(
            schemaVersion: 1,
            channel: .test,
            build: 48,
            revision: "fedcba654321",
            repositoryURL: nil,
            entries: []
        )
        #expect(BuildTestingVerdictStore.verdicts(for: laterBuild, defaults: defaults).isEmpty)
    }
}
