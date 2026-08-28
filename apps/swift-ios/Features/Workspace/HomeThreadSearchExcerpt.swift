import SwiftUI

/// A bounded, single-line quote of the message that made a thread match Home
/// search, so a result explains itself instead of showing only its metadata.
///
/// The server owns the search index and returns a snippet per match; this type
/// only decides how much of that snippet to show and which ranges inside it are
/// the query. Mirrors the React Native client's `ThreadSearchMatchExcerpt`.
struct HomeThreadSearchExcerpt: Equatable {
    typealias Source = FeatureThreadSearchMatch.Source

    /// One run of the excerpt. `isMatch` runs carry the query occurrence and
    /// are the only ones the row emphasises.
    struct Segment: Equatable {
        let text: String
        let isMatch: Bool
    }

    /// The ellipsis is part of the text so callers never re-derive whether the
    /// snippet was trimmed.
    static let ellipsis = "…"

    /// Roughly how much of a snippet one row renders before truncating. A match
    /// beyond it would be cut off, so the excerpt scrolls its window forward.
    private static let visibleLineBudget = 48
    /// How much text to keep ahead of a windowed match so it still reads as a
    /// sentence rather than starting mid-thought.
    private static let leadingContext = 12
    /// A hard cap, since a whole snippet can be far longer than a row shows.
    private static let maximumLength = 120

    let source: Source
    let segments: [Segment]

    var text: String {
        segments.map(\.text).joined()
    }

    /// VoiceOver does not announce emphasis, so the matching text is named
    /// rather than only styled.
    func accessibilityDescription(query: String) -> String {
        let normalizedQuery = Self.collapseWhitespace(query)
        return "Matched message from \(source.spokenName), \"\(text)\", matching \"\(normalizedQuery)\""
    }

    /// Returns `nil` when the query is empty or the snippet does not contain
    /// it, which keeps metadata-only results on their ordinary presentation.
    static func resolve(match: FeatureThreadSearchMatch, query: String) -> Self? {
        let normalizedQuery = collapseWhitespace(query)
        guard !normalizedQuery.isEmpty else { return nil }
        let snippet = collapseWhitespace(match.snippet)
        let matches = matchRanges(in: snippet, query: normalizedQuery)
        guard let firstMatch = matches.first else { return nil }

        let window = window(in: snippet, around: firstMatch)
        return Self(
            source: match.source,
            segments: segments(in: snippet, window: window, matches: matches)
        )
    }

    /// Snippets arrive with the message's original newlines and runs of spaces;
    /// a one-line row needs them flattened before any offset is measured.
    private static func collapseWhitespace(_ value: String) -> String {
        value.split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }

    private struct Window {
        let bounds: Range<String.Index>
        let truncated: (leading: Bool, trailing: Bool)
    }

    /// A snippet whose match already falls on the visible line is shown as it
    /// arrived; only a match past that point needs its own window, and then a
    /// little leading context keeps the quote readable.
    private static func window(
        in snippet: String,
        around match: Range<String.Index>
    ) -> Window {
        var start = snippet.startIndex
        if snippet.distance(from: snippet.startIndex, to: match.lowerBound) > visibleLineBudget {
            start = snippet.index(match.lowerBound, offsetBy: -leadingContext)
            start = wordBoundary(in: snippet, at: start, upperLimit: match.lowerBound)
        }

        var end = snippet.endIndex
        if snippet.distance(from: start, to: snippet.endIndex) > maximumLength {
            end = snippet.index(start, offsetBy: maximumLength)
        }

        let leadingTruncated = start != snippet.startIndex
        let trailingTruncated = end != snippet.endIndex
        return Window(
            bounds: start..<end,
            truncated: (leadingTruncated, trailingTruncated)
        )
    }

    /// Snapping to the next space avoids opening the excerpt mid-word.
    private static func wordBoundary(
        in snippet: String,
        at index: String.Index,
        upperLimit: String.Index
    ) -> String.Index {
        guard let space = snippet.range(of: " ", range: index..<upperLimit) else { return index }
        return space.upperBound
    }

