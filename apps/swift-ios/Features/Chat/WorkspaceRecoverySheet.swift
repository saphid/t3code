import SwiftUI

struct WorkspaceRecoverySheet: View {
    @SwiftUI.Environment(\.dismiss) private var dismiss

    let recovery: FeatureWorkspaceRecovery
    let recover: (FeatureWorkspaceRecovery.Selection) async -> Bool

    @State private var isRecovering = false
    @State private var recoveryFailed = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(recovery.detail)
                        .foregroundStyle(T3Colors.textSecondary)
                } header: {
                    Label("Worktree removed", systemImage: "folder.badge.questionmark")
                }

                Section("Thread workspace") {
                    LabeledContent("Branch", value: recovery.branch ?? "Unavailable")
                    LabeledContent("Removed path") {
                        Text(recovery.missingWorktreePath)
                            .font(.caption.monospaced())
                            .multilineTextAlignment(.trailing)
                            .textSelection(.enabled)
                    }
                }

                if !recovery.candidates.isEmpty {
                    Section("Continue in") {
                        ForEach(recovery.candidates) { candidate in
                            Button {
                                recover(using: candidate)
                            } label: {
                                VStack(alignment: .leading, spacing: 4) {
                                    Label(
                                        candidate.displayName,
                                        systemImage: candidate.isProjectRoot
                                            ? "folder"
                                            : "arrow.triangle.branch"
                                    )
                                    Text(candidate.path)
                                        .font(.caption.monospaced())
                                        .foregroundStyle(T3Colors.textSecondary)
                                        .lineLimit(2)
                                    if candidate.dirty {
                                        Label("Contains uncommitted changes", systemImage: "exclamationmark.triangle")
                                            .font(.caption)
                                            .foregroundStyle(.orange)
                                    }
                                }
                            }
                        }
                    } footer: {
                        Text("T3 Code will update this thread only after confirming the repository and exact branch again.")
                    }
                }

                if recovery.canRecreate {
                    Section {
                        Button {
                            beginRecovery(.recreateWorktree)
                        } label: {
                            Label("Recreate worktree", systemImage: "plus.rectangle.on.folder")
                        }
                    } footer: {
                        Text("Creates the recorded branch again at the removed path.")
                    }
                }
            }
            .disabled(isRecovering)
            .navigationTitle("Recover Thread")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(isRecovering ? "Close" : "Leave unchanged") { dismiss() }
                }
                if isRecovering {
                    ToolbarItem(placement: .confirmationAction) {
                        ProgressView()
                            .accessibilityLabel("Recovering thread workspace")
                    }
                }
            }
            .alert("Could not recover worktree", isPresented: $recoveryFailed) {
                Button("OK", role: .cancel) {}
            } message: {
                Text("The thread was left unchanged. Check the connection and try again.")
            }
        }
    }

    private func recover(using candidate: FeatureWorkspaceRecovery.Candidate) {
        if candidate.isProjectRoot {
            beginRecovery(.mainProject)
        } else {
            beginRecovery(.matchingWorktree(path: candidate.path))
        }
    }

    private func beginRecovery(_ selection: FeatureWorkspaceRecovery.Selection) {
        guard !isRecovering else { return }
        isRecovering = true
        Task {
            let recovered = await recover(selection)
            if !recovered {
                isRecovering = false
                recoveryFailed = true
            }
        }
    }
}
