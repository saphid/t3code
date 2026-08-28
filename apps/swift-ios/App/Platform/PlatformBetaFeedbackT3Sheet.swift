import SwiftUI

enum PlatformBetaFeedbackT3Route: String, Identifiable {
    case newTask
    case followUp

    var id: String { rawValue }
}

struct PlatformBetaFeedbackT3Sheet: View {
    let route: PlatformBetaFeedbackT3Route
    let projects: [FeatureProject]
    let threads: [FeatureThread]
    let report: String
    let screenshotJPEG: Data
    let onCreateTask: (String) async throws -> Bool
    let onFollowUp: (String) async throws -> Bool
    let onCompleted: () -> Void

    @SwiftUI.Environment(\.dismiss) private var dismiss
    @State private var selectedProjectID: String?
    @State private var selectedThreadID: String?
    @State private var isSubmitting = false
    @State private var errorMessage: String?
    @State private var submissionTask: Task<Void, Never>?

    var body: some View {
        NavigationStack {
            Form {
                Section(route == .newTask ? "New fixing task" : "Follow-up fixing task") {
                    if route == .newTask {
                        if projects.isEmpty {
                            ContentUnavailableView(
                                "No project available",
                                systemImage: "folder.badge.questionmark",
                                description: Text("Connect an environment with a project, or use another destination.")
                            )
                        } else {
                            Picker("Project", selection: $selectedProjectID) {
                                Text("Choose a project").tag(Optional<String>.none)
                                ForEach(projects) { project in
                                    Text(project.name).tag(Optional(project.id))
                                }
                            }
                            .accessibilityIdentifier("betaFeedbackT3Project")
                        }
                    } else if threads.isEmpty {
                        ContentUnavailableView(
                            "No thread available",
                            systemImage: "bubble.left.and.exclamationmark.bubble.right",
                            description: Text("Start a new fixing task or use another destination.")
                        )
                    } else {
                        Picker("Thread", selection: $selectedThreadID) {
                            Text("Choose a thread").tag(Optional<String>.none)
                            ForEach(threads) { thread in
                                Text(thread.title).tag(Optional(thread.id))
                            }
                        }
                        .accessibilityIdentifier("betaFeedbackT3Thread")
                    }
                }

                Section("Exact attachment preview") {
                    PlatformBetaFeedbackExactScreenshotPreview(
                        screenshotJPEG: screenshotJPEG,
                        accessibilityLabel: "Exact annotated screenshot for T3 Code"
                    )
                }

                Section("Reviewed report") {
                    Text(report)
                        .font(.footnote.monospaced())
                        .textSelection(.enabled)
                }

                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                            .accessibilityIdentifier("betaFeedbackT3Error")
                    }
                }
            }
            .navigationTitle(route == .newTask ? "Fix in T3 Code" : "Follow up in T3 Code")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", role: .cancel) { dismiss() }
                        .disabled(isSubmitting)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Send", action: submit)
                        .disabled(isSubmitting || selectedDestinationID == nil)
                        .accessibilityIdentifier("betaFeedbackT3Submit")
                }
            }
            .overlay {
                if isSubmitting {
                    ProgressView("Sending to T3 Code…")
                        .padding()
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                }
            }
            .onDisappear { submissionTask?.cancel() }
            .interactiveDismissDisabled(isSubmitting)
        }
    }

    private var selectedDestinationID: String? {
        route == .newTask ? selectedProjectID : selectedThreadID
    }

    private func submit() {
        guard isSubmitting == false,
              let destinationID = selectedDestinationID else { return }
        isSubmitting = true
        errorMessage = nil

        submissionTask = Task { @MainActor in
            defer { isSubmitting = false }
            do {
                let succeeded = if route == .newTask {
                    try await onCreateTask(destinationID)
                } else {
                    try await onFollowUp(destinationID)
                }
                try Task.checkCancellation()
                if succeeded {
                    onCompleted()
                } else {
                    errorMessage = "T3 Code could not accept the fixing task. The report is still saved here."
                }
            } catch is CancellationError {
                return
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}
