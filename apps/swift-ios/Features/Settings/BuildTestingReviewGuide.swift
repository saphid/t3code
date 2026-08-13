import SwiftUI

struct BuildTestingReviewGuide: View {
    let entry: BuildTestingManifest.Entry

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            guidance("What changed", text: entry.summary)
            guidance("What to check", text: entry.whatToCheck)
            guidance("Success looks like", text: entry.successLooksLike)
        }
    }

    private func guidance(_ title: String, text: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(T3Typography.supportingStrong)
                .foregroundStyle(T3Colors.textSecondary)
            Text(text)
                .font(T3Typography.threadBody)
                .foregroundStyle(T3Colors.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
