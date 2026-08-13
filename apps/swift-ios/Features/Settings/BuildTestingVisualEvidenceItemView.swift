import SwiftUI

struct BuildTestingVisualEvidenceItemView: View {
    let evidence: BuildTestingManifest.VisualEvidence

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                Text(evidence.title)
                    .font(T3Typography.threadBody)
                    .bold()
                    .foregroundStyle(T3Colors.textPrimary)
                Text(evidence.caption)
                    .font(T3Typography.supporting)
                    .foregroundStyle(T3Colors.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                Label(
                    evidence.isDarkMode ? "Captured in dark mode" : "Appearance not verified",
                    systemImage: evidence.isDarkMode ? "moon.fill" : "exclamationmark.triangle.fill"
                )
                .font(T3Typography.supportingStrong)
                .foregroundStyle(evidence.isDarkMode ? T3Colors.textSecondary : T3Colors.warning)
            }

            switch evidence.kind {
            case .image:
                BuildTestingEvidenceImage(url: evidence.annotatedURL, title: evidence.title)
            case .video:
                BuildTestingEvidenceVideo(url: evidence.annotatedURL)
            }

            VStack(alignment: .leading, spacing: 8) {
                Link(destination: evidence.annotatedURL) {
                    Label("Open annotated \(evidence.kind.rawValue)", systemImage: "sparkles.rectangle.stack")
                }
                Link(destination: evidence.cleanURL) {
                    Label("Open clean \(evidence.kind.rawValue)", systemImage: "rectangle")
                }
            }
            .font(T3Typography.supportingStrong)
            .foregroundStyle(T3Colors.accent)
        }
        .padding(12)
        .background(T3Colors.surfaceRaised, in: RoundedRectangle(cornerRadius: 12))
    }
}
