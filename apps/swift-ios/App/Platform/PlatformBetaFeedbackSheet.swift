import SwiftUI

struct PlatformBetaFeedbackSheet: View {
    let projects: [FeatureProject]
    let threads: [FeatureThread]
    let onCancel: () -> Void
    let onSave: (PlatformBetaFeedbackDraft) async throws -> Void
    let onPersist: (PlatformBetaFeedbackDraft) async throws -> Void
    let onCreateTask: (String, String, Data) async throws -> Bool
    let onFollowUp: (String, String, Data) async throws -> Bool
    let onFinished: () -> Void

    @SwiftUI.Environment(\.openURL) private var openURL
    @State private var model: PlatformBetaFeedbackSheetModel
    @State private var githubRoute: PlatformBetaFeedbackGitHubRoute?
    @State private var t3Route: PlatformBetaFeedbackT3Route?
    @State private var sharePayload: PlatformBetaFeedbackSharePayload?
    @State private var showingCancelConfirmation = false
    @State private var isSaving = false
    @State private var reviewTask: Task<Void, Never>?
    @State private var saveTask: Task<Void, Never>?
    @State private var routeTask: Task<Void, Never>?

    init(
        draft: PlatformBetaFeedbackDraft,
        projects: [FeatureProject],
        threads: [FeatureThread],
        onCancel: @escaping () -> Void,
        onSave: @escaping (PlatformBetaFeedbackDraft) async throws -> Void,
        onPersist: @escaping (PlatformBetaFeedbackDraft) async throws -> Void,
        onCreateTask: @escaping (String, String, Data) async throws -> Bool,
        onFollowUp: @escaping (String, String, Data) async throws -> Bool,
        onFinished: @escaping () -> Void
    ) {
        self.projects = projects
        self.threads = threads
        self.onCancel = onCancel
        self.onSave = onSave
        self.onPersist = onPersist
        self.onCreateTask = onCreateTask
        self.onFollowUp = onFollowUp
        self.onFinished = onFinished
        _model = State(initialValue: PlatformBetaFeedbackSheetModel(draft: draft))
    }

