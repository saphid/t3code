import SwiftUI

struct BuildTestingPipelineDiagram: View {
    @State private var isExpanded = false

    var body: some View {
        DisclosureGroup(isExpanded: $isExpanded) {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(BuildTestingPipelineStage.stages.enumerated()), id: \.element.id) { index, stage in
                    BuildTestingPipelineStageRow(
                        stage: stage,
                        showsConnector: index < BuildTestingPipelineStage.stages.count - 1
                    )
                }
            }
            .padding(.top, 14)
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                Text("Proposed PR promotion flow")
                    .font(T3Typography.homeTitle)
                    .foregroundStyle(T3Colors.textPrimary)
                Text("This is the proposed shape: automated gates prove each branch, while your approvals confirm the exact builds installed on your phone.")
                    .font(T3Typography.supporting)
                    .foregroundStyle(T3Colors.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .multilineTextAlignment(.leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .tint(T3Colors.accent)
        .padding(16)
        .background(T3Colors.surface, in: RoundedRectangle(cornerRadius: 14))
        .overlay {
            RoundedRectangle(cornerRadius: 14)
                .stroke(T3Colors.border, lineWidth: 1)
        }
    }
}
