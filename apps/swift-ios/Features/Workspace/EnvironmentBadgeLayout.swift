import CoreGraphics

enum EnvironmentBadgeLayout {
    static let headerSpacing: CGFloat = 2
    static let headerLeadingInset: CGFloat = 15
    static let headerTrailingInset: CGFloat = 8
    static let trailingActionWidth: CGFloat = 40

    static func includesFullLabel(isAccessibilitySize: Bool) -> Bool {
        !isAccessibilitySize
    }

    static func maximumBadgeWidth(
        containerWidth: CGFloat,
        trailingActionCount: Int
    ) -> CGFloat {
        let actionCount = max(0, trailingActionCount)
        let actionWidths = CGFloat(actionCount) * trailingActionWidth
        let gaps = CGFloat(actionCount) * headerSpacing
        return max(
            0,
            containerWidth
                - headerLeadingInset
                - headerTrailingInset
                - actionWidths
                - gaps
        )
    }
}
