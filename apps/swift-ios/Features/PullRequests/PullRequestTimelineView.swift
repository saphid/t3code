import SwiftUI

struct PullRequestTimelineView: View {
    let activity: PullRequestActivity?
    let items: [PullRequestInboxModel.TimelineItem]
    let errorMessage: String?
    let retry: () -> Void

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 18) {
                if let activity, activity.commentsTruncated {
                    Label(
                        "Showing \(activity.comments.count) of \(activity.commentCount) comments. Open on the host to read the rest.",
                        systemImage: "exclamationmark.circle"
                    )
                    .font(T3Typography.supporting)
                    .foregroundStyle(T3Colors.warning)
                    .padding(12)
                    .background(T3Colors.surface, in: RoundedRectangle(cornerRadius: 12))
                }

                if let errorMessage {
                    VStack(alignment: .leading, spacing: 10) {
                        Label("Activity unavailable", systemImage: "exclamationmark.circle")
                            .font(.headline)
                        Text(errorMessage)
                            .font(T3Typography.supporting)
                            .foregroundStyle(T3Colors.textSecondary)
                        Button("Try activity again", action: retry)
                    }
                    .padding(16)
                    .background(T3Colors.surface, in: RoundedRectangle(cornerRadius: 16))
                }

                ForEach(items) { item in
                    PullRequestTimelineRow(item: item)
                }

                if items.isEmpty, errorMessage == nil {
                    ContentUnavailableView("No activity yet", systemImage: "clock")
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 32)
        }
        .scrollIndicators(.hidden)
    }
}
