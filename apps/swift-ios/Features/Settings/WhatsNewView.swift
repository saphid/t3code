import SwiftUI

/// What shipped in this build, followed by the builds before it.
struct WhatsNewView: View {
    let presentation: WhatsNewPresentation
    let runningBuildLabel: String?

    /// The screen is one flat list of rows rather than a section-per-build
    /// nesting: nesting a per-build `ForEach` inside the outer one left the
    /// earlier builds' cards unrendered in the scroll view.
    private enum Row: Identifiable {
        case sectionTitle(id: String, title: String, detail: String?)
        case buildLabel(id: String, text: String)
        case entry(id: String, entry: WhatsNewChangelog.Entry)

        var id: String {
            switch self {
            case let .sectionTitle(id, _, _), let .buildLabel(id, _), let .entry(id, _): id
            }
        }
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 16) {
                ForEach(rows) { row in
                    switch row {
                    case let .sectionTitle(_, title, detail):
                        sectionTitle(title, detail: detail)
                    case let .buildLabel(_, text):
                        Text(text)
                            .font(T3Typography.supportingStrong)
                            .foregroundStyle(T3Colors.textSecondary)
                    case let .entry(_, entry):
                        entryCard(entry)
                    }
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

    private var rows: [Row] {
        var rows: [Row] = []

        if let current = presentation.current {
            rows.append(
                .sectionTitle(
                    id: "current-title",
                    title: "In this build",
                    detail: current.label ?? runningBuildLabel
                )
            )
            rows.append(
                contentsOf: current.entries.enumerated().map { index, entry in
                    .entry(id: "current-entry-\(index)", entry: entry)
                }
            )
        }

        guard !presentation.earlier.isEmpty else { return rows }

        rows.append(
            .sectionTitle(
                id: "earlier-title",
                title: "Earlier builds",
                detail: presentation.current == nil ? runningBuildLabel : nil
            )
        )
        for (buildIndex, build) in presentation.earlier.enumerated() {
            if let label = build.label {
                rows.append(.buildLabel(id: "earlier-\(buildIndex)-label", text: label))
            }
            rows.append(
                contentsOf: build.entries.enumerated().map { index, entry in
                    .entry(id: "earlier-\(buildIndex)-entry-\(index)", entry: entry)
                }
            )
        }
        return rows
    }

    private func sectionTitle(_ title: String, detail: String?) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(T3Typography.homeTitle)
                .foregroundStyle(T3Colors.textPrimary)
            if let detail {
                Text(detail)
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
