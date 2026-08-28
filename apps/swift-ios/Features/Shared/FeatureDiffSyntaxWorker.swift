/// A serial executor keeps bounded diff lexing away from SwiftUI main-actor rendering.
actor FeatureDiffSyntaxWorker {
    static let shared = FeatureDiffSyntaxWorker()

    func lines(
        for file: FeatureReviewFile,
        lines: [FeatureDiffLine]
    ) -> [FeatureDiffSyntaxLine] {
        guard Task.isCancelled == false else { return [] }
        return FeatureDiffSyntaxHighlighter.lines(for: file, lines: lines)
    }
}
