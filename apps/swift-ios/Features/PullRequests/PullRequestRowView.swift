import SwiftUI

struct PullRequestRowView: View {
    let entry: PullRequestListEntry
    let stat: PullRequestDiffStat?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Label(stateLabel, systemImage: stateImage)
                    .font(T3Typography.supporting)
                    .foregroundStyle(stateStyle)
                Text("#\(entry.number)")
                    .font(T3Typography.supporting.monospacedDigit())
                    .foregroundStyle(T3Colors.textSecondary)
                Spacer(minLength: 8)
                if entry.viewerReviewRequested {
                    Label("Review requested", systemImage: "eye")
                        .labelStyle(.iconOnly)
                        .foregroundStyle(T3Colors.accent)
                        .accessibilityLabel("Your review is requested")
                }
            }

            Text(entry.title)
                .font(T3Typography.threadBody)
                .foregroundStyle(T3Colors.textPrimary)
                .lineLimit(3)

            Text("\(entry.projectTitle) · \(entry.repository)")
                .font(T3Typography.supporting)
                .foregroundStyle(T3Colors.textSecondary)
                .lineLimit(2)

            HStack(spacing: 10) {
                Label(entry.author?.login ?? "ghost", systemImage: "person.crop.circle")
                Label(entry.headBranch, systemImage: "arrow.triangle.branch")
                    .lineLimit(1)
                Spacer(minLength: 4)
                diffStat
            }
            .font(T3Typography.supporting)
            .foregroundStyle(T3Colors.textTertiary)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilitySummary)
    }

    private var stateLabel: String {
        if entry.isDraft { return "Draft" }
        return entry.state.rawValue.capitalized
    }

    private var stateImage: String {
        if entry.isDraft { return "pencil.circle" }
        return switch entry.state {
        case .open: "arrow.triangle.pull"
        case .merged: "arrow.triangle.merge"
        case .closed: "xmark.circle"
        case .unknown: "questionmark.circle"
        }
    }

    private var stateStyle: Color {
        switch entry.state {
        case .open: T3Colors.success
        case .merged: T3Colors.accent
        case .closed: T3Colors.danger
        case .unknown: T3Colors.textSecondary
        }
    }

    @ViewBuilder
    private var diffStat: some View {
        if let counts = Self.resolvedChangeCounts(entry: entry, stat: stat) {
            let additions = counts.additions
            let deletions = counts.deletions
            Text("+\(additions)")
                .foregroundStyle(T3Colors.success)
                .accessibilityLabel("\(additions) additions")
            Text("−\(deletions)")
                .foregroundStyle(T3Colors.danger)
                .accessibilityLabel("\(deletions) deletions")
        }
    }

    static func resolvedChangeCounts(
        entry: PullRequestListEntry,
        stat: PullRequestDiffStat?
    ) -> (additions: Int, deletions: Int)? {
        let deferred = entry.additions == 0 && entry.deletions == 0
        if deferred {
            guard let stat else { return nil }
            return (stat.additions, stat.deletions)
        }
        return (entry.additions, entry.deletions)
    }

    private var accessibilitySummary: String {
        "\(stateLabel) pull request \(entry.number), \(entry.title), in \(entry.repository), by \(entry.author?.login ?? "unknown author")"
    }
}
