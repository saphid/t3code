import SwiftUI

struct BuildTestingFeatureView: View {
    let entry: BuildTestingManifest.Entry
    let manifest: BuildTestingManifest
    let presentation: BuildTestingPresentation
    let isSubmitting: Bool
    let submittedVerdict: BuildTestingDecision.Verdict?
    let onDecision: (BuildTestingDecision) -> Void

    @State private var isExpanded = false
    @State private var pendingVerdict: BuildTestingDecision.Verdict?
    @State private var isConfirmingVerdict = false

    var body: some View {
        DisclosureGroup(isExpanded: $isExpanded) {
            VStack(alignment: .leading, spacing: 14) {
                BuildTestingReviewGuide(entry: entry)

                if entry.isProofPending {
                    Label(
                        "Fresh Test proof is being recorded. This item is not ready for approval.",
                        systemImage: "record.circle"
                    )
                    .font(T3Typography.supportingStrong)
                    .foregroundStyle(T3Colors.warning)
                    .accessibilityIdentifier("build-testing-proof-pending")
                }

                if !entry.evidence.isEmpty {
                    BuildTestingVisualEvidenceView(evidence: entry.evidence)
                }

                if !entry.commits.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Commits")
                            .font(T3Typography.supportingStrong)
                            .foregroundStyle(T3Colors.textSecondary)
                        ForEach(entry.commits) { commit in
                            BuildTestingCommitRow(
                                commit: commit,
                                repositoryURL: manifest.repositoryURL
                            )
                        }
                    }
                }

                if !entry.threads.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Threads")
                            .font(T3Typography.supportingStrong)
                            .foregroundStyle(T3Colors.textSecondary)
                        ForEach(entry.threads) { thread in
                            BuildTestingThreadRow(thread: thread)
                        }
                    }
                }

                if let issueURL = entry.issueURL {
                    Link(destination: issueURL) {
                        Label("Owning issue", systemImage: "smallcircle.filled.circle")
                    }
                    .font(T3Typography.supportingStrong)
                    .foregroundStyle(T3Colors.accent)
                }

                HStack(spacing: 10) {
                    Button(presentation.readyLabel) {
                        pendingVerdict = .ready
                        isConfirmingVerdict = true
                    }
                    .buttonStyle(.borderedProminent)
                    .accessibilityIdentifier("build-testing-ready-\(entry.id)")
                    .disabled(
                        entry.isProofPending || isSubmitting || submittedVerdict == .ready
                    )

                    Button("Not ready", role: .destructive) {
                        pendingVerdict = .notReady
                        isConfirmingVerdict = true
                    }
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("build-testing-not-ready-\(entry.id)")
                    .disabled(isSubmitting || submittedVerdict == .notReady)
                }
                .confirmationDialog(
                    pendingDecision?.confirmationTitle ?? "Confirm verdict",
                    isPresented: $isConfirmingVerdict,
                    titleVisibility: .visible,
                    presenting: pendingDecision
                ) { decision in
                    Button(
                        presentation.verdictLabel(decision.verdict),
                        role: decision.verdict == .notReady ? .destructive : nil
                    ) {
                        pendingVerdict = nil
                        onDecision(decision)
                    }
                    Button("Cancel", role: .cancel) { pendingVerdict = nil }
                } message: { _ in
                    Text("This sends an auditable verdict for \(entry.name) from exact build \(manifest.build) to its owning T3 thread.")
                }
                .onChange(of: isConfirmingVerdict) { _, isPresented in
                    if !isPresented { pendingVerdict = nil }
                }
            }
            .padding(.top, 14)
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                Text(entry.name)
                    .font(T3Typography.threadBody)
                    .bold()
                    .foregroundStyle(T3Colors.textPrimary)
                    .accessibilityIdentifier("build-testing-entry-\(entry.id)")
                Text("Priority \(entry.reviewPriority) · \(entry.reviewGroup)")
                    .font(T3Typography.supportingStrong)
                    .foregroundStyle(T3Colors.accent)
                    .accessibilityLabel(
                        "Priority \(entry.reviewPriority), \(entry.reviewGroup)"
                    )
                Text("^[\(entry.commits.count) commit](inflect: true) · ^[\(entry.threads.count) thread](inflect: true)")
                    .font(T3Typography.supporting)
                    .foregroundStyle(T3Colors.textSecondary)
                Text(entry.stateLabel)
                    .font(T3Typography.supporting)
                    .foregroundStyle(T3Colors.textTertiary)
                if let submittedVerdict {
                    Label(
                        "Submitted: \(presentation.verdictLabel(submittedVerdict))",
                        systemImage: "paperplane.fill"
                    )
                    .font(T3Typography.supporting)
                    .foregroundStyle(T3Colors.textSecondary)
                }
            }
        }
        .tint(T3Colors.accent)
        .padding(16)
        .background(T3Colors.surface, in: RoundedRectangle(cornerRadius: 14))
        .overlay {
            RoundedRectangle(cornerRadius: 14)
                .stroke(T3Colors.border, lineWidth: 1)
        }
    }

    private var pendingDecision: BuildTestingDecision? {
        pendingVerdict.map {
            BuildTestingDecision(manifest: manifest, entry: entry, verdict: $0)
        }
    }
}