    var body: some View {
        @Bindable var model = model

        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    PlatformBetaFeedbackScreenshotSection(
                        screenshotJPEG: model.draft.submissionScreenshotJPEG,
                        hasMarkup: model.draft.annotatedScreenshotJPEG != nil,
                        onAnnotate: { model.isAnnotating = true }
                    )
                    if model.reportText.isEmpty {
                        PlatformBetaFeedbackDescriptionSection(
                            descriptionText: $model.descriptionText,
                            notificationWasUnavailable: model.draft.notificationWasUnavailable,
                            isStructuring: model.isStructuring
                        )
                    } else {
                        PlatformBetaFeedbackReportSection(
                            reportText: $model.reportText,
                            fallbackMessage: model.fallbackMessage,
                            usedOnDeviceModel: model.usedOnDeviceModel
                        )
                    }
                    if let errorMessage = model.errorMessage {
                        Label(errorMessage, systemImage: "exclamationmark.triangle")
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                }
                .padding()
            }
            .navigationTitle(model.reportText.isEmpty ? "Quick beta feedback" : "Review report")
            .navigationBarTitleDisplayMode(.inline)
            // This ScrollView uses systemBackground, unlike the Form-backed sheet chrome.
            .toolbarBackground(Color(uiColor: .systemBackground), for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", role: .cancel, action: requestCancel)
                        .disabled(isSaving)
                }
                ToolbarItem(placement: .primaryAction) {
                    if model.reportText.isEmpty {
                        Button("Review", action: review)
                            .disabled(model.canReview == false)
                    } else {
                        Menu("Send", systemImage: "paperplane") {
                            Button("Create GitHub issue", systemImage: "plus.circle") {
                                prepareRoute { githubRoute = .create }
                            }
                            Button("Update GitHub issue", systemImage: "arrow.triangle.2.circlepath") {
                                prepareRoute { githubRoute = .update }
                            }
                            Divider()
                            Button("New fixing task", systemImage: "square.and.pencil") {
                                prepareRoute { t3Route = .newTask }
                            }
                            Button("Follow-up fixing task", systemImage: "arrowshape.turn.up.left") {
                                prepareRoute { t3Route = .followUp }
                            }
                            Divider()
                            Button("Share with another app", systemImage: "square.and.arrow.up") {
                                prepareShare()
                            }
                        }
                        .disabled(model.canRoute == false)
                        .accessibilityIdentifier("betaFeedbackSendMenu")
                    }
                }
                ToolbarItem(placement: .secondaryAction) {
                    if model.reportText.isEmpty == false {
                        Button("Edit description", systemImage: "pencil.line") {
                            model.returnToDescription()
                        }
                    }
                }
                ToolbarItem(placement: .bottomBar) {
                    Button("Save for later", systemImage: "tray.and.arrow.down", action: save)
                        .disabled(isSaving)
                        .accessibilityIdentifier("betaFeedbackSaveForLater")
                }
            }
            .fullScreenCover(isPresented: $model.isAnnotating) {
                PlatformBetaFeedbackMarkupEditor(
                    sourceJPEG: model.draft.screenshotJPEG,
                    initialMarkup: model.markup,
                    onCancel: { model.isAnnotating = false },
                    onDone: model.applyMarkup
                )
            }
            .sheet(item: $githubRoute) { route in
                PlatformBetaFeedbackGitHubSheet(
                    route: route,
                    report: model.reportText,
                    screenshotJPEG: model.draft.submissionScreenshotJPEG,
                    onCompleted: finishGitHubSubmission
                )
            }
            .sheet(item: $t3Route) { route in
                PlatformBetaFeedbackT3Sheet(
                    route: route,
                    projects: projects,
                    threads: threads,
                    report: model.reportText,
                    screenshotJPEG: model.draft.submissionScreenshotJPEG,
                    onCreateTask: { projectID in
                        try await onCreateTask(
                            projectID,
                            model.reportText,
                            model.draft.submissionScreenshotJPEG
                        )
                    },
                    onFollowUp: { threadID in
                        try await onFollowUp(
                            threadID,
                            model.reportText,
                            model.draft.submissionScreenshotJPEG
                        )
                    },
                    onCompleted: onFinished
                )
            }
            .sheet(item: $sharePayload) { payload in
                PlatformBetaFeedbackActivityView(
                    payload: payload,
                    onDismiss: {
                        payload.removeTemporaryFile()
                        sharePayload = nil
                    },
                    onComplete: onFinished
                )
            }
            .confirmationDialog(
                "Keep this feedback?",
                isPresented: $showingCancelConfirmation,
                titleVisibility: .visible
            ) {
                Button("Save for later", action: save)
                Button("Discard report", role: .destructive, action: discard)
                Button("Keep editing", role: .cancel) {}
            } message: {
                Text("Save the screenshot and report to finish later, or discard them from this device.")
            }
            .task {
                await model.structureInlineResponseIfNeeded()
            }
            .onDisappear {
                reviewTask?.cancel()
                saveTask?.cancel()
                routeTask?.cancel()
                sharePayload?.removeTemporaryFile()
            }
            .interactiveDismissDisabled(isSaving || hasProtectedContent)
        }
    }

    private func review() {
        reviewTask?.cancel()
        reviewTask = Task { @MainActor in
            defer { reviewTask = nil }
            await model.structureReport()
        }
    }

    private func save() {
        guard isSaving == false else { return }
        isSaving = true
        let draft = model.reviewedDraft
        saveTask = Task { @MainActor in
            defer {
                isSaving = false
                saveTask = nil
            }
            do {
                try await onSave(draft)
            } catch is CancellationError {
                return
            } catch {
                model.errorMessage = error.localizedDescription
            }
        }
    }

    private func prepareRoute(_ present: @escaping @MainActor () -> Void) {
        persistReviewedDraft {
            present()
        }
    }

    private func prepareShare() {
        persistReviewedDraft {
            do {
                sharePayload = try PlatformBetaFeedbackSharePayload.prepare(
                    report: model.reportText,
                    screenshotJPEG: model.draft.submissionScreenshotJPEG
                )
            } catch {
                model.errorMessage = error.localizedDescription
            }
        }
    }

    private func persistReviewedDraft(onSuccess: @escaping @MainActor () -> Void) {
        guard isSaving == false else { return }
        routeTask?.cancel()
        isSaving = true
        let draft = model.reviewedDraft
        routeTask = Task { @MainActor in
            defer {
                isSaving = false
                routeTask = nil
            }
            do {
                try await onPersist(draft)
                try Task.checkCancellation()
                onSuccess()
            } catch is CancellationError {
                return
            } catch {
                model.errorMessage = error.localizedDescription
            }
        }
    }

    private var hasProtectedContent: Bool {
        model.draft.savedForLater
            || model.descriptionText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
            || model.reportText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
            || model.markup.isEmpty == false
    }

    private func requestCancel() {
        if hasProtectedContent {
            showingCancelConfirmation = true
        } else {
            discard()
        }
    }

    private func discard() {
        reviewTask?.cancel()
        saveTask?.cancel()
        onCancel()
    }

    private func finishGitHubSubmission(_ issue: PlatformBetaFeedbackGitHubIssue) {
        openURL(issue.url)
        onFinished()
    }
}

