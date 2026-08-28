import Foundation

/// The generated name for an attached image the user pasted, dropped, picked,
/// captured, or shared into a draft.
///
/// A name carries an ordinal so the user and the agent can say "Image 2"
/// without opening it, which only works while no two attachments in one draft
/// share a number. Deriving the ordinal from a position — `count + 1` — holds
/// only while position matches what was actually issued, and it stops matching
/// as soon as an intake fails partway, two intakes overlap, or the user removes
/// an attachment before sending. Ordinals are therefore reserved, never
/// recomputed: see `FeatureAttachmentPreparationState.begin(itemCount:after:)`.
enum FeatureAttachmentOrdinal {
    private static let prefix = "Image "
    private static let suffix = ".jpg"

    static func filename(_ ordinal: Int) -> String {
        "\(prefix)\(ordinal)\(suffix)"
    }

    /// The ordinal inside a name this app generated, or nil for any other name.
    /// Reading a name back is what lets a new intake reserve past attachments
    /// it never numbered itself, such as a restored draft or an imported share.
    static func read(from filename: String) -> Int? {
        guard filename.hasPrefix(prefix), filename.hasSuffix(suffix) else { return nil }
        let digits = filename.dropFirst(prefix.count).dropLast(suffix.count)
        guard !digits.isEmpty,
              digits.allSatisfy({ $0.isASCII && $0.isNumber }) else { return nil }
        return Int(digits)
    }

    /// The highest ordinal `filenames` already spends. Names this app did not
    /// generate hold no ordinal, so nothing can collide with them.
    static func highest(in filenames: [String]) -> Int {
        filenames.compactMap(read(from:)).max() ?? 0
    }

    /// Renumbers `incoming` past everything `existingNames` already spends,
    /// keeping the incoming order. Used where attachments numbered by one
    /// producer are merged into a draft numbered by another, which is the one
    /// case where reserving up front is not possible: the merge decides what
    /// the draft holds.
    static func renumbered(
        _ incoming: [FeatureDraftAttachment],
        after existingNames: [String]
    ) -> [FeatureDraftAttachment] {
        var next = highest(in: existingNames)
        return incoming.map { attachment in
            guard read(from: attachment.filename) != nil else { return attachment }
            next += 1
            var renamed = attachment
            renamed.filename = filename(next)
            return renamed
        }
    }
}
