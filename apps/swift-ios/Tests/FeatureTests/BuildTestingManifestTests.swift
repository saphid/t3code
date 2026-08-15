import Foundation
import Testing

@testable import T3Code

@Suite("Build testing metadata")
struct BuildTestingManifestTests {
    @Test("Loads exact embedded stream metadata", .bug("https://github.com/saphid/t3code-personal/issues/56"))
    func loadsEmbeddedManifest() throws {
        let json =
            #"{"schemaVersion":1,"channel":"test","build":42,"revision":"abcdef123456","repositoryURL":"https://github.com/saphid/t3code-personal","entries":[{"id":"feature-one","name":"Feature one","problem":"The old flow loses work.","reproductionSteps":["Open the flow.","Trigger the action."],"summary":"Explains the change.","whatToCheck":"Exercise the changed flow.","successLooksLike":"The flow works without regression.","validationSummary":"Focused tests pass.","knownLimitations":"None known.","reviewPriority":1,"reviewGroup":"Core reliability","state":"in-test","commits":[{"sha":"1234567890abcdef","title":"Add feature one","role":"integrated"}],"threads":[{"id":"THREAD-ONE","title":"Feature one thread"}],"issueURL":"https://github.com/saphid/t3code-personal/issues/56","proofPending":true,"visualEvidence":[]}] }"#
        let info = ["T3BuildTesting": Data(json.utf8).base64EncodedString()]
        let manifest = try #require(BuildTestingManifest.load(info: info))

        #expect(manifest.channel == .test)
        #expect(manifest.build == 42)
        #expect(manifest.entries.first?.commits.first?.shortSHA == "1234567")
        #expect(manifest.entries.first?.threads.first?.id == "THREAD-ONE")
        #expect(manifest.entries.first?.stateLabel == "In Test")
        #expect(manifest.entries.first?.problem == "The old flow loses work.")
        #expect(manifest.entries.first?.whatToCheck == "Exercise the changed flow.")
        #expect(manifest.entries.first?.reproductionSteps.count == 2)
        #expect(manifest.entries.first?.reviewPriority == 1)
        #expect(manifest.entries.first?.isProofPending == true)
        #expect(manifest.entries.first?.evidence.isEmpty == true)
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

    @Test("Explains every proposed PR promotion gate")
    func explainsPromotionPipeline() {
        let stages = BuildTestingPipelineStage.stages

        #expect(stages.map(\.number) == Array(1 ... 6))
        #expect(stages.first?.title == "Candidate PR into Test")
        #expect(stages.contains { $0.gate == .human && $0.title == "You approve the feature" })
        #expect(stages.contains { $0.detail.contains("orange Dev app") })
        #expect(stages.last?.title == "Upstream PR")
        #expect(Set(stages.map(\.id)).count == stages.count)
        #expect(stages.allSatisfy { $0.detail.contains("would") })
    }

    @Test("Builds exact auditable verdict prompts")
    func buildsVerdictPrompts() throws {
        let entry = BuildTestingManifest.Entry(
            id: "feature-one",
            name: "Feature one",
            problem: "The old flow loses work.",
            reproductionSteps: ["Open the flow.", "Trigger the action."],
            summary: "Explains feature one.",
            whatToCheck: "Exercise feature one.",
            successLooksLike: "Feature one works.",
            validationSummary: "Focused tests pass.",
            knownLimitations: "None known.",
            reviewPriority: 1,
            reviewGroup: "Core reliability",
            state: "needs-you",
            commits: [
                .init(sha: "1234567890abcdef", title: "Integrate feature one", role: .integrated),
                .init(sha: "fedcba0987654321", title: "Source feature one", role: .source),
            ],
            threads: [.init(id: "THREAD-ONE", title: "Feature one thread")],
            issueURL: URL(string: "https://github.com/saphid/t3code-personal/issues/56")
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
        #expect(ready.prompt.contains("https://github.com/saphid/t3code-personal/issues/56"))
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
            problem: "The old flow loses work.",
            reproductionSteps: ["Open the flow.", "Trigger the action."],
            summary: "Explains feature one.",
            whatToCheck: "Exercise feature one.",
            successLooksLike: "Feature one works.",
            validationSummary: "Focused tests pass.",
            knownLimitations: "None known.",
            reviewPriority: 1,
            reviewGroup: "Core reliability",
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

    @Test("Persists one current review for an exact build only")
    func persistsExactCurrentReview() throws {
        let suite = "build-testing-current-review-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let entry = reviewEntry()
        let manifest = reviewManifest(entry: entry)

        BuildTestingCurrentReviewStore.select(
            entryID: entry.id,
            manifest: manifest,
            defaults: defaults
        )
        #expect(BuildTestingCurrentReviewStore.entryID(for: manifest, defaults: defaults) == entry.id)

        let laterBuild = BuildTestingManifest(
            schemaVersion: 1,
            channel: .test,
            build: 43,
            revision: "fedcba654321",
            repositoryURL: manifest.repositoryURL,
            entries: [entry]
        )
        #expect(BuildTestingCurrentReviewStore.entryID(for: laterBuild, defaults: defaults) == nil)

        BuildTestingCurrentReviewStore.select(
            entryID: "not-in-this-build",
            manifest: manifest,
            defaults: defaults
        )
        #expect(BuildTestingCurrentReviewStore.entryID(for: manifest, defaults: defaults) == entry.id)
    }

    @Test("Builds a complete new-review discussion prompt")
    func buildsReviewDiscussionPrompt() {
        let entry = reviewEntry()
        let prompt = BuildTestingDiscussion(
            manifest: reviewManifest(entry: entry),
            entry: entry
        ).prompt

        #expect(prompt.contains("Do not approve or reject"))
        #expect(prompt.contains("Feature ID: feature-one"))
        #expect(prompt.contains("Owning issue: https://github.com/saphid/t3code-personal/issues/56"))
        #expect(prompt.contains("Installed candidate: test build 42"))
        #expect(prompt.contains("Revision: abcdef123456"))
        #expect(prompt.contains("1. Open feature one."))
        #expect(prompt.contains("2. Trigger its action."))
        #expect(prompt.contains("Feature one works."))
        #expect(prompt.contains("THREAD-ONE"))
        #expect(prompt.contains("1234567890abcdef"))
    }

    private func reviewEntry() -> BuildTestingManifest.Entry {
        BuildTestingManifest.Entry(
            id: "feature-one",
            name: "Feature one",
            problem: "Feature one fails before the change.",
            reproductionSteps: ["Open feature one.", "Trigger its action."],
            summary: "Explains feature one.",
            whatToCheck: "Exercise feature one.",
            successLooksLike: "Feature one works.",
            validationSummary: "Focused tests pass.",
            knownLimitations: "None known.",
            reviewPriority: 1,
            reviewGroup: "Core reliability",
            state: "in-test",
            commits: [.init(sha: "1234567890abcdef", title: "Feature one", role: .integrated)],
            threads: [.init(id: "THREAD-ONE", title: "Feature one thread")],
            issueURL: URL(string: "https://github.com/saphid/t3code-personal/issues/56")
        )
    }

    private func reviewManifest(
        entry: BuildTestingManifest.Entry
    ) -> BuildTestingManifest {
        BuildTestingManifest(
            schemaVersion: 1,
            channel: .test,
            build: 42,
            revision: "abcdef123456",
            repositoryURL: URL(string: "https://github.com/saphid/t3code-personal"),
            entries: [entry]
        )
    }
}
