import SwiftUI

struct BuildTestingCommitRow: View {
    let commit: BuildTestingManifest.Commit
    let repositoryURL: URL?

    var body: some View {
        Group {
            if commit.role != .source, let repositoryURL {
                Link(destination: repositoryURL.appending(path: "commit/\(commit.sha)")) {
                    label
                }
            } else {
                label
            }
        }
        .font(T3Typography.supporting)
        .foregroundStyle(commit.role == .source ? T3Colors.textSecondary : T3Colors.accent)
    }

    private var label: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(commit.role.label)
                    .font(T3Typography.supportingStrong)
                Text(commit.shortSHA)
                    .font(.caption.monospaced())
            }
            Text(commit.title)
                .lineLimit(2)
        }
    }
}
