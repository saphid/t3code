import Foundation
import Testing
import UIKit
@testable import T3Code

@Suite("Beta feedback")
struct PlatformBetaFeedbackFlowTests {
    @Test
    func betaChannelsUseNotificationReplyWhenAvailable() {
        #expect(
            PlatformBetaFeedbackPolicy.presentationPath(
                channel: .test,
                distribution: .development,
                testFlightEnabled: false,
                notificationsAvailable: true
            ) == .notificationReply
        )
        #expect(
            PlatformBetaFeedbackPolicy.presentationPath(
                channel: .dev,
                distribution: .development,
                testFlightEnabled: false,
                notificationsAvailable: false
            ) == .inAppFallback
        )
        #expect(
            PlatformBetaFeedbackPolicy.presentationPath(
                channel: .upstream,
                distribution: .appStore,
                testFlightEnabled: true,
                notificationsAvailable: true
            ) == .disabled
        )
    }

    @Test
    func testFlightRequiresAnExplicitOptIn() {
        #expect(PlatformBetaFeedbackPolicy.testFlightEnabled(from: "YES"))
        #expect(PlatformBetaFeedbackPolicy.testFlightEnabled(from: true))
        #expect(PlatformBetaFeedbackPolicy.testFlightEnabled(from: "NO") == false)
        #expect(PlatformBetaFeedbackPolicy.testFlightEnabled(from: false) == false)
        #expect(PlatformBetaFeedbackPolicy.testFlightEnabled(from: nil) == false)
        #expect(
            PlatformBetaFeedbackPolicy.isEnabled(
                channel: .upstream,
                distribution: .development,
                testFlightEnabled: false
            )
        )
        #expect(
            PlatformBetaFeedbackPolicy.isEnabled(
                channel: .upstream,
                distribution: .testFlight,
                testFlightEnabled: false
            ) == false
        )
        #expect(
            PlatformBetaFeedbackPolicy.isEnabled(
                channel: .upstream,
                distribution: .testFlight,
                testFlightEnabled: true
            )
        )
        #expect(
            PlatformBetaFeedbackPolicy.isEnabled(
                channel: .test,
                distribution: .development,
                testFlightEnabled: false
            )
        )
        #expect(
            PlatformBetaFeedbackPolicy.isEnabled(
                channel: .dev,
                distribution: .development,
                testFlightEnabled: false
            )
        )
        #expect(
            PlatformBetaFeedbackPolicy.isEnabled(
                channel: .upstream,
                distribution: .appStore,
                testFlightEnabled: true
            ) == false
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
    func availableOnDeviceModelProducesEditableStructuredReport() async throws {
        let structurer = PlatformBetaFeedbackStructurer(
            isAvailable: { true },
            generate: { description, diagnostics in
                "Summary\n\(description)\n\nDiagnostics\n\(diagnostics)"
            }
        )

        let report = try await structurer.report(
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
    func unavailableModelPreservesOriginalTextInFallbackReport() async throws {
        let structurer = PlatformBetaFeedbackStructurer(
            isAvailable: { false },
            generate: { _, _ in
                Issue.record("The generator must not run")
                return ""
            }
        )

        let report = try await structurer.report(
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
    func modelFailureIsNonBlockingAndPreservesOriginalText() async throws {
        let structurer = PlatformBetaFeedbackStructurer(
            isAvailable: { true },
            generate: { _, _ in throw TestError.generationFailed }
        )

        let report = try await structurer.report(
            for: "Title generation stopped.",
            diagnostics: diagnostics
        )

        #expect(!report.usedOnDeviceModel)
        #expect(report.text.contains("Title generation stopped."))
        #expect(report.fallbackMessage?.contains("failed") == true)
    }

    @Test
    func modelCancellationIsNotConvertedIntoAReport() async {
        let structurer = PlatformBetaFeedbackStructurer(
            isAvailable: { true },
            generate: { _, _ in throw CancellationError() }
        )

        do {
            _ = try await structurer.report(
                for: "Do not replace this text.",
                diagnostics: diagnostics
            )
            Issue.record("Expected model cancellation to propagate")
        } catch is CancellationError {
            // Expected.
        } catch {
            Issue.record("Unexpected error: \(error)")
        }
    }

    @MainActor
    @Test
    func sheetModelUsesTheInjectedFallbackWithoutLosingTesterText() async {
        let model = PlatformBetaFeedbackSheetModel(
            draft: PlatformBetaFeedbackDraft(
                screenshotJPEG: Data([1, 2, 3]),
                diagnostics: diagnostics,
                originalDescription: "The reconnect banner covered Send."
            ),
            structurer: PlatformBetaFeedbackStructurer(
                isAvailable: { false },
                generate: { _, _ in "" }
            )
        )

        await model.structureReport()

        #expect(model.reportText.contains("The reconnect banner covered Send."))
        #expect(model.fallbackMessage?.contains("unavailable") == true)
        #expect(model.isStructuring == false)
    }

    @Test
    func notificationResponseBindsOnlyTheDraftIdentifier() {
        let draftID = UUID().uuidString
        let payload: [AnyHashable: Any] = [
            PlatformBetaFeedbackNotificationPayload.draftIDKey: draftID,
            "conversation": "must-not-be-read",
        ]

        #expect(PlatformBetaFeedbackNotificationPayload.draftID(from: payload) == draftID)
        #expect(
            PlatformBetaFeedbackNotificationPayload.draftID(from: [
                PlatformBetaFeedbackNotificationPayload.draftIDKey: "../another-file",
            ]) == nil
        )
        #expect(PlatformBetaFeedbackNotificationPayload.draftID(from: [:]) == nil)
    }

    @Test
    func aNewScreenshotSupersedesAnUnansweredPendingDraft() {
        var state = PlatformBetaFeedbackPendingDraftState()

        #expect(state.replace(with: "first-draft") == nil)
        #expect(state.replace(with: "second-draft") == "first-draft")
        #expect(state.id == "second-draft")

        state.clear(ifMatching: "first-draft")
        #expect(state.id == "second-draft")
        state.clear(ifMatching: "second-draft")
        #expect(state.id == nil)
    }

    @Test
    func sharePayloadHandsOffTheExactReviewedScreenshotFile() throws {
        let screenshot = try testScreenshotData()
        let payload = try PlatformBetaFeedbackSharePayload.prepare(
            report: "Summary\nThe send button disappeared.",
            screenshotJPEG: screenshot
        )
        defer { payload.removeTemporaryFile() }

        #expect(payload.report.contains("Summary"))
        #expect(try Data(contentsOf: payload.screenshotFileURL) == screenshot)
    }

    @Test
    func screenshotMarkupSupportsUndoAndClear() {
        var markup = PlatformBetaFeedbackMarkup()
        let first = PlatformBetaFeedbackMarkup.Stroke(points: [
            .init(x: 0.1, y: 0.2),
            .init(x: 0.8, y: 0.2),
        ])
        let second = PlatformBetaFeedbackMarkup.Stroke(points: [
            .init(x: 0.4, y: 0.3),
            .init(x: 0.4, y: 0.9),
        ])

        markup.append(first)
        markup.append(second)
        #expect(markup.strokes == [first, second])

        markup.undo()
        #expect(markup.strokes == [first])

        markup.clear()
        #expect(markup.strokes.isEmpty)
    }

    @MainActor
    @Test
    func markupRendererPreservesSourcePixelsAndDrawsTheReviewedStroke() throws {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let source = UIGraphicsImageRenderer(
            size: CGSize(width: 120, height: 80),
            format: format
        ).image { context in
            UIColor.white.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 120, height: 80))
        }
        let sourceData = try #require(source.jpegData(compressionQuality: 0.9))
        let markup = PlatformBetaFeedbackMarkup(strokes: [
            .init(points: [
                .init(x: 0.1, y: 0.5),
                .init(x: 0.9, y: 0.5),
            ]),
        ])

        let rendered = try PlatformBetaFeedbackMarkupRenderer.render(
            sourceJPEG: sourceData,
            markup: markup
        )
        let reviewedImage = try #require(UIImage(data: rendered))
        let sourceImage = try #require(UIImage(data: sourceData))
        let reviewedCGImage = try #require(reviewedImage.cgImage)
        let centerPixel = try pixel(in: reviewedCGImage, x: 60, y: 40)

        #expect(reviewedImage.cgImage?.width == sourceImage.cgImage?.width)
        #expect(reviewedImage.cgImage?.height == sourceImage.cgImage?.height)
        #expect(Int(centerPixel.red) > Int(centerPixel.green) + 50)
        #expect(Int(centerPixel.red) > Int(centerPixel.blue) + 50)
        #expect(rendered != sourceData)
    }

    @MainActor
    @Test
    func clearingReviewedMarkupRestoresTheExactOriginalScreenshot() throws {
        let source = try testScreenshotData()
        let model = PlatformBetaFeedbackSheetModel(
            draft: PlatformBetaFeedbackDraft(
                screenshotJPEG: source,
                diagnostics: diagnostics
            )
        )
        let markup = PlatformBetaFeedbackMarkup(strokes: [
            .init(points: [.init(x: 0.1, y: 0.1), .init(x: 0.9, y: 0.9)]),
        ])
        let rendered = try PlatformBetaFeedbackMarkupRenderer.render(
            sourceJPEG: source,
            markup: markup
        )

        model.applyMarkup(markup, renderedJPEG: rendered)
        #expect(model.reviewedDraft.submissionScreenshotJPEG == rendered)

        model.applyMarkup(PlatformBetaFeedbackMarkup(), renderedJPEG: source)
        #expect(model.reviewedDraft.annotatedScreenshotJPEG == nil)
        #expect(model.reviewedDraft.submissionScreenshotJPEG == source)
    }

    @Test
    func githubGatewayCreatesANewIssueWithTheUploadedAnnotatedScreenshot() async throws {
        let recorder = GitHubRecorder()
        let gateway = PlatformBetaFeedbackGitHubGateway(
            uploadScreenshot: { data, configuration in
                await recorder.recordUpload(data: data, repository: configuration.repository)
                return PlatformBetaFeedbackGitHubUpload(
                    url: URL(string: "https://github.com/acme/app/blob/t3-feedback/report.jpg?raw=1")!,
                    path: ".t3-feedback/report.jpg",
                    sha: "upload-sha"
                )
            },
            deleteScreenshot: { _, _ in
                Issue.record("A successful attachment must not be rolled back")
            },
            createIssue: { title, body, configuration in
                await recorder.recordCreate(title: title, body: body, repository: configuration.repository)
                return PlatformBetaFeedbackGitHubIssue(
                    number: 41,
                    title: title,
                    url: URL(string: "https://github.com/acme/app/issues/41")!
                )
            },
            addComment: { issueNumber, body, configuration in
                await recorder.recordUpdate(
                    issueNumber: issueNumber,
                    body: body,
                    repository: configuration.repository
                )
                return URL(string: "https://github.com/acme/app/issues/41#issuecomment-1")!
            }
        )
        let configuration = PlatformBetaFeedbackGitHubConfiguration(
            repository: "acme/app",
            feedbackBranch: "t3-feedback",
            token: "secret"
        )

        let screenshot = Data([1, 2, 3])
        let result = try await gateway.submit(
            .create(title: "Send button disappeared"),
            report: "Summary\nSend button disappeared.",
            screenshotJPEG: screenshot,
            configuration: configuration
        )
        let calls = await recorder.calls

        #expect(result.number == 41)
        #expect(calls.uploadedRepository == "acme/app")
        #expect(calls.uploadedScreenshot == screenshot)
        #expect(calls.createdTitle == "Send button disappeared")
        #expect(calls.createdBody?.contains("Send button disappeared.") == true)
        #expect(calls.updatedBodies.last?.contains("report.jpg?raw=1") == true)
    }

    @Test
    func githubGatewayUpdatesTheChosenIssueWithTheSameReviewedPayload() async throws {
        let recorder = GitHubRecorder()
        let gateway = PlatformBetaFeedbackGitHubGateway(
            uploadScreenshot: { _, _ in
                PlatformBetaFeedbackGitHubUpload(
                    url: URL(string: "https://github.com/acme/app/blob/t3-feedback/follow-up.jpg?raw=1")!,
                    path: ".t3-feedback/follow-up.jpg",
                    sha: "upload-sha"
                )
            },
            deleteScreenshot: { _, _ in
                Issue.record("A successful attachment must not be rolled back")
            },
            createIssue: { _, _, _ in
                Issue.record("The create endpoint must not run for an issue update")
                return PlatformBetaFeedbackGitHubIssue(
                    number: 0,
                    title: "unexpected",
                    url: URL(string: "https://github.com")!
                )
            },
            addComment: { issueNumber, body, configuration in
                await recorder.recordUpdate(
                    issueNumber: issueNumber,
                    body: body,
                    repository: configuration.repository
                )
                return URL(string: "https://github.com/acme/app/issues/12#issuecomment-99")!
            }
        )

        let result = try await gateway.submit(
            .update(issueNumber: 12, title: "Existing issue"),
            report: "Summary\nThe reconnect path still fails.",
            screenshotJPEG: Data([4, 5, 6]),
            configuration: .init(
                repository: "acme/app",
                feedbackBranch: "t3-feedback",
                token: "secret"
            )
        )
        let calls = await recorder.calls

        #expect(result.number == 12)
        #expect(calls.updatedIssueNumber == 12)
        #expect(calls.updatedBodies.first?.contains("The reconnect path still fails.") == true)
        #expect(calls.updatedBodies.last?.contains("follow-up.jpg?raw=1") == true)
    }

    @Test
    func githubAPICreatesTheIssueBeforePublishingTheReviewedBytes() async throws {
        let recorder = GitHubHTTPRecorder()
        let api = PlatformBetaFeedbackGitHubAPI(transport: .init(send: { request in
            try await recorder.send(request)
        }))
        let screenshot = Data([10, 20, 30])

        let result = try await api.gateway.submit(
            .create(title: "Reconnect fails"),
            report: "Summary\nReconnect fails.",
            screenshotJPEG: screenshot,
            configuration: .init(
                repository: "acme/app",
                feedbackBranch: "t3-feedback",
                token: "secret"
            )
        )
        let requests = await recorder.requests

        #expect(result.number == 41)
        #expect(requests.map(\.method) == ["POST", "PUT", "POST"])
        #expect(requests[0].path == "/repos/acme/app/issues")
        #expect(requests[1].path.contains("/repos/acme/app/contents/.t3-feedback/"))
        #expect(requests[1].body.contains(screenshot.base64EncodedString()))
        #expect(requests[2].path == "/repos/acme/app/issues/41/comments")
    }

    @Test
    func githubGatewayRollsBackAnUploadThatCouldNotBeAttached() async throws {
        let recorder = GitHubRecorder()
        let upload = PlatformBetaFeedbackGitHubUpload(
            url: URL(string: "https://github.com/acme/app/blob/t3-feedback/orphan.jpg?raw=1")!,
            path: ".t3-feedback/orphan.jpg",
            sha: "orphan-sha"
        )
        let gateway = PlatformBetaFeedbackGitHubGateway(
            uploadScreenshot: { _, _ in upload },
            deleteScreenshot: { deleted, _ in await recorder.recordDelete(upload: deleted) },
            createIssue: { title, _, _ in
                PlatformBetaFeedbackGitHubIssue(
                    number: 41,
                    title: title,
                    url: URL(string: "https://github.com/acme/app/issues/41")!
                )
            },
            addComment: { _, _, _ in throw TestError.generationFailed }
        )

        do {
            _ = try await gateway.submit(
                .create(title: "Reconnect fails"),
                report: "Summary\nReconnect fails.",
                screenshotJPEG: Data([1, 2, 3]),
                configuration: .init(
                    repository: "acme/app",
                    feedbackBranch: "t3-feedback",
                    token: "secret"
                )
            )
            Issue.record("Expected the attachment failure")
        } catch {
            #expect(error.localizedDescription.contains("report was posted"))
        }
        #expect(await recorder.calls.deletedUpload == upload)
    }

    @Test
    func githubGatewayRollsBackAnUploadAfterTaskCancellation() async throws {
        let recorder = GitHubRecorder()
        let createStarted = AsyncStream<Void>.makeStream()
        let keepCreateOpen = AsyncStream<Void>.makeStream()
        let upload = PlatformBetaFeedbackGitHubUpload(
            url: URL(string: "https://github.com/acme/app/blob/t3-feedback/cancelled.jpg?raw=1")!,
            path: ".t3-feedback/cancelled.jpg",
            sha: "cancelled-sha"
        )
        let gateway = PlatformBetaFeedbackGitHubGateway(
            uploadScreenshot: { _, _ in upload },
            deleteScreenshot: { deleted, _ in await recorder.recordDelete(upload: deleted) },
            createIssue: { title, _, _ in
                createStarted.continuation.yield()
                for await _ in keepCreateOpen.stream { break }
                return PlatformBetaFeedbackGitHubIssue(
                    number: 41,
                    title: title,
                    url: URL(string: "https://github.com/acme/app/issues/41")!
                )
            },
            addComment: { _, _, _ in
                try Task.checkCancellation()
                return URL(string: "https://github.com/acme/app/issues/41#issuecomment-1")!
            }
        )
        let task = Task {
            try await gateway.submit(
                .create(title: "Reconnect fails"),
                report: "Summary\nReconnect fails.",
                screenshotJPEG: Data([1, 2, 3]),
                configuration: .init(
                    repository: "acme/app",
                    feedbackBranch: "t3-feedback",
                    token: "secret"
                )
            )
        }
        var started = createStarted.stream.makeAsyncIterator()
        _ = await started.next()
        task.cancel()
        keepCreateOpen.continuation.yield()

        do {
            _ = try await task.value
            Issue.record("Expected cancellation")
        } catch {
            #expect(error.localizedDescription.contains("report was posted"))
        }
        #expect(await recorder.calls.deletedUpload == upload)
    }

    @Test
    func githubConfigurationRejectsDefaultBranchesAndMalformedRepositories() {
        #expect(PlatformBetaFeedbackGitHubConfiguration(
            repository: "acme/app",
            feedbackBranch: "main",
            token: "secret"
        ).validationMessage?.contains("dedicated") == true)
        #expect(PlatformBetaFeedbackGitHubConfiguration(
            repository: "acme/app/extra",
            feedbackBranch: "t3-feedback",
            token: "secret"
        ).validationMessage?.contains("owner/name") == true)
    }

    @MainActor
    @Test
    func githubSuggestedTitlePreservesTheStructuredSummary() {
        #expect(
            PlatformBetaFeedbackGitHubSheet.suggestedTitle(from: """
                ### Summary
                Send button disappears after reconnect

                ### Diagnostics
                Test build
                """) == "Send button disappears after reconnect"
        )
        #expect(
            PlatformBetaFeedbackGitHubSheet.suggestedTitle(from: """
                Summary
                Palette overlaps the composer
                """) == "Palette overlaps the composer"
        )
        #expect(
            PlatformBetaFeedbackGitHubSheet.suggestedTitle(from: """
                **Summary**
                Follow-up send loses the screenshot
                """) == "Follow-up send loses the screenshot"
        )
        #expect(
            PlatformBetaFeedbackGitHubSheet.suggestedTitle(from: """
                ### Diagnostics
                Test build on iOS 26.5
                """) == "Test build on iOS 26.5"
        )
        #expect(
            PlatformBetaFeedbackGitHubSheet.suggestedTitle(from: """
                ### Observed
                ### Expected
                ### Diagnostics
                """) == "Beta feedback"
        )
        #expect(
            PlatformBetaFeedbackGitHubSheet.suggestedTitle(from: """
                ### Summary
                ### Observed
                The sheet obscures the composer
                """) == "The sheet obscures the composer"
        )
        #expect(
            PlatformBetaFeedbackGitHubSheet.suggestedTitle(from: """
                **Summary:**
                Follow-up send loses the screenshot
                """) == "Follow-up send loses the screenshot"
        )
    }

    #if DEBUG
    @MainActor
    @Test
    func demoDestinationsRequireTheExplicitFlagAndAnEmptyProjectList() {
        #expect(PlatformRootView.shouldUseBetaFeedbackDemoDestinations(
            arguments: ["T3Code", "--t3-beta-feedback-demo-destinations"],
            hasProjects: false
        ))
        #expect(PlatformRootView.shouldUseBetaFeedbackDemoDestinations(
            arguments: ["T3Code", "--t3-beta-feedback-demo"],
            hasProjects: false
        ) == false)
        #expect(PlatformRootView.shouldUseBetaFeedbackDemoDestinations(
            arguments: ["T3Code", "--t3-beta-feedback-demo-destinations"],
            hasProjects: true
        ) == false)
    }
    #endif

    @Test
    func t3HandoffBuildsNewAndFollowUpFixingSubmissionsWithTheExactImage() throws {
        let screenshot = try testScreenshotData()
        let newTask = try PlatformBetaFeedbackT3Handoff.newTask(
            projectID: "project-143",
            report: "Summary\nFix the hidden send button.",
            screenshotJPEG: screenshot
        )
        let followUp = try PlatformBetaFeedbackT3Handoff.followUp(
            threadID: "thread-143",
            report: "Summary\nThe first fix did not cover reconnect.",
            screenshotJPEG: screenshot
        )

        #expect(newTask.projectID == "project-143")
        #expect(newTask.prompt.contains("Fix this reviewed beta feedback report"))
        #expect(newTask.attachments.count == 1)
        #expect(followUp.threadID == "thread-143")
        #expect(followUp.text.contains("Follow up on this reviewed beta feedback report"))
        #expect(followUp.attachments.count == 1)
        #expect(newTask.attachments[0].data == screenshot)
        #expect(followUp.attachments[0].data == screenshot)
        #expect(newTask.attachments[0].data == followUp.attachments[0].data)
    }

    @Test
    func draftStoreRejectsPathComponentsFromUntrustedNotificationPayloads() async {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("PlatformBetaFeedbackUnsafeIDTests-\(UUID().uuidString)")
        let store = PlatformBetaFeedbackStore(directory: directory)
        defer { try? FileManager.default.removeItem(at: directory) }

        do {
            try await store.saveResponse(draftID: "../another-file", text: "Do not write this.")
            Issue.record("Expected the unsafe draft identifier to be rejected")
        } catch PlatformBetaFeedbackStore.StoreError.invalidDraftID {
            // Expected.
        } catch {
            Issue.record("Unexpected error: \(error)")
        }
    }

    @Test
    func cancellationRemovesTheStoredScreenshotAndDiagnostics() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("PlatformBetaFeedbackFlowTests-\(UUID().uuidString)")
        let store = PlatformBetaFeedbackStore(directory: directory)
        let draft = PlatformBetaFeedbackDraft(
            id: "cancelled-draft",
            screenshotJPEG: Data([1, 2, 3]),
            annotatedScreenshotJPEG: Data([4, 5, 6]),
            diagnostics: diagnostics
        )
        defer { try? FileManager.default.removeItem(at: directory) }

        try await store.save(draft)
        let loaded = try await store.load(id: draft.id)
        #expect(loaded == draft)

        await store.remove(id: draft.id)
        let removed = try await store.load(id: draft.id)
        #expect(removed == nil)
        let remaining = try FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: nil
        )
        #expect(remaining.isEmpty)
    }

    @Test
    func pendingNotificationResponseSurvivesUntilTheRootConsumesIt() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("PlatformBetaFeedbackResponseTests-\(UUID().uuidString)")
        let store = PlatformBetaFeedbackStore(directory: directory)
        defer { try? FileManager.default.removeItem(at: directory) }

        let draft = PlatformBetaFeedbackDraft(
            id: "cold-launch",
            screenshotJPEG: Data([1, 2, 3]),
            diagnostics: diagnostics
        )
        try await store.save(draft)
        try await store.saveResponse(draftID: draft.id, text: "The list froze.")
        let responded = try await store.loadNextRespondedDraft()

        #expect(responded?.id == draft.id)
        #expect(responded?.originalDescription == "The list froze.")
        #expect(try await store.loadNextRespondedDraft() == nil)
        let resumedAfterInterruption = try await store.loadNextResumableDraft()
        #expect(resumedAfterInterruption?.originalDescription == "The list froze.")
    }

    @Test
    func orphanedNotificationResponseIsRemovedWhenItsDraftIsGone() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("PlatformBetaFeedbackOrphanResponseTests-\(UUID().uuidString)")
        let store = PlatformBetaFeedbackStore(directory: directory)
        defer { try? FileManager.default.removeItem(at: directory) }
        let draft = PlatformBetaFeedbackDraft(
            id: "missing-draft",
            screenshotJPEG: Data([1, 2, 3]),
            diagnostics: diagnostics
        )

        try await store.saveResponse(draftID: draft.id, text: "No draft remains.")
        #expect(try await store.loadNextRespondedDraft() == nil)

        try await store.save(draft)
        #expect(try await store.loadNextRespondedDraft() == nil)
    }

    @Test
    func freshPendingResponseKeepsAnOlderTemporaryDraftAlive() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("PlatformBetaFeedbackResponseRetentionTests-\(UUID().uuidString)")
        let store = PlatformBetaFeedbackStore(directory: directory)
        defer { try? FileManager.default.removeItem(at: directory) }
        let draft = PlatformBetaFeedbackDraft(
            id: "older-draft-with-fresh-response",
            screenshotJPEG: Data([1, 2, 3]),
            diagnostics: diagnostics
        )

        try await store.save(draft)
        try FileManager.default.setAttributes(
            [.modificationDate: Date.now.addingTimeInterval(-25 * 60 * 60)],
            ofItemAtPath: directory.appendingPathComponent("older-draft-with-fresh-response.json").path
        )
        try await store.saveResponse(draftID: draft.id, text: "This reply is fresh.")
        await store.pruneExpired()

        let responded = try await store.loadNextRespondedDraft()
        #expect(responded?.originalDescription == "This reply is fresh.")
    }

    @Test
    func malformedResponseAndOrphanedImagesAreReclaimed() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("PlatformBetaFeedbackOrphanFileTests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let store = PlatformBetaFeedbackStore(directory: directory)
        defer { try? FileManager.default.removeItem(at: directory) }
        try Data("not json".utf8).write(
            to: directory.appendingPathComponent("broken.response.json")
        )
        try Data([1, 2, 3]).write(to: directory.appendingPathComponent("orphan.jpg"))
        try Data([4, 5, 6]).write(to: directory.appendingPathComponent("orphan.annotated.jpg"))

        #expect(try await store.loadNextRespondedDraft() == nil)
        await store.pruneExpired()

        let remaining = try FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: nil
        )
        #expect(remaining.isEmpty)
    }

    @Test
    func undecodableRecordUsesTheConservativeThirtyDayRetention() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("PlatformBetaFeedbackUnreadableRecordTests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let store = PlatformBetaFeedbackStore(directory: directory)
        defer { try? FileManager.default.removeItem(at: directory) }
        let recordURL = directory.appendingPathComponent("future-schema.json")
        let screenshotURL = directory.appendingPathComponent("future-schema.jpg")
        try Data("future schema".utf8).write(to: recordURL)
        try Data([1, 2, 3]).write(to: screenshotURL)
        try FileManager.default.setAttributes(
            [.modificationDate: Date.now.addingTimeInterval(-2 * 24 * 60 * 60)],
            ofItemAtPath: recordURL.path
        )

        await store.pruneExpired()

        #expect(FileManager.default.fileExists(atPath: recordURL.path))
        #expect(FileManager.default.fileExists(atPath: screenshotURL.path))
    }

    @Test
    func savedDraftResumesWithTextReportAndAnnotatedScreenshot() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("PlatformBetaFeedbackSavedDraftTests-\(UUID().uuidString)")
        let store = PlatformBetaFeedbackStore(directory: directory)
        defer { try? FileManager.default.removeItem(at: directory) }
        let annotated = Data([7, 8, 9])
        let draft = PlatformBetaFeedbackDraft(
            id: "saved-draft",
            screenshotJPEG: Data([1, 2, 3]),
            annotatedScreenshotJPEG: annotated,
            diagnostics: diagnostics,
            originalDescription: "The list froze.",
            reportText: "Summary\nThe list froze.",
            usedOnDeviceModel: true
        )

        try await store.saveForLater(draft)
        let resumed = try await store.loadNextResumableDraft()

        #expect(resumed?.id == draft.id)
        #expect(resumed?.originalDescription == draft.originalDescription)
        #expect(resumed?.savedForLater == true)
        #expect(resumed?.usedOnDeviceModel == true)
        #expect(resumed?.submissionScreenshotJPEG == annotated)
    }

    @Test
    func explicitlySavedDraftIsNotRemovedByTemporaryDraftExpiry() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("PlatformBetaFeedbackSavedExpiryTests-\(UUID().uuidString)")
        let store = PlatformBetaFeedbackStore(directory: directory)
        defer { try? FileManager.default.removeItem(at: directory) }
        let saved = PlatformBetaFeedbackDraft(
            id: "saved-for-later",
            screenshotJPEG: Data([1, 2, 3]),
            diagnostics: diagnostics,
            originalDescription: "Keep this report."
        )

        try await store.saveForLater(saved)
        try FileManager.default.setAttributes(
            [.modificationDate: Date.now.addingTimeInterval(-48 * 60 * 60)],
            ofItemAtPath: directory.appendingPathComponent("saved-for-later.json").path
        )
        try await store.save(PlatformBetaFeedbackDraft(
            id: "new-temporary-draft",
            screenshotJPEG: Data([4, 5, 6]),
            diagnostics: diagnostics
        ))

        let loaded = try await store.load(id: saved.id)
        #expect(loaded?.id == saved.id)
        #expect(loaded?.originalDescription == saved.originalDescription)
        #expect(loaded?.savedForLater == true)
    }

    @Test
    func expiredTemporaryDraftRemovesItsScreenshotAndRecord() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("PlatformBetaFeedbackTemporaryExpiryTests-\(UUID().uuidString)")
        let store = PlatformBetaFeedbackStore(directory: directory)
        defer { try? FileManager.default.removeItem(at: directory) }
        let draft = PlatformBetaFeedbackDraft(
            id: "expired-temporary-draft",
            screenshotJPEG: Data([1, 2, 3]),
            annotatedScreenshotJPEG: Data([4, 5, 6]),
            diagnostics: diagnostics
        )

        try await store.save(draft)
        try FileManager.default.setAttributes(
            [.modificationDate: Date.now.addingTimeInterval(-48 * 60 * 60)],
            ofItemAtPath: directory.appendingPathComponent("expired-temporary-draft.json").path
        )
        await store.pruneExpired()

        #expect(try await store.load(id: draft.id) == nil)
        let remaining = try FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: nil
        )
        #expect(remaining.isEmpty)
    }

    @Test
    func expiredSavedDraftHasABoundedThirtyDayLifetime() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("PlatformBetaFeedbackSavedRetentionTests-\(UUID().uuidString)")
        let store = PlatformBetaFeedbackStore(directory: directory)
        defer { try? FileManager.default.removeItem(at: directory) }
        let draft = PlatformBetaFeedbackDraft(
            id: "expired-saved-draft",
            screenshotJPEG: Data([1, 2, 3]),
            diagnostics: diagnostics
        )

        try await store.saveForLater(draft)
        try FileManager.default.setAttributes(
            [.modificationDate: Date.now.addingTimeInterval(-31 * 24 * 60 * 60)],
            ofItemAtPath: directory.appendingPathComponent("expired-saved-draft.json").path
        )
        await store.pruneExpired()

        #expect(try await store.load(id: draft.id) == nil)
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

    private func testScreenshotData() throws -> Data {
        let image = UIGraphicsImageRenderer(size: CGSize(width: 24, height: 24)).image { context in
            UIColor.systemBlue.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 24, height: 24))
        }
        return try #require(image.jpegData(compressionQuality: 0.9))
    }

    private func pixel(in image: CGImage, x: Int, y: Int) throws -> (
        red: UInt8,
        green: UInt8,
        blue: UInt8
    ) {
        var bytes = [UInt8](repeating: 0, count: 4)
        let context = try #require(CGContext(
            data: &bytes,
            width: 1,
            height: 1,
            bitsPerComponent: 8,
            bytesPerRow: 4,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ))
        context.translateBy(x: CGFloat(-x), y: CGFloat(y - image.height + 1))
        context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
        return (bytes[0], bytes[1], bytes[2])
    }

    private enum TestError: Error {
        case generationFailed
    }
}