    /// Mirrors the server and React Native client's ASCII-only case folding.
    /// Replacing ASCII scalars preserves every UTF-16 offset, so match ranges
    /// can be mapped back to the original snippet without losing emoji or
    /// composed Unicode boundaries.
    private static func foldAsciiCase(_ value: String) -> String {
        var result = ""
        for scalar in value.unicodeScalars {
            if scalar.value >= 65, scalar.value <= 90,
               let lowercased = UnicodeScalar(scalar.value + 32) {
                result.unicodeScalars.append(lowercased)
            } else {
                result.unicodeScalars.append(scalar)
            }
        }
        return result
    }

    private static func matchRanges(
        in text: String,
        query: String
    ) -> [Range<String.Index>] {
        let foldedText = foldAsciiCase(text)
        let foldedQuery = foldAsciiCase(query)
        guard !foldedQuery.isEmpty else { return [] }

        var ranges: [Range<String.Index>] = []
        var cursor = foldedText.startIndex
        while cursor < foldedText.endIndex,
              let found = foldedText.range(
                  of: foldedQuery,
                  options: .literal,
                  range: cursor..<foldedText.endIndex
              ) {
            let lowerOffset = found.lowerBound.utf16Offset(in: foldedText)
            let upperOffset = found.upperBound.utf16Offset(in: foldedText)
            let lowerBound = String.Index(utf16Offset: lowerOffset, in: text)
            let upperBound = String.Index(utf16Offset: upperOffset, in: text)
            ranges.append(lowerBound..<upperBound)
            cursor = found.upperBound
        }
        return ranges
    }

    /// Splits the bounded window into alternating plain and matching runs.
    /// A protocol-valid query can be longer than the display budget, so the
    /// visible intersection stays highlighted without expanding the row.
    private static func segments(
        in snippet: String,
        window: Window,
        matches: [Range<String.Index>]
    ) -> [Segment] {
        var segments: [Segment] = []
        if window.truncated.leading {
            segments.append(Segment(text: ellipsis, isMatch: false))
        }

        var cursor = window.bounds.lowerBound
        for match in matches {
            let lowerBound = max(match.lowerBound, window.bounds.lowerBound)
            let upperBound = min(match.upperBound, window.bounds.upperBound)
            guard lowerBound < upperBound else { continue }
            if lowerBound > cursor {
                segments.append(
                    Segment(text: String(snippet[cursor..<lowerBound]), isMatch: false)
                )
            }
            segments.append(
                Segment(text: String(snippet[lowerBound..<upperBound]), isMatch: true)
            )
            cursor = upperBound
        }
        if cursor < window.bounds.upperBound {
            segments.append(
                Segment(text: String(snippet[cursor..<window.bounds.upperBound]), isMatch: false)
            )
        }
        if window.truncated.trailing {
            segments.append(Segment(text: ellipsis, isMatch: false))
        }
        return segments
    }
}

private extension FeatureThreadSearchMatch.Source {
    var label: String {
        switch self {
        case .user: "You:"
        case .agent: "Agent:"
        }
    }

    var spokenName: String {
        switch self {
        case .user: "you"
        case .agent: "the agent"
        }
    }
}

/// Renders one excerpt as a single bounded line under a Home row's title.
struct HomeThreadSearchExcerptView: View {
    let excerpt: HomeThreadSearchExcerpt

    var body: some View {
        Text(attributed)
            .font(T3Typography.homeMetadata)
            .lineLimit(1)
            .truncationMode(.tail)
            .accessibilityHidden(true)
    }

    private var attributed: AttributedString {
        var result = AttributedString(excerpt.source.label + " ")
        result.foregroundColor = sourceColor
        result.font = T3Typography.homeMetadata.weight(.semibold)
        for segment in excerpt.segments {
            var run = AttributedString(segment.text)
            run.foregroundColor = segment.isMatch ? T3Colors.textPrimary : T3Colors.textTertiary
            run.font = segment.isMatch
                ? T3Typography.homeMetadata.weight(.bold)
                : T3Typography.homeMetadata
            result.append(run)
        }
        return result
    }

    private var sourceColor: Color {
        switch excerpt.source {
        case .user: T3Colors.statusInput
        case .agent: T3Colors.syntaxProperty
        }
    }
}
