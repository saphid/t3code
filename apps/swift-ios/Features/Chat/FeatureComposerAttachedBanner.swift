import SwiftUI

struct FeatureComposerAttachedBanner<Content: View>: View {
    @Environment(\.displayScale) private var displayScale

    @ViewBuilder let content: Content

    var body: some View {
        content
            .padding(.bottom, overlap)
            .background(T3Colors.input.opacity(0.98), in: bannerShape)
            .overlay {
                bannerShape
                    .stroke(T3Colors.inputBorder, lineWidth: 1)
            }
            .clipShape(bannerShape)
            .padding(.horizontal, 12 + FeatureComposerAttachmentLayout.horizontalInset)
            .padding(.bottom, -overlap)
    }

    private var overlap: CGFloat {
        FeatureComposerAttachmentLayout.overlap(
            hasAttachedBanner: true,
            displayScale: displayScale
        )
    }

    private var bannerShape: UnevenRoundedRectangle {
        UnevenRoundedRectangle(
            topLeadingRadius: FeatureComposerAttachmentLayout.shoulderDepth,
            bottomLeadingRadius: 0,
            bottomTrailingRadius: 0,
            topTrailingRadius: FeatureComposerAttachmentLayout.shoulderDepth
        )
    }
}