struct PlatformBetaFeedbackExactScreenshotPreview: View {
    let screenshotJPEG: Data
    let accessibilityLabel: String

    var body: some View {
        if let image = UIImage(data: screenshotJPEG) {
            Image(uiImage: image)
                .resizable()
                .scaledToFit()
                .clipShape(RoundedRectangle(cornerRadius: 14))
                .overlay {
                    RoundedRectangle(cornerRadius: 14)
                        .stroke(.quaternary)
                }
                .accessibilityLabel(accessibilityLabel)
                .accessibilityIdentifier("betaFeedbackExactScreenshotPreview")
        } else {
            ContentUnavailableView(
                "Screenshot unavailable",
                systemImage: "photo.badge.exclamationmark"
            )
        }
    }
}

private struct PlatformBetaFeedbackScreenshotSection: View {
    let screenshotJPEG: Data
    let hasMarkup: Bool
    let onAnnotate: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            PlatformBetaFeedbackExactScreenshotPreview(
                screenshotJPEG: screenshotJPEG,
                accessibilityLabel: hasMarkup
                    ? "Exact annotated screenshot that will be attached"
                    : "Captured app screenshot that will be attached"
            )
            Button(
                hasMarkup ? "Edit screenshot drawing" : "Draw on screenshot",
                systemImage: "pencil.tip",
                action: onAnnotate
            )
            .buttonStyle(.bordered)
            .accessibilityIdentifier("betaFeedbackAnnotateScreenshot")
            if hasMarkup {
                Label("This exact annotated image will be attached.", systemImage: "checkmark.circle")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

private struct PlatformBetaFeedbackDescriptionSection: View {
    @Binding var descriptionText: String
    let notificationWasUnavailable: Bool
    let isStructuring: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("What went wrong?")
                .font(.headline)
            TextField("Describe the problem", text: $descriptionText, axis: .vertical)
                .lineLimit(5...10)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("betaFeedbackDescription")
            if notificationWasUnavailable {
                Label(
                    "Notifications are unavailable, so this report opened in the app instead.",
                    systemImage: "bell.slash"
                )
                .font(.footnote)
                .foregroundStyle(.secondary)
            }
            if isStructuring {
                Label("Preparing an editable report on this device…", systemImage: "apple.intelligence")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

private struct PlatformBetaFeedbackReportSection: View {
    @Binding var reportText: String
    let fallbackMessage: String?
    let usedOnDeviceModel: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(
                usedOnDeviceModel ? "Prepared on device" : "Original text preserved",
                systemImage: usedOnDeviceModel ? "apple.intelligence" : "text.document"
            )
            .font(.headline)
            if let fallbackMessage {
                Text(fallbackMessage)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Text("Edit anything before sending. Only this report, the exact image above, and the diagnostics shown in the report leave the app.")
                .font(.footnote)
                .foregroundStyle(.secondary)
            TextField("Reviewed report", text: $reportText, axis: .vertical)
                .lineLimit(12...24)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("betaFeedbackReport")
        }
    }
}