private actor GitHubRecorder {
    struct Calls: Sendable {
        var uploadedRepository: String?
        var uploadedScreenshot: Data?
        var createdTitle: String?
        var createdBody: String?
        var updatedIssueNumber: Int?
        var updatedBodies: [String] = []
        var deletedUpload: PlatformBetaFeedbackGitHubUpload?
    }

    private(set) var calls = Calls()

    func recordUpload(data: Data, repository: String) {
        calls.uploadedRepository = repository
        calls.uploadedScreenshot = data
    }

    func recordCreate(title: String, body: String, repository: String) {
        calls.createdTitle = title
        calls.createdBody = body
    }

    func recordUpdate(issueNumber: Int, body: String, repository: String) {
        calls.updatedIssueNumber = issueNumber
        calls.updatedBodies.append(body)
    }

    func recordDelete(upload: PlatformBetaFeedbackGitHubUpload) {
        calls.deletedUpload = upload
    }
}

private actor GitHubHTTPRecorder {
    struct Request: Sendable {
        let method: String
        let path: String
        let body: String
    }

    private(set) var requests: [Request] = []

    func send(_ request: URLRequest) throws -> (Data, Int) {
        let method = request.httpMethod ?? ""
        let path = request.url?.path ?? ""
        requests.append(Request(
            method: method,
            path: path,
            body: request.httpBody.flatMap { String(data: $0, encoding: .utf8) } ?? ""
        ))

        if method == "PUT" {
            return (Data(#"{"content":{"html_url":"https://github.com/acme/app/blob/t3-feedback/report.jpg","sha":"upload-sha"}}"#.utf8), 201)
        }
        if path.hasSuffix("/comments") {
            return (Data(#"{"html_url":"https://github.com/acme/app/issues/41#issuecomment-1"}"#.utf8), 201)
        }
        return (Data(#"{"number":41,"title":"Reconnect fails","html_url":"https://github.com/acme/app/issues/41"}"#.utf8), 201)
    }
}
