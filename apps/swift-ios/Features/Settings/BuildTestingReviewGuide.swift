import SwiftUI

struct BuildTestingReviewGuide: View {
    let entry: BuildTestingManifest.Entry

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            guidance("Original problem", text: entry.problem)
            reproductionSteps
            guidance("What changed", text: entry.summary)
            guidance("What to check", text: entry.whatToCheck)
            guidance("Success looks like", text: entry.successLooksLike)
            guidance("Automated validation", text: entry.validationSummary)
            guidance("Known limits", text: entry.knownLimitations)
        }
    }

    private var reproductionSteps: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Steps to reproduce")
                .font(T3Typography.supportingStrong)
                .foregroundStyle(T3Colors.textSecondary)
            ForEach(Array(entry.reproductionSteps.enumerated()), id: \.offset) { index, step in
                Text("\(index + 1). \(step)")
                    .font(T3Typography.threadBody)
                    .foregroundStyle(T3Colors.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
            }
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
