import SwiftUI

struct BuildTestingView: View {
    @Bindable var model: FeatureRootModel
    let manifest: BuildTestingManifest?
    let presentation: BuildTestingPresentation
    let onOpenThread: (FeatureThread) -> Void

    @State private var isSubmitting = false
    @State private var resultMessage = ""
    @State private var isShowingResult = false
    @State private var resultTitle = "Testing verdict"
    @State private var currentReviewID: String?
    @State private var startingDiscussionID: String?
    @State private var submittedVerdicts: [String: BuildTestingDecision.Verdict]

    init(
        model: FeatureRootModel,
        manifest: BuildTestingManifest?,
        presentation: BuildTestingPresentation,
        onOpenThread: @escaping (FeatureThread) -> Void = { _ in }
    ) {
        self.model = model
        self.manifest = manifest
        self.presentation = presentation
        self.onOpenThread = onOpenThread
        _currentReviewID = State(
            initialValue: manifest.flatMap { BuildTestingCurrentReviewStore.entryID(for: $0) }
        )
        _submittedVerdicts = State(
            initialValue: manifest.map { BuildTestingVerdictStore.verdicts(for: $0) } ?? [:]
        )
    }

    var body: some View {
        ScrollView {
            // Review cards own disclosure and verdict state. Keeping this stack
            // materialized preserves that state while Alex checks long evidence.
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 6) {
                    if let manifest, manifest.channel == presentation.channel {
                        Text("Build \(manifest.build) · Revision \(String(manifest.revision.prefix(7)))")
                            .font(T3Typography.homeTitle)
                            .foregroundStyle(T3Colors.textPrimary)
                            .accessibilityIdentifier("build-testing-build-identity")
                        Text(presentation.pipelinePosition)
                            .font(T3Typography.supportingStrong)
                            .foregroundStyle(T3Colors.textSecondary)
                        Text("Expand each item for what changed, what to check, and the exact signs of success before recording a verdict.")
                            .font(T3Typography.supporting)
                            .foregroundStyle(T3Colors.textSecondary)
                    } else {
                        Text("This build does not contain stream metadata.")
                            .font(T3Typography.supporting)
                            .foregroundStyle(T3Colors.textSecondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.bottom, 8)

                if let manifest, manifest.channel == presentation.channel,
                    !manifest.entries.isEmpty
                {
                    BuildTestingPipelineDiagram()

                    if let currentReview = manifest.entries.first(where: { $0.id == currentReviewID }) {
                        Label("Current review: \(currentReview.name)", systemImage: "checkmark.circle.fill")
                            .font(T3Typography.supportingStrong)
                            .foregroundStyle(T3Colors.accent)
                            .accessibilityIdentifier("build-testing-current-review")
                    } else {
                        Text("Choose “Review this item” to focus one item and open its discussion tools.")
                            .font(T3Typography.supporting)
                            .foregroundStyle(T3Colors.textSecondary)
                    }

                    ForEach(manifest.entries) { entry in
                        BuildTestingFeatureView(
                            entry: entry,
                            manifest: manifest,
                            presentation: presentation,
                            isSubmitting: isSubmitting,
                            isCurrentReview: currentReviewID == entry.id,
                            isStartingDiscussion: startingDiscussionID == entry.id,
                            submittedVerdict: submittedVerdicts[entry.id],
                            onSelectForReview: { selectForReview(entry, manifest: manifest) },
                            onOpenActiveThread: { openActiveThread(for: entry) },
                            onStartDiscussion: { startDiscussion(for: entry, manifest: manifest) },
                            onDecision: submit
                        )
                    }
                } else {
                    ContentUnavailableView(
                        presentation.emptyTitle,
                        systemImage: "checklist",
                        description: Text(presentation.emptyDescription)
                    )
                    .frame(maxWidth: .infinity)
                    .padding(.top, 40)
                }
            }
            .padding(20)
        }
        .background(T3Colors.background)
        .navigationTitle(presentation.navigationTitle)
        .navigationBarTitleDisplayMode(.inline)
        .alert(
            resultTitle,
            isPresented: $isShowingResult
        ) {
        } message: {
            Text(resultMessage)
        }
    }

    private func submit(_ decision: BuildTestingDecision) {
        resultTitle = "Testing verdict"
        guard let sourceThread = decision.entry.threads.first,
            let thread = PlatformRouteResolver.thread(
                in: model.snapshot,
                environmentID: nil,
                id: sourceThread.id
            )
        else {
            resultMessage = "The owning T3 thread is unavailable or ambiguous across connected environments on this device."
            isShowingResult = true
            return
        }

        isSubmitting = true
        Task {
            let sent = await model.sendMessage(
                threadID: thread.id,
                text: decision.prompt,
                selection: nil
            )
            isSubmitting = false
            if sent {
                submittedVerdicts[decision.entry.id] = decision.verdict
                BuildTestingVerdictStore.record(
                    decision.verdict,
                    entryID: decision.entry.id,
                    manifest: decision.manifest
                )
                resultMessage = "Verdict queued for \(sourceThread.title)."
            } else {
                resultMessage = "The verdict could not be queued. Check the connected environment and try again."
            }
            isShowingResult = true
        }
    }

    private func selectForReview(
        _ entry: BuildTestingManifest.Entry,
        manifest: BuildTestingManifest
    ) {
        currentReviewID = entry.id
        BuildTestingCurrentReviewStore.select(entryID: entry.id, manifest: manifest)
    }

    private func sourceThread(for entry: BuildTestingManifest.Entry) -> FeatureThread? {
        return entry.threads
            .compactMap { source in
                PlatformRouteResolver.thread(
                    in: model.snapshot,
                    environmentID: nil,
                    id: source.id
                )
            }
            .filter { !$0.isArchived }
            .max { $0.updatedAt < $1.updatedAt }
    }

    private func openActiveThread(for entry: BuildTestingManifest.Entry) {
        guard let thread = sourceThread(for: entry) else {
            showDiscussionError(
                "The active source thread is unavailable or ambiguous across connected environments on this device."
            )
            return
        }
        onOpenThread(thread)
    }

    private func startDiscussion(
        for entry: BuildTestingManifest.Entry,
        manifest: BuildTestingManifest
    ) {
        guard let source = sourceThread(for: entry) else {
            showDiscussionError(
                "A new discussion needs the active source thread so it can use the correct project and workspace. That thread is unavailable or ambiguous on this device."
            )
            return
        }

        startingDiscussionID = entry.id
        let discussion = BuildTestingDiscussion(manifest: manifest, entry: entry)
        Task {
            let thread = await model.startTask(
                NewTaskRequest(
                    projectID: source.projectID,
                    prompt: discussion.prompt,
                    selection: nil,
                    runtimeMode: source.runtimeMode,
                    interactionMode: source.interactionMode,
                    workspaceMode: .local,
                    worktreePath: source.worktreePath
                )
            )
            startingDiscussionID = nil
            guard let thread else {
                showDiscussionError(
                    model.errorMessage ?? "The new review discussion could not be started."
                )
                return
            }
            onOpenThread(thread)
        }
    }

    private func showDiscussionError(_ message: String) {
        resultTitle = "Review discussion"
        resultMessage = message
        isShowingResult = true
    }
}
