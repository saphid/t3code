import Foundation
import Testing
@testable import T3Code

@Suite("Attachment ordinals")
struct AttachmentOrdinalTests {
    private static func attachment(named filename: String) -> FeatureDraftAttachment {
        FeatureDraftAttachment(
            data: Data([0x01]),
            filename: filename,
            mimeType: "image/jpeg"
        )
    }

    private static func names(_ filenames: String...) -> [String] {
        filenames
    }

    // MARK: - Reading a generated name

    @Test
    func aGeneratedNameRoundTripsThroughItsOrdinal() throws {
        for ordinal in [1, 2, 8, 137] {
            let filename = FeatureAttachmentOrdinal.filename(ordinal)
            #expect(FeatureAttachmentOrdinal.read(from: filename) == ordinal)
        }
    }

    @Test
    func namesThisAppDidNotGenerateHoldNoOrdinal() {
        for filename in ["photo.jpg", "Image .jpg", "Image 2.png", "Image two.jpg", "Image -1.jpg"] {
            #expect(FeatureAttachmentOrdinal.read(from: filename) == nil)
        }
    }

    @Test
    func theHighestOrdinalIgnoresUnrelatedNames() {
        #expect(FeatureAttachmentOrdinal.highest(in: Self.names("Image 1.jpg", "receipt.pdf")) == 1)
        #expect(FeatureAttachmentOrdinal.highest(in: Self.names("Image 3.jpg", "Image 1.jpg")) == 3)
        #expect(FeatureAttachmentOrdinal.highest(in: Self.names("scan.jpg")) == 0)
        #expect(FeatureAttachmentOrdinal.highest(in: []) == 0)
    }

    // MARK: - Reserving

    @Test
    func aSingleMultiImagePasteKeepsItsOrdinalsConsecutiveAndInOrder() {
        var state = FeatureAttachmentPreparationState()

        let paste = state.begin(itemCount: 3, after: [])

        #expect(paste.ordinal(at: 0) == 1)
        #expect(paste.ordinal(at: 1) == 2)
        #expect(paste.ordinal(at: 2) == 3)
    }

    @Test
    func aFailedItemDoesNotReturnItsOrdinalToTheNextIntake() {
        var state = FeatureAttachmentPreparationState()

        // A three-image paste where only the second image decodes.
        let paste = state.begin(itemCount: 3, after: [])
        let survivor = Self.attachment(
            named: FeatureAttachmentOrdinal.filename(paste.ordinal(at: 1))
        )
        state.finish(paste)

        let next = state.begin(itemCount: 1, after: [survivor.filename])

        #expect(survivor.filename == "Image 2.jpg")
        #expect(next.ordinal(at: 0) == 4)
    }

    @Test
    func overlappingIntakesNeverShareAnOrdinal() {
        var state = FeatureAttachmentPreparationState()

        let first = state.begin(itemCount: 2, after: [])
        // The second paste starts while the first is still preparing, so it can
        // see none of the first paste's attachments in the draft yet.
        let second = state.begin(itemCount: 2, after: [])

        let issued = [
            first.ordinal(at: 0), first.ordinal(at: 1),
            second.ordinal(at: 0), second.ordinal(at: 1),
        ]

        #expect(issued == [1, 2, 3, 4])
        #expect(Set(issued).count == issued.count)
    }

    @Test
    func removingAnAttachmentCannotHandItsNeighboursNameToALaterIntake() {
        var state = FeatureAttachmentPreparationState()

        let paste = state.begin(itemCount: 2, after: [])
        state.finish(paste)
        let first = Self.attachment(named: FeatureAttachmentOrdinal.filename(paste.ordinal(at: 0)))
        let second = Self.attachment(named: FeatureAttachmentOrdinal.filename(paste.ordinal(at: 1)))

        // The user removes "Image 1.jpg" before sending, leaving "Image 2.jpg".
        let remaining = [second]
        let next = state.begin(itemCount: 1, after: remaining.map(\.filename))

        #expect(first.filename == "Image 1.jpg")
        #expect(second.filename == "Image 2.jpg")
        #expect(next.ordinal(at: 0) == 3)
    }

