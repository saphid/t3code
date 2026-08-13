import SwiftUI

struct BuildTestingVisualEvidenceView: View {
    let evidence: [BuildTestingManifest.VisualEvidence]

    @State private var isExpanded = false

    var body: some View {
        DisclosureGroup(isExpanded: $isExpanded) {
            VStack(alignment: .leading, spacing: 10) {
                ForEach(evidence) { item in
                    BuildTestingVisualEvidenceItemView(evidence: item)
                }
            }
            .padding(.top, 10)
        } label: {
            Label(
                "Visual evidence · \(evidence.count)",
                systemImage: "photo.on.rectangle.angled"
            )
            .font(T3Typography.supportingStrong)
            .foregroundStyle(T3Colors.textPrimary)
        }
        .tint(T3Colors.accent)
    }
}
