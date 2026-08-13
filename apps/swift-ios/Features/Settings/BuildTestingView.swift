import SwiftUI

struct BuildTestingView: View {
    @Bindable var model: FeatureRootModel
    let manifest: BuildTestingManifest?
    let presentation: BuildTestingPresentation

    @State private var isSubmitting = false
    @State private var resultMessage = ""
    @State private var isShowingResult = false
    @State private var submittedVerdicts: [String: BuildTestingDecision.Verdict]

    init(
        model: FeatureRootModel,
        manifest: BuildTestingManifest?,
        presentation: BuildTestingPresentation
    ) {
        self.model = model
        self.manifest = manifest
        self.presentation = presentation
        _submittedVerdicts = State(
            initialValue: manifest.map { BuildTestingVerdictStore.verdicts(for: $0) } ?? [:]
        )
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 6) {
                    if let manifest, manifest.channel == presentation.channel {
                        Text("Build \(manifest.build) · Revision \(String(manifest.revision.prefix(7)))")
                            .font(T3Typography.homeTitle)
                            .foregroundStyle(T3Colors.textPrimary)
                        Text("Expand a feature to inspect its exact commits and source thread before recording a verdict.")
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
                    ForEach(manifest.entries) { entry in
                        BuildTestingFeatureView(
                            entry: entry,
                            manifest: manifest,
                            presentation: presentation,
                            isSubmitting: isSubmitting,
                            submittedVerdict: submittedVerdicts[entry.id],
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
            "Testing verdict",
            isPresented: $isShowingResult
        ) {
        } message: {
            Text(resultMessage)
        }
    }

    private func submit(_ decision: BuildTestingDecision) {
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
}
