import Foundation
import Testing
import UIKit
import UniformTypeIdentifiers
@testable import T3Code

@Suite("Composer image paste")
@MainActor
struct ComposerImagePasteTests {
    @Test
    func pastedImagesAreAcceptedUpToTheAttachmentLimit() {
        let plan = FeatureComposerPastePlan.make(
            providerCount: 3,
            attachedCount: 1,
            pendingCount: 0
        )

        #expect(plan.acceptedCount == 3)
        #expect(plan.message == nil)
    }

    @Test
    func pasteBeyondTheLimitAttachesWhatFitsAndDiscloses() {
        let plan = FeatureComposerPastePlan.make(
            providerCount: 4,
            attachedCount: 6,
            pendingCount: 0,
            limit: 8
        )

        #expect(plan.acceptedCount == 2)
        #expect(plan.message == "Only 2 of 4 images were attached. You can attach up to 8.")
    }

    @Test
    func imagesStillPreparingCountAgainstTheLimit() {
        let plan = FeatureComposerPastePlan.make(
            providerCount: 2,
            attachedCount: 5,
            pendingCount: 3,
            limit: 8
        )

        #expect(plan.acceptedCount == 0)
        #expect(plan.message == "You can attach up to 8 images.")
    }

    @Test
    func pasteWithoutImagesIsSilent() {
        let plan = FeatureComposerPastePlan.make(
            providerCount: 0,
            attachedCount: 0,
            pendingCount: 0
        )

        #expect(plan.acceptedCount == 0)
        #expect(plan.message == nil)
    }

    @Test
    func imagePasteboardOffersThePasteMenuEntry() throws {
        let pasteboard = try #require(UIPasteboard(name: .init(rawValue: "t3.paste.image"), create: true))
        defer { UIPasteboard.remove(withName: pasteboard.name) }
        pasteboard.setData(Self.pngData(), forPasteboardType: UTType.png.identifier)

        #expect(FeatureComposerPasteboardPolicy.containsImage(in: pasteboard))
        #expect(FeatureComposerPasteboardPolicy.imageProviders(in: pasteboard).count == 1)
    }

    @Test
    func textOnlyPasteboardLeavesTheDefaultPasteBehaviourAlone() throws {
        let pasteboard = try #require(UIPasteboard(name: .init(rawValue: "t3.paste.text"), create: true))
        defer { UIPasteboard.remove(withName: pasteboard.name) }
        pasteboard.string = "just words"

        #expect(!FeatureComposerPasteboardPolicy.containsImage(in: pasteboard))
        #expect(FeatureComposerPasteboardPolicy.imageProviders(in: pasteboard).isEmpty)
    }

    @Test
    func pastedBytesBecomeADraftAttachmentThroughTheSharedPipeline() async throws {
        let attachment = try await FeatureImageAttachmentLoader.attachment(
            from: Self.pngData(),
            ordinal: 3
        )

        #expect(attachment.filename == "Image 3.jpg")
        #expect(attachment.mimeType == "image/jpeg")
        #expect(!attachment.data.isEmpty)
        #expect(attachment.thumbnailData?.isEmpty == false)

        // The same shape the turn command uploads for picker attachments.
        let upload = try UploadChatImageAttachment(
            data: attachment.data,
            name: attachment.filename,
            mimeType: attachment.mimeType
        )
        #expect(upload.dataUrl.hasPrefix("data:image/jpeg;base64,"))
    }

    @Test
    func composerGrowsToSevenLinesThenScrolls() {
        let lineHeight: CGFloat = 20

        #expect(FeatureComposerTextInputSizing.height(
            fittingHeight: 8,
            lineHeight: lineHeight,
            maximumLineCount: 7
        ) == 20)
        #expect(FeatureComposerTextInputSizing.height(
            fittingHeight: 60,
            lineHeight: lineHeight,
            maximumLineCount: 7
        ) == 60)
        #expect(FeatureComposerTextInputSizing.height(
            fittingHeight: 400,
            lineHeight: lineHeight,
            maximumLineCount: 7
        ) == 140)
    }

    private static func pngData() -> Data {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: CGSize(width: 24, height: 18), format: format)
            .pngData { context in
                UIColor.systemTeal.setFill()
                context.fill(CGRect(x: 0, y: 0, width: 24, height: 18))
            }
    }
}
