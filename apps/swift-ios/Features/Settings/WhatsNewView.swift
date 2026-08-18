import SwiftUI

/// What's in this build, as embedded by the build that produced it.
struct WhatsNewView: View {
    let changelog: WhatsNewChangelog
    let buildLabel: String?

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 16) {
                header
                ForEach(Array(changelog.entries.enumerated()), id: \.offset) { _, entry in
                    entryCard(entry)
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 18)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(T3Colors.background)
        .navigationTitle("What's New")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("In this build")
                .font(T3Typography.homeTitle)
                .foregroundStyle(T3Colors.textPrimary)
            if let buildLabel {
                Text(buildLabel)
                    .font(T3Typography.supporting)
                    .foregroundStyle(T3Colors.textSecondary)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func entryCard(_ entry: WhatsNewChangelog.Entry) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(entry.title)
                .font(T3Typography.threadBody)
                .foregroundStyle(T3Colors.textPrimary)
            if let summary = entry.summary {
                Text(summary)
                    .font(T3Typography.supporting)
                    .foregroundStyle(T3Colors.textSecondary)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(T3Colors.surface, in: RoundedRectangle(cornerRadius: 16))
        .accessibilityElement(children: .combine)
    }
}
