import SwiftUI

public struct FeatureSourceControlView: View {
    let client: any FeatureClient
    let threadID: String

    @State private var status: FeatureSourceControlStatus?
    @State private var isLoading = true
    @State private var isRunningAction = false
    @State private var errorMessage: String?
    @State private var commitMessage = ""
    @State private var pendingCommitAction: FeatureSourceControlAction?
    @State private var needsLoadAfterAction = false
    @State private var loadRequests = FeatureLatestRequest()
    @AccessibilityFocusState private var recoveryFocus: RecoveryFocus?

    private enum RecoveryFocus: Hashable {
        case branch
    }

    private var errorPresentation: FeatureToolErrorPresentation {
        .resolve(
            errorMessage: errorMessage,
            retainsContent: status?.isRepository == true
        )
    }

    public init(client: any FeatureClient, threadID: String) {
        self.client = client
        self.threadID = threadID
    }

    public var body: some View {
        Group {
            if isLoading, status == nil {
                ProgressView("Loading repository…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let status, status.isRepository {
                statusList(status)
            } else if let errorMessage = errorPresentation.unavailableMessage {
                ContentUnavailableView(
                    "Source control unavailable",
                    systemImage: "arrow.triangle.branch",
                    description: Text(errorMessage)
                )
            } else {
                ContentUnavailableView(
                    "Source control unavailable",
                    systemImage: "arrow.triangle.branch",
                    description: Text(status?.isRepository == false
                        ? "This workspace is not a Git repository."
                        : "Repository status could not be loaded.")
                )
            }
        }
        .background(T3Colors.background)
        .navigationTitle("Source Control")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { Task { await load() } } label: { Image(systemName: "arrow.clockwise") }
                    .disabled(isLoading || isRunningAction)
                    .accessibilityLabel("Reload source control")
            }
        }
        .alert("Commit changes", isPresented: Binding(
            get: { pendingCommitAction != nil },
            set: { if !$0 { pendingCommitAction = nil } }
        )) {
            TextField("Commit message", text: $commitMessage)
            Button("Cancel", role: .cancel) { pendingCommitAction = nil }
            Button("Commit") {
                if let action = pendingCommitAction {
                    Task { await perform(action, message: commitMessage) }
                }
                pendingCommitAction = nil
            }
            .disabled(
                isLoading
                    || isRunningAction
                    || commitMessage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            )
        }
        .task { await load() }
        .safeAreaInset(edge: .top, spacing: 0) {
            if let errorMessage = errorPresentation.inlineMessage {
                FeatureToolErrorNotice(
                    message: errorMessage,
                    isRetrying: isLoading || isRunningAction,
                    retryTitle: "Refresh status",
                    accessibilityIdentifierPrefix: "source-control-recovery"
                ) {
                    await load()
                }
            }
        }
    }

    private func statusList(_ status: FeatureSourceControlStatus) -> some View {
        List {
            Section("Repository") {
                LabeledContent("Branch", value: status.branch ?? "Detached HEAD")
                    .accessibilityIdentifier("source-control-branch")
                    .accessibilityFocused($recoveryFocus, equals: .branch)
                if let upstream = status.upstream {
                    LabeledContent("Upstream", value: upstream)
                }
                HStack {
                    Label("\(status.aheadCount) ahead", systemImage: "arrow.up")
                    Spacer()
                    Label("\(status.behindCount) behind", systemImage: "arrow.down")
                }
                .font(T3Typography.supporting)
                .foregroundStyle(T3Colors.textSecondary)
                if let pullRequest = status.pullRequest {
                    if let url = pullRequest.safeExternalURL {
                        Link(destination: url) {
                            Label("PR \(pullRequest.shortLabel) · \(pullRequest.title)", systemImage: "arrow.up.right.square")
                        }
                    } else {
                        LabeledContent("Pull Request", value: "#\(pullRequest.number) · \(pullRequest.state)")
                    }
                }
            }

            Section("Actions") {
                if status.availableActions.isEmpty {
                    Text(status.isBusy ? "Source control operation in progress" : "No actions available")
                        .foregroundStyle(T3Colors.textSecondary)
                }
                ForEach(status.availableActions, id: \.self) { action in
                    Button {
                        begin(action)
                    } label: {
                        Label(action.title, systemImage: action.icon)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .disabled(isLoading || isRunningAction)
                }
            }

            Section("\(status.files.count) changed \(status.files.count == 1 ? "file" : "files")") {
                if status.files.isEmpty {
                    Label("Working tree clean", systemImage: "checkmark.circle")
                        .foregroundStyle(T3Colors.textSecondary)
                }
                ForEach(status.files) { file in
                    HStack(spacing: 10) {
                        Text(file.state.shortLabel)
                            .font(.caption2.monospaced().weight(.bold))
                            .foregroundStyle(file.state.color)
                            .frame(width: 18)
                        Text(file.path)
                            .font(T3Typography.threadBody)
                            .lineLimit(1)
                        Spacer()
                        if file.isStaged {
                            Text("STAGED")
                                .font(T3Typography.eyebrow)
                                .foregroundStyle(.green)
                        }
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .refreshable { await load() }
        .overlay {
            if isRunningAction {
                ProgressView()
                    .padding(12)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 10))
            }
        }
    }

    private func begin(_ action: FeatureSourceControlAction) {
        if action.requiresMessage {
            commitMessage = ""
            pendingCommitAction = action
        } else {
            Task { await perform(action, message: nil) }
        }
    }

    private func load() async {
        guard !isRunningAction else {
            needsLoadAfterAction = true
            return
        }
        let request = loadRequests.begin()
        isLoading = true
        defer {
            if loadRequests.isCurrent(request) {
                isLoading = false
            }
        }
        let isRecovery = errorMessage != nil && status?.isRepository == true
        do {
            let loadedStatus = try await client.sourceControlStatus(threadID: threadID)
            guard loadRequests.isCurrent(request) else { return }
            status = loadedStatus
            errorMessage = nil
            if isRecovery {
                recoveryFocus = .branch
            }
        } catch {
            guard loadRequests.isCurrent(request) else { return }
            guard let message = FeatureToolErrorPresentation.message(
                for: error,
                taskIsCancelled: Task.isCancelled
            ) else { return }
            errorMessage = message
        }
    }

    private func perform(_ action: FeatureSourceControlAction, message: String?) async {
        guard !isLoading, !isRunningAction else { return }
        isRunningAction = true
        do {
            status = try await client.performSourceControlAction(
                threadID: threadID,
                action: action,
                message: message?.trimmingCharacters(in: .whitespacesAndNewlines)
            )
            errorMessage = nil
        } catch {
            if let message = FeatureToolErrorPresentation.message(
                for: error,
                taskIsCancelled: Task.isCancelled
            ) {
                errorMessage = message
            }
        }
        isRunningAction = false
        if needsLoadAfterAction {
            needsLoadAfterAction = false
            await load()
        }
    }
}

private extension FeatureSourceControlAction {
    var requiresMessage: Bool {
        switch self {
        case .commit, .commitAndPush, .commitPushAndCreatePullRequest: true
        case .push, .pull, .createPullRequest: false
        }
    }

    var title: String {
        switch self {
        case .commit: "Commit changes"
        case .push: "Push"
        case .pull: "Pull latest"
        case .createPullRequest: "Create pull request"
        case .commitAndPush: "Commit and push"
        case .commitPushAndCreatePullRequest: "Commit, push, and create PR"
        }
    }

    var icon: String {
        switch self {
        case .commit: "checkmark.circle"
        case .push: "arrow.up.circle"
        case .pull: "arrow.down.circle"
        case .createPullRequest: "arrow.triangle.pull"
        case .commitAndPush: "arrow.up.circle.fill"
        case .commitPushAndCreatePullRequest: "point.3.connected.trianglepath.dotted"
        }
    }
}

private extension FeatureSourceControlFileState {
    var shortLabel: String {
        switch self {
        case .added: "A"
        case .modified: "M"
        case .deleted: "D"
        case .renamed: "R"
        case .untracked: "?"
        case .conflicted: "!"
        }
    }

    var color: Color {
        switch self {
        case .added: .green
        case .modified: .orange
        case .deleted, .conflicted: .red
        case .renamed: .blue
        case .untracked: .secondary
        }
    }
}
