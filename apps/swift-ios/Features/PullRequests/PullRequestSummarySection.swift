import SwiftUI

struct PullRequestSummarySection<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.headline)
            VStack(alignment: .leading, spacing: 10) {
                content
            }
            .font(T3Typography.threadBody)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .background(T3Colors.surface, in: RoundedRectangle(cornerRadius: 16))
        }
    }
}
