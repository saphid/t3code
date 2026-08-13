import SwiftUI

struct BuildTestingPipelineStageRow: View {
    let stage: BuildTestingPipelineStage
    let showsConnector: Bool

    @ScaledMetric(relativeTo: .body) private var markerSize = 38

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(spacing: 0) {
                Text(stage.number, format: .number)
                    .font(T3Typography.supportingStrong)
                    .foregroundStyle(gateColor)
                    .frame(width: min(markerSize, 56), height: min(markerSize, 56))
                    .background(T3Colors.surfaceRaised, in: .circle)
                    .overlay {
                        Circle()
                            .stroke(gateColor, lineWidth: 1)
                    }
                    .accessibilityHidden(true)

                if showsConnector {
                    Rectangle()
                        .fill(T3Colors.border)
                        .frame(width: 2)
                        .frame(maxHeight: .infinity)
                        .accessibilityHidden(true)
                }
            }

            VStack(alignment: .leading, spacing: 6) {
                Text(stage.title)
                    .font(T3Typography.threadBody)
                    .bold()
                    .foregroundStyle(T3Colors.textPrimary)

                Text(stage.detail)
                    .font(T3Typography.supporting)
                    .foregroundStyle(T3Colors.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)

                Label(gateLabel, systemImage: gateIcon)
                    .font(T3Typography.supportingStrong)
                    .foregroundStyle(T3Colors.textPrimary)
            }
            .padding(.bottom, showsConnector ? 12 : 0)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
    }

    private var gateLabel: String {
        switch stage.gate {
        case .agentAndAutomation: "Agent proof + automated gate"
        case .automation: "Automated gate"
        case .human: "Your approval"
        case .maintainer: "Maintainer gate"
        }
    }

    private var gateIcon: String {
        switch stage.gate {
        case .agentAndAutomation: "checkmark.seal.fill"
        case .automation: "gearshape.2.fill"
        case .human: "person.crop.circle.badge.checkmark"
        case .maintainer: "arrow.up.right.square.fill"
        }
    }

    private var gateColor: Color {
        switch stage.gate {
        case .agentAndAutomation, .automation: T3Colors.accent
        case .human: T3Colors.warning
        case .maintainer: T3Colors.success
        }
    }

    private var accessibilityLabel: String {
        "Step \(stage.number), \(stage.title). \(stage.detail) \(gateLabel)."
    }
}
