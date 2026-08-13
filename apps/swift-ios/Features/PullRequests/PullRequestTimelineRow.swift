import SwiftUI

struct PullRequestTimelineRow: View {
    let item: PullRequestInboxModel.TimelineItem

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: image)
                .foregroundStyle(style)
                .frame(width: 28, height: 28)
                .background(T3Colors.surface, in: Circle())
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 7) {
                Text("\(item.actor?.login ?? "T3") \(item.title)")
                    .font(T3Typography.threadBody)
                HStack(spacing: 8) {
                    if let date = PullRequestInboxModel.date(item.at) {
                        Text(date, style: .relative)
                    } else {
                        Text(item.at)
                    }
                    if let path = item.path {
                        Label(path, systemImage: "doc.text")
                            .lineLimit(1)
                    }
                }
                .font(T3Typography.supporting)
                .foregroundStyle(T3Colors.textSecondary)

                if let body = item.body, !body.isEmpty {
                    Text(body)
                        .font(T3Typography.threadBody)
                        .textSelection(.enabled)
                }

                if let additions = item.additions, let deletions = item.deletions {
                    Text("+\(additions)  −\(deletions)")
                        .font(T3Typography.supporting.monospacedDigit())
                        .foregroundStyle(T3Colors.textSecondary)
                        .accessibilityLabel("\(additions) additions, \(deletions) deletions")
                }

                if let url = PullRequestInboxModel.safeURL(item.url) {
                    Link("Open activity on host", destination: url)
                        .font(T3Typography.supporting)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }

    private var image: String {
        switch item.kind {
        case .lifecycle: "arrow.triangle.pull"
        case .commit: "point.topleft.down.to.point.bottomright.curvepath"
        case .comment: "bubble.left"
        case let .reviewThread(resolved): resolved ? "checkmark.bubble" : "text.bubble"
        }
    }

    private var style: Color {
        switch item.kind {
        case .lifecycle: T3Colors.accent
        case .commit: T3Colors.textSecondary
        case .comment: T3Colors.textPrimary
        case let .reviewThread(resolved): resolved ? T3Colors.success : T3Colors.warning
        }
    }
}
