import SwiftUI

struct PullRequestSummaryView: View {
    let detail: PullRequestDetail

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 10) {
                    Text(detail.title)
                        .font(.title2.bold())
                        .foregroundStyle(T3Colors.textPrimary)
                    Text("\(detail.projectTitle) · \(detail.repository) #\(detail.number)")
                        .font(T3Typography.supporting)
                        .foregroundStyle(T3Colors.textSecondary)
                    HStack(spacing: 12) {
                        Label(stateLabel, systemImage: stateImage)
                        Label(detail.author?.login ?? "ghost", systemImage: "person.crop.circle")
                    }
                    .font(T3Typography.supporting)
                    .foregroundStyle(T3Colors.textSecondary)
                }

                PullRequestSummarySection(title: "Branches") {
                    LabeledContent("From", value: detail.headBranch)
                    LabeledContent("Into", value: detail.baseBranch)
                }

                PullRequestSummarySection(title: "Changes") {
                    LabeledContent("Files", value: detail.changedFiles.formatted())
                    LabeledContent("Additions", value: "+\(detail.additions)")
                    LabeledContent("Deletions", value: "−\(detail.deletions)")
                    LabeledContent("Mergeability", value: mergeabilityLabel)
                }

                if !detail.labels.isEmpty {
                    PullRequestSummarySection(title: "Labels") {
                        ScrollView(.horizontal) {
                            HStack {
                                ForEach(detail.labels, id: \.name) { label in
                                    Text(label.name)
                                        .font(T3Typography.supporting)
                                        .padding(.horizontal, 10)
                                        .frame(minHeight: 30)
                                        .background(T3Colors.input, in: Capsule())
                                }
                            }
                        }
                        .scrollIndicators(.hidden)
                    }
                }

                PullRequestSummarySection(title: "Description") {
                    if detail.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        Text("No description provided.")
                            .foregroundStyle(T3Colors.textSecondary)
                    } else {
                        Text(markdown: detail.body)
                            .textSelection(.enabled)
                            .environment(\.openURL, OpenURLAction { url in
                                PullRequestInboxModel.safeURL(url.absoluteString) == nil
                                    ? .discarded
                                    : .systemAction(url)
                            })
                    }
                }

                PullRequestSummarySection(title: "Checks") {
                    if detail.checks.isEmpty {
                        Text("No checks reported.")
                            .foregroundStyle(T3Colors.textSecondary)
                    } else {
                        ForEach(Array(detail.checks.enumerated()), id: \.offset) { _, check in
                            HStack(spacing: 10) {
                                Image(systemName: checkImage(check.status))
                                    .foregroundStyle(checkStyle(check.status))
                                    .accessibilityHidden(true)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(check.name)
                                    if let description = check.description {
                                        Text(description)
                                            .font(T3Typography.supporting)
                                            .foregroundStyle(T3Colors.textSecondary)
                                    }
                                }
                                Spacer(minLength: 8)
                                Text(check.status.rawValue.capitalized)
                                    .font(T3Typography.supporting)
                                    .foregroundStyle(T3Colors.textSecondary)
                            }
                            .accessibilityElement(children: .combine)
                        }
                    }
                }

                PullRequestSummarySection(title: "Reviewers") {
                    if detail.reviewers.isEmpty {
                        Text("No reviewers requested.")
                            .foregroundStyle(T3Colors.textSecondary)
                    } else {
                        ForEach(Array(detail.reviewers.enumerated()), id: \.offset) { _, reviewer in
                            Label(reviewer.login, systemImage: "person.crop.circle")
                        }
                    }
                }

                if let url = PullRequestInboxModel.safeURL(detail.url) {
                    Link(destination: url) {
                        Label("Open on host", systemImage: "arrow.up.right.square")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .accessibilityHint("Opens the pull request in your browser")
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 32)
        }
        .scrollIndicators(.hidden)
    }

    private var stateLabel: String {
        detail.isDraft ? "Draft" : detail.state.rawValue.capitalized
    }

    private var stateImage: String {
        if detail.isDraft { return "pencil.circle" }
        return switch detail.state {
        case .open: "arrow.triangle.pull"
        case .merged: "arrow.triangle.merge"
        case .closed: "xmark.circle"
        case .unknown: "questionmark.circle"
        }
    }

    private var mergeabilityLabel: String {
        switch detail.mergeability {
        case .mergeable: "Mergeable"
        case .conflicting: "Conflicts"
        case .unknown: "Unknown"
        }
    }

    private func checkImage(_ status: PullRequestCheckStatus) -> String {
        switch status {
        case .success: "checkmark.circle.fill"
        case .failure, .cancelled: "xmark.circle.fill"
        case .pending: "clock"
        case .skipped, .neutral, .unknown: "minus.circle"
        }
    }

    private func checkStyle(_ status: PullRequestCheckStatus) -> Color {
        switch status {
        case .success: T3Colors.success
        case .failure, .cancelled: T3Colors.danger
        case .pending: T3Colors.warning
        case .skipped, .neutral, .unknown: T3Colors.textSecondary
        }
    }
}

private extension Text {
    init(markdown: String) {
        self.init(MarkdownInlineFormatter.format(markdown))
    }
}
