import CoreGraphics

enum FeatureComposerAttachmentLayout {
    static let shoulderDepth: CGFloat = 16
    static let horizontalInset: CGFloat = 10

    static func overlap(
        hasAttachedBanner: Bool,
        displayScale: CGFloat
    ) -> CGFloat {
        guard hasAttachedBanner else { return 0 }
        return shoulderDepth + 1 / max(displayScale, 1)
    }
}
