import SwiftUI

struct EnvironmentBadgeView: View {
    @SwiftUI.Environment(\.dynamicTypeSize) private var dynamicTypeSize

    let presentation: EnvironmentBadgePresentation
    var showsDisclosure = false

    var body: some View {
        Group {
            if EnvironmentBadgeLayout.includesFullLabel(
                isAccessibilitySize: dynamicTypeSize.isAccessibilitySize
            ) {
                ViewThatFits(in: .horizontal) {
                    content(label: presentation.fullLabel, isCompact: false)
                        .fixedSize(horizontal: true, vertical: false)
                    compactContent
                    minimalContent
                        .fixedSize(horizontal: true, vertical: false)
                }
            } else {
                ViewThatFits(in: .horizontal) {
                    compactContent
                    minimalContent
                        .fixedSize(horizontal: true, vertical: false)
                }
            }
        }
        .frame(
            maxWidth: .infinity,
            minHeight: T3Metrics.minimumTapTarget,
            alignment: .leading
        )
        .clipped()
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(presentation.accessibilityLabel)
    }

    private var compactContent: some View {
        content(label: presentation.compactLabel, isCompact: true)
    }

    private func content(label: String, isCompact: Bool) -> some View {
        HStack(spacing: isCompact ? 5 : 7) {
            leadingIdentity

            if case .environment = presentation.content {
                Text(label)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .layoutPriority(-1)
            } else if !isCompact {
                Text("Code")
                    .fontWeight(.medium)
                    .foregroundStyle(T3Colors.textSecondary)
            }

            channelBadge

            if showsDisclosure {
                Image(systemName: "chevron.down")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(T3Colors.textTertiary)
                    .accessibilityHidden(true)
            }
        }
        .font(badgeFont)
        .foregroundStyle(foregroundStyle)
    }

    @ViewBuilder
    private var leadingIdentity: some View {
        switch presentation.content {
        case .brand:
            Text("T3")
                .bold()
                .foregroundStyle(T3Colors.textPrimary)
        case let .environment(_, status, _):
            Image(systemName: status.systemImage)
                .font(.system(size: 13, weight: .semibold))
                .accessibilityHidden(true)
        }
    }

    @ViewBuilder
    private var channelBadge: some View {
        if let channel = presentation.channel.badgeLabel {
            Text(channel)
                .font(.caption.weight(.semibold))
                .lineLimit(1)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .foregroundStyle(T3Colors.warning)
                .background(T3Colors.warning.opacity(0.14), in: Capsule())
                .fixedSize(horizontal: true, vertical: false)
        }
    }

    private var minimalContent: some View {
        HStack(spacing: 5) {
            leadingIdentity
            channelBadge
            if showsDisclosure {
                Image(systemName: "chevron.down")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(T3Colors.textTertiary)
                    .accessibilityHidden(true)
            }
        }
        .foregroundStyle(foregroundStyle)
    }

    private var badgeFont: Font {
        dynamicTypeSize.isAccessibilitySize
            ? T3Typography.supportingStrong
            : .system(size: presentation.status == nil ? 16 : 14, weight: .semibold)
    }

    private var foregroundStyle: Color {
        switch presentation.status {
        case .connecting, .reconnecting: T3Colors.warning
        case .disconnected, .disabled: T3Colors.danger
        case .connected, nil: T3Colors.textSecondary
        }
    }
}
