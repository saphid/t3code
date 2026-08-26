import Foundation
import Testing
@testable import T3Code

@Suite("Beta feedback")
struct PlatformBetaFeedbackFlowTests {
    @Test
    func betaChannelsUseNotificationReplyWhenAvailable() {
        #expect(
            PlatformBetaFeedbackPolicy.presentationPath(
                channel: .test,
                notificationsAvailable: true
            ) == .notificationReply
        )
        #expect(
            PlatformBetaFeedbackPolicy.presentationPath(
                channel: .dev,
                notificationsAvailable: false
            ) == .inAppFallback
        )
        #expect(
            PlatformBetaFeedbackPolicy.presentationPath(
                channel: .upstream,
                notificationsAvailable: true
            ) == .disabled
        )
    }

    @Test
    func diagnosticsExposeCountsButNotEnvironmentIdentityOrEndpoints() {
        let diagnostics = PlatformBetaFeedbackDiagnostics(
            build: AppBuildIdentity(infoDictionary: [
                "T3BuildChannel": "test",
                "CFBundleShortVersionString": "1.2.3",
                "CFBundleVersion": "77",
                "T3GitCommit": "abcdef123456",
            ]),
            deviceModel: "iPhone",
            operatingSystem: "iOS 26.5",
            localeIdentifier: "en_AU",
            environments: [
                environment(
                    id: "secret-environment-id",
                    name: "Alex's MacBook",
                    endpoint: "https://token@private.example",
                    source: .direct,
                    connectionState: .connected
                ),
                environment(
                    id: "relay-id",
                    name: "Private relay",
                    endpoint: "https://relay.example/path",
                    source: .t3Connect,
                    connectionState: .reconnecting
                ),
            ]
        )

        #expect(diagnostics.rendered.contains("1/2 connected"))
        #expect(diagnostics.rendered.contains("direct, t3Connect"))
        #expect(!diagnostics.rendered.contains("Alex's MacBook"))
        #expect(!diagnostics.rendered.contains("token@private.example"))
        #expect(!diagnostics.rendered.contains("secret-environment-id"))
        #expect(!diagnostics.rendered.contains("relay-id"))
    }

    @Test
    func availableOnDeviceModelProducesEditableStructuredReport() async {
        let structurer = PlatformBetaFeedbackStructurer(
            isAvailable: { true },
            generate: { description, diagnostics in
                "Summary\n\(description)\n\nDiagnostics\n\(diagnostics)"
            }
        )

        let report = await structurer.report(
            for: "Swipe freezes after opening a long thread.",
            diagnostics: diagnostics
        )

        #expect(report.usedOnDeviceModel)
        #expect(report.fallbackMessage == nil)
        #expect(report.text.contains("Swipe freezes after opening a long thread."))
        #expect(report.text.contains("Original tester text"))
        #expect(report.text.contains("Diagnostics"))
    }

    @Test
    func unavailableModelPreservesOriginalTextInFallbackReport() async {
        let structurer = PlatformBetaFeedbackStructurer(
            isAvailable: { false },
            generate: { _, _ in
                Issue.record("The generator must not run")
                return ""
            }
        )

        let report = await structurer.report(
            for: "  The palette covered the send button.  ",
            diagnostics: diagnostics
        )

        #expect(!report.usedOnDeviceModel)
        #expect(report.fallbackMessage != nil)
        #expect(report.text.contains("Summary\nThe palette covered the send button."))
        #expect(report.text.contains("Observed\nThe palette covered the send button."))
        #expect(report.text.contains(diagnostics.rendered))
    }

    @Test
    func modelFailureIsNonBlockingAndPreservesOriginalText() async {
        let structurer = PlatformBetaFeedbackStructurer(
            isAvailable: { true },
            generate: { _, _ in throw TestError.generationFailed }
        )

        let report = await structurer.report(
            for: "Title generation stopped.",
            diagnostics: diagnostics
        )

        #expect(!report.usedOnDeviceModel)
        #expect(report.text.contains("Title generation stopped."))
        #expect(report.fallbackMessage?.contains("failed") == true)
    }

    @Test
    func notificationResponseBindsOnlyTheDraftIdentifier() {
        let payload: [AnyHashable: Any] = [
            PlatformBetaFeedbackNotificationPayload.draftIDKey: "draft-143",
            "conversation": "must-not-be-read",
        ]

        #expect(PlatformBetaFeedbackNotificationPayload.draftID(from: payload) == "draft-143")
        #expect(PlatformBetaFeedbackNotificationPayload.draftID(from: [:]) == nil)
    }

    @Test
    func sharePayloadHandsOffReportAndSelectedScreenshot() {
        let screenshot = Data([0xFF, 0xD8, 0xFF, 0xD9])
        let payload = PlatformBetaFeedbackSharePayload(
            report: "Summary\nThe send button disappeared.",
            screenshotJPEG: screenshot
        )

        #expect(payload.report.contains("Summary"))
        #expect(payload.screenshotJPEG == screenshot)
    }

    @Test
    func cancellationRemovesTheStoredScreenshotAndDiagnostics() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("PlatformBetaFeedbackFlowTests-\(UUID().uuidString)")
        let store = PlatformBetaFeedbackStore(directory: directory)
        let draft = PlatformBetaFeedbackDraft(
            id: "cancelled-draft",
            screenshotJPEG: Data([1, 2, 3]),
            diagnostics: diagnostics
        )
        defer { try? FileManager.default.removeItem(at: directory) }

        try await store.save(draft)
        let loaded = try await store.load(id: draft.id)
        #expect(loaded == draft)

        await store.remove(id: draft.id)
        let removed = try await store.load(id: draft.id)
        #expect(removed == nil)
    }

    private var diagnostics: PlatformBetaFeedbackDiagnostics {
        PlatformBetaFeedbackDiagnostics(
            build: AppBuildIdentity(infoDictionary: [
                "T3BuildChannel": "test",
                "CFBundleShortVersionString": "1.2.3",
                "CFBundleVersion": "77",
                "T3GitCommit": "abcdef123456",
            ]),
            deviceModel: "iPhone",
            operatingSystem: "iOS 26.5",
            localeIdentifier: "en_AU",
            environments: []
        )
    }

    private func environment(
        id: String,
        name: String,
        endpoint: String,
        source: FeatureEnvironment.Source,
        connectionState: FeatureConnection.State
    ) -> FeatureEnvironment {
        FeatureEnvironment(
            id: id,
            name: name,
            endpoint: endpoint,
            source: source,
            connectionState: connectionState
        )
    }

    private enum TestError: Error {
        case generationFailed
    }
}