    @Test
    func aRestoredDraftRaisesTheFloorForAComposerThatNeverNumberedIt() {
        // A fresh composer knows nothing about the draft it just restored.
        var state = FeatureAttachmentPreparationState()

        let restored = ["Image 1.jpg", "Image 2.jpg", "Image 3.jpg"]
        let next = state.begin(itemCount: 1, after: restored)

        #expect(next.ordinal(at: 0) == 4)
    }

    @Test
    func cancellingAnIntakeStillSpendsItsOrdinals() {
        var state = FeatureAttachmentPreparationState()

        // Accepted, then every item failed or the user backed out: no
        // attachment ever reached the draft.
        let cancelled = state.begin(itemCount: 2, after: [])
        state.finish(cancelled)

        let next = state.begin(itemCount: 1, after: [])

        #expect(next.ordinal(at: 0) == 3)
    }

    @Test
    func releasingRestartsNumberingOnlyWhenNothingIsInFlight() {
        var state = FeatureAttachmentPreparationState()

        let sent = state.begin(itemCount: 2, after: [])
        state.finish(sent)
        state.releaseOrdinals()

        #expect(state.begin(itemCount: 1, after: []).ordinal(at: 0) == 1)

        var busy = FeatureAttachmentPreparationState()
        let inFlight = busy.begin(itemCount: 2, after: [])
        busy.releaseOrdinals()

        // The in-flight paste still owns ordinals 1 and 2.
        #expect(busy.begin(itemCount: 1, after: []).ordinal(at: 0) == 3)
        busy.finish(inFlight)
    }

    // MARK: - When numbering may restart

    @Test
    func aSettledDraftRestartsNumberingButASendInFlightDoesNot() {
        #expect(FeatureComposerAttachmentOrdinalPolicy.releasesOrdinals(
            attachmentsAreEmpty: true,
            isPreparingAttachments: false,
            isSending: false
        ))

        // Send clears the composer before the request completes. A failed send
        // puts those attachments back, so their names are not free yet.
        #expect(FeatureComposerAttachmentOrdinalPolicy.releasesOrdinals(
            attachmentsAreEmpty: true,
            isPreparingAttachments: false,
            isSending: true
        ) == false)
        #expect(FeatureComposerAttachmentOrdinalPolicy.releasesOrdinals(
            attachmentsAreEmpty: true,
            isPreparingAttachments: true,
            isSending: false
        ) == false)
        #expect(FeatureComposerAttachmentOrdinalPolicy.releasesOrdinals(
            attachmentsAreEmpty: false,
            isPreparingAttachments: false,
            isSending: false
        ) == false)
    }

    // MARK: - Merging a share into a draft

    @Test
    func anImportedShareIsRenumberedPastTheDraftItJoins() {
        let incoming = [
            Self.attachment(named: "Image 1.jpg"),
            Self.attachment(named: "Image 2.jpg"),
        ]

        let merged = FeatureAttachmentOrdinal.renumbered(
            incoming,
            after: Self.names("Image 1.jpg", "Image 2.jpg")
        )

        #expect(merged.map(\.filename) == ["Image 3.jpg", "Image 4.jpg"])
    }

    @Test
    func renumberingLeavesNamesThisAppDidNotGenerateAlone() {
        let incoming = [
            Self.attachment(named: "scan.jpg"),
            Self.attachment(named: "Image 1.jpg"),
        ]

        let merged = FeatureAttachmentOrdinal.renumbered(
            incoming,
            after: Self.names("Image 4.jpg")
        )

        #expect(merged.map(\.filename) == ["scan.jpg", "Image 5.jpg"])
    }

    @Test
    func renumberingAnEmptyDraftKeepsTheShareNumberedFromOne() {
        let incoming = [Self.attachment(named: "Image 1.jpg")]

        let merged = FeatureAttachmentOrdinal.renumbered(incoming, after: [])

        #expect(merged.map(\.filename) == ["Image 1.jpg"])
    }
}
