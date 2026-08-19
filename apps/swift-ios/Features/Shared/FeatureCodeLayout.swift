import CoreGraphics
import Foundation

/// Width arithmetic for the scrollable code surfaces.
///
/// A `LazyVStack` sizes its cross axis from the proposal it receives, so inside a horizontally
/// scrollable `ScrollView` it never grows past the viewport no matter how wide its rows are: the
/// scroll view's content width equals its own width, there is nothing to scroll, and long lines
/// are simply clipped behind the trailing edge. The fix is to hand the stack one definite width
/// resolved from the file itself, which these helpers compute.
public enum FeatureCodeLayout {
    private struct Candidate {
        let index: Int
        let weight: Int
    }

    /// Widest the surface is allowed to grow. Beyond this a phone-sized viewport is scrolling
    /// through more line than anyone reads, and the scroll view pays for content it never shows.
    public static let maximumContentWidth: CGFloat = 24_000

    /// Content width for a code surface whose widest line renders `widestLineWidth` points wide.
    ///
    /// Never narrower than the viewport, so short files still fill the screen and row
    /// backgrounds run edge to edge.
    public static func contentWidth(
        widestLineWidth: CGFloat,
        leadingInset: CGFloat,
        trailingInset: CGFloat,
        viewportWidth: CGFloat
    ) -> CGFloat {
        guard widestLineWidth.isFinite, widestLineWidth > 0 else {
            return max(viewportWidth, 0)
        }
        let required = leadingInset + widestLineWidth + trailingInset
        return min(max(max(viewportWidth, 0), required), maximumContentWidth)
    }

    /// Indices of the lines worth measuring with real text metrics.
    ///
    /// Measuring every line of a large file is wasted work when only the longest can win, but
    /// ranking by `count` alone is wrong for tabs and for scripts whose glyphs are wider than a
    /// Latin monospace advance — so candidates are ranked by an estimate and only the top
    /// `limit` of them are handed to the layout engine.
    public static func measurementCandidates(
        for lines: [FeatureSourceLine],
        limit: Int = 48
    ) -> [Int] {
        guard limit > 0 else { return [] }
        var ranked: [Candidate] = []
        ranked.reserveCapacity(lines.count)
        for index in lines.indices {
            let weight = displayWeight(of: lines[index].text)
            guard weight > 0 else { continue }
            ranked.append(Candidate(index: index, weight: weight))
        }
        ranked.sort { left, right in
            if left.weight != right.weight { return left.weight > right.weight }
            return left.index < right.index
        }
        var selected: [Int] = ranked.prefix(limit).map { $0.index }
        selected.sort()
        return selected
    }

    /// Rough rendered width of `text` in monospace character cells.
    ///
    /// Tabs advance to the next stop rather than one cell, and East Asian glyphs occupy two
    /// cells; both would otherwise make a long line look short to a `count`-based ranking.
    public static func displayWeight(of text: String) -> Int {
        var weight = 0
        for scalar in text.unicodeScalars {
            switch scalar {
            case "\t":
                weight += 4
            case let scalar where scalar.value >= 0x1100:
                weight += 2
            default:
                weight += 1
            }
        }
        return weight
    }
}
