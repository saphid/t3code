import SwiftUI

enum PlatformBetaFeedbackGitHubRoute: String, Identifiable {
    case create
    case update

    var id: String { rawValue }
}

struct PlatformBetaFeedbackGitHubSheet: View {
    let route: PlatformBetaFeedbackGitHubRoute
    let report: String
    let screenshotJPEG: Data
    let onCompleted: (PlatformBetaFeedbackGitHubIssue) -> Void

    @SwiftUI.Environment(\.dismiss) private var dismiss
    @State private var repository = ""
    @State private var feedbackBranch = "t3-feedback"
    @State private var token = ""
    @State private var title = ""
    @State private var issues: [PlatformBetaFeedbackGitHubIssue] = []
    @State private var selectedIssueNumber: Int?
    @State private var issueNumberText = ""
    @State private var isLoadingConfiguration = true
    @State private var isLoadingIssues = false
    @State private var isSubmitting = false
    @State private var errorMessage: String?
    @State private var loadTask: Task<Void, Never>?
    @State private var submissionTask: Task<Void, Never>?

    private let api = PlatformBetaFeedbackGitHubAPI()

    var body: some View {
        NavigationStack {
            Form {
                Section("Tracker") {
                    TextField("Repository (owner/name)", text: $repository)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .accessibilityIdentifier("betaFeedbackGitHubRepository")
                    TextField("Screenshot branch", text: $feedbackBranch)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SecureField("Fine-grained token", text: $token)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .accessibilityIdentifier("betaFeedbackGitHubToken")
                    Text("The token stays in this device's Keychain. It needs Issues and Contents write access. The image is committed permanently to the existing dedicated branch; deleting the issue does not remove it.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                if route == .create {
                    Section("New issue") {
                        TextField("Issue title", text: $title)
                            .accessibilityIdentifier("betaFeedbackGitHubIssueTitle")
                    }
                } else {
                    Section("Existing issue") {
                        TextField("Issue number", text: $issueNumberText)
                            .keyboardType(.numberPad)
                            .accessibilityIdentifier("betaFeedbackGitHubIssueNumber")
                        Text("Enter any existing issue number, including one outside the open-issue list.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        if issues.isEmpty {
                            Button("Load open issues", systemImage: "arrow.clockwise", action: loadIssues)
                                .disabled(isLoadingIssues || isSubmitting)
                        } else {
                            Picker("Issue", selection: $selectedIssueNumber) {
                                Text("Choose an issue").tag(Optional<Int>.none)
                                ForEach(issues) { issue in
                                    Text("#\(issue.number) \(issue.title)")
                                        .tag(Optional(issue.number))
                                }
                            }
                            .accessibilityIdentifier("betaFeedbackGitHubExistingIssue")
                            .onChange(of: selectedIssueNumber) { _, number in
                                if let number { issueNumberText = String(number) }
                            }
                            Button("Refresh open issues", systemImage: "arrow.clockwise", action: loadIssues)
                                .disabled(isLoadingIssues || isSubmitting)
                        }
                        if isLoadingIssues {
                            ProgressView("Loading open issues…")
                        }
                    }
                }

                Section("Exact attachment preview") {
                    PlatformBetaFeedbackExactScreenshotPreview(
                        screenshotJPEG: screenshotJPEG,
                        accessibilityLabel: "Exact annotated screenshot for GitHub"
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
                            .accessibilityIdentifier("betaFeedbackGitHubError")
                    }
                }
            }
            .navigationTitle(route == .create ? "Create GitHub issue" : "Update GitHub issue")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", role: .cancel, action: cancel)
                        .disabled(isSubmitting)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(route == .create ? "Create" : "Update", action: submit)
                        .disabled(isLoadingConfiguration || isSubmitting || submissionUnavailable)
                        .accessibilityIdentifier("betaFeedbackGitHubSubmit")
                }
            }
            .overlay {
                if isSubmitting {
                    ProgressView(route == .create ? "Creating issue…" : "Updating issue…")
                        .padding()
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                }
            }
            .task {
                await loadConfiguration()
            }
            .onChange(of: repository) {
                guard isLoadingConfiguration == false else { return }
                loadTask?.cancel()
                issues = []
                selectedIssueNumber = nil
                issueNumberText = ""
                isLoadingIssues = false
            }
            .onDisappear {
                loadTask?.cancel()
                submissionTask?.cancel()
            }
            .interactiveDismissDisabled(isSubmitting)
        }
    }

    private var configuration: PlatformBetaFeedbackGitHubConfiguration {
        PlatformBetaFeedbackGitHubConfiguration(
            repository: repository.trimmingCharacters(in: .whitespacesAndNewlines),
            feedbackBranch: feedbackBranch.trimmingCharacters(in: .whitespacesAndNewlines),
            token: token.trimmingCharacters(in: .whitespacesAndNewlines)
        )
    }

    private var submissionUnavailable: Bool {
        if configuration.validationMessage != nil { return true }
        return switch route {
        case .create:
            title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        case .update:
            chosenIssueNumber == nil
        }
    }

    private var chosenIssueNumber: Int? {
        guard let number = Int(issueNumberText), number > 0 else { return nil }
        return number
    }

    private func loadConfiguration() async {
        defer { isLoadingConfiguration = false }
        if title.isEmpty { title = Self.suggestedTitle(from: report) }
        do {
            let saved = try await PlatformBetaFeedbackGitHubConfigurationStore.shared.load()
            repository = saved.repository
            feedbackBranch = saved.feedbackBranch
            token = saved.token
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func loadIssues() {
        guard isLoadingIssues == false else { return }
        loadTask?.cancel()
        isLoadingIssues = true
        errorMessage = nil
        let configuration = configuration
        loadTask = Task { @MainActor in
            defer { isLoadingIssues = false }
            do {
                if let validationMessage = configuration.validationMessage {
                    throw PlatformBetaFeedbackGitHubError.invalidConfiguration(validationMessage)
                }
                try await PlatformBetaFeedbackGitHubConfigurationStore.shared.save(configuration)
                let loadedIssues = try await api.listOpenIssues(configuration: configuration)
                try Task.checkCancellation()
                guard self.configuration.repository == configuration.repository else { return }
                issues = loadedIssues
                selectedIssueNumber = nil
            } catch is CancellationError {
                return
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func submit() {
        guard isSubmitting == false, submissionUnavailable == false else { return }
        isSubmitting = true
        errorMessage = nil
        let configuration = configuration
        let submission: PlatformBetaFeedbackGitHubSubmission
        switch route {
        case .create:
            submission = .create(title: title)
        case .update:
            let number = chosenIssueNumber ?? 0
            let issueTitle = issues.first(where: { $0.number == number })?.title ?? "Issue #\(number)"
            submission = .update(issueNumber: number, title: issueTitle)
        }

        submissionTask = Task { @MainActor in
            defer { isSubmitting = false }
            do {
                try await PlatformBetaFeedbackGitHubConfigurationStore.shared.save(configuration)
                let issue = try await api.gateway.submit(
                    submission,
                    report: report,
                    screenshotJPEG: screenshotJPEG,
                    configuration: configuration
                )
                try Task.checkCancellation()
                onCompleted(issue)
            } catch is CancellationError {
                return
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func cancel() {
        loadTask?.cancel()
        dismiss()
    }

    static func suggestedTitle(from report: String) -> String {
        let lines = report.split(separator: "\n").map {
            String($0).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        if let summaryIndex = lines.firstIndex(where: {
            Self.headingName($0)?.caseInsensitiveCompare("Summary") == .orderedSame
        }),
           lines.indices.contains(summaryIndex + 1),
           Self.headingName(lines[summaryIndex + 1]) == nil {
            return String(lines[summaryIndex + 1].prefix(120))
        }
        return String((lines.first(where: {
            $0.isEmpty == false && Self.headingName($0) == nil
        }) ?? "Beta feedback").prefix(120))
    }

    private static func headingName(_ line: String) -> String? {
        let name = line.trimmingCharacters(in: CharacterSet(charactersIn: "# *_:"))
        let headings = ["summary", "observed", "expected", "diagnostics", "original tester text"]
        return headings.contains(name.lowercased()) ? name : nil
    }
}
